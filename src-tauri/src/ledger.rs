//! Typed ledger operations. The desktop/import layers call these instead of SQL.
use crate::database::Database;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::{error::Error, fmt};

#[derive(Debug)]
pub enum LedgerError {
    InvalidValue(&'static str),
    NotFound,
    ReconciledConfirmationRequired,
    ReconciliationOutOfDate,
    AmountOverflow,
    Storage(rusqlite::Error),
}

impl fmt::Display for LedgerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidValue(message) => f.write_str(message),
            Self::NotFound => f.write_str("Ledger record not found."),
            Self::ReconciledConfirmationRequired => {
                f.write_str("Confirm changes to reconciled history.")
            }
            Self::ReconciliationOutOfDate => {
                f.write_str("The account changed since this reconciliation was reviewed.")
            }
            Self::AmountOverflow => f.write_str("Balance exceeds the signed 64-bit HUF range."),
            Self::Storage(_) => f.write_str("The ledger operation could not be saved or read."),
        }
    }
}
impl Error for LedgerError {}
impl From<rusqlite::Error> for LedgerError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error)
    }
}
pub type LedgerResult<T> = Result<T, LedgerError>;

/// Integer forints. JSON uses a decimal string, never a floating-point number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Huf(pub i64);

impl Serialize for Huf {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0.to_string())
    }
}
impl<'de> Deserialize<'de> for Huf {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        let amount: i64 = text.parse().map_err(serde::de::Error::custom)?;
        if amount.to_string() != text {
            return Err(serde::de::Error::custom(
                "Expected canonical integer HUF text.",
            ));
        }
        Ok(Self(amount))
    }
}

/// Calendar date with no time or timezone, validated at the Rust and SQL boundaries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct CalendarDate(String);

impl CalendarDate {
    pub fn parse(value: &str) -> LedgerResult<Self> {
        let bytes = value.as_bytes();
        if bytes.len() != 10
            || bytes[4] != b'-'
            || bytes[7] != b'-'
            || !bytes
                .iter()
                .enumerate()
                .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
        {
            return Err(LedgerError::InvalidValue(
                "Expected a yyyy-mm-dd calendar date.",
            ));
        }
        let year: u32 = value[..4].parse().unwrap();
        let month: usize = value[5..7].parse().unwrap();
        let day: u32 = value[8..].parse().unwrap();
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        let days = [
            31,
            if leap { 29 } else { 28 },
            31,
            30,
            31,
            30,
            31,
            31,
            30,
            31,
            30,
            31,
        ];
        if year == 0 || !(1..=12).contains(&month) || day == 0 || day > days[month - 1] {
            return Err(LedgerError::InvalidValue("Invalid calendar date."));
        }
        Ok(Self(value.to_owned()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl<'de> Deserialize<'de> for CalendarDate {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(&String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

// One mapping defines each enum's SQL spelling; JSON uses the same snake case.
macro_rules! sql_enum {
    ($name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }
        impl $name {
            pub fn as_str(self) -> &'static str { match self { $(Self::$variant => $text),+ } }
        }
        impl rusqlite::types::ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
                Ok(self.as_str().into())
            }
        }
        impl rusqlite::types::FromSql for $name {
            fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
                match value.as_str()? {
                    $($text => Ok(Self::$variant),)+
                    _ => Err(rusqlite::types::FromSqlError::InvalidType),
                }
            }
        }
    };
}
sql_enum!(AccountKind { Cash => "cash", Credit => "credit", Loan => "loan", Tracking => "tracking" });
sql_enum!(ClearedState { Uncleared => "uncleared", Cleared => "cleared", Reconciled => "reconciled" });
sql_enum!(PostingState { Posted => "posted", Scheduled => "scheduled" });
sql_enum!(Origin { Manual => "manual", Import => "import", Schedule => "schedule" });
sql_enum!(Direction { Outflow => "outflow", Inflow => "inflow" });

impl AccountKind {
    pub fn is_on_budget(self) -> bool {
        matches!(self, Self::Cash | Self::Credit)
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub kind: AccountKind,
    pub sort_order: i64,
    pub closed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub account_id: String,
    pub date: CalendarDate,
    pub payee_id: Option<String>,
    pub category_id: Option<String>,
    pub memo: String,
    pub flag_id: Option<String>,
    pub cleared_state: ClearedState,
    pub posting_state: PostingState,
    pub origin: Origin,
    pub scheduled_origin_id: Option<String>,
    pub import_row_id: Option<String>,
}

impl Entry {
    pub fn manual(id: &str, account_id: &str, date: CalendarDate) -> Self {
        Self {
            id: id.into(),
            account_id: account_id.into(),
            date,
            payee_id: None,
            category_id: None,
            memo: String::new(),
            flag_id: None,
            cleared_state: ClearedState::Cleared,
            posting_state: PostingState::Posted,
            origin: Origin::Manual,
            scheduled_origin_id: None,
            import_row_id: None,
        }
    }
    pub fn scheduled(id: &str, account_id: &str, date: CalendarDate, schedule_id: &str) -> Self {
        Self {
            cleared_state: ClearedState::Uncleared,
            posting_state: PostingState::Scheduled,
            origin: Origin::Schedule,
            scheduled_origin_id: Some(schedule_id.into()),
            ..Self::manual(id, account_id, date)
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferDraft {
    pub id: String,
    pub amount: Huf,
    pub outflow: Entry,
    pub inflow: Entry,
}

impl TransferDraft {
    /// The entered side is cleared, whichever direction the user entered it from.
    pub fn manual(
        id: &str,
        amount: Huf,
        mut entered: Entry,
        mut counterpart: Entry,
        direction: Direction,
    ) -> Self {
        for entry in [&mut entered, &mut counterpart] {
            entry.origin = Origin::Manual;
            entry.posting_state = PostingState::Posted;
            entry.scheduled_origin_id = None;
            entry.import_row_id = None;
        }
        entered.cleared_state = ClearedState::Cleared;
        counterpart.cleared_state = ClearedState::Uncleared;
        let (outflow, inflow) = match direction {
            Direction::Outflow => (entered, counterpart),
            Direction::Inflow => (counterpart, entered),
        };
        Self {
            id: id.into(),
            amount,
            outflow,
            inflow,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    #[serde(flatten)]
    pub entry: Entry,
    pub amount: Huf,
    pub transfer_id: Option<String>,
    pub transfer_direction: Option<Direction>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountBalance {
    pub working: Huf,
    /// Includes both cleared and reconciled entries.
    pub cleared: Huf,
    pub uncleared: Huf,
    pub reconciled: Huf,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountOverview {
    pub id: String,
    pub name: String,
    pub kind: AccountKind,
    pub sort_order: i64,
    pub closed: bool,
    pub balance: AccountBalance,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetWorthReport {
    pub as_of: CalendarDate,
    pub compared_to: Option<CalendarDate>,
    pub assets: Huf,
    pub debts: Huf,
    pub net_worth: Huf,
    pub change: Option<Huf>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterEntry {
    pub id: String,
    pub date: CalendarDate,
    pub payee_name: Option<String>,
    pub category_group_name: Option<String>,
    pub category_name: Option<String>,
    pub memo: String,
    pub flag_name: Option<String>,
    pub flag_color: Option<String>,
    pub cleared_state: ClearedState,
    pub posting_state: PostingState,
    pub origin: Origin,
    pub amount: Huf,
    pub transfer_id: Option<String>,
    pub transfer_account_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayeeOption {
    pub id: String,
    pub name: String,
    pub last_category_id: Option<String>,
    pub last_direction: Option<Direction>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryOption {
    pub id: String,
    pub group_name: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlagOption {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionFormOptions {
    pub payees: Vec<PayeeOption>,
    pub categories: Vec<CategoryOption>,
    pub flags: Vec<FlagOption>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualTransactionDraft {
    pub account_id: String,
    pub date: CalendarDate,
    pub payee_name: Option<String>,
    pub category_id: Option<String>,
    pub memo: String,
    pub flag_id: Option<String>,
    pub amount: Huf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyScheduleDraft {
    pub account_id: String,
    pub start_date: CalendarDate,
    pub end_date: Option<CalendarDate>,
    pub payee_name: Option<String>,
    pub category_id: Option<String>,
    pub memo: String,
    pub flag_id: Option<String>,
    pub amount: Huf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendingReportInput {
    pub from: CalendarDate,
    pub to: CalendarDate,
    pub account_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendingCategoryTotal {
    pub category_id: Option<String>,
    pub group_name: Option<String>,
    pub category_name: String,
    pub total: Huf,
    pub transaction_count: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendingPayeeTotal {
    pub payee_name: String,
    pub total: Huf,
    pub transaction_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InflowOutflowMonth {
    pub month: String,
    pub inflow: Huf,
    pub outflow: Huf,
    pub difference: Huf,
    pub inflow_transaction_count: usize,
    pub outflow_transaction_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InflowOutflowReport {
    pub from: CalendarDate,
    pub to: CalendarDate,
    pub months: Vec<InflowOutflowMonth>,
    pub total_inflow: Huf,
    pub total_outflow: Huf,
    pub total_difference: Huf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledOccurrence {
    pub schedule_id: String,
    pub transaction_id: String,
    pub account_name: String,
    pub date: CalendarDate,
    pub payee_name: Option<String>,
    pub category_name: Option<String>,
    pub memo: String,
    pub amount: Huf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualTransferInput {
    pub account_id: String,
    pub counterpart_account_id: String,
    pub date: CalendarDate,
    pub memo: String,
    pub flag_id: Option<String>,
    pub amount: Huf,
    pub direction: Direction,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterEntryEdit {
    pub id: String,
    pub memo: String,
    pub amount: Huf,
    pub cleared_state: ClearedState,
    pub confirmed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationInput {
    pub account_id: String,
    pub as_of: CalendarDate,
    pub bank_cleared_balance: Huf,
    pub expected_cleared_balance: Option<Huf>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationReview {
    pub account_id: String,
    pub as_of: CalendarDate,
    pub app_cleared_balance: Huf,
    pub bank_cleared_balance: Huf,
    pub adjustment_amount: Huf,
    pub cleared_entry_count: usize,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationResult {
    pub review: ReconciliationReview,
    pub reconciled_entry_count: usize,
    pub adjustment_transaction_id: Option<String>,
}

impl Database {
    pub fn create_account(&self, account: &Account) -> LedgerResult<()> {
        self.connection.execute(
            "INSERT INTO accounts (id,name,kind,sort_order,closed) VALUES (?1,?2,?3,?4,?5)",
            params![
                account.id,
                account.name,
                account.kind,
                account.sort_order,
                account.closed
            ],
        )?;
        Ok(())
    }

    pub fn accounts(&self) -> LedgerResult<Vec<Account>> {
        let mut query = self.connection.prepare("SELECT id,name,kind,sort_order,closed FROM accounts ORDER BY CASE WHEN closed=1 THEN 4 WHEN kind='cash' THEN 0 WHEN kind='credit' THEN 1 WHEN kind='loan' THEN 2 ELSE 3 END,sort_order,id")?;
        let accounts = query
            .query_map([], |row| {
                Ok(Account {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    kind: row.get(2)?,
                    sort_order: row.get(3)?,
                    closed: row.get(4)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(accounts)
    }

    pub fn set_account_closed(&self, id: &str, closed: bool) -> LedgerResult<()> {
        require_changed(self.connection.execute(
            "UPDATE accounts SET closed=?2 WHERE id=?1",
            params![id, closed],
        )?)
    }

    pub fn create_category_group(&self, id: &str, name: &str, order: i64) -> LedgerResult<()> {
        self.connection.execute(
            "INSERT INTO category_groups (id,name,sort_order) VALUES (?1,?2,?3)",
            params![id, name, order],
        )?;
        Ok(())
    }

    pub fn create_category(
        &self,
        id: &str,
        group: &str,
        name: &str,
        order: i64,
    ) -> LedgerResult<()> {
        self.connection.execute(
            "INSERT INTO categories (id,group_id,name,sort_order) VALUES (?1,?2,?3,?4)",
            params![id, group, name, order],
        )?;
        Ok(())
    }

    pub fn create_payee(&self, id: &str, name: &str) -> LedgerResult<()> {
        self.connection.execute(
            "INSERT INTO payees (id,name) VALUES (?1,?2)",
            params![id, name],
        )?;
        Ok(())
    }

    pub fn rename_flag(&self, id: &str, name: &str) -> LedgerResult<()> {
        require_changed(
            self.connection
                .execute("UPDATE flags SET name=?2 WHERE id=?1", params![id, name])?,
        )
    }

    pub fn create_transaction(&self, entry: &Entry, amount: Huf) -> LedgerResult<()> {
        insert_entry(&self.connection, entry, Some(amount), None)
    }

    pub fn create_transfer(&mut self, draft: &TransferDraft) -> LedgerResult<()> {
        if draft.amount.0 <= 0 {
            return Err(LedgerError::InvalidValue(
                "Transfer amount must be positive.",
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO transfers (id,amount_huf,outflow_id,inflow_id) VALUES (?1,?2,?3,?4)",
            params![draft.id, draft.amount.0, draft.outflow.id, draft.inflow.id],
        )?;
        insert_entry(
            &transaction,
            &draft.outflow,
            None,
            Some((&draft.id, Direction::Outflow)),
        )?;
        insert_entry(
            &transaction,
            &draft.inflow,
            None,
            Some((&draft.id, Direction::Inflow)),
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn entries(&self, account_id: &str) -> LedgerResult<Vec<LedgerEntry>> {
        ensure_account(&self.connection, account_id)?;
        let mut query = self.connection.prepare("SELECT id,account_id,transaction_date,payee_id,category_id,memo,flag_id,cleared_state,posting_state,origin,scheduled_origin_id,import_row_id,amount_huf,transfer_id,transfer_direction FROM ledger_entries WHERE account_id=?1 ORDER BY transaction_date DESC,id")?;
        let entries = query
            .query_map([account_id], |row| {
                let date: String = row.get(2)?;
                Ok(LedgerEntry {
                    entry: Entry {
                        id: row.get(0)?,
                        account_id: row.get(1)?,
                        date: CalendarDate::parse(&date).map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                2,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        })?,
                        payee_id: row.get(3)?,
                        category_id: row.get(4)?,
                        memo: row.get(5)?,
                        flag_id: row.get(6)?,
                        cleared_state: row.get(7)?,
                        posting_state: row.get(8)?,
                        origin: row.get(9)?,
                        scheduled_origin_id: row.get(10)?,
                        import_row_id: row.get(11)?,
                    },
                    amount: Huf(row.get(12)?),
                    transfer_id: row.get(13)?,
                    transfer_direction: row.get(14)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(entries)
    }

    pub fn account_balance(
        &self,
        account_id: &str,
        as_of: &CalendarDate,
    ) -> LedgerResult<AccountBalance> {
        account_balance_for(&self.connection, account_id, as_of)
    }

    pub fn preview_account_reconciliation(
        &self,
        input: &ReconciliationInput,
    ) -> LedgerResult<ReconciliationReview> {
        ensure_open_account(&self.connection, &input.account_id)?;
        reconciliation_review_for(&self.connection, input)
    }

    pub fn reconcile_account(
        &mut self,
        input: &ReconciliationInput,
    ) -> LedgerResult<ReconciliationResult> {
        let expected = input
            .expected_cleared_balance
            .ok_or(LedgerError::InvalidValue(
                "Review the account before reconciling it.",
            ))?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_open_account(&transaction, &input.account_id)?;
        let review = reconciliation_review_for(&transaction, input)?;
        if review.app_cleared_balance != expected {
            return Err(LedgerError::ReconciliationOutOfDate);
        }
        let reconciled_entry_count = transaction.execute(
            "UPDATE transactions SET cleared_state='reconciled' WHERE account_id=?1 AND posting_state='posted' AND transaction_date<=?2 AND cleared_state='cleared'",
            params![input.account_id, input.as_of.as_str()],
        )?;
        let adjustment_transaction_id = if review.adjustment_amount.0 == 0 {
            None
        } else {
            let id = random_id(&transaction, "reconciliation-adjustment")?;
            let mut entry = Entry::manual(&id, &input.account_id, input.as_of.clone());
            entry.cleared_state = ClearedState::Reconciled;
            entry.payee_id =
                resolve_payee(&transaction, Some("Reconciliation Balance Adjustment"))?;
            entry.memo = format!("Reconciliation adjustment for {}", input.as_of.as_str());
            insert_entry(&transaction, &entry, Some(review.adjustment_amount), None)?;
            Some(id)
        };
        transaction.commit()?;
        Ok(ReconciliationResult {
            review,
            reconciled_entry_count,
            adjustment_transaction_id,
        })
    }

    pub fn account_overviews(&self, as_of: &CalendarDate) -> LedgerResult<Vec<AccountOverview>> {
        self.accounts()?
            .into_iter()
            .map(|account| {
                Ok(AccountOverview {
                    balance: self.account_balance(&account.id, as_of)?,
                    id: account.id,
                    name: account.name,
                    kind: account.kind,
                    sort_order: account.sort_order,
                    closed: account.closed,
                })
            })
            .collect()
    }

    pub fn net_worth_report(
        &self,
        as_of: &CalendarDate,
        compared_to: Option<&CalendarDate>,
    ) -> LedgerResult<NetWorthReport> {
        let net_worth = net_worth_for(self.account_overviews(as_of)?)?;
        let (assets, debts) = asset_debt_totals(self.account_overviews(as_of)?)?;
        let change = compared_to
            .map(|date| {
                net_worth_for(self.account_overviews(date)?)
                    .and_then(|prior| narrow(i128::from(net_worth.0) - i128::from(prior.0)))
            })
            .transpose()?;
        Ok(NetWorthReport {
            as_of: as_of.clone(),
            compared_to: compared_to.cloned(),
            assets,
            debts,
            net_worth,
            change,
        })
    }

    /// Returns display-ready ledger rows while keeping all financial querying
    /// and foreign-key resolution on the Rust side of the IPC boundary.
    pub fn register_entries(&self, account_id: &str) -> LedgerResult<Vec<RegisterEntry>> {
        ensure_account(&self.connection, account_id)?;
        let mut query = self.connection.prepare(
            "SELECT le.id,le.transaction_date,p.name,cg.name,c.name,le.memo,f.name,f.color,le.cleared_state,le.posting_state,le.origin,le.amount_huf,le.transfer_id,transfer_account.name
             FROM ledger_entries le
             LEFT JOIN payees p ON p.id=le.payee_id
             LEFT JOIN categories c ON c.id=le.category_id
             LEFT JOIN category_groups cg ON cg.id=c.group_id
             LEFT JOIN flags f ON f.id=le.flag_id
             LEFT JOIN transactions peer ON peer.transfer_id=le.transfer_id AND peer.id<>le.id
             LEFT JOIN accounts transfer_account ON transfer_account.id=peer.account_id
             WHERE le.account_id=?1
             ORDER BY le.transaction_date DESC,le.created_at DESC,le.id DESC",
        )?;
        let entries = query
            .query_map([account_id], |row| {
                let date: String = row.get(1)?;
                Ok(RegisterEntry {
                    id: row.get(0)?,
                    date: CalendarDate::parse(&date).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            1,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                    payee_name: row.get(2)?,
                    category_group_name: row.get(3)?,
                    category_name: row.get(4)?,
                    memo: row.get(5)?,
                    flag_name: row.get(6)?,
                    flag_color: row.get(7)?,
                    cleared_state: row.get(8)?,
                    posting_state: row.get(9)?,
                    origin: row.get(10)?,
                    amount: Huf(row.get(11)?),
                    transfer_id: row.get(12)?,
                    transfer_account_name: row.get(13)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(entries)
    }

    pub fn transaction_form_options(&self) -> LedgerResult<TransactionFormOptions> {
        let payees = {
            let mut query = self.connection.prepare(
                "SELECT id,name,last_category_id,last_direction FROM payees WHERE archived=0 ORDER BY name COLLATE NOCASE,id",
            )?;
            let rows = query
                .query_map([], |row| {
                    Ok(PayeeOption {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        last_category_id: row.get(2)?,
                        last_direction: row.get(3)?,
                    })
                })?
                .collect::<Result<_, _>>()?;
            rows
        };
        let categories = {
            let mut query = self.connection.prepare(
                "SELECT c.id,g.name,c.name FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE c.hidden=0 AND g.hidden=0 ORDER BY g.sort_order,c.sort_order,c.id",
            )?;
            let rows = query
                .query_map([], |row| {
                    Ok(CategoryOption {
                        id: row.get(0)?,
                        group_name: row.get(1)?,
                        name: row.get(2)?,
                    })
                })?
                .collect::<Result<_, _>>()?;
            rows
        };
        let flags = {
            let mut query = self
                .connection
                .prepare("SELECT id,name,color FROM flags ORDER BY sort_order")?;
            let rows = query
                .query_map([], |row| {
                    Ok(FlagOption {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        color: row.get(2)?,
                    })
                })?
                .collect::<Result<_, _>>()?;
            rows
        };
        Ok(TransactionFormOptions {
            payees,
            categories,
            flags,
        })
    }

    pub fn spending_by_category(
        &self,
        input: &SpendingReportInput,
    ) -> LedgerResult<Vec<SpendingCategoryTotal>> {
        if input.from.as_str() > input.to.as_str() {
            return Err(LedgerError::InvalidValue(
                "Report start date must not be after its end date.",
            ));
        }
        let mut sql = "SELECT t.category_id,g.name,COALESCE(c.name,'Uncategorized'),SUM(-t.amount_huf),COUNT(*) FROM ledger_entries t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN category_groups g ON g.id=c.group_id WHERE t.posting_state='posted' AND t.transfer_id IS NULL AND t.amount_huf<0 AND t.transaction_date>=?1 AND t.transaction_date<=?2".to_owned();
        if input.account_ids.is_empty() {
            sql.push_str(" AND a.kind IN ('cash','credit')");
        } else {
            sql.push_str(" AND a.id IN (");
            sql.push_str(
                &std::iter::repeat_n("?", input.account_ids.len())
                    .collect::<Vec<_>>()
                    .join(","),
            );
            sql.push(')');
        }
        sql.push_str(" GROUP BY t.category_id,g.name,c.name ORDER BY SUM(-t.amount_huf) DESC,c.name,t.category_id");
        let mut values: Vec<rusqlite::types::Value> = vec![
            input.from.as_str().to_owned().into(),
            input.to.as_str().to_owned().into(),
        ];
        values.extend(input.account_ids.iter().cloned().map(Into::into));
        let mut statement = self.connection.prepare(&sql)?;
        let totals = statement
            .query_map(rusqlite::params_from_iter(values), |row| {
                Ok(SpendingCategoryTotal {
                    category_id: row.get(0)?,
                    group_name: row.get(1)?,
                    category_name: row.get(2)?,
                    total: Huf(row.get(3)?),
                    transaction_count: row.get(4)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(totals)
    }
    pub fn spending_by_payee(
        &self,
        input: &SpendingReportInput,
    ) -> LedgerResult<Vec<SpendingPayeeTotal>> {
        if input.from.as_str() > input.to.as_str() {
            return Err(LedgerError::InvalidValue(
                "Report start date must not be after its end date.",
            ));
        }
        let mut sql = "SELECT COALESCE(p.name,'No payee'),SUM(-t.amount_huf),COUNT(*) FROM ledger_entries t JOIN accounts a ON a.id=t.account_id LEFT JOIN payees p ON p.id=t.payee_id WHERE t.posting_state='posted' AND t.transfer_id IS NULL AND t.amount_huf<0 AND t.transaction_date>=?1 AND t.transaction_date<=?2".to_owned();
        if input.account_ids.is_empty() {
            sql.push_str(" AND a.kind IN ('cash','credit')");
        } else {
            sql.push_str(" AND a.id IN (");
            sql.push_str(
                &std::iter::repeat_n("?", input.account_ids.len())
                    .collect::<Vec<_>>()
                    .join(","),
            );
            sql.push(')');
        }
        sql.push_str(" GROUP BY t.payee_id,p.name ORDER BY SUM(-t.amount_huf) DESC,p.name");
        let mut values: Vec<rusqlite::types::Value> = vec![
            input.from.as_str().to_owned().into(),
            input.to.as_str().to_owned().into(),
        ];
        values.extend(input.account_ids.iter().cloned().map(Into::into));
        let mut statement = self.connection.prepare(&sql)?;
        let totals = statement
            .query_map(rusqlite::params_from_iter(values), |row| {
                Ok(SpendingPayeeTotal {
                    payee_name: row.get(0)?,
                    total: Huf(row.get(1)?),
                    transaction_count: row.get(2)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(totals)
    }

    pub fn inflow_outflow_by_month(
        &self,
        input: &SpendingReportInput,
    ) -> LedgerResult<InflowOutflowReport> {
        if input.from.as_str() > input.to.as_str() {
            return Err(LedgerError::InvalidValue(
                "Report start date must not be after its end date.",
            ));
        }
        let mut sql = "SELECT substr(t.transaction_date,1,7),SUM(CASE WHEN t.amount_huf>0 THEN t.amount_huf ELSE 0 END),SUM(CASE WHEN t.amount_huf<0 THEN -t.amount_huf ELSE 0 END),SUM(CASE WHEN t.amount_huf>0 THEN 1 ELSE 0 END),SUM(CASE WHEN t.amount_huf<0 THEN 1 ELSE 0 END) FROM ledger_entries t JOIN accounts a ON a.id=t.account_id WHERE t.posting_state='posted' AND t.transfer_id IS NULL AND t.amount_huf<>0 AND t.transaction_date>=?1 AND t.transaction_date<=?2".to_owned();
        if input.account_ids.is_empty() {
            sql.push_str(" AND a.kind IN ('cash','credit')");
        } else {
            sql.push_str(" AND a.id IN (");
            sql.push_str(
                &std::iter::repeat_n("?", input.account_ids.len())
                    .collect::<Vec<_>>()
                    .join(","),
            );
            sql.push(')');
        }
        sql.push_str(
            " GROUP BY substr(t.transaction_date,1,7) ORDER BY substr(t.transaction_date,1,7)",
        );
        let mut values: Vec<rusqlite::types::Value> = vec![
            input.from.as_str().to_owned().into(),
            input.to.as_str().to_owned().into(),
        ];
        values.extend(input.account_ids.iter().cloned().map(Into::into));
        let mut statement = self.connection.prepare(&sql)?;
        let totals = statement
            .query_map(rusqlite::params_from_iter(values), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    (
                        Huf(row.get(1)?),
                        Huf(row.get(2)?),
                        row.get::<_, usize>(3)?,
                        row.get::<_, usize>(4)?,
                    ),
                ))
            })?
            .collect::<Result<std::collections::BTreeMap<_, _>, _>>()?;
        let mut total_inflow = 0i128;
        let mut total_outflow = 0i128;
        let months = report_months(&input.from, &input.to)?
            .into_iter()
            .map(|month| {
                let (inflow, outflow, inflow_transaction_count, outflow_transaction_count) = totals
                    .get(&month)
                    .copied()
                    .unwrap_or((Huf(0), Huf(0), 0, 0));
                add(&mut total_inflow, i128::from(inflow.0))?;
                add(&mut total_outflow, i128::from(outflow.0))?;
                Ok(InflowOutflowMonth {
                    month,
                    inflow,
                    outflow,
                    difference: narrow(i128::from(inflow.0) - i128::from(outflow.0))?,
                    inflow_transaction_count,
                    outflow_transaction_count,
                })
            })
            .collect::<LedgerResult<Vec<_>>>()?;
        let total_inflow = narrow(total_inflow)?;
        let total_outflow = narrow(total_outflow)?;
        Ok(InflowOutflowReport {
            from: input.from.clone(),
            to: input.to.clone(),
            total_difference: narrow(i128::from(total_inflow.0) - i128::from(total_outflow.0))?,
            total_inflow,
            total_outflow,
            months,
        })
    }

    pub fn create_monthly_schedule(&mut self, draft: &MonthlyScheduleDraft) -> LedgerResult<()> {
        if draft.amount.0 == 0
            || draft
                .end_date
                .as_ref()
                .is_some_and(|end| end.as_str() < draft.start_date.as_str())
        {
            return Err(LedgerError::InvalidValue("Invalid monthly schedule."));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_open_account(&transaction, &draft.account_id)?;
        let schedule_id = random_id(&transaction, "monthly-schedule")?;
        let payee_id = resolve_payee(&transaction, draft.payee_name.as_deref())?;
        let day = calendar_day(&draft.start_date)?;
        transaction.execute("INSERT INTO schedules (id,account_id,payee_id,category_id,memo,flag_id,amount_huf,start_date,day_of_month,end_date) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)", params![schedule_id,draft.account_id,payee_id,draft.category_id,draft.memo.trim(),draft.flag_id,draft.amount.0,draft.start_date.as_str(),day,draft.end_date.as_ref().map(CalendarDate::as_str)])?;
        materialize_occurrence(&transaction, &schedule_id, &draft.start_date)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn scheduled_occurrences(&self) -> LedgerResult<Vec<ScheduledOccurrence>> {
        let mut statement = self.connection.prepare("SELECT o.schedule_id,o.transaction_id,a.name,t.transaction_date,p.name,c.name,t.memo,t.amount_huf FROM schedule_occurrences o JOIN transactions t ON t.id=o.transaction_id JOIN schedules s ON s.id=o.schedule_id JOIN accounts a ON a.id=s.account_id LEFT JOIN payees p ON p.id=t.payee_id LEFT JOIN categories c ON c.id=t.category_id WHERE o.state='pending' ORDER BY t.transaction_date,o.schedule_id")?;
        let occurrences = statement
            .query_map([], |row| {
                Ok(ScheduledOccurrence {
                    schedule_id: row.get(0)?,
                    transaction_id: row.get(1)?,
                    account_name: row.get(2)?,
                    date: CalendarDate::parse(&row.get::<_, String>(3)?).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            3,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                    payee_name: row.get(4)?,
                    category_name: row.get(5)?,
                    memo: row.get(6)?,
                    amount: Huf(row.get(7)?),
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(occurrences)
    }

    pub fn post_scheduled_occurrence(&mut self, transaction_id: &str) -> LedgerResult<()> {
        self.finish_scheduled_occurrence(transaction_id, "posted")
    }

    pub fn skip_scheduled_occurrence(&mut self, transaction_id: &str) -> LedgerResult<()> {
        self.finish_scheduled_occurrence(transaction_id, "skipped")
    }

    pub fn deactivate_schedule(&mut self, schedule_id: &str) -> LedgerResult<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_changed(transaction.execute(
            "UPDATE schedules SET active=0 WHERE id=?1 AND active=1",
            [schedule_id],
        )?)?;
        let ids = transaction.prepare("SELECT transaction_id FROM schedule_occurrences WHERE schedule_id=?1 AND state='pending'")?.query_map([schedule_id], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        transaction.execute("UPDATE schedule_occurrences SET transaction_id=NULL,state='skipped' WHERE schedule_id=?1 AND state='pending'", [schedule_id])?;
        for id in ids {
            transaction.execute(
                "DELETE FROM transactions WHERE id=?1 AND posting_state='scheduled'",
                [id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    fn finish_scheduled_occurrence(
        &mut self,
        transaction_id: &str,
        state: &str,
    ) -> LedgerResult<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (schedule_id, date): (String, String) = transaction.query_row("SELECT schedule_id,occurrence_date FROM schedule_occurrences WHERE transaction_id=?1 AND state='pending'", [transaction_id], |row| Ok((row.get(0)?,row.get(1)?))).optional()?.ok_or(LedgerError::NotFound)?;
        if state == "posted" {
            transaction.execute("UPDATE transactions SET posting_state='posted' WHERE id=?1 AND posting_state='scheduled'", [transaction_id])?;
        } else {
            transaction.execute("UPDATE schedule_occurrences SET transaction_id=NULL,state='skipped' WHERE transaction_id=?1", [transaction_id])?;
            transaction.execute(
                "DELETE FROM transactions WHERE id=?1 AND posting_state='scheduled'",
                [transaction_id],
            )?;
        }
        if state == "posted" {
            transaction.execute(
                "UPDATE schedule_occurrences SET state='posted' WHERE transaction_id=?1",
                [transaction_id],
            )?;
        }
        let previous = CalendarDate::parse(&date)?;
        if let Some(next) = next_schedule_date(&transaction, &schedule_id, &previous)? {
            materialize_occurrence(&transaction, &schedule_id, &next)?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn create_manual_transaction(
        &mut self,
        draft: &ManualTransactionDraft,
    ) -> LedgerResult<String> {
        if draft.amount.0 == 0 {
            return Err(LedgerError::InvalidValue(
                "A manual transaction amount cannot be zero.",
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_open_account(&transaction, &draft.account_id)?;
        let id = random_id(&transaction, "manual-transaction")?;
        let payee_id = resolve_payee(&transaction, draft.payee_name.as_deref())?;
        let mut entry = Entry::manual(&id, &draft.account_id, draft.date.clone());
        entry.payee_id = payee_id.clone();
        entry.category_id = draft.category_id.clone();
        entry.memo = draft.memo.trim().to_owned();
        entry.flag_id = draft.flag_id.clone();
        insert_entry(&transaction, &entry, Some(draft.amount), None)?;
        if let Some(payee_id) = payee_id {
            let direction = if draft.amount.0 < 0 {
                Direction::Outflow
            } else {
                Direction::Inflow
            };
            transaction.execute(
                "UPDATE payees SET last_category_id=?2,last_direction=?3 WHERE id=?1",
                params![payee_id, draft.category_id, direction],
            )?;
        }
        transaction.commit()?;
        Ok(id)
    }

    pub fn create_manual_transfer(&mut self, input: &ManualTransferInput) -> LedgerResult<String> {
        if input.account_id == input.counterpart_account_id {
            return Err(LedgerError::InvalidValue(
                "A transfer needs two different accounts.",
            ));
        }
        if input.amount.0 <= 0 {
            return Err(LedgerError::InvalidValue(
                "Transfer amount must be positive.",
            ));
        }
        ensure_open_account(&self.connection, &input.account_id)?;
        ensure_open_account(&self.connection, &input.counterpart_account_id)?;
        let transfer_id = random_id(&self.connection, "manual-transfer")?;
        let entered_id = random_id(&self.connection, "manual-transaction")?;
        let counterpart_id = random_id(&self.connection, "manual-transaction")?;
        let mut entered = Entry::manual(&entered_id, &input.account_id, input.date.clone());
        let mut counterpart = Entry::manual(
            &counterpart_id,
            &input.counterpart_account_id,
            input.date.clone(),
        );
        for entry in [&mut entered, &mut counterpart] {
            entry.memo = input.memo.trim().to_owned();
            entry.flag_id = input.flag_id.clone();
        }
        self.create_transfer(&TransferDraft::manual(
            &transfer_id,
            input.amount,
            entered,
            counterpart,
            input.direction,
        ))?;
        Ok(entered_id)
    }

    /// Applies the editable register fields atomically. Transfer amounts stay
    /// on the shared pair record, while memo and clearing state belong to the
    /// selected leg. Any financial change touching reconciled history requires
    /// an explicit retry with confirmation; memo-only edits never do.
    pub fn update_register_entry(&mut self, edit: &RegisterEntryEdit) -> LedgerResult<()> {
        if edit.amount.0 == 0 {
            return Err(LedgerError::InvalidValue(
                "A transaction amount cannot be zero.",
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = transaction
            .query_row(
                "SELECT transfer_id,transfer_direction,cleared_state,memo,amount_huf,posting_state FROM ledger_entries WHERE id=?1",
                [&edit.id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<Direction>>(1)?,
                        row.get::<_, ClearedState>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, PostingState>(5)?,
                    ))
                },
            )
            .optional()?
            .ok_or(LedgerError::NotFound)?;
        if current.5 == PostingState::Scheduled {
            return Err(LedgerError::InvalidValue(
                "Use the schedule Post or Skip action.",
            ));
        }
        let amount_changed = current.4 != edit.amount.0;
        let state_changed = current.2 != edit.cleared_state;
        let reconciled_pair = if let Some(transfer_id) = current.0.as_deref() {
            transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM transactions WHERE transfer_id=?1 AND cleared_state='reconciled')",
                [transfer_id],
                |row| row.get(0),
            )?
        } else {
            false
        };
        let confirmation_required = (state_changed && current.2 == ClearedState::Reconciled)
            || (amount_changed && (current.2 == ClearedState::Reconciled || reconciled_pair));
        confirm_reconciled(confirmation_required, edit.confirmed)?;

        if let Some(transfer_id) = current.0 {
            let direction = current.1.ok_or(LedgerError::InvalidValue(
                "A transfer direction is missing.",
            ))?;
            let valid_sign = match direction {
                Direction::Outflow => edit.amount.0 < 0,
                Direction::Inflow => edit.amount.0 > 0,
            };
            if !valid_sign {
                return Err(LedgerError::InvalidValue(
                    "A transfer cannot reverse direction during amount editing.",
                ));
            }
            if amount_changed {
                transaction.execute(
                    "UPDATE transfers SET amount_huf=?2 WHERE id=?1",
                    params![
                        transfer_id,
                        edit.amount
                            .0
                            .checked_abs()
                            .ok_or(LedgerError::AmountOverflow)?
                    ],
                )?;
            }
        } else if amount_changed {
            transaction.execute(
                "UPDATE transactions SET amount_huf=?2 WHERE id=?1",
                params![edit.id, edit.amount.0],
            )?;
        }
        if current.3 != edit.memo || state_changed {
            transaction.execute(
                "UPDATE transactions SET memo=?2,cleared_state=?3 WHERE id=?1",
                params![edit.id, edit.memo.trim(), edit.cleared_state],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn update_transaction_amount(
        &mut self,
        id: &str,
        amount: Huf,
        confirmed: bool,
    ) -> LedgerResult<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (transfer, state) = entry_identity(&transaction, id)?;
        if transfer.is_some() {
            return Err(LedgerError::InvalidValue(
                "Use the paired transfer amount operation.",
            ));
        }
        confirm_reconciled(state == ClearedState::Reconciled, confirmed)?;
        transaction.execute(
            "UPDATE transactions SET amount_huf=?2 WHERE id=?1",
            params![id, amount.0],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn update_transfer_amount(
        &mut self,
        id: &str,
        amount: Huf,
        confirmed: bool,
    ) -> LedgerResult<()> {
        if amount.0 <= 0 {
            return Err(LedgerError::InvalidValue(
                "Transfer amount must be positive.",
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        guard_transfer(&transaction, id, confirmed)?;
        require_changed(transaction.execute(
            "UPDATE transfers SET amount_huf=?2 WHERE id=?1",
            params![id, amount.0],
        )?)?;
        transaction.commit()?;
        Ok(())
    }

    /// Deleting either transfer leg deletes its pair atomically.
    pub fn delete_entry(&mut self, id: &str, confirmed: bool) -> LedgerResult<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let scheduled: bool = transaction
            .query_row(
                "SELECT posting_state='scheduled' FROM transactions WHERE id=?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(LedgerError::NotFound)?;
        if scheduled {
            return Err(LedgerError::InvalidValue(
                "Use the schedule Post or Skip action.",
            ));
        }
        let (transfer, state) = entry_identity(&transaction, id)?;
        if let Some(transfer_id) = transfer {
            guard_transfer(&transaction, &transfer_id, confirmed)?;
            transaction.execute(
                "DELETE FROM transactions WHERE transfer_id=?1",
                [&transfer_id],
            )?;
            transaction.execute("DELETE FROM transfers WHERE id=?1", [&transfer_id])?;
        } else {
            confirm_reconciled(state == ClearedState::Reconciled, confirmed)?;
            transaction.execute("DELETE FROM transactions WHERE id=?1", [id])?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn update_memo(&self, id: &str, memo: &str) -> LedgerResult<()> {
        require_changed(self.connection.execute(
            "UPDATE transactions SET memo=?2 WHERE id=?1",
            params![id, memo],
        )?)
    }

    pub fn set_cleared_state(
        &mut self,
        id: &str,
        state: ClearedState,
        confirmed: bool,
    ) -> LedgerResult<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (_, previous) = entry_identity(&transaction, id)?;
        confirm_reconciled(
            previous == ClearedState::Reconciled && state != previous,
            confirmed,
        )?;
        transaction.execute(
            "UPDATE transactions SET cleared_state=?2 WHERE id=?1",
            params![id, state],
        )?;
        transaction.commit()?;
        Ok(())
    }
}

fn account_balance_for(
    connection: &Connection,
    account_id: &str,
    as_of: &CalendarDate,
) -> LedgerResult<AccountBalance> {
    ensure_account(connection, account_id)?;
    let mut query = connection.prepare("SELECT amount_huf,cleared_state FROM ledger_entries WHERE account_id=?1 AND posting_state='posted' AND transaction_date<=?2")?;
    let mut rows = query.query(params![account_id, as_of.as_str()])?;
    let (mut working, mut cleared, mut uncleared, mut reconciled) = (0i128, 0i128, 0i128, 0i128);
    while let Some(row) = rows.next()? {
        let amount = i128::from(row.get::<_, i64>(0)?);
        let state: ClearedState = row.get(1)?;
        add(&mut working, amount)?;
        match state {
            ClearedState::Uncleared => add(&mut uncleared, amount)?,
            ClearedState::Cleared => add(&mut cleared, amount)?,
            ClearedState::Reconciled => {
                add(&mut cleared, amount)?;
                add(&mut reconciled, amount)?;
            }
        }
    }
    Ok(AccountBalance {
        working: narrow(working)?,
        cleared: narrow(cleared)?,
        uncleared: narrow(uncleared)?,
        reconciled: narrow(reconciled)?,
    })
}

fn net_worth_for(accounts: Vec<AccountOverview>) -> LedgerResult<Huf> {
    let mut total = 0i128;
    for account in accounts {
        add(&mut total, i128::from(account.balance.working.0))?;
    }
    narrow(total)
}
fn asset_debt_totals(accounts: Vec<AccountOverview>) -> LedgerResult<(Huf, Huf)> {
    let mut assets = 0i128;
    let mut debts = 0i128;
    for account in accounts {
        if account.balance.working.0 >= 0 {
            add(&mut assets, i128::from(account.balance.working.0))?;
        } else {
            add(&mut debts, -i128::from(account.balance.working.0))?;
        }
    }
    Ok((narrow(assets)?, narrow(debts)?))
}

fn reconciliation_review_for(
    connection: &Connection,
    input: &ReconciliationInput,
) -> LedgerResult<ReconciliationReview> {
    let balance = account_balance_for(connection, &input.account_id, &input.as_of)?;
    let adjustment_amount =
        narrow(i128::from(input.bank_cleared_balance.0) - i128::from(balance.cleared.0))?;
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM transactions WHERE account_id=?1 AND posting_state='posted' AND transaction_date<=?2 AND cleared_state='cleared'",
        params![input.account_id, input.as_of.as_str()], |row| row.get(0),
    )?;
    Ok(ReconciliationReview {
        account_id: input.account_id.clone(),
        as_of: input.as_of.clone(),
        app_cleared_balance: balance.cleared,
        bank_cleared_balance: input.bank_cleared_balance,
        adjustment_amount,
        cleared_entry_count: usize::try_from(count).map_err(|_| LedgerError::AmountOverflow)?,
    })
}

fn insert_entry(
    connection: &Connection,
    entry: &Entry,
    amount: Option<Huf>,
    transfer: Option<(&str, Direction)>,
) -> LedgerResult<()> {
    connection.execute("INSERT INTO transactions (id,account_id,transaction_date,payee_id,category_id,memo,flag_id,amount_huf,cleared_state,posting_state,origin,scheduled_origin_id,import_row_id,transfer_id,transfer_direction) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![entry.id,entry.account_id,entry.date.as_str(),entry.payee_id,entry.category_id,entry.memo,entry.flag_id,amount.map(|v|v.0),entry.cleared_state,entry.posting_state,entry.origin,entry.scheduled_origin_id,entry.import_row_id,transfer.map(|v|v.0),transfer.map(|v|v.1)])?;
    Ok(())
}
fn require_changed(count: usize) -> LedgerResult<()> {
    if count == 0 {
        Err(LedgerError::NotFound)
    } else {
        Ok(())
    }
}
fn ensure_account(connection: &Connection, id: &str) -> LedgerResult<()> {
    if connection
        .query_row("SELECT 1 FROM accounts WHERE id=?1", [id], |row| {
            row.get::<_, i64>(0)
        })
        .optional()?
        .is_none()
    {
        return Err(LedgerError::NotFound);
    }
    Ok(())
}
fn ensure_open_account(connection: &Connection, id: &str) -> LedgerResult<()> {
    let closed = connection
        .query_row("SELECT closed FROM accounts WHERE id=?1", [id], |row| {
            row.get::<_, bool>(0)
        })
        .optional()?
        .ok_or(LedgerError::NotFound)?;
    if closed {
        Err(LedgerError::InvalidValue(
            "Transactions cannot be added to a closed account.",
        ))
    } else {
        Ok(())
    }
}
fn materialize_occurrence(
    transaction: &rusqlite::Transaction<'_>,
    schedule_id: &str,
    date: &CalendarDate,
) -> LedgerResult<()> {
    let changed = transaction.execute("INSERT INTO schedule_occurrences (schedule_id,occurrence_date,state) VALUES (?1,?2,'pending') ON CONFLICT(schedule_id,occurrence_date) DO NOTHING", params![schedule_id,date.as_str()])?;
    if changed == 0 {
        return Ok(());
    }
    let (account_id, payee_id, category_id, memo, flag_id, amount): (String, Option<String>, Option<String>, String, Option<String>, i64) = transaction.query_row("SELECT account_id,payee_id,category_id,memo,flag_id,amount_huf FROM schedules WHERE id=?1 AND active=1", [schedule_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?)))?;
    let id = random_id(transaction, "scheduled-transaction")?;
    let mut entry = Entry::scheduled(&id, &account_id, date.clone(), schedule_id);
    entry.payee_id = payee_id;
    entry.category_id = category_id;
    entry.memo = memo;
    entry.flag_id = flag_id;
    insert_entry(transaction, &entry, Some(Huf(amount)), None)?;
    transaction.execute("UPDATE schedule_occurrences SET transaction_id=?3 WHERE schedule_id=?1 AND occurrence_date=?2", params![schedule_id,date.as_str(),id])?;
    Ok(())
}
fn next_schedule_date(
    transaction: &rusqlite::Transaction<'_>,
    schedule_id: &str,
    previous: &CalendarDate,
) -> LedgerResult<Option<CalendarDate>> {
    let (day, end_date, active): (i64, Option<String>, bool) = transaction.query_row(
        "SELECT day_of_month,end_date,active FROM schedules WHERE id=?1",
        [schedule_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if !active {
        return Ok(None);
    }
    let text = previous.as_str();
    let year: i32 = text[..4].parse().unwrap();
    let month: u32 = text[5..7].parse().unwrap();
    let (year, month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let day = u32::try_from(day)
        .map_err(|_| LedgerError::InvalidValue("Invalid monthly schedule."))?
        .min(days_in_month(year, month));
    let next = CalendarDate::parse(&format!("{year:04}-{month:02}-{day:02}"))?;
    Ok((end_date.as_deref().is_none_or(|end| next.as_str() <= end)).then_some(next))
}
fn calendar_day(date: &CalendarDate) -> LedgerResult<i64> {
    date.as_str()[8..10]
        .parse()
        .map_err(|_| LedgerError::InvalidValue("Invalid monthly schedule."))
}
fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}
fn random_id(connection: &Connection, prefix: &str) -> LedgerResult<String> {
    let suffix: String =
        connection.query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))?;
    Ok(format!("{prefix}-{suffix}"))
}
fn resolve_payee(connection: &Connection, name: Option<&str>) -> LedgerResult<Option<String>> {
    let Some(name) = name.map(str::trim).filter(|name| !name.is_empty()) else {
        return Ok(None);
    };
    if let Some(id) = connection
        .query_row(
            "SELECT id FROM payees WHERE name=?1 COLLATE NOCASE ORDER BY id LIMIT 1",
            [name],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(Some(id));
    }
    let id = random_id(connection, "manual-payee")?;
    connection.execute(
        "INSERT INTO payees (id,name) VALUES (?1,?2)",
        params![id, name],
    )?;
    Ok(Some(id))
}
fn entry_identity(
    connection: &Connection,
    id: &str,
) -> LedgerResult<(Option<String>, ClearedState)> {
    connection
        .query_row(
            "SELECT transfer_id,cleared_state FROM transactions WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(LedgerError::NotFound)
}
fn confirm_reconciled(reconciled: bool, confirmed: bool) -> LedgerResult<()> {
    if reconciled && !confirmed {
        Err(LedgerError::ReconciledConfirmationRequired)
    } else {
        Ok(())
    }
}
fn guard_transfer(connection: &Connection, id: &str, confirmed: bool) -> LedgerResult<()> {
    let reconciled: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM transactions WHERE transfer_id=?1 AND cleared_state='reconciled')",[id],|row|row.get(0))?;
    confirm_reconciled(reconciled, confirmed)
}
fn report_months(from: &CalendarDate, to: &CalendarDate) -> LedgerResult<Vec<String>> {
    let mut year: u32 = from.as_str()[..4]
        .parse()
        .map_err(|_| LedgerError::InvalidValue("Invalid report date."))?;
    let mut month: u32 = from.as_str()[5..7]
        .parse()
        .map_err(|_| LedgerError::InvalidValue("Invalid report date."))?;
    let end = &to.as_str()[..7];
    let mut months = Vec::new();
    loop {
        let current = format!("{year:04}-{month:02}");
        months.push(current.clone());
        if current == end {
            return Ok(months);
        }
        if month == 12 {
            year += 1;
            month = 1;
        } else {
            month += 1;
        }
    }
}
fn add(total: &mut i128, amount: i128) -> LedgerResult<()> {
    *total = total
        .checked_add(amount)
        .ok_or(LedgerError::AmountOverflow)?;
    Ok(())
}
fn narrow(amount: i128) -> LedgerResult<Huf> {
    i64::try_from(amount)
        .map(Huf)
        .map_err(|_| LedgerError::AmountOverflow)
}
