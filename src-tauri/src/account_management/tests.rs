use super::*;
use crate::ledger::{Account, ManualTransactionDraft};

fn date(value: &str) -> CalendarDate {
    CalendarDate::parse(value).unwrap()
}
fn database() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("budget.sqlite3")).unwrap();
    (dir, db)
}
fn account(db: &Database, id: &str, kind: AccountKind) {
    db.create_account(&Account {
        id: id.into(),
        name: id.into(),
        kind,
        sort_order: 0,
        closed: false,
    })
    .unwrap();
}
fn input(id: &str, expected: i64, balance: Option<i64>) -> EditAccountInput {
    EditAccountInput {
        account_id: id.into(),
        name: "  New name  ".into(),
        notes: "  exact\nnotes  ".into(),
        as_of: date("2026-05-10"),
        expected_working_balance: Huf(expected),
        working_balance: balance.map(Huf),
    }
}
fn transaction(db: &mut Database, _id: &str, account_id: &str, date_text: &str, amount: i64) {
    db.create_manual_transaction(&ManualTransactionDraft {
        account_id: account_id.into(),
        date: date(date_text),
        payee_name: Some("Opening".into()),
        category_id: None,
        memo: String::new(),
        flag_id: None,
        amount: Huf(amount),
    })
    .unwrap();
}

#[test]
fn details_balance_is_cutoff_inclusive_but_history_counts_include_everything() {
    let (_dir, mut db) = database();
    account(&db, "cash", AccountKind::Cash);
    transaction(&mut db, "before", "cash", "2026-05-10", 100);
    transaction(&mut db, "future", "cash", "2026-05-11", 300);
    db.connection
        .execute(
            "UPDATE transactions SET posting_state='scheduled',cleared_state='uncleared' WHERE transaction_date='2026-05-11'",
            [],
        )
        .unwrap();
    let details = db
        .get_account_details(&GetAccountDetailsInput {
            account_id: "cash".into(),
            as_of: date("2026-05-10"),
        })
        .unwrap();
    assert_eq!(details.working_balance, Huf(100));
    assert_eq!(details.transaction_count, 2);
}

#[test]
fn metadata_edit_trims_name_preserves_notes_and_account_identity() {
    let (_dir, mut db) = database();
    account(&db, "stable", AccountKind::Tracking);
    db.edit_account(&input("stable", 0, None)).unwrap();
    let details = db
        .get_account_details(&GetAccountDetailsInput {
            account_id: "stable".into(),
            as_of: date("2026-05-10"),
        })
        .unwrap();
    assert_eq!(details.account_id, "stable");
    assert_eq!(details.name, "New name");
    assert_eq!(details.notes, "  exact\nnotes  ");
    assert!(db
        .edit_account(&EditAccountInput {
            name: " ".into(),
            ..input("stable", 0, None)
        })
        .is_err());
    assert!(db
        .edit_account(&EditAccountInput {
            name: "x".repeat(201),
            ..input("stable", 0, None)
        })
        .is_err());
}

#[test]
fn cash_adjustment_is_a_single_cleared_rta_entry_on_inclusive_date_and_undoable() {
    let (_dir, mut db) = database();
    account(&db, "cash", AccountKind::Cash);
    transaction(&mut db, "old", "cash", "2026-05-10", 100);
    db.undoable("Edit account", |db| {
        db.edit_account(&input("cash", 100, Some(250)))
            .map_err(|e| e.to_string())
    })
    .unwrap();
    assert_eq!(
        db.account_balance("cash", &date("2026-05-10"))
            .unwrap()
            .working,
        Huf(250)
    );
    assert_eq!(
        db.connection
            .query_row(
                "SELECT amount_huf FROM transactions WHERE memo='Balance adjustment'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        150
    );
    assert_eq!(db.connection.query_row("SELECT c.name FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.memo='Balance adjustment'", [], |r| r.get::<_, String>(0)).unwrap(), "Ready to Assign");
    db.undo_last_action().unwrap();
    assert_eq!(
        db.account_balance("cash", &date("2026-05-10"))
            .unwrap()
            .working,
        Huf(100)
    );
}

#[test]
fn credit_adjustment_uses_rta_but_off_budget_adjustment_has_no_category() {
    let (_dir, mut db) = database();
    account(&db, "cash", AccountKind::Cash);
    account(&db, "credit", AccountKind::Credit);
    account(&db, "asset", AccountKind::Tracking);
    db.edit_account(&input("cash", 0, Some(-75))).unwrap();
    db.edit_account(&input("credit", 0, Some(-1_200))).unwrap();
    db.edit_account(&input("asset", 0, Some(-50))).unwrap();
    assert_eq!(
        db.account_balance("cash", &date("2026-05-10"))
            .unwrap()
            .working,
        Huf(-75)
    );
    assert_eq!(
        db.account_balance("credit", &date("2026-05-10"))
            .unwrap()
            .working,
        Huf(-1_200)
    );
    let credit_cat: Option<String> = db
        .connection
        .query_row(
            "SELECT category_id FROM transactions WHERE account_id='credit'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let asset_cat: Option<String> = db
        .connection
        .query_row(
            "SELECT category_id FROM transactions WHERE account_id='asset'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let cash_cat: Option<String> = db
        .connection
        .query_row(
            "SELECT category_id FROM transactions WHERE account_id='cash'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(credit_cat.is_some());
    assert_eq!(cash_cat, credit_cat);
    assert_eq!(asset_cat, None);
}

#[test]
fn stale_and_closed_balance_edits_fail_without_any_mutation_and_delta_overflow_is_checked() {
    let (_dir, mut db) = database();
    account(&db, "cash", AccountKind::Cash);
    transaction(&mut db, "old", "cash", "2026-05-01", i64::MAX);
    let before = db
        .connection
        .query_row("SELECT COUNT(*) FROM transactions", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap();
    assert!(db.edit_account(&input("cash", 0, Some(5))).is_err());
    assert_eq!(
        db.connection
            .query_row("SELECT COUNT(*) FROM transactions", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        before
    );
    assert!(db
        .edit_account(&input("cash", i64::MAX, Some(i64::MIN)))
        .is_err());
    db.set_account_closed("cash", true).unwrap();
    assert!(db.edit_account(&input("cash", i64::MAX, Some(0))).is_err());
    assert_eq!(
        db.get_account_details(&GetAccountDetailsInput {
            account_id: "cash".into(),
            as_of: date("2026-05-10")
        })
        .unwrap()
        .name,
        "cash"
    );
}

#[test]
fn close_and_reopen_are_undoable_and_preserve_kind_and_history() {
    let (_dir, mut db) = database();
    account(&db, "asset", AccountKind::Tracking);
    transaction(&mut db, "history", "asset", "2026-05-01", 12);
    db.undoable("Close account", |db| {
        db.set_account_closed("asset", true)
            .map_err(|e| e.to_string())
    })
    .unwrap();
    assert!(db.accounts().unwrap()[0].closed);
    db.undo_last_action().unwrap();
    let account = db
        .accounts()
        .unwrap()
        .into_iter()
        .find(|a| a.id == "asset")
        .unwrap();
    assert!(!account.closed);
    assert_eq!(account.kind, AccountKind::Tracking);
    assert_eq!(db.entries("asset").unwrap().len(), 1);
}

#[test]
fn deleting_closed_account_rejects_any_transaction_history_without_mutation() {
    let (_dir, mut db) = database();
    account(&db, "cash", AccountKind::Cash);
    transaction(&mut db, "history", "cash", "2026-05-01", 12);
    db.set_account_closed("cash", true).unwrap();
    let input = DeleteClosedAccountInput {
        account_id: "cash".into(),
        confirmed: true,
    };
    assert!(db.validate_closed_account_deletion(&input).is_err());
    assert!(db.delete_closed_account(&input).is_err());
    assert_eq!(
        db.connection
            .query_row("SELECT COUNT(*) FROM accounts WHERE id='cash'", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        1
    );
    assert_eq!(
        db.connection
            .query_row(
                "SELECT COUNT(*) FROM transactions WHERE account_id='cash'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}

#[test]
fn deleting_empty_closed_account_removes_only_safe_schedule_metadata_and_is_undoable() {
    let (_dir, mut db) = database();
    account(&db, "cash", AccountKind::Cash);
    db.set_account_closed("cash", true).unwrap();
    db.connection.execute("INSERT INTO schedules (id,account_id,memo,amount_huf,start_date,day_of_month,active) VALUES ('orphan-schedule','cash','memo',100,'2026-05-01',1,0)", []).unwrap();
    db.connection.execute("INSERT INTO schedule_occurrences (schedule_id,occurrence_date,state) VALUES ('orphan-schedule','2026-05-01','skipped')", []).unwrap();
    let input = DeleteClosedAccountInput {
        account_id: "cash".into(),
        confirmed: true,
    };
    db.undoable("Delete account", |db| {
        db.delete_closed_account(&input).map_err(|e| e.to_string())
    })
    .unwrap();
    assert_eq!(
        db.connection
            .query_row("SELECT COUNT(*) FROM accounts WHERE id='cash'", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        0
    );
    assert_eq!(
        db.connection
            .query_row(
                "SELECT COUNT(*) FROM schedules WHERE id='orphan-schedule'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    db.undo_last_action().unwrap();
    assert_eq!(
        db.connection
            .query_row(
                "SELECT COUNT(*) FROM accounts WHERE id='cash' AND closed=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert_eq!(
        db.connection
            .query_row(
                "SELECT COUNT(*) FROM schedule_occurrences WHERE schedule_id='orphan-schedule'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}

#[test]
fn deletion_rejects_schedule_history_that_still_points_to_transactions() {
    let (_dir, mut db) = database();
    account(&db, "cash", AccountKind::Cash);
    account(&db, "other", AccountKind::Tracking);
    db.set_account_closed("cash", true).unwrap();
    db.connection.execute("INSERT INTO schedules (id,account_id,memo,amount_huf,start_date,day_of_month,active) VALUES ('retained-schedule','cash','memo',100,'2026-05-01',1,0)", []).unwrap();
    transaction(&mut db, "history", "other", "2026-05-01", 12);
    db.connection.execute("UPDATE transactions SET scheduled_origin_id='retained-schedule' WHERE account_id='other'", []).unwrap();
    let input = DeleteClosedAccountInput {
        account_id: "cash".into(),
        confirmed: true,
    };
    assert!(db.delete_closed_account(&input).is_err());
    assert_eq!(
        db.connection
            .query_row(
                "SELECT COUNT(*) FROM schedules WHERE id='retained-schedule'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert_eq!(
        db.connection
            .query_row(
                "SELECT COUNT(*) FROM transactions WHERE account_id='other'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}
