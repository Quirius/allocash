use crate::{
    database::Database,
    ledger::{CalendarDate, Huf, LedgerError, LedgerResult},
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
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
    fn next_start(&self) -> String {
        let year: i32 = self.0[..4].parse().unwrap();
        let month: u32 = self.0[5..].parse().unwrap();
        if month == 12 {
            format!("{:04}-01-01", year + 1)
        } else {
            format!("{:04}-{:02}-01", year, month + 1)
        }
    }
    fn next(&self) -> Self {
        let year: i32 = self.0[..4].parse().unwrap();
        let month: u32 = self.0[5..].parse().unwrap();
        if month == 12 {
            Self(format!("{:04}-01", year + 1))
        } else {
            Self(format!("{:04}-{:02}", year, month + 1))
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
    pub target: Option<CategoryTargetProgress>,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTargetDefinition {
    pub behavior: String,
    pub amount: Huf,
    pub due_kind: String,
    pub due_day: Option<i64>,
    #[serde(default = "monthly_target_interval")]
    pub interval_months: i64,
    #[serde(default)]
    pub first_due_month: Option<String>,
}

fn monthly_target_interval() -> i64 {
    1
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTargetProgress {
    #[serde(flatten)]
    pub definition: CategoryTargetDefinition,
    pub needed_this_month: Huf,
    pub funded: Huf,
    pub to_go: Huf,
    pub snoozed: bool,
    pub due_month: Option<String>,
}

#[derive(Debug, Clone)]
struct EffectiveCategoryTarget {
    definition: CategoryTargetDefinition,
    effective_month: PlanMonth,
}

#[derive(Default)]
struct CategoryMonthActivity {
    assignment: i128,
    cash_net: i128,
    credit_net: BTreeMap<String, i128>,
    credit_spending: Vec<CreditSpend>,
    positive_balance_spending: BTreeMap<String, i128>,
    normal_activity: i128,
}

struct CreditSpend {
    account_id: String,
    amount: i128,
    positive_balance_portion: i128,
}

#[derive(Default)]
struct MonthActivity {
    categories: BTreeMap<String, CategoryMonthActivity>,
    payment_deltas: BTreeMap<String, i128>,
    ready_income: i128,
}

struct PlanDerivation {
    assigned: BTreeMap<String, i128>,
    activity: BTreeMap<String, i128>,
    available: BTreeMap<String, i128>,
    starting_available: BTreeMap<String, i128>,
    ready_to_assign: i128,
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

    pub fn set_category_target(
        &self,
        category_id: &str,
        effective_month: &PlanMonth,
        definition: Option<&CategoryTargetDefinition>,
    ) -> LedgerResult<()> {
        let exists: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1)",
            [category_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(LedgerError::NotFound);
        }
        if let Some(definition) = definition {
            validate_target_definition(definition, effective_month)?;
        }
        let id: String = self.connection.query_row(
            "SELECT 'category-target-' || lower(hex(randomblob(16)))",
            [],
            |row| row.get(0),
        )?;
        match definition {
            Some(definition) => self.connection.execute(
                "INSERT INTO category_target_revisions (id,category_id,effective_month,active,behavior,amount_huf,due_kind,due_day,interval_months,first_due_month) VALUES (?1,?2,?3,1,?4,?5,?6,?7,?8,?9) ON CONFLICT(category_id,effective_month) DO UPDATE SET active=1,behavior=excluded.behavior,amount_huf=excluded.amount_huf,due_kind=excluded.due_kind,due_day=excluded.due_day,interval_months=excluded.interval_months,first_due_month=excluded.first_due_month,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                params![id, category_id, effective_month.as_str(), definition.behavior, definition.amount.0, definition.due_kind, definition.due_day, definition.interval_months, definition.first_due_month],
            )?,
            None => self.connection.execute(
                "INSERT INTO category_target_revisions (id,category_id,effective_month,active) VALUES (?1,?2,?3,0) ON CONFLICT(category_id,effective_month) DO UPDATE SET active=0,behavior=NULL,amount_huf=NULL,due_kind=NULL,due_day=NULL,interval_months=1,first_due_month=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                params![id, category_id, effective_month.as_str()],
            )?,
        };
        Ok(())
    }

    pub fn set_category_target_snoozed(
        &self,
        category_id: &str,
        month: &PlanMonth,
        snoozed: bool,
    ) -> LedgerResult<()> {
        let exists: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1)",
            [category_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(LedgerError::NotFound);
        }
        if snoozed && !target_definitions_for(&self.connection, month)?.contains_key(category_id) {
            return Err(LedgerError::InvalidValue(
                "A category needs an active target before it can be snoozed.",
            ));
        }
        if snoozed {
            self.connection.execute(
                "INSERT INTO category_target_snoozes (category_id,month) VALUES (?1,?2) ON CONFLICT(category_id,month) DO NOTHING",
                params![category_id, month.as_str()],
            )?;
        } else {
            self.connection.execute(
                "DELETE FROM category_target_snoozes WHERE category_id=?1 AND month=?2",
                params![category_id, month.as_str()],
            )?;
        }
        Ok(())
    }

    pub fn move_monthly_money(
        &mut self,
        from_category_id: &str,
        to_category_id: &str,
        month: &PlanMonth,
        amount: Huf,
    ) -> LedgerResult<()> {
        self.move_monthly_money_with_cutoff(from_category_id, to_category_id, month, amount)
    }

    pub fn move_monthly_money_as_of(
        &mut self,
        from_category_id: &str,
        to_category_id: &str,
        month: &PlanMonth,
        amount: Huf,
        _as_of: &CalendarDate,
    ) -> LedgerResult<()> {
        self.move_monthly_money_with_cutoff(from_category_id, to_category_id, month, amount)
    }

    fn move_monthly_money_with_cutoff(
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
        self.plan_month_with_cutoff(month, None)
    }

    pub fn plan_month_as_of(
        &self,
        month: &PlanMonth,
        as_of: &CalendarDate,
    ) -> LedgerResult<PlanSnapshot> {
        self.plan_month_with_cutoff(month, Some(as_of))
    }

    fn plan_month_with_cutoff(
        &self,
        month: &PlanMonth,
        as_of: Option<&CalendarDate>,
    ) -> LedgerResult<PlanSnapshot> {
        let derivation = derive_plan(&self.connection, month, as_of)?;
        let ready_category_ids = ready_to_assign_category_ids(&self.connection)?;
        let target_definitions = target_definitions_for(&self.connection, month)?;
        let target_snoozes = target_snoozes_for(&self.connection, month)?;
        let mut categories = Vec::new();
        let mut category_query = self.connection.prepare("SELECT g.id,g.name,c.id,c.name FROM category_groups g JOIN categories c ON c.group_id=g.id WHERE g.hidden=0 AND c.hidden=0 ORDER BY g.sort_order,c.sort_order,c.id")?;
        let mut rows = category_query.query([])?;
        while let Some(row) = rows.next()? {
            let category_id: String = row.get(2)?;
            if ready_category_ids.contains(&category_id) {
                continue;
            }
            categories.push((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                category_id,
                row.get::<_, String>(3)?,
            ));
        }
        let categories = categories
            .into_iter()
            .map(
                |(group_id, group_name, category_id, category_name)| -> LedgerResult<_> {
                    let assigned = *derivation.assigned.get(&category_id).unwrap_or(&0);
                    let target = target_definitions
                        .get(&category_id)
                        .map(|definition| {
                            if definition.definition.interval_months == 1 {
                                target_progress(
                                    &definition.definition,
                                    *derivation
                                        .starting_available
                                        .get(&category_id)
                                        .unwrap_or(&0),
                                    assigned,
                                    target_snoozes.contains(&category_id),
                                )
                            } else {
                                periodic_target_progress(
                                    &self.connection,
                                    &category_id,
                                    month,
                                    definition,
                                    *derivation
                                        .starting_available
                                        .get(&category_id)
                                        .unwrap_or(&0),
                                    assigned,
                                    target_snoozes.contains(&category_id),
                                    as_of,
                                )
                            }
                        })
                        .transpose()?;
                    Ok(PlanCategory {
                        group_id,
                        group_name,
                        category_id: category_id.clone(),
                        category_name,
                        assigned: narrow(assigned)?,
                        activity: narrow(*derivation.activity.get(&category_id).unwrap_or(&0))?,
                        available: narrow(*derivation.available.get(&category_id).unwrap_or(&0))?,
                        target,
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
            ready_to_assign: narrow(derivation.ready_to_assign)?,
            categories,
            credit_payment_categories,
        })
    }
}

fn ready_to_assign_category_ids(
    connection: &rusqlite::Connection,
) -> LedgerResult<BTreeSet<String>> {
    Ok(connection
        .prepare("SELECT c.id FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE lower(trim(g.name))='inflow' AND lower(trim(c.name))='ready to assign'")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?)
}

/// Replays the budget one calendar month at a time. A closed month carries only
/// positive category money forward; cash overspending reduces Ready to Assign
/// in the following month, while credit overspending remains card debt.
fn derive_plan(
    connection: &rusqlite::Connection,
    target: &PlanMonth,
    as_of: Option<&CalendarDate>,
) -> LedgerResult<PlanDerivation> {
    let ready_category_ids = ready_to_assign_category_ids(connection)?;
    let payment_categories: BTreeMap<String, String> = connection
        .prepare("SELECT account_id,category_id FROM credit_payment_categories")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let credit_accounts: Vec<String> = connection
        .prepare("SELECT id FROM accounts WHERE kind='credit' ORDER BY sort_order,id")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    let mut months = BTreeMap::<String, MonthActivity>::new();
    let mut credit_balances = BTreeMap::<String, i128>::new();
    let mut assignment_total = 0i128;
    let mut assignments = connection.prepare(
        "SELECT month,category_id,amount_huf FROM category_month_assignments WHERE month<=?1",
    )?;
    for row in assignments.query_map([target.as_str()], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })? {
        let (month, category_id, amount) = row?;
        let amount = i128::from(amount);
        assignment_total = checked_add(assignment_total, amount)?;
        let activity = months
            .entry(month)
            .or_default()
            .categories
            .entry(category_id)
            .or_default();
        activity.assignment = checked_add(activity.assignment, amount)?;
    }
    let mut entries = connection.prepare(
        "SELECT t.category_id,t.amount_huf,t.transaction_date,a.kind,t.account_id,t.transfer_id,
                (SELECT other_account.kind FROM ledger_entries other JOIN accounts other_account ON other_account.id=other.account_id WHERE other.transfer_id=t.transfer_id AND other.account_id<>t.account_id)
         FROM ledger_entries t JOIN accounts a ON a.id=t.account_id
         LEFT JOIN import_rows source ON source.id=t.import_row_id
         WHERE t.posting_state='posted' AND t.transaction_date<?1 AND (?2 IS NULL OR t.transaction_date<=?2) AND a.kind IN ('cash','credit')
         ORDER BY t.transaction_date,source.source_file,source.row_number,t.id",
    )?;
    let mut rows = entries.query(params![
        target.next_start(),
        as_of.map(CalendarDate::as_str)
    ])?;
    while let Some(row) = rows.next()? {
        let category_id: Option<String> = row.get(0)?;
        let amount = i128::from(row.get::<_, i64>(1)?);
        let date: String = row.get(2)?;
        let kind: String = row.get(3)?;
        let account_id: String = row.get(4)?;
        let transfer_id: Option<String> = row.get(5)?;
        let counterpart_kind: Option<String> = row.get(6)?;
        let positive_balance_portion = if kind == "credit" {
            let balance = credit_balances.entry(account_id.clone()).or_default();
            let covered = if amount < 0 {
                (-amount).min((*balance).max(0))
            } else {
                0
            };
            *balance = checked_add(*balance, amount)?;
            covered
        } else {
            0
        };
        let month = &date[..7];
        let month_activity = months.entry(month.to_owned()).or_default();
        if transfer_id.is_some() {
            if kind == "credit" && amount > 0 && counterpart_kind.as_deref() == Some("cash") {
                if let Some(payment_category) = payment_categories.get(&account_id) {
                    let delta = month_activity
                        .payment_deltas
                        .entry(payment_category.clone())
                        .or_default();
                    *delta = checked_add(*delta, -amount)?;
                }
            }
            if !matches!(counterpart_kind.as_deref(), Some("tracking" | "loan")) {
                continue;
            }
        }
        if category_id
            .as_ref()
            .is_some_and(|id| ready_category_ids.contains(id))
        {
            if kind == "cash" {
                month_activity.ready_income = checked_add(month_activity.ready_income, amount)?;
            }
        } else if let Some(category_id) = category_id {
            let category = month_activity.categories.entry(category_id).or_default();
            category.normal_activity = checked_add(category.normal_activity, amount)?;
            if kind == "cash" {
                category.cash_net = checked_add(category.cash_net, amount)?;
            } else {
                if amount < 0 {
                    category.credit_spending.push(CreditSpend {
                        account_id: account_id.clone(),
                        amount: -amount,
                        positive_balance_portion,
                    });
                    let covered = category
                        .positive_balance_spending
                        .entry(account_id.clone())
                        .or_default();
                    *covered = checked_add(*covered, positive_balance_portion)?;
                }
                let credit = category.credit_net.entry(account_id).or_default();
                *credit = checked_add(*credit, amount)?;
            }
        } else if kind == "cash" {
            month_activity.ready_income = checked_add(month_activity.ready_income, amount)?;
        }
    }

    let first_month = months
        .keys()
        .next()
        .cloned()
        .unwrap_or_else(|| target.as_str().to_owned());
    let mut current = PlanMonth::parse(&first_month)?;
    let mut available = BTreeMap::<String, i128>::new();
    let mut starting_available = BTreeMap::<String, i128>::new();
    let mut target_assigned = BTreeMap::<String, i128>::new();
    let mut target_activity = BTreeMap::<String, i128>::new();
    let mut ready_income = 0i128;
    let mut closed_cash_overspending = 0i128;

    loop {
        let is_target = current == *target;
        if is_target {
            starting_available = available.clone();
        }
        let MonthActivity {
            categories: month_categories,
            mut payment_deltas,
            ready_income: month_ready_income,
        } = months.remove(current.as_str()).unwrap_or_default();
        ready_income = checked_add(ready_income, month_ready_income)?;
        let mut category_ids: BTreeSet<String> = month_categories.keys().cloned().collect();
        category_ids.extend(payment_deltas.keys().cloned());
        for category_id in category_ids {
            let entry = month_categories.get(&category_id);
            let assignment = entry.map_or(0, |value| value.assignment);
            let cash_net = entry.map_or(0, |value| value.cash_net);
            let normal_activity = entry.map_or(0, |value| value.normal_activity);
            let carry = *available.get(&category_id).unwrap_or(&0);
            let cash_in = cash_net.max(0);
            let cash_spend = (-cash_net).max(0);
            let credit_refunds = entry
                .map(|value| {
                    value
                        .credit_net
                        .values()
                        .filter(|amount| **amount > 0)
                        .try_fold(0i128, |total, amount| checked_add(total, *amount))
                })
                .transpose()?
                .unwrap_or(0);
            let pool = checked_add(
                checked_add(carry, assignment)?,
                checked_add(cash_in, credit_refunds)?,
            )?;
            let positive_balance_spend = entry
                .map(|value| {
                    value
                        .positive_balance_spending
                        .values()
                        .try_fold(0i128, |total, amount| checked_add(total, *amount))
                })
                .transpose()?
                .unwrap_or(0);
            let mut credit_capacity =
                checked_sub(checked_sub(pool, cash_spend)?, positive_balance_spend)?.max(0);
            let mut total_credit_spend = 0i128;
            let mut credit_overspending = 0i128;
            if let Some(entry) = entry {
                let mut eligible_remaining = BTreeMap::<String, i128>::new();
                for account_id in &credit_accounts {
                    let net = *entry.credit_net.get(account_id).unwrap_or(&0);
                    if net > 0 {
                        if let Some(payment_category) = payment_categories.get(account_id) {
                            let delta = payment_deltas.entry(payment_category.clone()).or_default();
                            *delta = checked_add(*delta, -net)?;
                        }
                        continue;
                    }
                    if net == 0 {
                        continue;
                    }
                    let spend = -net;
                    total_credit_spend = checked_add(total_credit_spend, spend)?;
                    let covered = *entry
                        .positive_balance_spending
                        .get(account_id)
                        .unwrap_or(&0);
                    eligible_remaining
                        .insert(account_id.clone(), checked_sub(spend, covered)?.max(0));
                }
                for purchase in &entry.credit_spending {
                    let Some(remaining) = eligible_remaining.get_mut(&purchase.account_id) else {
                        continue;
                    };
                    let eligible = checked_sub(purchase.amount, purchase.positive_balance_portion)?
                        .min(*remaining);
                    *remaining = checked_sub(*remaining, eligible)?;
                    let funded = credit_capacity.min(eligible);
                    credit_capacity = checked_sub(credit_capacity, funded)?;
                    credit_overspending =
                        checked_add(credit_overspending, checked_sub(eligible, funded)?)?;
                    if let Some(payment_category) = payment_categories.get(&purchase.account_id) {
                        let delta = payment_deltas.entry(payment_category.clone()).or_default();
                        *delta = checked_add(*delta, funded)?;
                    }
                }
            }
            let raw_available = checked_sub(checked_sub(pool, cash_spend)?, total_credit_spend)?;
            let cash_overspending = checked_sub((-raw_available).max(0), credit_overspending)?;
            available.insert(category_id.clone(), raw_available);
            if is_target {
                target_assigned.insert(category_id.clone(), assignment);
                target_activity.insert(category_id, normal_activity);
            } else {
                closed_cash_overspending =
                    checked_add(closed_cash_overspending, cash_overspending)?;
            }
        }
        // A mapped card purchase moves only its funded portion into the payment
        // category; a refund and a cash-to-card payment reverse that movement.
        // The deltas are computed after cash gets first claim on category money.
        if is_target {
            for (category_id, delta) in payment_deltas {
                let current_available = available.entry(category_id.clone()).or_default();
                *current_available = checked_add(*current_available, delta)?;
                let current_activity = target_activity.entry(category_id).or_default();
                *current_activity = checked_add(*current_activity, delta)?;
            }
            break;
        }
        for (category_id, delta) in payment_deltas {
            let current_available = available.entry(category_id).or_default();
            *current_available = checked_add(*current_available, delta)?;
        }
        for value in available.values_mut() {
            *value = (*value).max(0);
        }
        current = current.next();
    }
    Ok(PlanDerivation {
        assigned: target_assigned,
        activity: target_activity,
        available,
        starting_available,
        ready_to_assign: checked_sub(
            checked_sub(ready_income, assignment_total)?,
            closed_cash_overspending,
        )?,
    })
}

fn checked_add(left: i128, right: i128) -> LedgerResult<i128> {
    left.checked_add(right).ok_or(LedgerError::AmountOverflow)
}

fn checked_sub(left: i128, right: i128) -> LedgerResult<i128> {
    left.checked_sub(right).ok_or(LedgerError::AmountOverflow)
}

fn validate_target_definition(
    definition: &CategoryTargetDefinition,
    effective_month: &PlanMonth,
) -> LedgerResult<()> {
    let valid_due = match definition.due_kind.as_str() {
        "day" => definition
            .due_day
            .is_some_and(|day| (1..=31).contains(&day)),
        "last_day" => definition.due_day.is_none(),
        _ => false,
    };
    let valid_interval = matches!(definition.interval_months, 1 | 3 | 12);
    let valid_first_due = match definition.interval_months {
        1 => definition.first_due_month.is_none(),
        3 | 12 => definition.first_due_month.as_deref().is_some_and(|due| {
            PlanMonth::parse(due).is_ok_and(|parsed| parsed >= *effective_month)
        }),
        _ => false,
    };
    if definition.amount.0 <= 0
        || !matches!(definition.behavior.as_str(), "set_aside" | "refill")
        || !valid_due
        || !valid_interval
        || !valid_first_due
    {
        return Err(LedgerError::InvalidValue("Invalid category target."));
    }
    Ok(())
}

fn target_definitions_for(
    connection: &rusqlite::Connection,
    month: &PlanMonth,
) -> LedgerResult<BTreeMap<String, EffectiveCategoryTarget>> {
    let mut statement = connection.prepare(
        "SELECT revision.category_id,revision.effective_month,revision.active,revision.behavior,revision.amount_huf,revision.due_kind,revision.due_day,revision.interval_months,revision.first_due_month
         FROM category_target_revisions revision
         JOIN (SELECT category_id,MAX(effective_month) effective_month FROM category_target_revisions WHERE effective_month<=?1 GROUP BY category_id) current
           ON current.category_id=revision.category_id AND current.effective_month=revision.effective_month",
    )?;
    let mut definitions = BTreeMap::new();
    for row in statement.query_map([month.as_str()], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, bool>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<i64>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<i64>>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, Option<String>>(8)?,
        ))
    })? {
        let (
            category_id,
            effective_month,
            active,
            behavior,
            amount,
            due_kind,
            due_day,
            interval_months,
            first_due_month,
        ) = row?;
        if !active {
            continue;
        }
        let definition = CategoryTargetDefinition {
            behavior: behavior.ok_or(LedgerError::InvalidValue("Invalid category target."))?,
            amount: Huf(amount.ok_or(LedgerError::InvalidValue("Invalid category target."))?),
            due_kind: due_kind.ok_or(LedgerError::InvalidValue("Invalid category target."))?,
            due_day,
            interval_months,
            first_due_month,
        };
        let effective_month = PlanMonth::parse(&effective_month)?;
        validate_target_definition(&definition, &effective_month)?;
        definitions.insert(
            category_id,
            EffectiveCategoryTarget {
                definition,
                effective_month,
            },
        );
    }
    Ok(definitions)
}

fn target_progress(
    definition: &CategoryTargetDefinition,
    starting_available: i128,
    assigned: i128,
    snoozed: bool,
) -> LedgerResult<CategoryTargetProgress> {
    let amount = i128::from(definition.amount.0);
    let needed = match definition.behavior.as_str() {
        "set_aside" => amount,
        "refill" => checked_sub(amount, starting_available.max(0))?.max(0),
        _ => return Err(LedgerError::InvalidValue("Invalid category target.")),
    };
    let needed = if snoozed { 0 } else { needed };
    let funded = assigned.max(0).min(needed);
    Ok(CategoryTargetProgress {
        definition: definition.clone(),
        needed_this_month: narrow(needed)?,
        funded: narrow(funded)?,
        to_go: narrow(checked_sub(needed, funded)?)?,
        snoozed,
        due_month: None,
    })
}

fn periodic_target_progress(
    connection: &rusqlite::Connection,
    category_id: &str,
    month: &PlanMonth,
    target: &EffectiveCategoryTarget,
    starting_available: i128,
    assigned: i128,
    snoozed: bool,
    as_of: Option<&CalendarDate>,
) -> LedgerResult<CategoryTargetProgress> {
    let definition = &target.definition;
    let first_due = PlanMonth::parse(definition.first_due_month.as_deref().ok_or(
        LedgerError::InvalidValue("Periodic target has no first due month."),
    )?)?;
    let (cycle_start, due_month) = if month <= &first_due {
        (target.effective_month.clone(), first_due)
    } else {
        let interval = definition.interval_months;
        let first_due_index = month_index(&first_due)?;
        let current_index = month_index(month)?;
        let periods_after = (current_index - first_due_index - 1) / interval + 1;
        let due = shift_month(&first_due, periods_after * interval)?;
        let start = shift_month(&first_due, (periods_after - 1) * interval + 1)?;
        (start, due)
    };
    let remaining_months = month_index(&due_month)? - month_index(month)? + 1;
    if remaining_months <= 0 {
        return Err(LedgerError::InvalidValue("Invalid periodic target cycle."));
    }
    let mut assignments = connection.prepare(
        "SELECT amount_huf FROM category_month_assignments WHERE category_id=?1 AND month>=?2 AND month<?3",
    )?;
    let prior_assigned = assignments
        .query_map(
            params![category_id, cycle_start.as_str(), month.as_str()],
            |row| row.get::<_, i64>(0),
        )?
        .try_fold(0i128, |sum, amount| checked_add(sum, i128::from(amount?)))?;
    let period_goal = if definition.behavior == "set_aside" {
        i128::from(definition.amount.0)
    } else {
        let opening = if cycle_start == *month {
            starting_available
        } else {
            let previous = shift_month(&cycle_start, -1)?;
            *derive_plan(connection, &previous, as_of)?
                .available
                .get(category_id)
                .unwrap_or(&0)
        };
        checked_sub(i128::from(definition.amount.0), opening.max(0))?.max(0)
    };
    let outstanding = checked_sub(period_goal, prior_assigned)?.max(0);
    let remaining_months = i128::from(remaining_months);
    let needed = outstanding / remaining_months + i128::from(outstanding % remaining_months != 0);
    let needed = if snoozed { 0 } else { needed };
    let funded = assigned.max(0).min(needed);
    let to_go = if snoozed {
        0
    } else {
        checked_sub(needed, assigned)?.max(0)
    };
    Ok(CategoryTargetProgress {
        definition: definition.clone(),
        needed_this_month: narrow(needed)?,
        funded: narrow(funded)?,
        to_go: narrow(to_go)?,
        snoozed,
        due_month: Some(due_month.0),
    })
}

fn month_index(month: &PlanMonth) -> LedgerResult<i64> {
    let year: i64 = month.0[..4]
        .parse()
        .map_err(|_| LedgerError::InvalidValue("Invalid plan month."))?;
    let number: i64 = month.0[5..]
        .parse()
        .map_err(|_| LedgerError::InvalidValue("Invalid plan month."))?;
    year.checked_mul(12)
        .and_then(|value| value.checked_add(number - 1))
        .ok_or(LedgerError::AmountOverflow)
}

fn shift_month(month: &PlanMonth, delta: i64) -> LedgerResult<PlanMonth> {
    let index = month_index(month)?
        .checked_add(delta)
        .ok_or(LedgerError::AmountOverflow)?;
    if index < 12 {
        return Err(LedgerError::InvalidValue("Plan month is out of range."));
    }
    let year = index / 12;
    let number = index % 12 + 1;
    if year > 9999 {
        return Err(LedgerError::InvalidValue("Plan month is out of range."));
    }
    PlanMonth::parse(&format!("{year:04}-{number:02}"))
}

fn target_snoozes_for(
    connection: &rusqlite::Connection,
    month: &PlanMonth,
) -> LedgerResult<BTreeSet<String>> {
    Ok(connection
        .prepare("SELECT category_id FROM category_target_snoozes WHERE month=?1")?
        .query_map([month.as_str()], |row| row.get(0))?
        .collect::<Result<_, _>>()?)
}

fn narrow(value: i128) -> LedgerResult<Huf> {
    i64::try_from(value)
        .map(Huf)
        .map_err(|_| LedgerError::AmountOverflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ledger::{Account, AccountKind, CalendarDate, Direction, Entry, TransferDraft};

    fn category_available(plan: &PlanSnapshot, category_id: &str) -> Huf {
        plan.categories
            .iter()
            .find(|category| category.category_id == category_id)
            .unwrap()
            .available
    }

    fn category_available_target<'a>(
        plan: &'a PlanSnapshot,
        category_id: &str,
    ) -> &'a CategoryTargetProgress {
        plan.categories
            .iter()
            .find(|category| category.category_id == category_id)
            .unwrap()
            .target
            .as_ref()
            .unwrap()
    }

    #[test]
    fn as_of_plan_excludes_future_dated_entries_until_their_date() {
        let directory = tempfile::tempdir().unwrap();
        let mut database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
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
        database.create_category("food", "g", "Food", 0).unwrap();
        database.create_category("other", "g", "Other", 1).unwrap();
        let month = PlanMonth::parse("2026-09").unwrap();
        database
            .set_monthly_assignment("food", &month, Huf(100))
            .unwrap();
        let income = Entry::manual("income", "cash", CalendarDate::parse("2026-09-10").unwrap());
        database.create_transaction(&income, Huf(200)).unwrap();
        let mut spend = Entry::manual("spend", "cash", CalendarDate::parse("2026-09-10").unwrap());
        spend.category_id = Some("food".into());
        database.create_transaction(&spend, Huf(-40)).unwrap();

        let before = database
            .plan_month_as_of(&month, &CalendarDate::parse("2026-09-09").unwrap())
            .unwrap();
        assert_eq!(before.ready_to_assign, Huf(-100));
        assert_eq!(before.categories[0].activity, Huf(0));
        assert_eq!(before.categories[0].available, Huf(100));

        let on_date = database
            .plan_month_as_of(&month, &CalendarDate::parse("2026-09-10").unwrap())
            .unwrap();
        assert_eq!(on_date.ready_to_assign, Huf(100));
        assert_eq!(on_date.categories[0].activity, Huf(-40));
        assert_eq!(on_date.categories[0].available, Huf(60));
        database
            .move_monthly_money_as_of(
                "food",
                "other",
                &month,
                Huf(80),
                &CalendarDate::parse("2026-09-10").unwrap(),
            )
            .unwrap();
    }

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
    fn moving_money_can_make_source_negative_and_reverse_without_changing_ledger_or_rta() {
        let directory = tempfile::tempdir().unwrap();
        let mut database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
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
        database.create_category("a", "g", "Food", 0).unwrap();
        database.create_category("b", "g", "Fun", 1).unwrap();
        let month = PlanMonth::parse("2026-09").unwrap();
        database
            .set_monthly_assignment("a", &month, Huf(100))
            .unwrap();
        let income = Entry::manual("income", "cash", CalendarDate::parse("2026-09-01").unwrap());
        database.create_transaction(&income, Huf(500)).unwrap();
        let mut spend = Entry::manual("spend", "cash", CalendarDate::parse("2026-09-02").unwrap());
        spend.category_id = Some("a".into());
        database.create_transaction(&spend, Huf(-150)).unwrap();
        let initial_balance = database
            .account_balance("cash", &CalendarDate::parse("2026-09-30").unwrap())
            .unwrap();
        let initial = database.plan_month(&month).unwrap();
        assert_eq!(initial.ready_to_assign, Huf(400));
        assert_eq!(category_available(&initial, "a"), Huf(-50));
        assert_eq!(
            initial
                .categories
                .iter()
                .find(|c| c.category_id == "a")
                .unwrap()
                .assigned,
            Huf(100)
        );

        database
            .move_monthly_money("a", "b", &month, Huf(175))
            .unwrap();
        let moved = database.plan_month(&month).unwrap();
        assert_eq!(moved.ready_to_assign, initial.ready_to_assign);
        assert_eq!(category_available(&moved, "a"), Huf(-225));
        assert_eq!(category_available(&moved, "b"), Huf(175));
        assert_eq!(
            moved
                .categories
                .iter()
                .find(|c| c.category_id == "a")
                .unwrap()
                .assigned,
            Huf(-75)
        );
        assert_eq!(
            database
                .account_balance("cash", &CalendarDate::parse("2026-09-30").unwrap())
                .unwrap(),
            initial_balance
        );

        database
            .move_monthly_money("b", "a", &month, Huf(175))
            .unwrap();
        let restored = database.plan_month(&month).unwrap();
        assert_eq!(restored.ready_to_assign, initial.ready_to_assign);
        assert_eq!(category_available(&restored, "a"), Huf(-50));
        assert_eq!(category_available(&restored, "b"), Huf(0));
        assert_eq!(
            restored
                .categories
                .iter()
                .find(|c| c.category_id == "a")
                .unwrap()
                .assigned,
            Huf(100)
        );
        assert_eq!(
            database
                .account_balance("cash", &CalendarDate::parse("2026-09-30").unwrap())
                .unwrap(),
            initial_balance
        );
        assert!(database
            .move_monthly_money("a", "a", &month, Huf(1))
            .is_err());
    }

    #[test]
    fn move_overflow_rolls_back_both_assignments_and_move_record() {
        let directory = tempfile::tempdir().unwrap();
        let mut database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database.create_category_group("g", "Living", 0).unwrap();
        database.create_category("a", "g", "Food", 0).unwrap();
        database.create_category("b", "g", "Fun", 1).unwrap();
        let month = PlanMonth::parse("2026-09").unwrap();
        database
            .set_monthly_assignment("a", &month, Huf(1))
            .unwrap();
        database
            .set_monthly_assignment("b", &month, Huf(i64::MAX))
            .unwrap();

        assert!(matches!(
            database.move_monthly_money("a", "b", &month, Huf(1)),
            Err(LedgerError::AmountOverflow)
        ));
        assert_eq!(
            database
                .plan_month(&month)
                .unwrap()
                .categories
                .iter()
                .find(|c| c.category_id == "a")
                .unwrap()
                .assigned,
            Huf(1)
        );
        assert_eq!(
            database
                .plan_month(&month)
                .unwrap()
                .categories
                .iter()
                .find(|c| c.category_id == "b")
                .unwrap()
                .assigned,
            Huf(i64::MAX)
        );
        let move_count: i64 = database
            .connection
            .query_row("SELECT COUNT(*) FROM category_month_moves", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(move_count, 0);
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
    fn positive_card_balance_spending_has_first_claim_before_other_card_funding() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        for (id, order) in [("first", 0), ("second", 1)] {
            database
                .create_account(&Account {
                    id: id.into(),
                    name: id.into(),
                    kind: AccountKind::Credit,
                    sort_order: order,
                    closed: false,
                })
                .unwrap();
        }
        database
            .create_category_group("spend", "Spending", 0)
            .unwrap();
        database
            .create_category("food", "spend", "Food", 0)
            .unwrap();
        database
            .create_category_group("payments", "Payments", 1)
            .unwrap();
        for (account, category, order) in [
            ("first", "first_payment", 0),
            ("second", "second_payment", 1),
        ] {
            database
                .create_category(category, "payments", category, order)
                .unwrap();
            database
                .set_credit_payment_category(account, Some(category))
                .unwrap();
        }
        let month = PlanMonth::parse("2026-09").unwrap();
        database
            .set_monthly_assignment("food", &month, Huf(60))
            .unwrap();
        database
            .create_transaction(
                &Entry::manual(
                    "positive_balance",
                    "first",
                    CalendarDate::parse("2026-09-01").unwrap(),
                ),
                Huf(40),
            )
            .unwrap();
        let mut second_purchase = Entry::manual(
            "second_purchase",
            "second",
            CalendarDate::parse("2026-09-02").unwrap(),
        );
        second_purchase.category_id = Some("food".into());
        database
            .create_transaction(&second_purchase, Huf(-50))
            .unwrap();
        let mut first_purchase = Entry::manual(
            "first_purchase",
            "first",
            CalendarDate::parse("2026-09-03").unwrap(),
        );
        first_purchase.category_id = Some("food".into());
        database
            .create_transaction(&first_purchase, Huf(-60))
            .unwrap();

        let plan = database.plan_month(&month).unwrap();
        let activity = |id| {
            plan.categories
                .iter()
                .find(|category| category.category_id == id)
                .unwrap()
                .activity
        };
        assert_eq!(activity("food"), Huf(-110));
        assert_eq!(activity("second_payment"), Huf(20));
        assert_eq!(activity("first_payment"), Huf(0));
        assert_eq!(
            database
                .plan_month(&PlanMonth::parse("2026-10").unwrap())
                .unwrap()
                .ready_to_assign,
            Huf(-60)
        );
    }

    #[test]
    fn funded_credit_spending_moves_only_available_money_to_the_payment_category() {
        let directory = tempfile::tempdir().unwrap();
        let mut database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
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
        database.create_category("other", "g", "Other", 2).unwrap();
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
        database
            .move_monthly_money("payment", "other", &month, Huf(600))
            .unwrap();
        let moved = database.plan_month(&month).unwrap();
        assert_eq!(category_available(&moved, "payment"), Huf(0));
        assert_eq!(category_available(&moved, "other"), Huf(600));
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

    #[test]
    fn cash_overspending_resets_on_rollover_and_reduces_ready_to_assign() {
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
        database.create_category("food", "g", "Food", 0).unwrap();
        let september = PlanMonth::parse("2026-09").unwrap();
        database
            .set_monthly_assignment("food", &september, Huf(100))
            .unwrap();
        let mut purchase = Entry::manual(
            "cash-purchase",
            "cash",
            CalendarDate::parse("2026-09-10").unwrap(),
        );
        purchase.category_id = Some("food".into());
        database.create_transaction(&purchase, Huf(-150)).unwrap();
        let september_plan = database.plan_month(&september).unwrap();
        assert_eq!(category_available(&september_plan, "food"), Huf(-50));
        let october = PlanMonth::parse("2026-10").unwrap();
        let october_plan = database.plan_month(&october).unwrap();
        assert_eq!(category_available(&october_plan, "food"), Huf(0));
        assert_eq!(october_plan.ready_to_assign, Huf(-150));
    }

    #[test]
    fn mixed_cash_and_credit_spending_gives_cash_first_claim_on_category_money() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        for (id, kind, sort_order) in [
            ("cash", AccountKind::Cash, 0),
            ("card", AccountKind::Credit, 1),
        ] {
            database
                .create_account(&Account {
                    id: id.into(),
                    name: id.into(),
                    kind,
                    sort_order,
                    closed: false,
                })
                .unwrap();
        }
        database.create_category_group("g", "Living", 0).unwrap();
        database.create_category("food", "g", "Food", 0).unwrap();
        database
            .create_category("payment", "g", "Card payment", 1)
            .unwrap();
        let september = PlanMonth::parse("2026-09").unwrap();
        database
            .set_monthly_assignment("food", &september, Huf(150))
            .unwrap();
        database
            .set_credit_payment_category("card", Some("payment"))
            .unwrap();
        for (id, account_id, amount) in [("cash-spend", "cash", -100), ("card-spend", "card", -100)]
        {
            let mut entry =
                Entry::manual(id, account_id, CalendarDate::parse("2026-09-10").unwrap());
            entry.category_id = Some("food".into());
            database.create_transaction(&entry, Huf(amount)).unwrap();
        }
        let september_plan = database.plan_month(&september).unwrap();
        assert_eq!(category_available(&september_plan, "food"), Huf(-50));
        assert_eq!(category_available(&september_plan, "payment"), Huf(50));
        let october_plan = database
            .plan_month(&PlanMonth::parse("2026-10").unwrap())
            .unwrap();
        assert_eq!(category_available(&october_plan, "food"), Huf(0));
        assert_eq!(category_available(&october_plan, "payment"), Huf(50));
        assert_eq!(october_plan.ready_to_assign, Huf(-150));
    }

    #[test]
    fn card_refunds_reverse_the_payment_category_and_cash_payments_consume_it() {
        let directory = tempfile::tempdir().unwrap();
        let mut database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        for (id, kind, sort_order) in [
            ("cash", AccountKind::Cash, 0),
            ("card", AccountKind::Credit, 1),
        ] {
            database
                .create_account(&Account {
                    id: id.into(),
                    name: id.into(),
                    kind,
                    sort_order,
                    closed: false,
                })
                .unwrap();
        }
        database.create_category_group("g", "Living", 0).unwrap();
        database.create_category("food", "g", "Food", 0).unwrap();
        database
            .create_category("payment", "g", "Card payment", 1)
            .unwrap();
        let september = PlanMonth::parse("2026-09").unwrap();
        database
            .set_monthly_assignment("food", &september, Huf(100))
            .unwrap();
        database
            .set_credit_payment_category("card", Some("payment"))
            .unwrap();
        for (id, amount) in [("purchase", -100), ("refund", 40)] {
            let mut entry = Entry::manual(id, "card", CalendarDate::parse("2026-09-10").unwrap());
            entry.category_id = Some("food".into());
            database.create_transaction(&entry, Huf(amount)).unwrap();
        }
        let september_plan = database.plan_month(&september).unwrap();
        assert_eq!(category_available(&september_plan, "food"), Huf(40));
        assert_eq!(category_available(&september_plan, "payment"), Huf(60));
        let transfer = TransferDraft::manual(
            "card-payment",
            Huf(60),
            Entry::manual(
                "cash-leg",
                "cash",
                CalendarDate::parse("2026-09-20").unwrap(),
            ),
            Entry::manual(
                "card-leg",
                "card",
                CalendarDate::parse("2026-09-20").unwrap(),
            ),
            Direction::Outflow,
        );
        database.create_transfer(&transfer).unwrap();
        let after_payment = database.plan_month(&september).unwrap();
        assert_eq!(category_available(&after_payment, "payment"), Huf(0));
        assert_eq!(after_payment.ready_to_assign, Huf(-100));
    }

    #[test]
    fn targets_are_effective_dated_and_keep_current_month_activity_out_of_progress() {
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
        database.create_category("food", "g", "Food", 0).unwrap();
        let september = PlanMonth::parse("2026-09").unwrap();
        database
            .set_category_target(
                "food",
                &september,
                Some(&CategoryTargetDefinition {
                    behavior: "set_aside".into(),
                    amount: Huf(100),
                    due_kind: "day".into(),
                    due_day: Some(10),
                    interval_months: 1,
                    first_due_month: None,
                }),
            )
            .unwrap();
        database
            .set_monthly_assignment("food", &september, Huf(30))
            .unwrap();
        let mut spending = Entry::manual(
            "spending",
            "cash",
            CalendarDate::parse("2026-09-10").unwrap(),
        );
        spending.category_id = Some("food".into());
        database.create_transaction(&spending, Huf(-10)).unwrap();
        let september_plan = database.plan_month(&september).unwrap();
        let september_target = category_available_target(&september_plan, "food");
        assert_eq!(september_target.needed_this_month, Huf(100));
        assert_eq!(september_target.funded, Huf(30));
        assert_eq!(september_target.to_go, Huf(70));
        let october = PlanMonth::parse("2026-10").unwrap();
        database
            .set_category_target(
                "food",
                &october,
                Some(&CategoryTargetDefinition {
                    behavior: "refill".into(),
                    amount: Huf(100),
                    due_kind: "last_day".into(),
                    due_day: None,
                    interval_months: 1,
                    first_due_month: None,
                }),
            )
            .unwrap();
        let october_plan = database.plan_month(&october).unwrap();
        let october_target = category_available_target(&october_plan, "food");
        assert_eq!(october_target.needed_this_month, Huf(80));
        assert_eq!(october_target.funded, Huf(0));
        assert_eq!(october_target.to_go, Huf(80));
        assert_eq!(
            category_available_target(&database.plan_month(&september).unwrap(), "food")
                .definition
                .behavior,
            "set_aside"
        );
        let november = PlanMonth::parse("2026-11").unwrap();
        database
            .set_category_target("food", &november, None)
            .unwrap();
        assert!(database
            .plan_month(&november)
            .unwrap()
            .categories
            .iter()
            .find(|category| category.category_id == "food")
            .unwrap()
            .target
            .is_none());
    }

    #[test]
    fn refill_target_uses_settled_available_after_cash_overspending() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database.create_category_group("g", "Living", 0).unwrap();
        database.create_category("food", "g", "Food", 0).unwrap();
        let september = PlanMonth::parse("2026-09").unwrap();
        database
            .set_monthly_assignment("food", &september, Huf(-50))
            .unwrap();
        let october = PlanMonth::parse("2026-10").unwrap();
        database
            .set_category_target(
                "food",
                &october,
                Some(&CategoryTargetDefinition {
                    behavior: "refill".into(),
                    amount: Huf(100),
                    due_kind: "day".into(),
                    due_day: Some(1),
                    interval_months: 1,
                    first_due_month: None,
                }),
            )
            .unwrap();
        assert_eq!(
            category_available_target(&database.plan_month(&october).unwrap(), "food")
                .needed_this_month,
            Huf(100)
        );
    }

    #[test]
    fn target_snoozes_are_month_specific_and_leave_budget_money_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database.create_category_group("g", "Living", 0).unwrap();
        database.create_category("food", "g", "Food", 0).unwrap();
        let september = PlanMonth::parse("2026-09").unwrap();
        database
            .set_category_target(
                "food",
                &september,
                Some(&CategoryTargetDefinition {
                    behavior: "set_aside".into(),
                    amount: Huf(100),
                    due_kind: "last_day".into(),
                    due_day: None,
                    interval_months: 1,
                    first_due_month: None,
                }),
            )
            .unwrap();
        let october = PlanMonth::parse("2026-10").unwrap();
        let before = database.plan_month(&october).unwrap();
        database
            .set_category_target_snoozed("food", &october, true)
            .unwrap();
        let snoozed = database.plan_month(&october).unwrap();
        let progress = category_available_target(&snoozed, "food");
        assert!(progress.snoozed);
        assert_eq!(progress.needed_this_month, Huf(0));
        assert_eq!(progress.funded, Huf(0));
        assert_eq!(progress.to_go, Huf(0));
        assert_eq!(
            category_available(&before, "food"),
            category_available(&snoozed, "food")
        );
        assert_eq!(before.ready_to_assign, snoozed.ready_to_assign);
        let november = database
            .plan_month(&PlanMonth::parse("2026-11").unwrap())
            .unwrap();
        assert!(!category_available_target(&november, "food").snoozed);
        assert_eq!(
            category_available_target(&november, "food").needed_this_month,
            Huf(100)
        );
        database
            .set_category_target_snoozed("food", &october, false)
            .unwrap();
        assert_eq!(
            category_available_target(&database.plan_month(&october).unwrap(), "food").to_go,
            Huf(100)
        );
        assert!(matches!(
            database.set_category_target_snoozed("missing", &october, true),
            Err(LedgerError::NotFound)
        ));
    }

    #[test]
    fn yearly_target_spreads_partial_first_cycle_catches_up_and_restarts() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database.create_category_group("g", "Savings", 0).unwrap();
        database.create_category("trip", "g", "Trip", 0).unwrap();
        database
            .set_category_target(
                "trip",
                &PlanMonth::parse("2026-02").unwrap(),
                Some(&CategoryTargetDefinition {
                    behavior: "set_aside".into(),
                    amount: Huf(100),
                    due_kind: "day".into(),
                    due_day: Some(15),
                    interval_months: 12,
                    first_due_month: Some("2026-04".into()),
                }),
            )
            .unwrap();
        let february = PlanMonth::parse("2026-02").unwrap();
        assert_eq!(
            category_available_target(&database.plan_month(&february).unwrap(), "trip")
                .needed_this_month,
            Huf(34)
        );
        database
            .set_monthly_assignment("trip", &february, Huf(34))
            .unwrap();
        let march = PlanMonth::parse("2026-03").unwrap();
        assert_eq!(
            category_available_target(&database.plan_month(&march).unwrap(), "trip")
                .needed_this_month,
            Huf(33)
        );
        database
            .set_category_target_snoozed("trip", &march, true)
            .unwrap();
        assert_eq!(
            category_available_target(&database.plan_month(&march).unwrap(), "trip")
                .needed_this_month,
            Huf(0)
        );
        assert_eq!(
            category_available_target(
                &database
                    .plan_month(&PlanMonth::parse("2026-04").unwrap())
                    .unwrap(),
                "trip"
            )
            .needed_this_month,
            Huf(66)
        );
        database
            .set_category_target_snoozed("trip", &march, false)
            .unwrap();
        database
            .set_monthly_assignment("trip", &march, Huf(33))
            .unwrap();
        let april = PlanMonth::parse("2026-04").unwrap();
        let april_plan = database.plan_month(&april).unwrap();
        let april_target = category_available_target(&april_plan, "trip");
        assert_eq!(april_target.needed_this_month, Huf(33));
        assert_eq!(april_target.due_month.as_deref(), Some("2026-04"));
        database
            .set_monthly_assignment("trip", &april, Huf(33))
            .unwrap();
        let may = PlanMonth::parse("2026-05").unwrap();
        let may_plan = database.plan_month(&may).unwrap();
        let may_target = category_available_target(&may_plan, "trip");
        assert_eq!(may_target.needed_this_month, Huf(9));
        assert_eq!(may_target.due_month.as_deref(), Some("2027-04"));
    }

    #[test]
    fn quarterly_refill_uses_cycle_opening_balance_and_prior_assignments() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database.create_category_group("g", "Savings", 0).unwrap();
        database
            .create_category("reserve", "g", "Reserve", 0)
            .unwrap();
        database
            .create_account(&Account {
                id: "cash".into(),
                name: "Cash".into(),
                kind: AccountKind::Cash,
                sort_order: 0,
                closed: false,
            })
            .unwrap();
        let december = PlanMonth::parse("2025-12").unwrap();
        database
            .set_monthly_assignment("reserve", &december, Huf(40))
            .unwrap();
        database
            .set_category_target(
                "reserve",
                &PlanMonth::parse("2026-01").unwrap(),
                Some(&CategoryTargetDefinition {
                    behavior: "refill".into(),
                    amount: Huf(100),
                    due_kind: "last_day".into(),
                    due_day: None,
                    interval_months: 3,
                    first_due_month: Some("2026-03".into()),
                }),
            )
            .unwrap();
        let january = PlanMonth::parse("2026-01").unwrap();
        assert_eq!(
            category_available_target(&database.plan_month(&january).unwrap(), "reserve")
                .needed_this_month,
            Huf(20)
        );
        database
            .set_monthly_assignment("reserve", &january, Huf(20))
            .unwrap();
        let mut spending = Entry::manual(
            "periodic-spend",
            "cash",
            CalendarDate::parse("2026-01-15").unwrap(),
        );
        spending.category_id = Some("reserve".into());
        database.create_transaction(&spending, Huf(-30)).unwrap();
        let february = PlanMonth::parse("2026-02").unwrap();
        assert_eq!(
            category_available_target(&database.plan_month(&february).unwrap(), "reserve")
                .needed_this_month,
            Huf(20)
        );
        database
            .set_monthly_assignment("reserve", &february, Huf(20))
            .unwrap();
        let march = PlanMonth::parse("2026-03").unwrap();
        assert_eq!(
            category_available_target(&database.plan_month(&march).unwrap(), "reserve")
                .needed_this_month,
            Huf(20)
        );
        database
            .set_monthly_assignment("reserve", &march, Huf(20))
            .unwrap();
        let april = PlanMonth::parse("2026-04").unwrap();
        let april_plan = database.plan_month(&april).unwrap();
        let next_cycle = category_available_target(&april_plan, "reserve");
        assert_eq!(next_cycle.needed_this_month, Huf(10));
        assert_eq!(next_cycle.due_month.as_deref(), Some("2026-06"));
    }

    #[test]
    fn exact_period_due_month_is_included_before_cycle_resets() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database.create_category_group("g", "Savings", 0).unwrap();
        database
            .create_category("quarterly", "g", "Quarterly", 0)
            .unwrap();
        database
            .create_category("yearly", "g", "Yearly", 1)
            .unwrap();
        database
            .set_category_target(
                "quarterly",
                &PlanMonth::parse("2026-09").unwrap(),
                Some(&CategoryTargetDefinition {
                    behavior: "set_aside".into(),
                    amount: Huf(300),
                    due_kind: "last_day".into(),
                    due_day: None,
                    interval_months: 3,
                    first_due_month: Some("2026-09".into()),
                }),
            )
            .unwrap();
        database
            .set_category_target(
                "yearly",
                &PlanMonth::parse("2026-09").unwrap(),
                Some(&CategoryTargetDefinition {
                    behavior: "set_aside".into(),
                    amount: Huf(1200),
                    due_kind: "last_day".into(),
                    due_day: None,
                    interval_months: 12,
                    first_due_month: Some("2026-09".into()),
                }),
            )
            .unwrap();
        database
            .set_monthly_assignment("quarterly", &PlanMonth::parse("2026-09").unwrap(), Huf(100))
            .unwrap();
        database
            .set_monthly_assignment("quarterly", &PlanMonth::parse("2026-10").unwrap(), Huf(100))
            .unwrap();
        let december = database
            .plan_month(&PlanMonth::parse("2026-12").unwrap())
            .unwrap();
        let quarterly = category_available_target(&december, "quarterly");
        assert_eq!(quarterly.due_month.as_deref(), Some("2026-12"));
        assert_eq!(quarterly.needed_this_month, Huf(200));
        let january = database
            .plan_month(&PlanMonth::parse("2027-01").unwrap())
            .unwrap();
        let next_quarter = category_available_target(&january, "quarterly");
        assert_eq!(next_quarter.due_month.as_deref(), Some("2027-03"));
        assert_eq!(next_quarter.needed_this_month, Huf(100));
        let september = database
            .plan_month(&PlanMonth::parse("2027-09").unwrap())
            .unwrap();
        let yearly = category_available_target(&september, "yearly");
        assert_eq!(yearly.due_month.as_deref(), Some("2027-09"));
        assert_eq!(yearly.needed_this_month, Huf(1200));
    }

    #[test]
    fn periodic_refill_opening_balance_respects_as_of_cutoff() {
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
        database.create_category_group("g", "Savings", 0).unwrap();
        database
            .create_category("reserve", "g", "Reserve", 0)
            .unwrap();
        database
            .set_category_target(
                "reserve",
                &PlanMonth::parse("2026-02").unwrap(),
                Some(&CategoryTargetDefinition {
                    behavior: "refill".into(),
                    amount: Huf(100),
                    due_kind: "last_day".into(),
                    due_day: None,
                    interval_months: 3,
                    first_due_month: Some("2026-04".into()),
                }),
            )
            .unwrap();
        let mut future_income = Entry::manual(
            "future-income",
            "cash",
            CalendarDate::parse("2026-01-20").unwrap(),
        );
        future_income.category_id = Some("reserve".into());
        database
            .create_transaction(&future_income, Huf(80))
            .unwrap();
        let april = PlanMonth::parse("2026-04").unwrap();
        let cutoff = CalendarDate::parse("2026-01-15").unwrap();
        let plan = database.plan_month_as_of(&april, &cutoff).unwrap();
        let target = category_available_target(&plan, "reserve");
        assert_eq!(target.needed_this_month, Huf(100));
    }

    #[test]
    fn periodic_to_go_counts_negative_assigned_in_earlier_and_due_months() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database.create_category_group("g", "Savings", 0).unwrap();
        database
            .create_category("periodic", "g", "Periodic", 0)
            .unwrap();
        database
            .create_category("monthly", "g", "Monthly", 1)
            .unwrap();
        let january = PlanMonth::parse("2026-01").unwrap();
        let february = PlanMonth::parse("2026-02").unwrap();
        let march = PlanMonth::parse("2026-03").unwrap();
        database
            .set_category_target(
                "periodic",
                &january,
                Some(&CategoryTargetDefinition {
                    behavior: "set_aside".into(),
                    amount: Huf(100),
                    due_kind: "last_day".into(),
                    due_day: None,
                    interval_months: 3,
                    first_due_month: Some("2026-03".into()),
                }),
            )
            .unwrap();
        database
            .set_category_target(
                "monthly",
                &january,
                Some(&CategoryTargetDefinition {
                    behavior: "set_aside".into(),
                    amount: Huf(100),
                    due_kind: "last_day".into(),
                    due_day: None,
                    interval_months: 1,
                    first_due_month: None,
                }),
            )
            .unwrap();
        database
            .set_monthly_assignment("periodic", &january, Huf(60))
            .unwrap();
        database
            .set_monthly_assignment("periodic", &february, Huf(-20))
            .unwrap();
        database
            .set_monthly_assignment("monthly", &february, Huf(-20))
            .unwrap();
        database
            .set_monthly_assignment("periodic", &march, Huf(-20))
            .unwrap();

        let february_plan = database.plan_month(&february).unwrap();
        let periodic = category_available_target(&february_plan, "periodic");
        assert_eq!(periodic.needed_this_month, Huf(20));
        assert_eq!(periodic.funded, Huf(0));
        assert_eq!(periodic.to_go, Huf(40));
        assert_eq!(
            february_plan
                .categories
                .iter()
                .find(|row| row.category_id == "periodic")
                .unwrap()
                .assigned,
            Huf(-20)
        );
        assert_eq!(
            category_available_target(&february_plan, "monthly").to_go,
            Huf(100)
        );

        let ready_before_snooze = february_plan.ready_to_assign;
        database
            .set_category_target_snoozed("periodic", &february, true)
            .unwrap();
        let snoozed_plan = database.plan_month(&february).unwrap();
        let snoozed = category_available_target(&snoozed_plan, "periodic");
        assert_eq!(snoozed.needed_this_month, Huf(0));
        assert_eq!(snoozed.funded, Huf(0));
        assert_eq!(snoozed.to_go, Huf(0));
        assert_eq!(snoozed_plan.ready_to_assign, ready_before_snooze);
        assert_eq!(
            snoozed_plan
                .categories
                .iter()
                .find(|row| row.category_id == "periodic")
                .unwrap()
                .assigned,
            Huf(-20)
        );
        database
            .set_category_target_snoozed("periodic", &february, false)
            .unwrap();
        database
            .set_monthly_assignment("periodic", &february, Huf(20))
            .unwrap();
        let funded_plan = database.plan_month(&february).unwrap();
        let funded = category_available_target(&funded_plan, "periodic");
        assert_eq!(funded.funded, Huf(20));
        assert_eq!(funded.to_go, Huf(0));

        let due_plan = database.plan_month(&march).unwrap();
        let due = category_available_target(&due_plan, "periodic");
        assert_eq!(due.due_month.as_deref(), Some("2026-03"));
        assert_eq!(due.needed_this_month, Huf(20));
        assert_eq!(due.funded, Huf(0));
        assert_eq!(due.to_go, Huf(40));
        database
            .set_monthly_assignment("periodic", &march, Huf(20))
            .unwrap();
        let completed_plan = database.plan_month(&march).unwrap();
        let completed = category_available_target(&completed_plan, "periodic");
        assert_eq!(completed.funded, Huf(20));
        assert_eq!(completed.to_go, Huf(0));
        assert_eq!(database.connection.query_row::<i64, _, _>(
            "SELECT SUM(amount_huf) FROM category_month_assignments WHERE category_id='periodic' AND month BETWEEN '2026-01' AND '2026-03'",
            [], |row| row.get(0)
        ).unwrap(), 100);
    }

    #[test]
    fn periodic_target_rejects_invalid_interval_and_first_due_month() {
        let definition =
            |interval_months, first_due_month: Option<&str>| CategoryTargetDefinition {
                behavior: "set_aside".into(),
                amount: Huf(100),
                due_kind: "last_day".into(),
                due_day: None,
                interval_months,
                first_due_month: first_due_month.map(str::to_owned),
            };
        let effective = PlanMonth::parse("2026-01").unwrap();
        assert!(validate_target_definition(&definition(6, Some("2026-06")), &effective).is_err());
        assert!(validate_target_definition(&definition(3, None), &effective).is_err());
        assert!(validate_target_definition(&definition(12, Some("2025-12")), &effective).is_err());
        assert!(validate_target_definition(&definition(1, Some("2026-02")), &effective).is_err());
        assert!(
            validate_target_definition(&definition(3, Some("2026-02-01")), &effective).is_err()
        );
    }

    #[test]
    fn periodic_revisions_and_tombstones_preserve_prior_month_views() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database.create_category_group("g", "Savings", 0).unwrap();
        database.create_category("trip", "g", "Trip", 0).unwrap();
        database
            .set_category_target(
                "trip",
                &PlanMonth::parse("2026-01").unwrap(),
                Some(&CategoryTargetDefinition {
                    behavior: "set_aside".into(),
                    amount: Huf(1200),
                    due_kind: "last_day".into(),
                    due_day: None,
                    interval_months: 12,
                    first_due_month: Some("2026-12".into()),
                }),
            )
            .unwrap();
        database
            .set_category_target(
                "trip",
                &PlanMonth::parse("2026-06").unwrap(),
                Some(&CategoryTargetDefinition {
                    behavior: "refill".into(),
                    amount: Huf(300),
                    due_kind: "day".into(),
                    due_day: Some(15),
                    interval_months: 3,
                    first_due_month: Some("2026-08".into()),
                }),
            )
            .unwrap();
        assert_eq!(
            category_available_target(
                &database
                    .plan_month(&PlanMonth::parse("2026-05").unwrap())
                    .unwrap(),
                "trip"
            )
            .due_month
            .as_deref(),
            Some("2026-12")
        );
        assert_eq!(
            category_available_target(
                &database
                    .plan_month(&PlanMonth::parse("2026-06").unwrap())
                    .unwrap(),
                "trip"
            )
            .due_month
            .as_deref(),
            Some("2026-08")
        );
        database
            .set_category_target("trip", &PlanMonth::parse("2026-07").unwrap(), None)
            .unwrap();
        assert!(database
            .plan_month(&PlanMonth::parse("2026-07").unwrap())
            .unwrap()
            .categories
            .iter()
            .find(|row| row.category_id == "trip")
            .unwrap()
            .target
            .is_none());
        assert_eq!(
            category_available_target(
                &database
                    .plan_month(&PlanMonth::parse("2026-06").unwrap())
                    .unwrap(),
                "trip"
            )
            .due_month
            .as_deref(),
            Some("2026-08")
        );
    }
}
