use crate::{
    database::Database,
    ledger::{Huf, LedgerError, LedgerResult},
};
use rusqlite::{params, OptionalExtension};
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
    pub credit_payment_categories: Vec<CreditPaymentCategory>,
}
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditPaymentCategory {
    pub account_id: String,
    pub account_name: String,
    pub category_id: Option<String>,
}

impl Database {
    pub fn set_credit_payment_category(
        &self,
        account_id: &str,
        category_id: Option<&str>,
    ) -> LedgerResult<()> {
        let kind: Option<String> = self
            .connection
            .query_row(
                "SELECT kind FROM accounts WHERE id=?1",
                [account_id],
                |row| row.get(0),
            )
            .optional()?;
        match kind.as_deref() {
            Some("credit") => {}
            Some(_) => {
                return Err(LedgerError::InvalidValue(
                    "A payment category requires a credit account.",
                ))
            }
            None => return Err(LedgerError::NotFound),
        }
        let Some(category_id) = category_id else {
            self.connection.execute(
                "DELETE FROM credit_payment_categories WHERE account_id=?1",
                [account_id],
            )?;
            return Ok(());
        };
        let category_exists: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1)",
            [category_id],
            |row| row.get(0),
        )?;
        if !category_exists {
            return Err(LedgerError::NotFound);
        }
        self.connection.execute("INSERT INTO credit_payment_categories (account_id,category_id) VALUES (?1,?2) ON CONFLICT(account_id) DO UPDATE SET category_id=excluded.category_id", params![account_id, category_id])?;
        Ok(())
    }

    pub fn move_monthly_money(
        &mut self,
        from_category_id: &str,
        to_category_id: &str,
        month: &PlanMonth,
        amount: Huf,
    ) -> LedgerResult<()> {
        if from_category_id == to_category_id || amount.0 <= 0 {
            return Err(LedgerError::InvalidValue(
                "A category move needs two categories and a positive amount.",
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM categories WHERE id IN (?1,?2)",
            params![from_category_id, to_category_id],
            |row| row.get(0),
        )?;
        if count != 2 {
            return Err(LedgerError::NotFound);
        }
        if category_available_for(&transaction, from_category_id, month)?.0 < amount.0 {
            return Err(LedgerError::InvalidValue(
                "Cannot move more than this category has available.",
            ));
        }
        let id: String = transaction.query_row(
            "SELECT 'category-move-' || lower(hex(randomblob(16)))",
            [],
            |row| row.get(0),
        )?;
        transaction.execute("INSERT INTO category_month_moves (id,month,from_category_id,to_category_id,amount_huf) VALUES (?1,?2,?3,?4,?5)", params![id, month.as_str(), from_category_id, to_category_id, amount.0])?;
        for (category_id, delta) in [(from_category_id, -amount.0), (to_category_id, amount.0)] {
            let current: Option<i64> = transaction.query_row("SELECT amount_huf FROM category_month_assignments WHERE category_id=?1 AND month=?2", params![category_id, month.as_str()], |row| row.get(0)).optional()?;
            let updated = current
                .unwrap_or(0)
                .checked_add(delta)
                .ok_or(LedgerError::AmountOverflow)?;
            transaction.execute("INSERT INTO category_month_assignments (category_id,month,amount_huf) VALUES (?1,?2,?3) ON CONFLICT(category_id,month) DO UPDATE SET amount_huf=excluded.amount_huf,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')", params![category_id, month.as_str(), updated])?;
        }
        transaction.commit()?;
        Ok(())
    }

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
        let payment_categories: BTreeMap<String, String> = self
            .connection
            .prepare("SELECT account_id,category_id FROM credit_payment_categories")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        let mut assignments_by_month = BTreeMap::<String, Vec<(String, i128)>>::new();
        let mut assignment_events = self.connection.prepare("SELECT month,category_id,amount_huf FROM category_month_assignments WHERE month<=?1 ORDER BY month,category_id")?;
        for row in assignment_events.query_map([month.as_str()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })? {
            let (assignment_month, category_id, amount) = row?;
            assignments_by_month
                .entry(assignment_month)
                .or_default()
                .push((category_id, i128::from(amount)));
        }
        let mut available = BTreeMap::<String, i128>::new();
        let mut activity = BTreeMap::<String, i128>::new();
        let mut ready_income = 0i128;
        let mut applied_through = String::new();
        let mut entry_query = self.connection.prepare("SELECT t.category_id,t.amount_huf,t.transaction_date,a.kind,t.account_id,t.transfer_id FROM ledger_entries t JOIN accounts a ON a.id=t.account_id WHERE t.posting_state='posted' AND t.transaction_date<?1 AND a.kind IN ('cash','credit') ORDER BY t.transaction_date,t.id")?;
        let mut entries = entry_query.query([&next])?;
        while let Some(row) = entries.next()? {
            let category: Option<String> = row.get(0)?;
            let amount = i128::from(row.get::<_, i64>(1)?);
            let date: String = row.get(2)?;
            let kind: String = row.get(3)?;
            let account_id: String = row.get(4)?;
            let transfer_id: Option<String> = row.get(5)?;
            let entry_month = &date[..7];
            for (assignment_month, assignments) in assignments_by_month.range((
                std::ops::Bound::Excluded(applied_through.clone()),
                std::ops::Bound::Included(entry_month.to_owned()),
            )) {
                for (category_id, assignment) in assignments {
                    *available.entry(category_id.clone()).or_default() += assignment;
                }
                applied_through = assignment_month.clone();
            }
            if let Some(id) = category {
                let before = *available.get(&id).unwrap_or(&0);
                *available.entry(id.clone()).or_default() += amount;
                if date >= start {
                    *activity.entry(id).or_default() += amount;
                }
                if kind == "credit" && amount < 0 {
                    if let Some(payment_category_id) = payment_categories.get(&account_id) {
                        let funded = before.max(0).min(-amount);
                        *available.entry(payment_category_id.clone()).or_default() += funded;
                        if date >= start {
                            *activity.entry(payment_category_id.clone()).or_default() += funded;
                        }
                    }
                }
            } else if kind == "cash" && transfer_id.is_none() {
                ready_income += amount;
            }
        }
        for (assignment_month, assignments) in assignments_by_month.range((
            std::ops::Bound::Excluded(applied_through),
            std::ops::Bound::Unbounded,
        )) {
            let _ = assignment_month;
            for (category_id, assignment) in assignments {
                *available.entry(category_id.clone()).or_default() += assignment;
            }
        }
        let categories = categories
            .into_iter()
            .map(
                |(group_id, group_name, category_id, category_name)| -> LedgerResult<_> {
                    let a = *assigned.get(&category_id).unwrap_or(&0);
                    Ok(PlanCategory {
                        group_id,
                        group_name,
                        category_id: category_id.clone(),
                        category_name,
                        assigned: narrow(
                            a - assigned_before(&self.connection, &month.0, &category_id)?,
                        )?,
                        activity: narrow(*activity.get(&category_id).unwrap_or(&0))?,
                        available: narrow(*available.get(&category_id).unwrap_or(&0))?,
                    })
                },
            )
            .collect::<LedgerResult<Vec<_>>>()?;
        let mut mapping_query = self.connection.prepare("SELECT a.id,a.name,p.category_id FROM accounts a LEFT JOIN credit_payment_categories p ON p.account_id=a.id WHERE a.kind='credit' ORDER BY a.sort_order,a.id")?;
        let credit_payment_categories = mapping_query
            .query_map([], |row| {
                Ok(CreditPaymentCategory {
                    account_id: row.get(0)?,
                    account_name: row.get(1)?,
                    category_id: row.get(2)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(PlanSnapshot {
            month: month.0.clone(),
            ready_to_assign: narrow(ready_income - assignment_total)?,
            categories,
            credit_payment_categories,
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
fn category_available_for(
    connection: &rusqlite::Connection,
    category_id: &str,
    month: &PlanMonth,
) -> LedgerResult<Huf> {
    let assignments: Option<i64> = connection.query_row(
        "SELECT SUM(amount_huf) FROM category_month_assignments WHERE category_id=?1 AND month<=?2",
        params![category_id, month.as_str()],
        |row| row.get(0),
    )?;
    let mut activity = 0i128;
    let mut query = connection.prepare("SELECT t.amount_huf FROM ledger_entries t JOIN accounts a ON a.id=t.account_id WHERE t.category_id=?1 AND t.posting_state='posted' AND t.transaction_date<?2 AND a.kind IN ('cash','credit')")?;
    let mut rows = query.query(params![category_id, month.next_start()])?;
    while let Some(row) = rows.next()? {
        activity = activity
            .checked_add(i128::from(row.get::<_, i64>(0)?))
            .ok_or(LedgerError::AmountOverflow)?;
    }
    narrow(i128::from(assignments.unwrap_or(0)) + activity)
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

    #[test]
    fn moving_money_keeps_ready_to_assign_constant_and_rolls_category_available() {
        let directory = tempfile::tempdir().unwrap();
        let mut database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database.create_category_group("g", "Living", 0).unwrap();
        database.create_category("a", "g", "Food", 0).unwrap();
        database.create_category("b", "g", "Fun", 1).unwrap();
        let month = PlanMonth::parse("2026-09").unwrap();
        database
            .set_monthly_assignment("a", &month, Huf(1000))
            .unwrap();
        database
            .move_monthly_money("a", "b", &month, Huf(250))
            .unwrap();
        let plan = database.plan_month(&month).unwrap();
        assert_eq!(plan.ready_to_assign, Huf(-1000));
        assert_eq!(plan.categories[0].available, Huf(750));
        assert_eq!(plan.categories[1].available, Huf(250));
        assert!(database
            .move_monthly_money("a", "b", &month, Huf(751))
            .is_err());
        assert_eq!(
            database.plan_month(&month).unwrap().categories[0].available,
            Huf(750)
        );
        assert!(database
            .move_monthly_money("a", "a", &month, Huf(1))
            .is_err());
    }

    #[test]
    fn credit_and_transfer_rows_do_not_inflate_ready_to_assign() {
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
        database
            .create_account(&Account {
                id: "card".into(),
                name: "Card".into(),
                kind: AccountKind::Credit,
                sort_order: 1,
                closed: false,
            })
            .unwrap();
        database
            .create_transaction(
                &Entry::manual("cash", "cash", CalendarDate::parse("2026-09-01").unwrap()),
                Huf(1000),
            )
            .unwrap();
        database
            .create_transaction(
                &Entry::manual("card", "card", CalendarDate::parse("2026-09-01").unwrap()),
                Huf(500),
            )
            .unwrap();
        assert_eq!(
            database
                .plan_month(&PlanMonth::parse("2026-09").unwrap())
                .unwrap()
                .ready_to_assign,
            Huf(1000)
        );
    }

    #[test]
    fn payment_categories_require_credit_accounts_and_stay_one_to_one() {
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
        database
            .create_account(&Account {
                id: "card".into(),
                name: "Card".into(),
                kind: AccountKind::Credit,
                sort_order: 1,
                closed: false,
            })
            .unwrap();
        database.create_category_group("g", "Payments", 0).unwrap();
        database
            .create_category("payment", "g", "Card payment", 0)
            .unwrap();
        database
            .set_credit_payment_category("card", Some("payment"))
            .unwrap();
        assert_eq!(
            database
                .connection
                .query_row::<String, _, _>(
                    "SELECT category_id FROM credit_payment_categories WHERE account_id='card'",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
            "payment"
        );
        database.set_credit_payment_category("card", None).unwrap();
        assert!(database
            .connection
            .query_row::<String, _, _>(
                "SELECT category_id FROM credit_payment_categories WHERE account_id='card'",
                [],
                |row| row.get(0)
            )
            .optional()
            .unwrap()
            .is_none());
        assert!(database
            .set_credit_payment_category("cash", Some("payment"))
            .is_err());
    }

    #[test]
    fn funded_credit_spending_moves_only_available_money_to_the_payment_category() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database
            .create_account(&Account {
                id: "card".into(),
                name: "Card".into(),
                kind: AccountKind::Credit,
                sort_order: 0,
                closed: false,
            })
            .unwrap();
        database.create_category_group("g", "Living", 0).unwrap();
        database.create_category("food", "g", "Food", 0).unwrap();
        database
            .create_category("payment", "g", "Card payment", 1)
            .unwrap();
        let month = PlanMonth::parse("2026-09").unwrap();
        database
            .set_monthly_assignment("food", &month, Huf(1_000))
            .unwrap();
        database
            .set_credit_payment_category("card", Some("payment"))
            .unwrap();
        let mut purchase = Entry::manual(
            "purchase",
            "card",
            CalendarDate::parse("2026-09-10").unwrap(),
        );
        purchase.category_id = Some("food".into());
        database.create_transaction(&purchase, Huf(-600)).unwrap();
        let plan = database.plan_month(&month).unwrap();
        assert_eq!(
            plan.categories
                .iter()
                .find(|category| category.category_id == "food")
                .unwrap()
                .available,
            Huf(400)
        );
        assert_eq!(
            plan.categories
                .iter()
                .find(|category| category.category_id == "payment")
                .unwrap()
                .available,
            Huf(600)
        );
    }

    #[test]
    fn credit_allocation_caps_at_funded_money_and_carries_the_payment_forward() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database
            .create_account(&Account {
                id: "card".into(),
                name: "Card".into(),
                kind: AccountKind::Credit,
                sort_order: 0,
                closed: false,
            })
            .unwrap();
        database.create_category_group("g", "Living", 0).unwrap();
        database.create_category("food", "g", "Food", 0).unwrap();
        database
            .create_category("payment", "g", "Card payment", 1)
            .unwrap();
        let september = PlanMonth::parse("2026-09").unwrap();
        database
            .set_monthly_assignment("food", &september, Huf(200))
            .unwrap();
        database
            .set_credit_payment_category("card", Some("payment"))
            .unwrap();
        let mut purchase = Entry::manual(
            "purchase",
            "card",
            CalendarDate::parse("2026-09-10").unwrap(),
        );
        purchase.category_id = Some("food".into());
        database.create_transaction(&purchase, Huf(-600)).unwrap();
        let september_plan = database.plan_month(&september).unwrap();
        assert_eq!(
            september_plan
                .categories
                .iter()
                .find(|category| category.category_id == "food")
                .unwrap()
                .available,
            Huf(-400)
        );
        assert_eq!(
            september_plan
                .categories
                .iter()
                .find(|category| category.category_id == "payment")
                .unwrap()
                .available,
            Huf(200)
        );
        let october = database
            .plan_month(&PlanMonth::parse("2026-10").unwrap())
            .unwrap();
        assert_eq!(
            october
                .categories
                .iter()
                .find(|category| category.category_id == "payment")
                .unwrap()
                .available,
            Huf(200)
        );
    }
}
