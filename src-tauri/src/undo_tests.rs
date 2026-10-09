use crate::{
    database::Database,
    ledger::{
        Account, AccountKind, CalendarDate, Direction, Huf, ManualTransactionDraft,
        ManualTransferInput,
    },
    plan::{CategoryTargetDefinition, PlanMonth},
};

fn date(value: &str) -> CalendarDate {
    CalendarDate::parse(value).unwrap()
}

fn database() -> (tempfile::TempDir, Database) {
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
        .create_category_group("test-group", "Test", 0)
        .unwrap();
    database
        .create_category("test-expense", "test-group", "Expense", 0)
        .unwrap();
    database
        .create_account(&Account {
            id: "savings".into(),
            name: "Savings".into(),
            kind: AccountKind::Cash,
            sort_order: 1,
            closed: false,
        })
        .unwrap();
    (directory, database)
}

fn count(database: &Database, sql: &str) -> i64 {
    database
        .connection
        .query_row(sql, [], |row| row.get(0))
        .unwrap()
}

#[test]
fn undo_transaction_create_and_delete_restores_linked_payee_identity() {
    let (_directory, mut database) = database();
    let draft = ManualTransactionDraft {
        account_id: "cash".into(),
        date: date("2026-10-01"),
        payee_name: Some("Corner shop".into()),
        category_id: Some("test-expense".into()),
        memo: "Weekly groceries".into(),
        flag_id: None,
        amount: Huf(-1_250),
    };
    let created_id = database
        .undoable("Add transaction", |database| {
            database
                .create_manual_transaction(&draft)
                .map_err(|error| error.to_string())
        })
        .unwrap();
    assert_eq!(count(&database, "SELECT COUNT(*) FROM transactions"), 1);
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM payees WHERE name='Corner shop'"
        ),
        1
    );
    database.undo_last_action().unwrap();
    assert_eq!(count(&database, "SELECT COUNT(*) FROM transactions"), 0);
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM payees WHERE name='Corner shop'"
        ),
        0
    );

    let existing_id = database.create_manual_transaction(&draft).unwrap();
    let payee_id: String = database
        .connection
        .query_row(
            "SELECT payee_id FROM transactions WHERE id=?1",
            [&existing_id],
            |row| row.get(0),
        )
        .unwrap();
    database
        .connection
        .execute(
            "UPDATE transactions SET cleared_state='reconciled' WHERE id=?1",
            [&existing_id],
        )
        .unwrap();
    database
        .undoable("Delete transaction", |database| {
            database
                .delete_entry(&existing_id, true)
                .map_err(|error| error.to_string())
        })
        .unwrap();
    assert_eq!(count(&database, "SELECT COUNT(*) FROM transactions"), 0);
    database.undo_last_action().unwrap();
    let restored: (String, String, String) = database
        .connection
        .query_row(
            "SELECT payee_id,memo,cleared_state FROM transactions WHERE id=?1",
            [&existing_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        restored,
        (payee_id, "Weekly groceries".into(), "reconciled".into())
    );
    assert_ne!(created_id, existing_id);
}

#[test]
fn undo_transfer_amount_and_paired_delete_preserve_both_legs_and_confirmation_history() {
    let (_directory, mut database) = database();
    let input = ManualTransferInput {
        account_id: "cash".into(),
        counterpart_account_id: "savings".into(),
        date: date("2026-10-02"),
        memo: "Monthly savings".into(),
        flag_id: None,
        amount: Huf(5_000),
        direction: Direction::Outflow,
        category_id: None,
    };
    let first_leg = database
        .undoable("Add transfer", |database| {
            database
                .create_manual_transfer(&input)
                .map_err(|error| error.to_string())
        })
        .unwrap();
    let transfer_id: String = database
        .connection
        .query_row(
            "SELECT transfer_id FROM transactions WHERE id=?1",
            [&first_leg],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM transactions WHERE transfer_id IS NOT NULL"
        ),
        2
    );
    database
        .undoable("Change transfer amount", |database| {
            database
                .update_transfer_amount(&transfer_id, Huf(7_500), true)
                .map_err(|error| error.to_string())
        })
        .unwrap();
    let amount: i64 = database
        .connection
        .query_row(
            "SELECT amount_huf FROM transfers WHERE id=?1",
            [&transfer_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(amount, 7_500);

    database
        .connection
        .execute(
            "UPDATE transactions SET cleared_state='reconciled' WHERE id=?1",
            [&first_leg],
        )
        .unwrap();
    assert!(database.check_entry_deletion(&first_leg, false).is_err());
    assert_eq!(
        database.undo_status().label.as_deref(),
        Some("Change transfer amount")
    );
    database.undo_last_action().unwrap();
    let amount: i64 = database
        .connection
        .query_row(
            "SELECT amount_huf FROM transfers WHERE id=?1",
            [&transfer_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(amount, 5_000);

    database
        .connection
        .execute(
            "UPDATE transactions SET cleared_state='reconciled' WHERE id=?1",
            [&first_leg],
        )
        .unwrap();

    database
        .undoable("Delete transfer", |database| {
            database
                .delete_entry(&first_leg, true)
                .map_err(|error| error.to_string())
        })
        .unwrap();
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM transactions WHERE transfer_id IS NOT NULL"
        ),
        0
    );
    database.undo_last_action().unwrap();
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM transactions WHERE transfer_id IS NOT NULL"
        ),
        2
    );
    let restored: (String, String) = database
        .connection
        .query_row(
            "SELECT account_id,cleared_state FROM transactions WHERE id=?1",
            [&first_leg],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(restored, ("cash".into(), "reconciled".into()));
    let restored_amount: i64 = database
        .connection
        .query_row(
            "SELECT amount_huf FROM transfers WHERE id=?1",
            [&transfer_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(restored_amount, 5_000);
}

#[test]
fn undo_plan_move_reverses_both_assignments_and_target_snooze() {
    let (_directory, mut database) = database();
    database.create_category_group("group", "Group", 0).unwrap();
    database
        .create_category("from", "group", "From", 0)
        .unwrap();
    database.create_category("to", "group", "To", 1).unwrap();
    let month = PlanMonth::parse("2026-10").unwrap();
    database
        .set_monthly_assignment("from", &month, Huf(100))
        .unwrap();
    database
        .set_monthly_assignment("to", &month, Huf(20))
        .unwrap();
    database
        .undoable("Move money", |database| {
            database
                .move_monthly_money_as_of("from", "to", &month, Huf(35), &date("2026-10-09"))
                .map_err(|error| error.to_string())
        })
        .unwrap();
    let moved: (i64, i64) = database.connection.query_row(
        "SELECT (SELECT amount_huf FROM category_month_assignments WHERE category_id='from' AND month='2026-10'),(SELECT amount_huf FROM category_month_assignments WHERE category_id='to' AND month='2026-10')",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap();
    assert_eq!(moved, (65, 55));
    database.undo_last_action().unwrap();
    let restored: (i64, i64) = database.connection.query_row(
        "SELECT (SELECT amount_huf FROM category_month_assignments WHERE category_id='from' AND month='2026-10'),(SELECT amount_huf FROM category_month_assignments WHERE category_id='to' AND month='2026-10')",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap();
    assert_eq!(restored, (100, 20));

    let target = CategoryTargetDefinition {
        behavior: "set_aside".into(),
        amount: Huf(1_000),
        due_kind: "day".into(),
        due_day: Some(15),
        interval_months: 1,
        first_due_month: None,
    };
    database
        .undoable("Set target", |database| {
            database
                .set_category_target("from", &month, Some(&target))
                .map_err(|error| error.to_string())
        })
        .unwrap();
    database
        .undoable("Snooze target", |database| {
            database
                .set_category_target_snoozed("from", &month, true)
                .map_err(|error| error.to_string())
        })
        .unwrap();
    let plan = database.plan_month(&month).unwrap();
    assert!(
        plan.categories
            .iter()
            .find(|category| category.category_id == "from")
            .unwrap()
            .target
            .as_ref()
            .unwrap()
            .snoozed
    );
    database.undo_last_action().unwrap();
    let plan = database.plan_month(&month).unwrap();
    assert!(
        !plan
            .categories
            .iter()
            .find(|category| category.category_id == "from")
            .unwrap()
            .target
            .as_ref()
            .unwrap()
            .snoozed
    );
    database.undo_last_action().unwrap();
    let plan = database.plan_month(&month).unwrap();
    assert!(plan
        .categories
        .iter()
        .find(|category| category.category_id == "from")
        .unwrap()
        .target
        .is_none());
}

#[test]
fn wal_snapshot_keeps_pre_action_commits_after_undo_and_reopen() {
    let (directory, mut database) = database();
    database
        .connection
        .pragma_update(None, "journal_mode", "WAL")
        .unwrap();
    database.connection.execute(
        "INSERT INTO transactions (id,account_id,transaction_date,amount_huf,memo) VALUES ('wal-entry','cash','2026-10-03',-300,'Before')",
        [],
    ).unwrap();
    database
        .undoable("Edit transaction", |database| {
            database
                .connection
                .execute(
                    "UPDATE transactions SET memo='After' WHERE id='wal-entry'",
                    [],
                )
                .map_err(|error| error.to_string())?;
            Ok(())
        })
        .unwrap();
    database.undo_last_action().unwrap();
    drop(database);
    let reopened = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
    let memo: String = reopened
        .connection
        .query_row(
            "SELECT memo FROM transactions WHERE id='wal-entry'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(memo, "Before");
    assert!(!reopened.undo_status().can_undo);
}

#[test]
fn undo_history_is_capped_at_thirty_and_empty_undo_is_a_noop() {
    let (_directory, mut database) = database();
    for _ in 0..31 {
        database
            .undoable("Rename budget", |database| {
                database
                    .connection
                    .execute("UPDATE budget_settings SET name=name || '*'", [])
                    .map_err(|error| error.to_string())?;
                Ok(())
            })
            .unwrap();
    }
    for index in 0..30 {
        let status = database.undo_last_action().unwrap();
        assert_eq!(status.can_undo, index < 29);
    }
    assert_eq!(database.info().unwrap().name, "My budget*");
    let status = database.undo_last_action().unwrap();
    assert!(!status.can_undo);
    assert_eq!(database.info().unwrap().name, "My budget*");
}
