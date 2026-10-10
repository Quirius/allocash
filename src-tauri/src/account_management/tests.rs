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

fn create_input(name: &str, kind: AccountKind, balance: i64) -> CreateBudgetAccountInput {
    CreateBudgetAccountInput {
        name: name.into(),
        kind,
        balance: Huf(balance),
        as_of: date("2026-05-10"),
    }
}

#[test]
fn create_account_adds_checked_starting_entry_by_budget_scope_and_credit_mapping() {
    let (_dir, mut db) = database();
    let cash = db
        .create_budget_account(&create_input("  Cash  ", AccountKind::Cash, -300))
        .unwrap();
    let credit = db
        .create_budget_account(&create_input("Everyday Card", AccountKind::Credit, -800))
        .unwrap();
    let loan = db
        .create_budget_account(&create_input("Loan", AccountKind::Loan, 500))
        .unwrap();
    assert_eq!(
        db.account_balance(&cash, &date("2026-05-10"))
            .unwrap()
            .working,
        Huf(-300)
    );
    assert_eq!(
        db.account_balance(&credit, &date("2026-05-10"))
            .unwrap()
            .working,
        Huf(-800)
    );
    assert_eq!(
        db.account_balance(&loan, &date("2026-05-10"))
            .unwrap()
            .working,
        Huf(500)
    );
    let cash_category: Option<String> = db
        .connection
        .query_row(
            "SELECT category_id FROM transactions WHERE account_id=?1",
            [&cash],
            |r| r.get(0),
        )
        .unwrap();
    let credit_category: Option<String> = db
        .connection
        .query_row(
            "SELECT category_id FROM transactions WHERE account_id=?1",
            [&credit],
            |r| r.get(0),
        )
        .unwrap();
    let loan_category: Option<String> = db
        .connection
        .query_row(
            "SELECT category_id FROM transactions WHERE account_id=?1",
            [&loan],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(cash_category, credit_category);
    assert_eq!(loan_category, None);
    let payment_category: String = db
        .connection
        .query_row(
            "SELECT category_id FROM credit_payment_categories WHERE account_id=?1",
            [&credit],
            |r| r.get(0),
        )
        .unwrap();
    let group_name: String = db.connection.query_row("SELECT g.name FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE c.id=?1", [&payment_category], |r| r.get(0)).unwrap();
    assert_eq!(group_name, "Credit Card Payments");
    assert_eq!(
        db.connection
            .query_row("SELECT notes FROM accounts WHERE id=?1", [&credit], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
        ""
    );
    assert_eq!(
        db.connection
            .query_row(
                "SELECT cleared_state FROM transactions WHERE account_id=?1",
                [&cash],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "cleared"
    );
}

#[test]
fn zero_balance_creation_keeps_opening_ledger_empty_and_allows_duplicate_names() {
    let (_dir, mut db) = database();
    let first = db
        .create_budget_account(&create_input("Same", AccountKind::Tracking, 0))
        .unwrap();
    let second = db
        .create_budget_account(&create_input("Same", AccountKind::Tracking, 0))
        .unwrap();
    assert_ne!(first, second);
    assert_eq!(
        db.connection
            .query_row("SELECT COUNT(*) FROM accounts WHERE name='Same'", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        db.connection
            .query_row(
                "SELECT COUNT(*) FROM transactions WHERE account_id IN (?1,?2)",
                rusqlite::params![first, second],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
fn account_creation_rolls_back_account_categories_and_payee_when_starting_entry_fails() {
    let (_dir, mut db) = database();
    db.connection.execute_batch("CREATE TRIGGER fail_starting_balance BEFORE INSERT ON transactions BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(db
        .create_budget_account(&create_input("Failed", AccountKind::Cash, 100))
        .is_err());
    assert_eq!(
        db.connection
            .query_row(
                "SELECT COUNT(*) FROM accounts WHERE name='Failed'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        db.connection
            .query_row(
                "SELECT COUNT(*) FROM category_groups WHERE lower(trim(name))='inflow'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        db.connection
            .query_row(
                "SELECT COUNT(*) FROM payees WHERE name='Starting Balance'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
fn created_account_is_one_undoable_action_including_credit_setup() {
    let (_dir, mut db) = database();
    let id = db
        .undoable("Create account", |db| {
            db.create_budget_account(&create_input("Undo card", AccountKind::Credit, 250))
                .map_err(|error| error.to_string())
        })
        .unwrap();
    assert_eq!(
        db.accounts().unwrap().iter().filter(|a| a.id == id).count(),
        1
    );
    assert_eq!(
        db.connection
            .query_row(
                "SELECT COUNT(*) FROM credit_payment_categories WHERE account_id=?1",
                [&id],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    db.undo_last_action().unwrap();
    assert!(!db.accounts().unwrap().iter().any(|a| a.id == id));
    assert_eq!(
        db.connection
            .query_row(
                "SELECT COUNT(*) FROM credit_payment_categories WHERE account_id=?1",
                [&id],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
fn new_credit_mapping_uses_visible_payment_group_and_category() {
    let (_dir, mut db) = database();
    db.create_category_group("hidden-payments", "Credit Card Payments", 0)
        .unwrap();
    db.connection
        .execute(
            "UPDATE category_groups SET hidden=1 WHERE id='hidden-payments'",
            [],
        )
        .unwrap();
    db.create_category("hidden-card", "hidden-payments", "Hidden Group Card", 0)
        .unwrap();
    db.connection
        .execute("UPDATE categories SET hidden=1 WHERE id='hidden-card'", [])
        .unwrap();

    let first = db
        .create_budget_account(&create_input("Hidden Group Card", AccountKind::Credit, 0))
        .unwrap();
    let first_visibility: (i64, i64) = db
        .connection
        .query_row(
            "SELECT g.hidden,c.hidden FROM credit_payment_categories p JOIN categories c ON c.id=p.category_id JOIN category_groups g ON g.id=c.group_id WHERE p.account_id=?1",
            [&first],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(first_visibility, (0, 0));

    let visible_group: String = db
        .connection
        .query_row(
            "SELECT g.id FROM category_groups g WHERE lower(trim(g.name))='credit card payments' AND g.hidden=0 ORDER BY g.id LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    db.create_category("hidden-category", &visible_group, "Hidden Category Card", 2)
        .unwrap();
    db.connection
        .execute(
            "UPDATE categories SET hidden=1 WHERE id='hidden-category'",
            [],
        )
        .unwrap();
    let second = db
        .create_budget_account(&create_input(
            "Hidden Category Card",
            AccountKind::Credit,
            0,
        ))
        .unwrap();
    let (category_name, group_hidden, category_hidden): (String, i64, i64) = db
        .connection
        .query_row(
            "SELECT c.name,g.hidden,c.hidden FROM credit_payment_categories p JOIN categories c ON c.id=p.category_id JOIN category_groups g ON g.id=c.group_id WHERE p.account_id=?1",
            [&second],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(category_name, "Hidden Category Card");
    assert_eq!((group_hidden, category_hidden), (0, 0));
    assert_eq!(
        db.connection
            .query_row(
                "SELECT hidden FROM categories WHERE id='hidden-category'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
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
