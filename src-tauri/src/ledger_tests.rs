use crate::{database::Database, ledger::*};

fn date(text: &str) -> CalendarDate {
    CalendarDate::parse(text).unwrap()
}
fn account(id: &str, kind: AccountKind, order: i64) -> Account {
    Account {
        id: id.into(),
        name: id.into(),
        kind,
        sort_order: order,
        closed: false,
    }
}
fn database() -> (tempfile::TempDir, Database) {
    let directory = tempfile::tempdir().unwrap();
    let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
    database
        .create_account(&account("cash", AccountKind::Cash, 0))
        .unwrap();
    (directory, database)
}
fn entry(id: &str, account: &str) -> Entry {
    Entry::manual(id, account, date("2026-09-10"))
}
fn transfer(id: &str, amount: i64, direction: Direction) -> TransferDraft {
    let out = entry(&format!("{id}-out"), "cash");
    let incoming = entry(&format!("{id}-in"), "other");
    match direction {
        Direction::Outflow => TransferDraft::manual(id, Huf(amount), out, incoming, direction),
        Direction::Inflow => TransferDraft::manual(id, Huf(amount), incoming, out, direction),
    }
}

#[test]
fn balances_separate_cleared_uncleared_reconciled_and_future_entries() {
    let (_directory, database) = database();
    database
        .create_transaction(&entry("income", "cash"), Huf(100000))
        .unwrap();
    let mut pending = entry("pending", "cash");
    pending.cleared_state = ClearedState::Uncleared;
    database.create_transaction(&pending, Huf(-2500)).unwrap();
    let mut reconciled = entry("reconciled", "cash");
    reconciled.cleared_state = ClearedState::Reconciled;
    database
        .create_transaction(&reconciled, Huf(-10000))
        .unwrap();
    let mut future = entry("future", "cash");
    future.date = date("2026-09-11");
    database.create_transaction(&future, Huf(-1000)).unwrap();
    let scheduled = Entry::scheduled("scheduled", "cash", date("2026-09-01"), "monthly-rule");
    database.create_transaction(&scheduled, Huf(-5000)).unwrap();
    assert_eq!(
        database
            .account_balance("cash", &date("2026-09-10"))
            .unwrap(),
        AccountBalance {
            working: Huf(87500),
            cleared: Huf(90000),
            uncleared: Huf(-2500),
            reconciled: Huf(-10000)
        }
    );
    assert_eq!(
        database
            .account_balance("cash", &date("2026-09-11"))
            .unwrap()
            .working,
        Huf(86500)
    );
    assert_eq!(database.entries("cash").unwrap().len(), 5);
    assert_eq!(
        database
            .account_balance("cash", &date("2026-08-31"))
            .unwrap()
            .working,
        Huf(0)
    );
}

#[test]
fn cash_credit_loan_and_tracking_pairs_remain_balanced_after_edits_and_deletes() {
    for kind in [
        AccountKind::Cash,
        AccountKind::Credit,
        AccountKind::Loan,
        AccountKind::Tracking,
    ] {
        let (_directory, mut database) = database();
        database.create_account(&account("other", kind, 0)).unwrap();
        database
            .create_transfer(&transfer("p", 10000, Direction::Outflow))
            .unwrap();
        let from = database.entries("cash").unwrap();
        let to = database.entries("other").unwrap();
        assert_eq!(from[0].amount, Huf(-10000));
        assert_eq!(to[0].amount, Huf(10000));
        assert_eq!(from[0].entry.cleared_state, ClearedState::Cleared);
        assert_eq!(to[0].entry.cleared_state, ClearedState::Uncleared);
        assert_eq!(from[0].transfer_id, to[0].transfer_id);
        database
            .update_transfer_amount("p", Huf(25000), false)
            .unwrap();
        assert_eq!(
            database
                .account_balance("cash", &date("2026-09-10"))
                .unwrap()
                .working,
            Huf(-25000)
        );
        assert_eq!(
            database
                .account_balance("other", &date("2026-09-10"))
                .unwrap()
                .working,
            Huf(25000)
        );
        database.delete_entry("p-in", false).unwrap();
        assert!(database.entries("cash").unwrap().is_empty());
        assert!(database.entries("other").unwrap().is_empty());
    }
}

#[test]
fn entered_inflow_is_cleared_and_automatic_outflow_is_uncleared() {
    let (_directory, mut database) = database();
    database
        .create_account(&account("other", AccountKind::Cash, 0))
        .unwrap();
    database
        .create_transfer(&transfer("p", 1234, Direction::Inflow))
        .unwrap();
    assert_eq!(
        database.entries("cash").unwrap()[0].entry.cleared_state,
        ClearedState::Uncleared
    );
    assert_eq!(
        database.entries("other").unwrap()[0].entry.cleared_state,
        ClearedState::Cleared
    );
}

#[test]
fn invalid_counterpart_rolls_back_every_part_of_a_transfer() {
    let (_directory, mut database) = database();
    assert!(database
        .create_transfer(&transfer("p", 10000, Direction::Outflow))
        .is_err());
    assert!(database.entries("cash").unwrap().is_empty());
    database
        .create_account(&account("other", AccountKind::Cash, 0))
        .unwrap();
    // Reuse the exact IDs to prove that even the canonical transfer was rolled back.
    database
        .create_transfer(&transfer("p", 10000, Direction::Outflow))
        .unwrap();
    assert!(database
        .update_transaction_amount("p-out", Huf(-10), true)
        .is_err());
    assert!(database.update_transfer_amount("p", Huf(0), false).is_err());
    assert!(database
        .update_transfer_amount("p", Huf(-1), false)
        .is_err());
    assert_eq!(database.entries("cash").unwrap()[0].amount, Huf(-10000));
}

#[test]
fn duplicate_entry_does_not_change_the_existing_transaction() {
    let (_directory, database) = database();
    database
        .create_transaction(&entry("t", "cash"), Huf(-100))
        .unwrap();
    assert!(database
        .create_transaction(&entry("t", "cash"), Huf(-999))
        .is_err());
    assert_eq!(database.entries("cash").unwrap()[0].amount, Huf(-100));
}

#[test]
fn either_reconciled_leg_requires_confirmation_for_shared_changes() {
    let (_directory, mut database) = database();
    database
        .create_account(&account("other", AccountKind::Credit, 0))
        .unwrap();
    database
        .create_transfer(&transfer("p", 10000, Direction::Outflow))
        .unwrap();
    database
        .set_cleared_state("p-in", ClearedState::Reconciled, false)
        .unwrap();
    assert!(matches!(
        database.update_transfer_amount("p", Huf(15000), false),
        Err(LedgerError::ReconciledConfirmationRequired)
    ));
    assert!(matches!(
        database.delete_entry("p-out", false),
        Err(LedgerError::ReconciledConfirmationRequired)
    ));
    assert!(matches!(
        database.set_cleared_state("p-in", ClearedState::Uncleared, false),
        Err(LedgerError::ReconciledConfirmationRequired)
    ));
    database.update_memo("p-in", "Memo edits are safe").unwrap();
    assert_eq!(
        database.entries("other").unwrap()[0].entry.memo,
        "Memo edits are safe"
    );
    database
        .update_transfer_amount("p", Huf(15000), true)
        .unwrap();
    assert_eq!(database.entries("other").unwrap()[0].amount, Huf(15000));
    database.delete_entry("p-out", true).unwrap();
    assert!(database.entries("cash").unwrap().is_empty());
    assert!(database.entries("other").unwrap().is_empty());
}

#[test]
fn reconciled_ordinary_entries_allow_memos_and_confirmed_amount_changes() {
    let (_directory, mut database) = database();
    let mut record = entry("t", "cash");
    record.cleared_state = ClearedState::Reconciled;
    database.create_transaction(&record, Huf(100)).unwrap();
    database.update_memo("t", "corrected memo").unwrap();
    assert!(matches!(
        database.update_transaction_amount("t", Huf(200), false),
        Err(LedgerError::ReconciledConfirmationRequired)
    ));
    assert!(matches!(
        database.delete_entry("t", false),
        Err(LedgerError::ReconciledConfirmationRequired)
    ));
    database
        .update_transaction_amount("t", Huf(200), true)
        .unwrap();
    assert_eq!(
        database
            .account_balance("cash", &date("2026-09-10"))
            .unwrap()
            .reconciled,
        Huf(200)
    );
    database
        .set_cleared_state("t", ClearedState::Uncleared, true)
        .unwrap();
    database.delete_entry("t", false).unwrap();
}

#[test]
fn account_order_closed_history_and_budget_classification_are_preserved() {
    let (_directory, database) = database();
    database
        .create_account(&account("cash-first", AccountKind::Cash, 0))
        .unwrap();
    database
        .create_account(&account("cash-last", AccountKind::Cash, 5))
        .unwrap();
    database
        .create_account(&account("loan", AccountKind::Loan, 0))
        .unwrap();
    database
        .create_account(&account("tracking", AccountKind::Tracking, 0))
        .unwrap();
    database
        .create_account(&account("credit", AccountKind::Credit, 0))
        .unwrap();
    database
        .create_transaction(&entry("t", "cash"), Huf(100))
        .unwrap();
    database.set_account_closed("cash", true).unwrap();
    let accounts = database.accounts().unwrap();
    assert_eq!(
        accounts.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
        [
            "cash-first",
            "cash-last",
            "credit",
            "loan",
            "tracking",
            "cash"
        ]
    );
    assert_eq!(
        database
            .account_balance("cash", &date("2026-09-10"))
            .unwrap()
            .working,
        Huf(100)
    );
    database.set_account_closed("cash", false).unwrap();
    assert_eq!(database.accounts().unwrap()[0].id, "cash");
    assert_eq!(database.entries("cash").unwrap().len(), 1);
    assert!(AccountKind::Cash.is_on_budget());
    assert!(AccountKind::Credit.is_on_budget());
    assert!(!AccountKind::Loan.is_on_budget());
    assert!(!AccountKind::Tracking.is_on_budget());
}

#[test]
fn balance_accumulation_is_exact_and_rejects_final_overflow() {
    let (_directory, mut database) = database();
    database
        .create_transaction(&entry("max", "cash"), Huf(i64::MAX))
        .unwrap();
    database
        .create_transaction(&entry("one", "cash"), Huf(1))
        .unwrap();
    assert!(matches!(
        database.account_balance("cash", &date("2026-09-10")),
        Err(LedgerError::AmountOverflow)
    ));
    database
        .create_transaction(&entry("minus-one", "cash"), Huf(-1))
        .unwrap();
    assert_eq!(
        database
            .account_balance("cash", &date("2026-09-10"))
            .unwrap()
            .working,
        Huf(i64::MAX)
    );
    database.delete_entry("max", false).unwrap();
    database
        .create_transaction(&entry("min", "cash"), Huf(i64::MIN))
        .unwrap();
    assert_eq!(
        database
            .account_balance("cash", &date("2026-09-10"))
            .unwrap()
            .working,
        Huf(i64::MIN)
    );
    database
        .create_transaction(&entry("underflow", "cash"), Huf(-1))
        .unwrap();
    assert!(matches!(
        database.account_balance("cash", &date("2026-09-10")),
        Err(LedgerError::AmountOverflow)
    ));
}

#[test]
fn transfer_legs_preserve_independent_dates_metadata_and_posting_states() {
    let (_directory, mut database) = database();
    database
        .create_account(&account("other", AccountKind::Loan, 0))
        .unwrap();
    database.create_category_group("g", "Living", 0).unwrap();
    database
        .create_category("c", "g", "Loan payment", 0)
        .unwrap();
    database.create_payee("p", "Example payee").unwrap();
    let mut draft = transfer("p", 7325, Direction::Outflow);
    draft.outflow.category_id = Some("c".into());
    draft.outflow.payee_id = Some("p".into());
    draft.outflow.memo = "common costs".into();
    draft.outflow.flag_id = Some("flag-orange".into());
    draft.inflow.date = date("2026-09-12");
    draft.inflow.posting_state = PostingState::Scheduled;
    database.create_transfer(&draft).unwrap();
    database
        .rename_flag("flag-orange", "Review correction")
        .unwrap();
    let saved = database.entries("cash").unwrap();
    assert_eq!(saved[0].entry.memo, "common costs");
    assert_eq!(saved[0].entry.category_id.as_deref(), Some("c"));
    assert_eq!(saved[0].entry.flag_id.as_deref(), Some("flag-orange"));
    assert_eq!(
        database
            .account_balance("cash", &date("2026-09-10"))
            .unwrap()
            .working,
        Huf(-7325)
    );
    assert_eq!(
        database
            .account_balance("other", &date("2026-10-01"))
            .unwrap()
            .working,
        Huf(0)
    );
    assert!(database
        .set_cleared_state("p-in", ClearedState::Cleared, false)
        .is_err());
}

#[test]
fn unknown_records_return_not_found_instead_of_successful_noops() {
    let (_directory, mut database) = database();
    assert!(matches!(
        database.account_balance("missing", &date("2026-09-10")),
        Err(LedgerError::NotFound)
    ));
    assert!(matches!(
        database.entries("missing"),
        Err(LedgerError::NotFound)
    ));
    assert!(matches!(
        database.delete_entry("missing", false),
        Err(LedgerError::NotFound)
    ));
    assert!(matches!(
        database.update_memo("missing", "memo"),
        Err(LedgerError::NotFound)
    ));
    assert!(matches!(
        database.update_transfer_amount("missing", Huf(1), false),
        Err(LedgerError::NotFound)
    ));
}

#[test]
fn huf_json_round_trips_the_full_integer_range_as_strings() {
    for amount in [i64::MIN, -7325, 0, 1234567, i64::MAX] {
        let encoded = serde_json::to_string(&Huf(amount)).unwrap();
        assert_eq!(encoded, format!("\"{amount}\""));
        assert_eq!(serde_json::from_str::<Huf>(&encoded).unwrap(), Huf(amount));
    }
    for invalid in [
        "1",
        "1.5",
        "\"1.5\"",
        "\"1 000\"",
        "\"+1\"",
        "\"01\"",
        "\"-0\"",
        "\"9223372036854775808\"",
    ] {
        assert!(serde_json::from_str::<Huf>(invalid).is_err(), "{invalid}");
    }
}

#[test]
fn calendar_dates_reject_invalid_and_timezone_values_at_deserialization() {
    for valid in ["0001-01-01", "2024-02-29", "2000-02-29", "9999-12-31"] {
        assert_eq!(date(valid).as_str(), valid);
    }
    for invalid in [
        "2026-02-29",
        "1900-02-29",
        "2026-04-31",
        "2026-00-01",
        "2026-13-01",
        "0000-01-01",
        "2026-09-00",
        "2026-9-10",
        "2026-09-10T00:00:00Z",
        "ééééé",
    ] {
        assert!(CalendarDate::parse(invalid).is_err(), "{invalid}");
        assert!(serde_json::from_str::<CalendarDate>(&format!("\"{invalid}\"")).is_err());
    }
}

#[test]
fn persisted_transactions_and_pairs_reopen_with_the_same_balances() {
    let (directory, mut database) = database();
    database
        .create_account(&account("other", AccountKind::Cash, 0))
        .unwrap();
    database
        .create_transaction(&entry("income", "cash"), Huf(40000))
        .unwrap();
    database
        .create_transfer(&transfer("p", 10000, Direction::Outflow))
        .unwrap();
    drop(database);
    let reopened = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
    assert_eq!(
        reopened
            .account_balance("cash", &date("2026-09-10"))
            .unwrap()
            .working,
        Huf(30000)
    );
    assert_eq!(
        reopened
            .account_balance("other", &date("2026-09-10"))
            .unwrap()
            .uncleared,
        Huf(10000)
    );
}
