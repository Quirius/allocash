use crate::{database::Database, ledger::*};
fn date(value: &str) -> CalendarDate {
    CalendarDate::parse(value).unwrap()
}
fn account(id: &str, kind: AccountKind) -> Account {
    Account {
        id: id.into(),
        name: id.into(),
        kind,
        sort_order: 0,
        closed: false,
    }
}
fn db() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("budget.sqlite3")).unwrap();
    db.create_account(&account("cash", AccountKind::Cash))
        .unwrap();
    db.create_account(&account("card", AccountKind::Credit))
        .unwrap();
    db.create_account(&account("asset", AccountKind::Tracking))
        .unwrap();
    db.create_category_group("living", "Living", 0).unwrap();
    db.create_category("groceries", "living", "Groceries", 0)
        .unwrap();
    db.create_category("fuel", "living", "Fuel", 1).unwrap();
    (dir, db)
}
fn category(db: &Database, id: &str, account: &str) -> Option<String> {
    db.entries(account)
        .unwrap()
        .into_iter()
        .find(|e| e.entry.id == id)
        .unwrap()
        .entry
        .category_id
}
fn peer_id(db: &Database, entry_id: &str, account: &str) -> String {
    let transfer_id = db
        .entries(account)
        .unwrap()
        .into_iter()
        .find(|e| e.entry.id == entry_id)
        .unwrap()
        .transfer_id
        .unwrap();
    ["cash", "card", "asset"]
        .into_iter()
        .filter(|candidate| *candidate != account)
        .find_map(|candidate| {
            db.entries(candidate)
                .unwrap()
                .into_iter()
                .find(|e| e.transfer_id.as_deref() == Some(&transfer_id))
                .map(|e| e.entry.id)
        })
        .unwrap()
}
fn transfer(
    db: &mut Database,
    account_id: &str,
    counterpart: &str,
    direction: Direction,
    category_id: Option<&str>,
) -> String {
    db.create_manual_transfer(&ManualTransferInput {
        account_id: account_id.into(),
        counterpart_account_id: counterpart.into(),
        date: date("2026-09-10"),
        memo: String::new(),
        flag_id: None,
        amount: Huf(100),
        direction,
        category_id: category_id.map(str::to_owned),
    })
    .unwrap()
}

#[test]
fn budget_manual_entries_default_inflows_and_require_outflow_category() {
    let (_dir, mut db) = db();
    assert!(db
        .create_manual_transaction(&ManualTransactionDraft {
            account_id: "cash".into(),
            date: date("2026-09-10"),
            payee_name: None,
            category_id: None,
            memo: String::new(),
            flag_id: None,
            amount: Huf(-100)
        })
        .is_err());
    let missing_ready: i64 = db.connection.query_row("SELECT COUNT(*) FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE lower(trim(g.name))='inflow' AND lower(trim(c.name))='ready to assign'", [], |row|row.get(0)).unwrap();
    assert_eq!(missing_ready, 0);
    let inflow = db
        .create_manual_transaction(&ManualTransactionDraft {
            account_id: "cash".into(),
            date: date("2026-09-10"),
            payee_name: None,
            category_id: None,
            memo: String::new(),
            flag_id: None,
            amount: Huf(100),
        })
        .unwrap();
    let rta = category(&db, &inflow, "cash").unwrap();
    assert_eq!(
        db.transaction_form_options()
            .unwrap()
            .categories
            .iter()
            .find(|c| c.id == rta)
            .map(|c| (c.group_name.as_str(), c.name.as_str())),
        Some(("Inflow", "Ready to Assign"))
    );
    assert!(db
        .create_manual_transaction(&ManualTransactionDraft {
            account_id: "cash".into(),
            date: date("2026-09-10"),
            payee_name: None,
            category_id: None,
            memo: String::new(),
            flag_id: None,
            amount: Huf(-1)
        })
        .is_err());
    let outflow = db
        .create_manual_transaction(&ManualTransactionDraft {
            account_id: "cash".into(),
            date: date("2026-09-10"),
            payee_name: None,
            category_id: Some("groceries".into()),
            memo: String::new(),
            flag_id: None,
            amount: Huf(-1),
        })
        .unwrap();
    assert_eq!(
        category(&db, &outflow, "cash").as_deref(),
        Some("groceries")
    );
}

#[test]
fn undo_of_defaulted_inflow_removes_its_lazily_created_category() {
    let (_dir, mut db) = db();
    let draft = ManualTransactionDraft {
        account_id: "cash".into(),
        date: date("2026-09-10"),
        payee_name: None,
        category_id: None,
        memo: String::new(),
        flag_id: None,
        amount: Huf(100),
    };
    db.undoable("Add inflow", |db| {
        db.create_manual_transaction(&draft)
            .map_err(|error| error.to_string())
    })
    .unwrap();
    let before:i64=db.connection.query_row("SELECT COUNT(*) FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE lower(trim(g.name))='inflow' AND lower(trim(c.name))='ready to assign'", [], |row|row.get(0)).unwrap();
    assert_eq!(before, 1);
    db.undo_last_action().unwrap();
    let after:i64=db.connection.query_row("SELECT COUNT(*) FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE lower(trim(g.name))='inflow' AND lower(trim(c.name))='ready to assign'", [], |row|row.get(0)).unwrap();
    assert_eq!(after, 0);
}

#[test]
fn failed_inflow_write_rolls_back_lazily_created_ready_category_and_payee() {
    let (_dir, mut db) = db();
    let result = db.create_manual_transaction(&ManualTransactionDraft {
        account_id: "cash".into(),
        date: date("2026-09-10"),
        payee_name: Some("New employer".into()),
        category_id: None,
        memo: String::new(),
        flag_id: Some("missing-flag".into()),
        amount: Huf(100),
    });
    assert!(result.is_err());
    let ready: i64 = db.connection.query_row("SELECT COUNT(*) FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE lower(trim(g.name))='inflow' AND lower(trim(c.name))='ready to assign'", [], |row| row.get(0)).unwrap();
    let payee: i64 = db
        .connection
        .query_row(
            "SELECT COUNT(*) FROM payees WHERE name='New employer'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!((ready, payee), (0, 0));
}

#[test]
fn hidden_case_and_trim_ready_category_is_reused() {
    let (_dir, mut db) = db();
    db.create_category_group("inflow-group", " InFlOw ", 1)
        .unwrap();
    db.create_category("ready-category", "inflow-group", " Ready to Assign ", 0)
        .unwrap();
    db.connection
        .execute(
            "UPDATE categories SET hidden=1 WHERE id='ready-category'",
            [],
        )
        .unwrap();
    let id = db
        .create_manual_transaction(&ManualTransactionDraft {
            account_id: "cash".into(),
            date: date("2026-09-10"),
            payee_name: None,
            category_id: None,
            memo: String::new(),
            flag_id: None,
            amount: Huf(1),
        })
        .unwrap();
    assert_eq!(
        category(&db, &id, "cash").as_deref(),
        Some("ready-category")
    );
    let count:i64=db.connection.query_row("SELECT COUNT(*) FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE lower(trim(g.name))='inflow' AND lower(trim(c.name))='ready to assign'", [], |row|row.get(0)).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn offbudget_entries_and_internal_transfers_have_no_new_category() {
    let (_dir, mut db) = db();
    let id = db
        .create_manual_transaction(&ManualTransactionDraft {
            account_id: "asset".into(),
            date: date("2026-09-10"),
            payee_name: None,
            category_id: Some("groceries".into()),
            memo: String::new(),
            flag_id: None,
            amount: Huf(-1),
        })
        .unwrap();
    assert_eq!(category(&db, &id, "asset"), None);
    let id = transfer(
        &mut db,
        "cash",
        "card",
        Direction::Outflow,
        Some("groceries"),
    );
    assert_eq!(category(&db, &id, "cash"), None);
    let peer = peer_id(&db, &id, "cash");
    assert_eq!(category(&db, &peer, "card"), None);
}

#[test]
fn boundary_transfer_routes_category_to_budget_leg_and_exposes_it_from_both_registers() {
    let (_dir, mut db) = db();
    assert!(db
        .create_manual_transfer(&ManualTransferInput {
            account_id: "cash".into(),
            counterpart_account_id: "asset".into(),
            date: date("2026-09-10"),
            memo: String::new(),
            flag_id: None,
            amount: Huf(100),
            direction: Direction::Outflow,
            category_id: None
        })
        .is_err());
    let id = transfer(
        &mut db,
        "cash",
        "asset",
        Direction::Outflow,
        Some("groceries"),
    );
    assert_eq!(category(&db, &id, "cash").as_deref(), Some("groceries"));
    let peer = peer_id(&db, &id, "cash");
    assert_eq!(category(&db, &peer, "asset"), None);
    for account_id in ["cash", "asset"] {
        assert_eq!(
            db.register_entries(account_id).unwrap()[0]
                .category_id
                .as_deref(),
            Some("groceries")
        );
    }
    let inflow = transfer(&mut db, "asset", "cash", Direction::Outflow, None);
    let cash_entry_id = peer_id(&db, &inflow, "asset");
    let cash_row = db
        .register_entries("cash")
        .unwrap()
        .into_iter()
        .find(|row| row.id == cash_entry_id)
        .unwrap();
    let rta = cash_row.category_id.unwrap();
    assert_eq!(db.connection.query_row("SELECT g.name,c.name FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE c.id=?1",[rta],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).unwrap(),("Inflow".into(),"Ready to Assign".into()));
}

#[test]
fn boundary_transfer_category_edit_from_peer_routes_to_budget_and_reconciled_peer_requires_confirmation(
) {
    let (_dir, mut db) = db();
    let id = transfer(
        &mut db,
        "cash",
        "asset",
        Direction::Outflow,
        Some("groceries"),
    );
    let peer = db
        .entries("asset")
        .unwrap()
        .into_iter()
        .find(|row| row.entry.id != id)
        .unwrap()
        .entry
        .id;
    let mut edit = RegisterEntryEdit {
        id: peer.clone(),
        account_id: None,
        date: date("2026-09-10"),
        payee_name: None,
        category_id: Some("groceries".into()),
        memo: "memo".into(),
        flag_id: None,
        amount: Huf(100),
        cleared_state: ClearedState::Uncleared,
        confirmed: false,
        repeat_interval_months: None,
    };
    db.connection
        .execute(
            "UPDATE transactions SET cleared_state='reconciled' WHERE id=?1",
            [&id],
        )
        .unwrap();
    edit.category_id = Some("fuel".into());
    assert!(matches!(
        db.update_register_entry(&edit),
        Err(LedgerError::ReconciledConfirmationRequired)
    ));
    edit.confirmed = true;
    db.update_register_entry(&edit).unwrap();
    assert_eq!(category(&db, &id, "cash").as_deref(), Some("fuel"));
    assert_eq!(category(&db, &peer, "asset"), None);
}

#[test]
fn schedules_require_outflow_category_and_repeat_boundary_category_on_budget_leg() {
    let (_dir, mut db) = db();
    let draft = MonthlyScheduleDraft {
        account_id: "cash".into(),
        start_date: date("2026-09-10"),
        day_of_month: None,
        end_date: None,
        payee_name: None,
        category_id: None,
        memo: String::new(),
        flag_id: None,
        amount: Huf(-100),
        interval_months: 1,
        counterpart_account_id: None,
    };
    assert!(db.create_monthly_schedule(&draft).is_err());
    let draft = MonthlyScheduleDraft {
        category_id: Some("groceries".into()),
        ..draft
    };
    db.create_monthly_schedule(&draft).unwrap();
    let occurrence = db.scheduled_occurrences().unwrap().remove(0);
    assert_eq!(occurrence.category_name.as_deref(), Some("Groceries"));
    db.post_scheduled_occurrence(&occurrence.transaction_id)
        .unwrap();
    let next = db.scheduled_occurrences().unwrap().remove(0);
    assert_eq!(next.category_name.as_deref(), Some("Groceries"));
}

#[test]
fn crossing_transfers_feed_budget_outflow_activity_and_inflow_ready_to_assign() {
    let (_dir, mut db) = db();
    let outflow = transfer(
        &mut db,
        "cash",
        "asset",
        Direction::Outflow,
        Some("groceries"),
    );
    let inflow = transfer(&mut db, "asset", "cash", Direction::Outflow, None);
    let plan = db
        .plan_month_as_of(
            &crate::plan::PlanMonth::parse("2026-09").unwrap(),
            &date("2026-09-30"),
        )
        .unwrap();
    assert_eq!(
        plan.categories
            .iter()
            .find(|row| row.category_id == "groceries")
            .unwrap()
            .activity,
        Huf(-100)
    );
    assert_eq!(plan.ready_to_assign, Huf(100));
    let budget_inflow_id = peer_id(&db, &inflow, "asset");
    let budget_inflow = db
        .register_entries("cash")
        .unwrap()
        .into_iter()
        .find(|row| row.id == budget_inflow_id)
        .unwrap();
    assert_eq!(
        category(&db, &outflow, "cash").as_deref(),
        Some("groceries")
    );
    assert!(budget_inflow.category_id.is_some());
}

#[test]
fn crossing_schedule_materialization_repeats_category_on_budget_leg() {
    let (_dir, mut db) = db();
    db.create_monthly_schedule(&MonthlyScheduleDraft {
        account_id: "cash".into(),
        start_date: date("2026-09-10"),
        day_of_month: None,
        end_date: None,
        payee_name: None,
        category_id: Some("groceries".into()),
        memo: String::new(),
        flag_id: None,
        amount: Huf(-100),
        interval_months: 1,
        counterpart_account_id: Some("asset".into()),
    })
    .unwrap();
    let first = db.scheduled_occurrences().unwrap().remove(0);
    assert_eq!(first.category_name.as_deref(), Some("Groceries"));
    let peer = peer_id(&db, &first.transaction_id, "cash");
    assert_eq!(
        db.register_entries("asset")
            .unwrap()
            .into_iter()
            .find(|row| row.id == peer)
            .unwrap()
            .category_name
            .as_deref(),
        Some("Groceries")
    );
    db.post_scheduled_occurrence(&first.transaction_id).unwrap();
    assert_eq!(
        db.scheduled_occurrences().unwrap()[0]
            .category_name
            .as_deref(),
        Some("Groceries")
    );
}

#[test]
fn sign_changes_apply_policy_and_legacy_offbudget_memo_edits_preserve_category() {
    let (_dir, mut db) = db();
    let entry = Entry::manual("legacy", "cash", date("2026-09-10"));
    db.create_transaction(&entry, Huf(-50)).unwrap();
    let edit = RegisterEntryEdit {
        id: "legacy".into(),
        account_id: None,
        date: date("2026-09-10"),
        payee_name: None,
        category_id: None,
        memo: String::new(),
        flag_id: None,
        amount: Huf(50),
        cleared_state: ClearedState::Cleared,
        confirmed: false,
        repeat_interval_months: None,
    };
    db.update_register_entry(&edit).unwrap();
    assert!(category(&db, "legacy", "cash").is_some());

    db.create_transaction(
        &Entry::manual("legacy-inflow", "cash", date("2026-09-10")),
        Huf(50),
    )
    .unwrap();
    let mut reverse = edit.clone();
    reverse.id = "legacy-inflow".into();
    reverse.amount = Huf(-50);
    assert!(db.update_register_entry(&reverse).is_err());

    let mut offbudget = Entry::manual("imported-offbudget", "asset", date("2026-09-10"));
    offbudget.origin = Origin::Import;
    offbudget.category_id = Some("groceries".into());
    db.create_transaction(&offbudget, Huf(-5)).unwrap();
    let edit = RegisterEntryEdit {
        id: "imported-offbudget".into(),
        account_id: None,
        date: date("2026-09-10"),
        payee_name: None,
        category_id: Some("groceries".into()),
        memo: "memo only".into(),
        flag_id: None,
        amount: Huf(-5),
        cleared_state: ClearedState::Cleared,
        confirmed: false,
        repeat_interval_months: None,
    };
    db.update_register_entry(&edit).unwrap();
    assert_eq!(
        category(&db, "imported-offbudget", "asset").as_deref(),
        Some("groceries")
    );
}

#[test]
fn scheduled_account_scope_changes_clear_offbudget_category_and_validate_budget_outflows() {
    let (_dir, mut db) = db();
    db.create_monthly_schedule(&MonthlyScheduleDraft {
        account_id: "cash".into(),
        start_date: date("2026-09-10"),
        day_of_month: None,
        end_date: Some(date("2026-09-10")),
        payee_name: None,
        category_id: Some("groceries".into()),
        memo: String::new(),
        flag_id: None,
        amount: Huf(-100),
        interval_months: 1,
        counterpart_account_id: None,
    })
    .unwrap();
    let first = db.scheduled_occurrences().unwrap().remove(0);
    db.update_register_entry(&RegisterEntryEdit {
        id: first.transaction_id.clone(),
        account_id: Some("asset".into()),
        date: date("2026-09-10"),
        payee_name: None,
        category_id: Some("groceries".into()),
        memo: String::new(),
        flag_id: None,
        amount: Huf(-100),
        cleared_state: ClearedState::Uncleared,
        confirmed: false,
        repeat_interval_months: None,
    })
    .unwrap();
    assert_eq!(category(&db, &first.transaction_id, "asset"), None);

    db.create_monthly_schedule(&MonthlyScheduleDraft {
        account_id: "asset".into(),
        start_date: date("2026-09-10"),
        day_of_month: None,
        end_date: Some(date("2026-09-10")),
        payee_name: None,
        category_id: None,
        memo: String::new(),
        flag_id: None,
        amount: Huf(-100),
        interval_months: 1,
        counterpart_account_id: None,
    })
    .unwrap();
    let second = db
        .scheduled_occurrences()
        .unwrap()
        .into_iter()
        .find(|o| o.transaction_id != first.transaction_id)
        .unwrap();
    assert!(db
        .update_register_entry(&RegisterEntryEdit {
            id: second.transaction_id,
            account_id: Some("cash".into()),
            date: date("2026-09-10"),
            payee_name: None,
            category_id: None,
            memo: String::new(),
            flag_id: None,
            amount: Huf(-100),
            cleared_state: ClearedState::Uncleared,
            confirmed: false,
            repeat_interval_months: None
        })
        .is_err());
}

#[test]
fn schedule_peer_category_routing_rejects_minimum_integer_without_changing_template() {
    let (_dir, mut db) = db();
    db.create_monthly_schedule(&MonthlyScheduleDraft {
        account_id: "asset".into(),
        start_date: date("2026-09-10"),
        day_of_month: None,
        end_date: Some(date("2026-09-10")),
        payee_name: None,
        category_id: Some("groceries".into()),
        memo: String::new(),
        flag_id: None,
        amount: Huf(-100),
        interval_months: 1,
        counterpart_account_id: Some("cash".into()),
    })
    .unwrap();
    let occurrence = db.scheduled_occurrences().unwrap().remove(0);
    let edit = RegisterEntryEdit {
        id: occurrence.transaction_id.clone(),
        account_id: None,
        date: occurrence.date.clone(),
        payee_name: None,
        category_id: Some("fuel".into()),
        memo: String::new(),
        flag_id: None,
        amount: Huf(i64::MIN),
        cleared_state: ClearedState::Uncleared,
        confirmed: false,
        repeat_interval_months: None,
    };
    assert!(matches!(
        db.update_register_entry(&edit),
        Err(LedgerError::AmountOverflow)
    ));
    let stored: String = db
        .connection
        .query_row(
            "SELECT category_id FROM schedules WHERE id=?1",
            [&occurrence.schedule_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, "groceries");
    assert_eq!(db.scheduled_occurrences().unwrap()[0].amount, Huf(-100));
}
