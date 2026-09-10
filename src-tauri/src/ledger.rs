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
        ensure_account(&self.connection, account_id)?;
        let mut query = self.connection.prepare("SELECT amount_huf,cleared_state FROM ledger_entries WHERE account_id=?1 AND posting_state='posted' AND transaction_date<=?2")?;
        let mut rows = query.query(params![account_id, as_of.as_str()])?;
        // Wider checked integer accumulation avoids intermediate i64 overflow and
        // keeps the result independent of row ordering. Never use SQLite total().
        let (mut working, mut cleared, mut uncleared, mut reconciled) =
            (0i128, 0i128, 0i128, 0i128);
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
