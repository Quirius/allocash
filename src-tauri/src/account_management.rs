//! Account details and metadata editing for the desktop account editor.
use crate::{
    database::Database,
    ledger::{AccountKind, CalendarDate, Huf, LedgerError, LedgerResult},
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDetails {
    pub account_id: String,
    pub name: String,
    pub notes: String,
    pub closed: bool,
    pub working_balance: Huf,
    pub transaction_count: u64,
    pub transfer_count: u64,
    pub schedule_count: u64,
    pub reconciled_count: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAccountDetailsInput {
    pub account_id: String,
    pub as_of: CalendarDate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditAccountInput {
    pub account_id: String,
    pub name: String,
    pub notes: String,
    pub as_of: CalendarDate,
    pub expected_working_balance: Huf,
    pub working_balance: Option<Huf>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAccountClosedInput {
    pub id: String,
    pub closed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteClosedAccountInput {
    pub account_id: String,
    pub confirmed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBudgetAccountInput {
    pub name: String,
    pub kind: AccountKind,
    pub balance: Huf,
    pub as_of: CalendarDate,
}

impl Database {
    pub fn create_budget_account(
        &mut self,
        input: &CreateBudgetAccountInput,
    ) -> LedgerResult<String> {
        let name = input.name.trim();
        if !(1..=200).contains(&name.chars().count()) {
            return Err(LedgerError::InvalidValue(
                "Account names must contain 1–200 characters.",
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let account_id = random_id(&transaction, "account")?;
        let sort_order: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(sort_order)+1,0) FROM accounts WHERE kind=?1 AND closed=0",
            [input.kind],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT INTO accounts (id,name,kind,sort_order,closed,notes) VALUES (?1,?2,?3,?4,0,'')",
            params![account_id, name, input.kind, sort_order],
        )?;

        if input.kind == AccountKind::Credit {
            let category_id = credit_payment_category(&transaction, name)?;
            transaction.execute(
                "INSERT INTO credit_payment_categories (account_id,category_id) VALUES (?1,?2)",
                params![account_id, category_id],
            )?;
        }
        if input.balance.0 != 0 {
            let payee_id = resolve_payee(&transaction, "Starting Balance")?;
            let category_id = if input.kind.is_on_budget() {
                Some(ready_to_assign(&transaction)?)
            } else {
                None
            };
            let transaction_id = random_id(&transaction, "starting-balance")?;
            transaction.execute(
                "INSERT INTO transactions (id,account_id,transaction_date,payee_id,category_id,memo,amount_huf,cleared_state,posting_state,origin) VALUES (?1,?2,?3,?4,?5,'Starting balance',?6,'cleared','posted','manual')",
                params![transaction_id, account_id, input.as_of.as_str(), payee_id, category_id, input.balance.0],
            )?;
        }
        transaction.commit()?;
        Ok(account_id)
    }

    pub fn get_account_details(
        &self,
        input: &GetAccountDetailsInput,
    ) -> LedgerResult<AccountDetails> {
        account_details(&self.connection, input)
    }

    pub fn edit_account(&mut self, input: &EditAccountInput) -> LedgerResult<()> {
        let name = input.name.trim();
        let length = name.chars().count();
        if !(1..=200).contains(&length) {
            return Err(LedgerError::InvalidValue(
                "Account names must contain 1–200 characters.",
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (kind, closed): (AccountKind, bool) = transaction
            .query_row(
                "SELECT kind,closed FROM accounts WHERE id=?1",
                [&input.account_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or(LedgerError::NotFound)?;
        let current = working_balance(&transaction, &input.account_id, input.as_of.as_str())?;
        if current != input.expected_working_balance {
            return Err(LedgerError::InvalidValue(
                "The account balance changed. Reload account details and try again.",
            ));
        }
        let adjustment = if let Some(new_balance) = input.working_balance {
            if closed {
                return Err(LedgerError::InvalidValue(
                    "A closed account balance cannot be adjusted.",
                ));
            }
            let delta = i128::from(new_balance.0) - i128::from(current.0);
            Some(i64::try_from(delta).map_err(|_| LedgerError::AmountOverflow)?)
        } else {
            None
        };

        transaction.execute(
            "UPDATE accounts SET name=?2,notes=?3 WHERE id=?1",
            params![input.account_id, name, input.notes],
        )?;
        if let Some(amount) = adjustment.filter(|amount| *amount != 0) {
            let id = random_id(&transaction, "balance-adjustment")?;
            let payee_id = resolve_payee(&transaction, "Balance Adjustment")?;
            let category_id = if kind.is_on_budget() && amount != 0 {
                Some(ready_to_assign(&transaction)?)
            } else {
                None
            };
            transaction.execute(
                "INSERT INTO transactions (id,account_id,transaction_date,payee_id,category_id,memo,amount_huf,cleared_state,posting_state,origin) VALUES (?1,?2,?3,?4,?5,'Balance adjustment',?6,'cleared','posted','manual')",
                params![id, input.account_id, input.as_of.as_str(), payee_id, category_id, amount],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn validate_closed_account_deletion(
        &self,
        input: &DeleteClosedAccountInput,
    ) -> LedgerResult<()> {
        validate_closed_account_deletion(&self.connection, input)
    }

    /// Caller creates the required safety backup and wraps this in the undo boundary.
    pub fn delete_closed_account(&mut self, input: &DeleteClosedAccountInput) -> LedgerResult<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        validate_closed_account_deletion(&transaction, input)?;
        let account_id = &input.account_id;
        let transaction_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM transactions WHERE account_id=?1",
            [account_id],
            |row| row.get(0),
        )?;
        if transaction_count != 0 {
            return Err(LedgerError::InvalidValue(
                "This account still has transaction history. Remove its transactions before deleting the account.",
            ));
        }
        let schedule_ids = collect_strings(
            &transaction,
            "SELECT id FROM schedules WHERE account_id=?1 OR counterpart_account_id=?1",
            account_id,
        )?;
        for schedule_id in &schedule_ids {
            let has_history: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM schedule_occurrences WHERE schedule_id=?1 AND transaction_id IS NOT NULL) OR EXISTS(SELECT 1 FROM transactions WHERE scheduled_origin_id=?1)",
                [schedule_id],
                |row| row.get(0),
            )?;
            if has_history {
                return Err(LedgerError::InvalidValue(
                    "This account has schedule history linked to transactions. Remove those entries before deleting the account.",
                ));
            }
            transaction.execute(
                "DELETE FROM schedule_occurrences WHERE schedule_id=?1",
                [schedule_id],
            )?;
        }
        transaction.execute(
            "DELETE FROM schedules WHERE account_id=?1 OR counterpart_account_id=?1",
            [account_id],
        )?;
        transaction.execute(
            "DELETE FROM credit_payment_categories WHERE account_id=?1",
            [account_id],
        )?;
        transaction.execute("DELETE FROM accounts WHERE id=?1", [account_id])?;
        transaction.commit()?;
        Ok(())
    }
}

fn validate_closed_account_deletion(
    connection: &rusqlite::Connection,
    input: &DeleteClosedAccountInput,
) -> LedgerResult<()> {
    let closed: bool = connection
        .query_row(
            "SELECT closed FROM accounts WHERE id=?1",
            [&input.account_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(LedgerError::NotFound)?;
    if !closed {
        return Err(LedgerError::InvalidValue(
            "Only closed accounts can be deleted.",
        ));
    }
    if !input.confirmed {
        return Err(LedgerError::InvalidValue(
            "Confirm deletion of this empty closed account.",
        ));
    }
    let transaction_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM transactions WHERE account_id=?1",
        [&input.account_id],
        |row| row.get(0),
    )?;
    if transaction_count != 0 {
        return Err(LedgerError::InvalidValue(
            "This account still has transaction history. Remove its transactions before deleting the account.",
        ));
    }
    let schedule_ids = collect_strings(
        connection,
        "SELECT id FROM schedules WHERE account_id=?1 OR counterpart_account_id=?1",
        &input.account_id,
    )?;
    for schedule_id in schedule_ids {
        let has_history: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM schedule_occurrences WHERE schedule_id=?1 AND transaction_id IS NOT NULL) OR EXISTS(SELECT 1 FROM transactions WHERE scheduled_origin_id=?1)",
            [&schedule_id],
            |row| row.get(0),
        )?;
        if has_history {
            return Err(LedgerError::InvalidValue(
                "This account has schedule history linked to transactions. Remove those entries before deleting the account.",
            ));
        }
    }
    Ok(())
}

fn collect_strings(
    connection: &rusqlite::Connection,
    sql: &str,
    value: &str,
) -> LedgerResult<Vec<String>> {
    let mut statement = connection.prepare(sql)?;
    let values = statement
        .query_map([value], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(values)
}

fn account_details(
    connection: &rusqlite::Connection,
    input: &GetAccountDetailsInput,
) -> LedgerResult<AccountDetails> {
    let (name, notes, closed): (String, String, bool) = connection
        .query_row(
            "SELECT name,notes,closed FROM accounts WHERE id=?1",
            [&input.account_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or(LedgerError::NotFound)?;
    let working_balance = working_balance(connection, &input.account_id, input.as_of.as_str())?;
    let transaction_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM transactions WHERE account_id=?1",
        [&input.account_id],
        |row| row.get(0),
    )?;
    let transfer_count: i64 = connection.query_row(
        "SELECT COUNT(DISTINCT transfer_id) FROM transactions WHERE account_id=?1 AND transfer_id IS NOT NULL",
        [&input.account_id],
        |row| row.get(0),
    )?;
    let schedule_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM schedules WHERE account_id=?1 OR counterpart_account_id=?1",
        [&input.account_id],
        |row| row.get(0),
    )?;
    let reconciled_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM transactions WHERE account_id=?1 AND cleared_state='reconciled'",
        [&input.account_id],
        |row| row.get(0),
    )?;
    Ok(AccountDetails {
        account_id: input.account_id.clone(),
        name,
        notes,
        closed,
        working_balance,
        transaction_count: count(transaction_count)?,
        transfer_count: count(transfer_count)?,
        schedule_count: count(schedule_count)?,
        reconciled_count: count(reconciled_count)?,
    })
}

fn count(value: i64) -> LedgerResult<u64> {
    u64::try_from(value).map_err(|_| LedgerError::AmountOverflow)
}

fn working_balance(
    connection: &rusqlite::Connection,
    account_id: &str,
    as_of: &str,
) -> LedgerResult<Huf> {
    let mut statement = connection.prepare("SELECT amount_huf FROM ledger_entries WHERE account_id=?1 AND posting_state='posted' AND transaction_date<=?2")?;
    let mut rows = statement.query(params![account_id, as_of])?;
    let mut total = 0i128;
    while let Some(row) = rows.next()? {
        total = total
            .checked_add(i128::from(row.get::<_, i64>(0)?))
            .ok_or(LedgerError::AmountOverflow)?;
    }
    Ok(Huf(
        i64::try_from(total).map_err(|_| LedgerError::AmountOverflow)?
    ))
}

fn random_id(connection: &rusqlite::Connection, prefix: &str) -> LedgerResult<String> {
    let suffix: String =
        connection.query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))?;
    Ok(format!("{prefix}-{suffix}"))
}

fn resolve_payee(connection: &rusqlite::Connection, name: &str) -> LedgerResult<String> {
    if let Some(id) = connection
        .query_row(
            "SELECT id FROM payees WHERE name=?1 COLLATE NOCASE ORDER BY id LIMIT 1",
            [name],
            |row| row.get(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    let id = random_id(connection, "manual-payee")?;
    connection.execute(
        "INSERT INTO payees (id,name) VALUES (?1,?2)",
        params![id, name],
    )?;
    Ok(id)
}

fn ready_to_assign(connection: &rusqlite::Connection) -> LedgerResult<String> {
    if let Some(id) = connection.query_row("SELECT c.id FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE lower(trim(g.name))='inflow' AND lower(trim(c.name))='ready to assign' ORDER BY c.id LIMIT 1", [], |row| row.get(0)).optional()? { return Ok(id); }
    let group_id: Option<String> = connection
        .query_row(
            "SELECT id FROM category_groups WHERE lower(trim(name))='inflow' ORDER BY id LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let group_id = if let Some(id) = group_id {
        id
    } else {
        let id = random_id(connection, "category-group")?;
        let order: i64 = connection.query_row(
            "SELECT COALESCE(MAX(sort_order)+1,0) FROM category_groups",
            [],
            |row| row.get(0),
        )?;
        connection.execute(
            "INSERT INTO category_groups (id,name,sort_order) VALUES (?1,'Inflow',?2)",
            params![id, order],
        )?;
        id
    };
    let id = random_id(connection, "category")?;
    connection.execute(
        "INSERT INTO categories (id,group_id,name,sort_order) VALUES (?1,?2,'Ready to Assign',0)",
        params![id, group_id],
    )?;
    Ok(id)
}

fn credit_payment_category(
    connection: &rusqlite::Connection,
    account_name: &str,
) -> LedgerResult<String> {
    let group_id: Option<String> = connection
        .query_row(
            "SELECT id FROM category_groups WHERE lower(trim(name))='credit card payments' AND hidden=0 ORDER BY id LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let group_id = if let Some(id) = group_id {
        id
    } else {
        let id = random_id(connection, "category-group")?;
        let sort_order: i64 = connection.query_row(
            "SELECT COALESCE(MAX(sort_order)+1,0) FROM category_groups",
            [],
            |row| row.get(0),
        )?;
        connection.execute(
            "INSERT INTO category_groups (id,name,sort_order) VALUES (?1,'Credit Card Payments',?2)",
            params![id, sort_order],
        )?;
        id
    };
    let existing: Option<String> = connection
        .query_row(
            "SELECT c.id FROM categories c LEFT JOIN credit_payment_categories p ON p.category_id=c.id WHERE c.group_id=?1 AND c.name=?2 COLLATE NOCASE AND c.hidden=0 AND p.category_id IS NULL ORDER BY c.id LIMIT 1",
            params![group_id, account_name],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = random_id(connection, "category")?;
    let sort_order: i64 = connection.query_row(
        "SELECT COALESCE(MAX(sort_order)+1,0) FROM categories WHERE group_id=?1",
        [&group_id],
        |row| row.get(0),
    )?;
    connection.execute(
        "INSERT INTO categories (id,group_id,name,sort_order) VALUES (?1,?2,?3,?4)",
        params![id, group_id, account_name, sort_order],
    )?;
    Ok(id)
}

#[cfg(test)]
mod tests;
