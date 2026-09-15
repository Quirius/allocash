use crate::{
    database::Database,
    ledger::{Huf, LedgerError, LedgerResult},
};
use rusqlite::params;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanMonth(String);
impl PlanMonth {
    pub fn parse(value: &str) -> LedgerResult<Self> {
        let bytes = value.as_bytes();
        if bytes.len() != 7
            || bytes[4] != b'-'
            || !bytes
                .iter()
                .enumerate()
                .all(|(i, b)| i == 4 || b.is_ascii_digit())
        {
            return Err(LedgerError::InvalidValue("Expected a yyyy-mm plan month."));
        }
        let year: i32 = value[..4].parse().unwrap();
        let month: u32 = value[5..].parse().unwrap();
        if year == 0 || !(1..=12).contains(&month) {
            return Err(LedgerError::InvalidValue("Invalid plan month."));
        }
        Ok(Self(value.into()))
    }
    fn start(&self) -> String {
        format!("{}-01", self.0)
    }
    fn next_start(&self) -> String {
        let year: i32 = self.0[..4].parse().unwrap();
        let month: u32 = self.0[5..].parse().unwrap();
        if month == 12 {
            format!("{:04}-01-01", year + 1)
        } else {
            format!("{:04}-{:02}-01", year, month + 1)
        }
    }
    fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanCategory {
    pub group_id: String,
    pub group_name: String,
    pub category_id: String,
    pub category_name: String,
    pub assigned: Huf,
    pub activity: Huf,
    pub available: Huf,
}
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSnapshot {
    pub month: String,
    pub ready_to_assign: Huf,
    pub categories: Vec<PlanCategory>,
}

impl Database {
    pub fn set_monthly_assignment(
        &self,
        category_id: &str,
        month: &PlanMonth,
        amount: Huf,
    ) -> LedgerResult<()> {
        let exists: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1)",
            [category_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(LedgerError::NotFound);
        }
        self.connection.execute("INSERT INTO category_month_assignments (category_id,month,amount_huf) VALUES (?1,?2,?3) ON CONFLICT(category_id,month) DO UPDATE SET amount_huf=excluded.amount_huf,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')", params![category_id, month.as_str(), amount.0])?;
        Ok(())
    }

    pub fn plan_month(&self, month: &PlanMonth) -> LedgerResult<PlanSnapshot> {
        let next = month.next_start();
        let start = month.start();
        let mut categories = Vec::new();
        let mut category_query = self.connection.prepare("SELECT g.id,g.name,c.id,c.name FROM category_groups g JOIN categories c ON c.group_id=g.id WHERE g.hidden=0 AND c.hidden=0 ORDER BY g.sort_order,c.sort_order,c.id")?;
        let mut rows = category_query.query([])?;
        while let Some(row) = rows.next()? {
            categories.push((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ));
        }
        let mut assigned = BTreeMap::<String, i128>::new();
        let mut assignment_total = 0i128;
        let mut statement = self.connection.prepare(
            "SELECT category_id,amount_huf FROM category_month_assignments WHERE month<=?1",
        )?;
        for row in statement.query_map([month.as_str()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })? {
            let (id, amount) = row?;
            *assigned.entry(id).or_default() += i128::from(amount);
            assignment_total += i128::from(amount);
        }
        let mut available_activity = BTreeMap::<String, i128>::new();
        let mut activity = BTreeMap::<String, i128>::new();
        let mut ready_income = 0i128;
        let mut entry_query = self.connection.prepare("SELECT t.category_id,t.amount_huf,t.transaction_date FROM ledger_entries t JOIN accounts a ON a.id=t.account_id WHERE t.posting_state='posted' AND t.transaction_date<?1 AND a.kind IN ('cash','credit')")?;
        let mut entries = entry_query.query([&next])?;
        while let Some(row) = entries.next()? {
            let category: Option<String> = row.get(0)?;
            let amount = i128::from(row.get::<_, i64>(1)?);
            let date: String = row.get(2)?;
            if let Some(id) = category {
                *available_activity.entry(id.clone()).or_default() += amount;
                if date >= start {
                    *activity.entry(id).or_default() += amount;
                }
            } else {
                ready_income += amount;
            }
        }
        let categories = categories
            .into_iter()
            .map(
                |(group_id, group_name, category_id, category_name)| -> LedgerResult<_> {
                    let a = *assigned.get(&category_id).unwrap_or(&0);
                    let activity_total = *available_activity.get(&category_id).unwrap_or(&0);
                    Ok(PlanCategory {
                        group_id,
                        group_name,
                        category_id: category_id.clone(),
                        category_name,
                        assigned: narrow(
                            a - assigned_before(&self.connection, &month.0, &category_id)?,
                        )?,
                        activity: narrow(*activity.get(&category_id).unwrap_or(&0))?,
                        available: narrow(a + activity_total)?,
                    })
                },
            )
            .collect::<LedgerResult<Vec<_>>>()?;
        Ok(PlanSnapshot {
            month: month.0.clone(),
            ready_to_assign: narrow(ready_income - assignment_total)?,
            categories,
        })
    }
}

fn assigned_before(
    connection: &rusqlite::Connection,
    month: &str,
    category_id: &str,
) -> LedgerResult<i128> {
    let value: Option<i64> = connection.query_row(
        "SELECT SUM(amount_huf) FROM category_month_assignments WHERE category_id=?1 AND month<?2",
        params![category_id, month],
        |row| row.get(0),
    )?;
    Ok(i128::from(value.unwrap_or(0)))
}
fn narrow(value: i128) -> LedgerResult<Huf> {
    i64::try_from(value)
        .map(Huf)
        .map_err(|_| LedgerError::AmountOverflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ledger::{Account, AccountKind, CalendarDate, Entry};
    #[test]
    fn plan_uses_posted_on_budget_activity_and_rolls_available_forward() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database
            .create_account(&Account {
                id: "cash".into(),
                name: "Cash".into(),
                kind: AccountKind::Cash,
                sort_order: 0,
                closed: false,
            })
            .unwrap();
        database.create_category_group("g", "Living", 0).unwrap();
        database.create_category("c", "g", "Food", 0).unwrap();
        database.connection.execute("INSERT INTO category_month_assignments (category_id,month,amount_huf) VALUES ('c','2026-08',1000),('c','2026-09',2000)", []).unwrap();
        let mut august = Entry::manual("a", "cash", CalendarDate::parse("2026-08-10").unwrap());
        august.category_id = Some("c".into());
        database.create_transaction(&august, Huf(-250)).unwrap();
        let mut september = Entry::manual("s", "cash", CalendarDate::parse("2026-09-10").unwrap());
        september.category_id = Some("c".into());
        database.create_transaction(&september, Huf(-500)).unwrap();
        let plan = database
            .plan_month(&PlanMonth::parse("2026-09").unwrap())
            .unwrap();
        assert_eq!(plan.categories[0].assigned, Huf(2000));
        assert_eq!(plan.categories[0].activity, Huf(-500));
        assert_eq!(plan.categories[0].available, Huf(2250));
    }

    #[test]
    fn assignment_updates_one_category_month_and_rejects_unknown_categories() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database.create_category_group("g", "Living", 0).unwrap();
        database.create_category("c", "g", "Food", 0).unwrap();
        let month = PlanMonth::parse("2026-09").unwrap();
        database
            .set_monthly_assignment("c", &month, Huf(100))
            .unwrap();
        database
            .set_monthly_assignment("c", &month, Huf(250))
            .unwrap();
        assert_eq!(
            database
                .connection
                .query_row::<i64, _, _>(
                    "SELECT amount_huf FROM category_month_assignments",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
            250
        );
        assert!(matches!(
            database.set_monthly_assignment("missing", &month, Huf(1)),
            Err(LedgerError::NotFound)
        ));
    }
}
