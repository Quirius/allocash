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
fn monthly_schedule_posts_once_and_clamps_the_next_short_month() {
    let (_directory, mut database) = database();
    database
        .create_monthly_schedule(&MonthlyScheduleDraft {
            account_id: "cash".into(),
            start_date: date("2026-01-31"),
            end_date: None,
            payee_name: Some("Rent".into()),
            category_id: None,
            memo: "Monthly rent".into(),
            flag_id: None,
            amount: Huf(-100),
        })
        .unwrap();
    let january = database.scheduled_occurrences().unwrap();
    assert_eq!(january.len(), 1);
    assert_eq!(january[0].date, date("2026-01-31"));
    assert_eq!(
        database
            .account_balance("cash", &date("2026-01-31"))
            .unwrap()
            .working,
        Huf(0)
    );
    database
        .post_scheduled_occurrence(&january[0].transaction_id)
        .unwrap();
    assert_eq!(
        database
            .account_balance("cash", &date("2026-01-31"))
            .unwrap()
            .working,
        Huf(-100)
    );
    let february = database.scheduled_occurrences().unwrap();
    assert_eq!(february.len(), 1);
    assert_eq!(february[0].date, date("2026-02-28"));
    assert!(matches!(
        database.post_scheduled_occurrence(&january[0].transaction_id),
        Err(LedgerError::NotFound)
    ));
    database
        .skip_scheduled_occurrence(&february[0].transaction_id)
        .unwrap();
    assert_eq!(
        database.scheduled_occurrences().unwrap()[0].date,
        date("2026-03-31")
    );
}

#[test]
fn deactivating_a_schedule_removes_pending_not_posted_occurrences() {
    let (_directory, mut database) = database();
    database
        .create_monthly_schedule(&MonthlyScheduleDraft {
            account_id: "cash".into(),
            start_date: date("2026-09-10"),
            end_date: None,
            payee_name: None,
            category_id: None,
            memo: String::new(),
            flag_id: None,
            amount: Huf(-10),
        })
        .unwrap();
    let first = database.scheduled_occurrences().unwrap().remove(0);
    database
        .post_scheduled_occurrence(&first.transaction_id)
        .unwrap();
    let pending = database.scheduled_occurrences().unwrap().remove(0);
    database.deactivate_schedule(&pending.schedule_id).unwrap();
    assert!(database.scheduled_occurrences().unwrap().is_empty());
    assert_eq!(
        database
            .account_balance("cash", &date("2026-09-10"))
            .unwrap()
            .working,
        Huf(-10)
    );
}

#[test]
fn spending_report_groups_posted_ordinary_outflows_only() {
    let (_directory, mut database) = database();
    database
        .create_account(&account("card", AccountKind::Credit, 1))
        .unwrap();
    database.create_category_group("g", "Living", 0).unwrap();
    database.create_category("food", "g", "Food", 0).unwrap();
    let mut cash = entry("cash-spend", "cash");
    cash.category_id = Some("food".into());
    database.create_transaction(&cash, Huf(-100)).unwrap();
    let mut card = entry("card-spend", "card");
    card.category_id = Some("food".into());
    database.create_transaction(&card, Huf(-50)).unwrap();
    let mut refund = entry("refund", "cash");
    refund.category_id = Some("food".into());
    database.create_transaction(&refund, Huf(20)).unwrap();
    let transfer = TransferDraft::manual(
        "transfer",
        Huf(30),
        entry("transfer-out", "cash"),
        entry("transfer-in", "card"),
        Direction::Outflow,
    );
    database.create_transfer(&transfer).unwrap();
    let report = database
        .spending_by_category(&SpendingReportInput {
            from: date("2026-09-10"),
            to: date("2026-09-10"),
            account_ids: vec![],
        })
        .unwrap();
    assert_eq!(report.len(), 1);
    assert_eq!(report[0].category_name, "Food");
    assert_eq!(report[0].total, Huf(150));
    assert_eq!(report[0].transaction_count, 2);
}

#[test]
fn spending_by_payee_groups_posted_ordinary_outflows_only() {
    let (_directory, database) = database();
    database.create_payee("market", "Market").unwrap();
    let mut first = entry("market-first", "cash");
    first.payee_id = Some("market".into());
    database.create_transaction(&first, Huf(-100)).unwrap();
    let mut second = entry("market-second", "cash");
    second.payee_id = Some("market".into());
    database.create_transaction(&second, Huf(-50)).unwrap();
    database
        .create_transaction(&entry("no-payee", "cash"), Huf(-20))
        .unwrap();
    let mut refund = entry("market-refund", "cash");
    refund.payee_id = Some("market".into());
    database.create_transaction(&refund, Huf(30)).unwrap();
    let report = database
        .spending_by_payee(&SpendingReportInput {
            from: date("2026-09-10"),
            to: date("2026-09-10"),
            account_ids: vec![],
        })
        .unwrap();
    assert_eq!(report.len(), 2);
    assert_eq!(report[0].payee_name, "Market");
    assert_eq!(report[0].total, Huf(150));
    assert_eq!(report[0].transaction_count, 2);
    assert_eq!(report[1].payee_name, "No payee");
    assert_eq!(report[1].total, Huf(20));
    assert_eq!(report[1].transaction_count, 1);
}

#[test]
fn inflow_outflow_report_is_monthly_dense_and_excludes_internal_movements() {
    let (_directory, mut database) = database();
    database
        .create_account(&account("card", AccountKind::Credit, 1))
        .unwrap();
    database
        .create_account(&account("closed-card", AccountKind::Credit, 2))
        .unwrap();
    database
        .create_account(&account("tracking", AccountKind::Tracking, 3))
        .unwrap();
    let mut september_income = entry("september-income", "cash");
    september_income.date = date("2026-09-01");
    database
        .create_transaction(&september_income, Huf(100))
        .unwrap();
    let mut september_spending = entry("september-spending", "cash");
    september_spending.date = date("2026-09-30");
    database
        .create_transaction(&september_spending, Huf(-30))
        .unwrap();
    let mut closed_spending = entry("closed-spending", "closed-card");
    closed_spending.date = date("2026-09-15");
    database
        .create_transaction(&closed_spending, Huf(-5))
        .unwrap();
    database.set_account_closed("closed-card", true).unwrap();
    let mut october_spending = entry("october-spending", "card");
    october_spending.date = date("2026-10-01");
    database
        .create_transaction(&october_spending, Huf(-20))
        .unwrap();
    let mut tracking_income = entry("tracking-income", "tracking");
    tracking_income.date = date("2026-10-10");
    database
        .create_transaction(&tracking_income, Huf(999))
        .unwrap();
    let scheduled = Entry::scheduled("scheduled-flow", "cash", date("2026-10-10"), "legacy");
    database.create_transaction(&scheduled, Huf(-50)).unwrap();
    database
        .create_transaction(&entry("zero-flow", "cash"), Huf(0))
        .unwrap();
    database
        .create_transfer(&TransferDraft::manual(
            "cash-card-transfer",
            Huf(80),
            entry("cash-transfer-out", "cash"),
            entry("card-transfer-in", "card"),
            Direction::Outflow,
        ))
        .unwrap();
    let input = SpendingReportInput {
        from: date("2026-09-01"),
        to: date("2026-11-01"),
        account_ids: vec![],
    };
    let report = database.inflow_outflow_by_month(&input).unwrap();
    assert_eq!(report.months.len(), 3);
    assert_eq!(report.months[0].month, "2026-09");
    assert_eq!(report.months[0].inflow, Huf(100));
    assert_eq!(report.months[0].outflow, Huf(35));
    assert_eq!(report.months[0].difference, Huf(65));
    assert_eq!(report.months[0].inflow_transaction_count, 1);
    assert_eq!(report.months[0].outflow_transaction_count, 2);
    assert_eq!(report.months[1].month, "2026-10");
    assert_eq!(report.months[1].inflow, Huf(0));
    assert_eq!(report.months[1].outflow, Huf(20));
    assert_eq!(report.months[1].difference, Huf(-20));
    assert_eq!(report.months[2].month, "2026-11");
    assert_eq!(report.months[2].inflow, Huf(0));
    assert_eq!(report.months[2].outflow, Huf(0));
    assert_eq!(report.total_inflow, Huf(100));
    assert_eq!(report.total_outflow, Huf(55));
    assert_eq!(report.total_difference, Huf(45));
    let tracking = database
        .inflow_outflow_by_month(&SpendingReportInput {
            account_ids: vec!["tracking".into()],
            ..input
        })
        .unwrap();
    assert_eq!(tracking.total_inflow, Huf(999));
    assert_eq!(tracking.total_outflow, Huf(0));
    assert!(matches!(
        database.inflow_outflow_by_month(&SpendingReportInput {
            from: date("2026-11-02"),
            to: date("2026-11-01"),
            account_ids: vec![],
        }),
        Err(LedgerError::InvalidValue(_))
    ));
}

#[test]
fn income_vs_expense_keeps_category_sides_and_months_distinct() {
    let (_directory, mut database) = database();
    database
        .create_account(&account("card", AccountKind::Credit, 1))
        .unwrap();
    database
        .create_account(&account("closed-card", AccountKind::Credit, 2))
        .unwrap();
    database
        .create_account(&account("tracking", AccountKind::Tracking, 3))
        .unwrap();
    database
        .create_category_group("income", "Income", 0)
        .unwrap();
    database
        .create_category_group("living", "Living", 1)
        .unwrap();
    database
        .create_category("salary", "income", "Salary", 0)
        .unwrap();
    database
        .create_category("groceries", "living", "Groceries", 0)
        .unwrap();
    let mut salary = entry("salary", "cash");
    salary.date = date("2026-09-01");
    salary.category_id = Some("salary".into());
    database.create_transaction(&salary, Huf(100)).unwrap();
    let mut groceries = entry("groceries", "cash");
    groceries.date = date("2026-09-30");
    groceries.category_id = Some("groceries".into());
    database.create_transaction(&groceries, Huf(-30)).unwrap();
    let mut closed_groceries = entry("closed-groceries", "closed-card");
    closed_groceries.date = date("2026-09-15");
    closed_groceries.category_id = Some("groceries".into());
    database
        .create_transaction(&closed_groceries, Huf(-3))
        .unwrap();
    database.set_account_closed("closed-card", true).unwrap();
    let mut refund = entry("refund", "cash");
    refund.date = date("2026-10-01");
    refund.category_id = Some("groceries".into());
    database.create_transaction(&refund, Huf(5)).unwrap();
    let mut october_groceries = entry("october-groceries", "card");
    october_groceries.date = date("2026-10-01");
    october_groceries.category_id = Some("groceries".into());
    database
        .create_transaction(&october_groceries, Huf(-10))
        .unwrap();
    let mut uncategorized_income = entry("uncategorized-income", "cash");
    uncategorized_income.date = date("2026-09-01");
    database
        .create_transaction(&uncategorized_income, Huf(7))
        .unwrap();
    let mut uncategorized_expense = entry("uncategorized-expense", "cash");
    uncategorized_expense.date = date("2026-10-01");
    database
        .create_transaction(&uncategorized_expense, Huf(-2))
        .unwrap();
    let mut tracking_income = entry("tracking-income", "tracking");
    tracking_income.date = date("2026-10-01");
    database
        .create_transaction(&tracking_income, Huf(999))
        .unwrap();
    let scheduled = Entry::scheduled(
        "scheduled-income-expense",
        "cash",
        date("2026-10-01"),
        "legacy",
    );
    database.create_transaction(&scheduled, Huf(-50)).unwrap();
    database
        .create_transaction(&entry("zero-income-expense", "cash"), Huf(0))
        .unwrap();
    database
        .create_transfer(&TransferDraft::manual(
            "income-expense-transfer",
            Huf(80),
            entry("income-expense-transfer-out", "cash"),
            entry("income-expense-transfer-in", "card"),
            Direction::Outflow,
        ))
        .unwrap();
    let input = SpendingReportInput {
        from: date("2026-09-01"),
        to: date("2026-11-01"),
        account_ids: vec![],
    };
    let report = database.income_vs_expense(&input).unwrap();
    assert_eq!(report.months, ["2026-09", "2026-10", "2026-11"]);
    assert_eq!(report.total_income, Huf(112));
    assert_eq!(report.total_expense, Huf(45));
    assert_eq!(report.total_net_income, Huf(67));
    assert_eq!(report.average_monthly_income, Huf(37));
    assert_eq!(report.average_monthly_expense, Huf(15));
    assert_eq!(report.average_monthly_net_income, Huf(22));
    assert_eq!(report.savings_ratio_basis_points, Some(Huf(5982)));
    assert_eq!(report.monthly_totals[0].income, Huf(107));
    assert_eq!(report.monthly_totals[0].expense, Huf(33));
    assert_eq!(report.monthly_totals[0].net_income, Huf(74));
    assert_eq!(report.monthly_totals[1].income, Huf(5));
    assert_eq!(report.monthly_totals[1].expense, Huf(12));
    assert_eq!(report.monthly_totals[1].net_income, Huf(-7));
    assert_eq!(report.monthly_totals[2].savings_ratio_basis_points, None);
    assert_eq!(report.income_groups[0].group_name, "Income");
    assert_eq!(
        report.income_groups[0].categories[0].amounts,
        [Huf(100), Huf(0), Huf(0)]
    );
    assert_eq!(report.income_groups[1].group_name, "Living");
    assert_eq!(
        report.income_groups[1].categories[0].amounts,
        [Huf(0), Huf(5), Huf(0)]
    );
    assert_eq!(report.income_groups[2].group_name, "Uncategorized");
    assert_eq!(
        report.expense_groups[0].categories[0].amounts,
        [Huf(33), Huf(10), Huf(0)]
    );
    assert_eq!(report.expense_groups[1].group_name, "Uncategorized");
    assert_eq!(
        report.expense_groups[1].categories[0].amounts,
        [Huf(0), Huf(2), Huf(0)]
    );
    let tracking = database
        .income_vs_expense(&SpendingReportInput {
            account_ids: vec!["tracking".into()],
            ..input
        })
        .unwrap();
    assert_eq!(tracking.total_income, Huf(999));
    assert_eq!(tracking.total_expense, Huf(0));
    assert!(matches!(
        database.income_vs_expense(&SpendingReportInput {
            from: date("2026-11-02"),
            to: date("2026-11-01"),
            account_ids: vec![],
        }),
        Err(LedgerError::InvalidValue(_))
    ));
}

#[test]
fn balance_over_time_uses_signed_posted_balances_and_month_end_points() {
    let (_directory, mut database) = database();
    database
        .create_account(&account("card", AccountKind::Credit, 1))
        .unwrap();
    database
        .create_account(&account("closed-card", AccountKind::Credit, 2))
        .unwrap();
    database
        .create_account(&account("tracking", AccountKind::Tracking, 3))
        .unwrap();
    let mut opening_cash = entry("opening-cash", "cash");
    opening_cash.date = date("2026-09-01");
    database.create_transaction(&opening_cash, Huf(10)).unwrap();
    let mut on_from = entry("on-from", "cash");
    on_from.date = date("2026-09-15");
    database.create_transaction(&on_from, Huf(5)).unwrap();
    let mut month_end = entry("month-end", "cash");
    month_end.date = date("2026-09-30");
    database.create_transaction(&month_end, Huf(-3)).unwrap();
    let mut closed_debt = entry("closed-debt", "closed-card");
    closed_debt.date = date("2026-09-10");
    database.create_transaction(&closed_debt, Huf(-2)).unwrap();
    database.set_account_closed("closed-card", true).unwrap();
    let mut transfer_out = entry("balance-transfer-out", "cash");
    transfer_out.date = date("2026-10-01");
    let mut transfer_in = entry("balance-transfer-in", "card");
    transfer_in.date = date("2026-10-02");
    database
        .create_transfer(&TransferDraft::manual(
            "balance-transfer",
            Huf(4),
            transfer_out,
            transfer_in,
            Direction::Outflow,
        ))
        .unwrap();
    let mut tracking_gain = entry("tracking-gain", "tracking");
    tracking_gain.date = date("2026-10-31");
    database.create_transaction(&tracking_gain, Huf(7)).unwrap();
    let scheduled = Entry::scheduled("balance-scheduled", "cash", date("2026-11-01"), "legacy");
    database.create_transaction(&scheduled, Huf(-100)).unwrap();
    let mut on_to = entry("on-to", "cash");
    on_to.date = date("2026-11-10");
    database.create_transaction(&on_to, Huf(1)).unwrap();
    let mut after_to = entry("after-to", "cash");
    after_to.date = date("2026-11-11");
    database.create_transaction(&after_to, Huf(100)).unwrap();
    let input = BalanceOverTimeInput {
        from: date("2026-09-15"),
        to: date("2026-11-10"),
        account_ids: vec![],
    };
    let report = database.balance_over_time(&input).unwrap();
    assert_eq!(
        report
            .point_dates
            .iter()
            .map(CalendarDate::as_str)
            .collect::<Vec<_>>(),
        ["2026-09-15", "2026-09-30", "2026-10-31", "2026-11-10"]
    );
    assert_eq!(report.total_balances, [Huf(13), Huf(10), Huf(17), Huf(18)]);
    assert_eq!(report.accounts.len(), 4);
    assert_eq!(report.accounts[0].account_name, "cash");
    assert_eq!(
        report.accounts[0].balances,
        [Huf(15), Huf(12), Huf(8), Huf(9)]
    );
    assert_eq!(
        report.accounts[1].balances,
        [Huf(0), Huf(0), Huf(4), Huf(4)]
    );
    assert_eq!(
        report.accounts[2].balances,
        [Huf(0), Huf(0), Huf(7), Huf(7)]
    );
    assert_eq!(
        report.accounts[3].balances,
        [Huf(-2), Huf(-2), Huf(-2), Huf(-2)]
    );
    let cash_only = database
        .balance_over_time(&BalanceOverTimeInput {
            account_ids: vec!["cash".into()],
            ..input
        })
        .unwrap();
    assert_eq!(cash_only.total_balances, [Huf(15), Huf(12), Huf(8), Huf(9)]);
    assert!(matches!(
        database.balance_over_time(&BalanceOverTimeInput {
            from: date("2026-11-11"),
            to: date("2026-11-10"),
            account_ids: vec![],
        }),
        Err(LedgerError::InvalidValue(_))
    ));
    assert!(matches!(
        database.balance_over_time(&BalanceOverTimeInput {
            from: date("2026-09-15"),
            to: date("2026-11-10"),
            account_ids: vec!["missing".into()],
        }),
        Err(LedgerError::NotFound)
    ));
}

#[test]
fn outflow_over_time_is_dense_and_filters_category_identity() {
    let (_directory, mut database) = database();
    database
        .create_account(&account("card", AccountKind::Credit, 1))
        .unwrap();
    database
        .create_account(&account("closed-card", AccountKind::Credit, 2))
        .unwrap();
    database
        .create_account(&account("tracking", AccountKind::Tracking, 3))
        .unwrap();
    database
        .create_category_group("living", "Living", 0)
        .unwrap();
    database
        .create_category("groceries", "living", "Groceries", 0)
        .unwrap();
    database.create_category("car", "living", "Car", 1).unwrap();
    let mut december_groceries = entry("december-groceries", "cash");
    december_groceries.date = date("2026-12-31");
    december_groceries.category_id = Some("groceries".into());
    database
        .create_transaction(&december_groceries, Huf(-10))
        .unwrap();
    let mut closed_groceries = entry("closed-groceries-outflow", "closed-card");
    closed_groceries.date = date("2026-12-31");
    closed_groceries.category_id = Some("groceries".into());
    database
        .create_transaction(&closed_groceries, Huf(-2))
        .unwrap();
    database.set_account_closed("closed-card", true).unwrap();
    let mut january_groceries = entry("january-groceries", "cash");
    january_groceries.date = date("2027-01-15");
    january_groceries.category_id = Some("groceries".into());
    database
        .create_transaction(&january_groceries, Huf(-5))
        .unwrap();
    let mut january_car = entry("january-car", "card");
    january_car.date = date("2027-01-31");
    january_car.category_id = Some("car".into());
    database.create_transaction(&january_car, Huf(-20)).unwrap();
    let mut february_uncategorized = entry("february-uncategorized", "cash");
    february_uncategorized.date = date("2027-02-01");
    database
        .create_transaction(&february_uncategorized, Huf(-7))
        .unwrap();
    let mut refund = entry("outflow-refund", "cash");
    refund.date = date("2027-01-15");
    refund.category_id = Some("groceries".into());
    database.create_transaction(&refund, Huf(3)).unwrap();
    let mut tracking = entry("tracking-outflow", "tracking");
    tracking.date = date("2027-01-15");
    tracking.category_id = Some("car".into());
    database.create_transaction(&tracking, Huf(-99)).unwrap();
    let scheduled = Entry::scheduled("outflow-scheduled", "cash", date("2027-01-15"), "legacy");
    database.create_transaction(&scheduled, Huf(-50)).unwrap();
    let mut transfer_out = entry("outflow-transfer-out", "cash");
    transfer_out.date = date("2027-01-15");
    let mut transfer_in = entry("outflow-transfer-in", "card");
    transfer_in.date = date("2027-01-15");
    database
        .create_transfer(&TransferDraft::manual(
            "outflow-transfer",
            Huf(4),
            transfer_out,
            transfer_in,
            Direction::Outflow,
        ))
        .unwrap();
    let input = OutflowOverTimeInput {
        from: date("2026-12-31"),
        to: date("2027-02-01"),
        account_ids: vec![],
        category_ids: vec![],
    };
    let report = database.outflow_over_time(&input).unwrap();
    assert_eq!(report.months, ["2026-12", "2027-01", "2027-02"]);
    assert_eq!(report.monthly_totals[0].outflow, Huf(12));
    assert_eq!(report.monthly_totals[1].outflow, Huf(25));
    assert_eq!(report.monthly_totals[2].outflow, Huf(7));
    assert_eq!(report.total_outflow, Huf(44));
    assert_eq!(report.average_monthly_outflow, Huf(14));
    assert_eq!(report.transaction_count, 5);
    assert_eq!(report.categories[0].category_name, "Groceries");
    assert_eq!(report.categories[0].amounts, [Huf(12), Huf(5), Huf(0)]);
    assert_eq!(report.categories[1].category_name, "Car");
    assert_eq!(report.categories[2].category_name, "Uncategorized");
    let groceries = database
        .outflow_over_time(&OutflowOverTimeInput {
            category_ids: vec![Some("groceries".into())],
            ..input
        })
        .unwrap();
    assert_eq!(groceries.total_outflow, Huf(17));
    let uncategorized = database
        .outflow_over_time(&OutflowOverTimeInput {
            account_ids: vec!["cash".into()],
            category_ids: vec![None],
            from: date("2026-12-31"),
            to: date("2027-02-01"),
        })
        .unwrap();
    assert_eq!(uncategorized.total_outflow, Huf(7));
    let tracking_only = database
        .outflow_over_time(&OutflowOverTimeInput {
            account_ids: vec!["tracking".into()],
            category_ids: vec![],
            from: date("2026-12-31"),
            to: date("2027-02-01"),
        })
        .unwrap();
    assert_eq!(tracking_only.total_outflow, Huf(99));
    assert!(matches!(
        database.outflow_over_time(&OutflowOverTimeInput {
            from: date("2027-02-02"),
            to: date("2027-02-01"),
            account_ids: vec![],
            category_ids: vec![],
        }),
        Err(LedgerError::InvalidValue(_))
    ));
}

#[test]
fn income_breakdown_uses_payees_and_budget_groups_without_tracing_funds() {
    let (_directory, mut database) = database();
    database
        .create_account(&account("card", AccountKind::Credit, 1))
        .unwrap();
    database
        .create_account(&account("closed-card", AccountKind::Credit, 2))
        .unwrap();
    database
        .create_account(&account("tracking", AccountKind::Tracking, 3))
        .unwrap();
    database.create_category_group("fixed", "Fixed", 0).unwrap();
    database
        .create_category_group("living", "Living", 1)
        .unwrap();
    database
        .create_category("rent", "fixed", "Rent", 0)
        .unwrap();
    database
        .create_category("groceries", "living", "Groceries", 0)
        .unwrap();
    database.create_payee("salary", "Salary payer").unwrap();
    database.create_payee("interest", "Interest").unwrap();
    database.create_payee("store", "Store").unwrap();
    let mut salary_cash = entry("salary-cash", "cash");
    salary_cash.payee_id = Some("salary".into());
    database.create_transaction(&salary_cash, Huf(100)).unwrap();
    let mut salary_card = entry("salary-card", "card");
    salary_card.payee_id = Some("salary".into());
    database.create_transaction(&salary_card, Huf(50)).unwrap();
    let mut interest = entry("interest", "cash");
    interest.payee_id = Some("interest".into());
    database.create_transaction(&interest, Huf(10)).unwrap();
    database
        .create_transaction(&entry("no-payee-income", "cash"), Huf(5))
        .unwrap();
    let mut refund = entry("refund-source", "cash");
    refund.payee_id = Some("store".into());
    refund.category_id = Some("groceries".into());
    database.create_transaction(&refund, Huf(3)).unwrap();
    let mut rent = entry("rent-expense", "cash");
    rent.category_id = Some("rent".into());
    database.create_transaction(&rent, Huf(-40)).unwrap();
    let mut groceries = entry("groceries-expense", "card");
    groceries.category_id = Some("groceries".into());
    database.create_transaction(&groceries, Huf(-20)).unwrap();
    let mut closed_groceries = entry("closed-groceries-expense", "closed-card");
    closed_groceries.category_id = Some("groceries".into());
    database
        .create_transaction(&closed_groceries, Huf(-2))
        .unwrap();
    database.set_account_closed("closed-card", true).unwrap();
    database
        .create_transaction(&entry("uncategorized-expense", "cash"), Huf(-7))
        .unwrap();
    let mut tracking_income = entry("tracking-income-source", "tracking");
    tracking_income.payee_id = Some("interest".into());
    database
        .create_transaction(&tracking_income, Huf(99))
        .unwrap();
    let scheduled = Entry::scheduled(
        "income-breakdown-scheduled",
        "cash",
        date("2026-09-10"),
        "legacy",
    );
    database.create_transaction(&scheduled, Huf(-50)).unwrap();
    database
        .create_transfer(&TransferDraft::manual(
            "income-breakdown-transfer",
            Huf(25),
            entry("income-breakdown-transfer-out", "cash"),
            entry("income-breakdown-transfer-in", "card"),
            Direction::Outflow,
        ))
        .unwrap();
    let input = IncomeBreakdownInput {
        from: date("2026-09-10"),
        to: date("2026-09-10"),
        account_ids: vec![],
    };
    let report = database.income_breakdown(&input).unwrap();
    assert_eq!(report.total_income, Huf(168));
    assert_eq!(report.total_expense, Huf(69));
    assert_eq!(report.net_income, Huf(99));
    assert_eq!(report.income_sources[0].payee_name, "Salary payer");
    assert_eq!(report.income_sources[0].total, Huf(150));
    assert_eq!(report.income_sources[1].payee_name, "Interest");
    assert_eq!(report.income_sources[2].payee_name, "No payee");
    assert_eq!(report.income_sources[3].payee_name, "Store");
    assert_eq!(report.expense_groups[0].group_name, "Fixed");
    assert_eq!(report.expense_groups[0].total, Huf(40));
    assert_eq!(report.expense_groups[1].group_name, "Living");
    assert_eq!(report.expense_groups[1].total, Huf(22));
    assert_eq!(report.expense_groups[2].group_name, "Uncategorized");
    assert_eq!(report.expense_groups[2].total, Huf(7));
    let tracking_only = database
        .income_breakdown(&IncomeBreakdownInput {
            account_ids: vec!["tracking".into()],
            ..input
        })
        .unwrap();
    assert_eq!(tracking_only.total_income, Huf(99));
    assert_eq!(tracking_only.total_expense, Huf(0));
    assert!(matches!(
        database.income_breakdown(&IncomeBreakdownInput {
            from: date("2026-09-11"),
            to: date("2026-09-10"),
            account_ids: vec![],
        }),
        Err(LedgerError::InvalidValue(_))
    ));
}

#[test]
fn forecast_bootstraps_complete_months_deterministically() {
    let (_directory, database) = database();
    database
        .create_category_group("living", "Living", 0)
        .unwrap();
    database
        .create_category("groceries", "living", "Groceries", 0)
        .unwrap();
    for (id, day, amount, category) in [
        ("march-income", "2026-03-10", 100, None),
        ("april-groceries", "2026-04-10", -40, Some("groceries")),
        ("may-income", "2026-05-10", 10, None),
        ("may-uncategorized", "2026-05-20", -30, None),
        ("current-income", "2026-06-10", 20, None),
    ] {
        let mut row = entry(id, "cash");
        row.date = date(day);
        row.category_id = category.map(str::to_owned);
        database.create_transaction(&row, Huf(amount)).unwrap();
    }
    let input = ForecastInput {
        as_of: date("2026-06-15"),
        horizon_months: 2,
        history_months: 3,
        account_ids: vec![],
        category_ids: vec![],
        seed: "42".into(),
    };
    let first = database.forecast(&input).unwrap();
    let second = database.forecast(&input).unwrap();
    assert_eq!(
        first
            .point_dates
            .iter()
            .map(CalendarDate::as_str)
            .collect::<Vec<_>>(),
        vec!["2026-06-15", "2026-07-31", "2026-08-31"]
    );
    assert_eq!(first.starting_balance, Huf(60));
    assert_eq!(first.history_from.as_str(), "2026-03-01");
    assert_eq!(first.history_to.as_str(), "2026-05-31");
    assert_eq!(first.percentile_paths.len(), 5);
    assert!(first
        .percentile_paths
        .iter()
        .all(|path| path.balances.len() == 3 && path.balances[0] == Huf(60)));
    assert_eq!(
        first.percentile_paths[2].balances,
        second.percentile_paths[2].balances
    );
    for index in 0..3 {
        assert!(
            first.percentile_paths[0].balances[index].0
                <= first.percentile_paths[1].balances[index].0
                && first.percentile_paths[1].balances[index].0
                    <= first.percentile_paths[2].balances[index].0
                && first.percentile_paths[2].balances[index].0
                    <= first.percentile_paths[3].balances[index].0
                && first.percentile_paths[3].balances[index].0
                    <= first.percentile_paths[4].balances[index].0
        );
    }
    let groceries_only = database
        .forecast(&ForecastInput {
            category_ids: vec![Some("groceries".into())],
            ..input
        })
        .unwrap();
    assert_eq!(groceries_only.starting_balance, Huf(60));
    assert_ne!(
        first.percentile_paths[2].balances,
        groceries_only.percentile_paths[2].balances
    );
}

#[test]
fn forecast_projects_schedules_without_resampling_posted_occurrences() {
    let (_directory, mut database) = database();
    database
        .create_monthly_schedule(&MonthlyScheduleDraft {
            account_id: "cash".into(),
            start_date: date("2025-10-31"),
            end_date: None,
            payee_name: Some("Rent".into()),
            category_id: None,
            memo: String::new(),
            flag_id: None,
            amount: Huf(-100),
        })
        .unwrap();
    for _ in 0..4 {
        let occurrence = database.scheduled_occurrences().unwrap().remove(0);
        database
            .post_scheduled_occurrence(&occurrence.transaction_id)
            .unwrap();
    }
    let report = database
        .forecast(&ForecastInput {
            as_of: date("2026-01-15"),
            horizon_months: 2,
            history_months: 3,
            account_ids: vec![],
            category_ids: vec![],
            seed: "42".into(),
        })
        .unwrap();
    assert_eq!(report.starting_balance, Huf(-300));
    assert!(report
        .percentile_paths
        .iter()
        .all(|path| path.balances == vec![Huf(-300), Huf(-500), Huf(-600)]));
}

#[test]
fn forecast_counts_an_overdue_schedule_once_and_honors_its_end_date() {
    let (_directory, mut database) = database();
    database
        .create_monthly_schedule(&MonthlyScheduleDraft {
            account_id: "cash".into(),
            start_date: date("2025-10-31"),
            end_date: Some(date("2026-02-28")),
            payee_name: None,
            category_id: None,
            memo: String::new(),
            flag_id: None,
            amount: Huf(-100),
        })
        .unwrap();
    let report = database
        .forecast(&ForecastInput {
            as_of: date("2026-01-31"),
            horizon_months: 2,
            history_months: 3,
            account_ids: vec![],
            category_ids: vec![],
            seed: "42".into(),
        })
        .unwrap();
    assert!(report
        .percentile_paths
        .iter()
        .all(|path| path.balances == vec![Huf(0), Huf(-200), Huf(-200)]));
}

#[test]
fn forecast_applies_account_and_expense_category_scope_to_schedules() {
    let (_directory, mut database) = database();
    database
        .create_account(&account("tracking", AccountKind::Tracking, 1))
        .unwrap();
    database
        .create_category_group("living", "Living", 0)
        .unwrap();
    database
        .create_category("groceries", "living", "Groceries", 0)
        .unwrap();
    database
        .create_category("utilities", "living", "Utilities", 1)
        .unwrap();
    for (account_id, category_id, amount) in [
        ("cash", Some("groceries"), -100),
        ("cash", Some("utilities"), -200),
        ("cash", None, 30),
        ("tracking", Some("groceries"), -500),
    ] {
        database
            .create_monthly_schedule(&MonthlyScheduleDraft {
                account_id: account_id.into(),
                start_date: date("2026-01-31"),
                end_date: None,
                payee_name: None,
                category_id: category_id.map(str::to_owned),
                memo: String::new(),
                flag_id: None,
                amount: Huf(amount),
            })
            .unwrap();
    }
    let report = database
        .forecast(&ForecastInput {
            as_of: date("2026-01-15"),
            horizon_months: 1,
            history_months: 3,
            account_ids: vec!["cash".into()],
            category_ids: vec![Some("groceries".into())],
            seed: "42".into(),
        })
        .unwrap();
    assert!(report
        .percentile_paths
        .iter()
        .all(|path| path.balances == vec![Huf(0), Huf(-140)]));
}

#[test]
fn net_worth_includes_all_account_kinds_and_excludes_scheduled_rows() {
    let (_directory, database) = database();
    for (id, kind) in [
        ("card", AccountKind::Credit),
        ("loan", AccountKind::Loan),
        ("tracking", AccountKind::Tracking),
    ] {
        database.create_account(&account(id, kind, 1)).unwrap();
    }
    for (id, account_id, amount) in [
        ("cash", "cash", 100),
        ("card", "card", -30),
        ("loan", "loan", -20),
        ("tracking", "tracking", 50),
    ] {
        database
            .create_transaction(&entry(id, account_id), Huf(amount))
            .unwrap();
    }
    let scheduled = Entry::scheduled("scheduled-worth", "cash", date("2026-09-10"), "legacy");
    database.create_transaction(&scheduled, Huf(999)).unwrap();
    let report = database
        .net_worth_report(&date("2026-09-10"), Some(&date("2026-09-09")))
        .unwrap();
    assert_eq!(report.assets, Huf(150));
    assert_eq!(report.debts, Huf(50));
    assert_eq!(report.net_worth, Huf(100));
    assert_eq!(report.change, Some(Huf(100)));
}

#[test]
fn reconciliation_promotes_eligible_entries_and_adds_only_the_reviewed_adjustment() {
    let (_directory, mut database) = database();
    database
        .create_transaction(&entry("income", "cash"), Huf(1_000))
        .unwrap();
    database
        .create_transaction(&entry("expense", "cash"), Huf(-200))
        .unwrap();
    let mut pending = entry("pending", "cash");
    pending.cleared_state = ClearedState::Uncleared;
    database.create_transaction(&pending, Huf(-50)).unwrap();
    let mut future = entry("future", "cash");
    future.date = date("2026-09-11");
    database.create_transaction(&future, Huf(100)).unwrap();
    let input = ReconciliationInput {
        account_id: "cash".into(),
        as_of: date("2026-09-10"),
        bank_cleared_balance: Huf(900),
        expected_cleared_balance: None,
    };
    let review = database.preview_account_reconciliation(&input).unwrap();
    assert_eq!(review.app_cleared_balance, Huf(800));
    assert_eq!(review.adjustment_amount, Huf(100));
    assert_eq!(review.cleared_entry_count, 2);
    let result = database
        .reconcile_account(&ReconciliationInput {
            expected_cleared_balance: Some(review.app_cleared_balance),
            ..input
        })
        .unwrap();
    assert_eq!(result.reconciled_entry_count, 2);
    assert!(result.adjustment_transaction_id.is_some());
    assert_eq!(
        database
            .account_balance("cash", &date("2026-09-10"))
            .unwrap(),
        AccountBalance {
            working: Huf(850),
            cleared: Huf(900),
            uncleared: Huf(-50),
            reconciled: Huf(900)
        }
    );
    assert_eq!(
        database
            .entries("cash")
            .unwrap()
            .iter()
            .find(|row| row.entry.id == "pending")
            .unwrap()
            .entry
            .cleared_state,
        ClearedState::Uncleared
    );
}

#[test]
fn reconciliation_without_a_difference_creates_no_adjustment() {
    let (_directory, mut database) = database();
    database
        .create_transaction(&entry("cleared-income", "cash"), Huf(1_000))
        .unwrap();
    let input = ReconciliationInput {
        account_id: "cash".into(),
        as_of: date("2026-09-10"),
        bank_cleared_balance: Huf(1_000),
        expected_cleared_balance: None,
    };
    let review = database.preview_account_reconciliation(&input).unwrap();
    assert_eq!(review.adjustment_amount, Huf(0));
    let result = database
        .reconcile_account(&ReconciliationInput {
            expected_cleared_balance: Some(review.app_cleared_balance),
            ..input
        })
        .unwrap();
    assert_eq!(result.reconciled_entry_count, 1);
    assert_eq!(result.adjustment_transaction_id, None);
    assert_eq!(database.entries("cash").unwrap().len(), 1);
    assert_eq!(
        database.entries("cash").unwrap()[0].entry.cleared_state,
        ClearedState::Reconciled
    );
}

#[test]
fn reconciliation_rejects_an_outdated_review_without_partial_changes() {
    let (_directory, mut database) = database();
    database
        .create_transaction(&entry("reviewed-income", "cash"), Huf(1_000))
        .unwrap();
    let input = ReconciliationInput {
        account_id: "cash".into(),
        as_of: date("2026-09-10"),
        bank_cleared_balance: Huf(1_000),
        expected_cleared_balance: None,
    };
    let review = database.preview_account_reconciliation(&input).unwrap();
    database
        .create_transaction(&entry("new-income", "cash"), Huf(1))
        .unwrap();
    assert!(matches!(
        database.reconcile_account(&ReconciliationInput {
            expected_cleared_balance: Some(review.app_cleared_balance),
            ..input
        }),
        Err(LedgerError::ReconciliationOutOfDate)
    ));
    assert!(database
        .entries("cash")
        .unwrap()
        .iter()
        .all(|row| row.entry.cleared_state == ClearedState::Cleared));
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
fn account_overviews_and_register_rows_resolve_display_data() {
    let (_directory, mut database) = database();
    database
        .create_account(&account("other", AccountKind::Credit, 0))
        .unwrap();
    database
        .create_category_group("living", "Living", 0)
        .unwrap();
    database
        .create_category("groceries", "living", "Groceries", 0)
        .unwrap();
    database.create_payee("market", "Market").unwrap();

    let mut purchase = entry("purchase", "cash");
    purchase.payee_id = Some("market".into());
    purchase.category_id = Some("groceries".into());
    purchase.memo = "Weekly shop".into();
    purchase.flag_id = Some("flag-orange".into());
    purchase.cleared_state = ClearedState::Reconciled;
    database.create_transaction(&purchase, Huf(-2500)).unwrap();
    database
        .create_transfer(&transfer("payment", 1000, Direction::Outflow))
        .unwrap();

    let overviews = database.account_overviews(&date("2026-09-10")).unwrap();
    assert_eq!(overviews.len(), 2);
    assert_eq!(overviews[0].name, "cash");
    assert_eq!(overviews[0].balance.working, Huf(-3500));
    assert_eq!(overviews[1].name, "other");
    assert_eq!(overviews[1].balance.working, Huf(1000));

    let register = database.register_entries("cash").unwrap();
    let purchase = register
        .iter()
        .find(|transaction| transaction.id == "purchase")
        .unwrap();
    assert_eq!(purchase.payee_name.as_deref(), Some("Market"));
    assert_eq!(purchase.category_group_name.as_deref(), Some("Living"));
    assert_eq!(purchase.category_name.as_deref(), Some("Groceries"));
    assert_eq!(purchase.flag_color.as_deref(), Some("orange"));
    assert_eq!(purchase.cleared_state, ClearedState::Reconciled);
    assert_eq!(purchase.amount, Huf(-2500));
    let payment = register
        .iter()
        .find(|transaction| transaction.id == "payment-out")
        .unwrap();
    assert_eq!(payment.transfer_account_name.as_deref(), Some("other"));
}

#[test]
fn manual_entry_creates_payees_and_remembers_their_defaults_atomically() {
    let (_directory, mut database) = database();
    database
        .create_category_group("living", "Living", 0)
        .unwrap();
    database
        .create_category("groceries", "living", "Groceries", 0)
        .unwrap();
    let id = database
        .create_manual_transaction(&ManualTransactionDraft {
            account_id: "cash".into(),
            date: date("2026-09-10"),
            payee_name: Some("  Market  ".into()),
            category_id: Some("groceries".into()),
            memo: "  Weekly shop  ".into(),
            flag_id: Some("flag-yellow".into()),
            amount: Huf(-2500),
        })
        .unwrap();
    assert!(id.starts_with("manual-transaction-"));
    let register = database.register_entries("cash").unwrap();
    assert_eq!(register[0].payee_name.as_deref(), Some("Market"));
    assert_eq!(register[0].memo, "Weekly shop");
    assert_eq!(register[0].cleared_state, ClearedState::Cleared);
    assert_eq!(register[0].amount, Huf(-2500));
    let options = database.transaction_form_options().unwrap();
    let market = options
        .payees
        .iter()
        .find(|payee| payee.name == "Market")
        .unwrap();
    assert_eq!(market.last_category_id.as_deref(), Some("groceries"));
    assert_eq!(market.last_direction, Some(Direction::Outflow));
    assert_eq!(options.categories[0].name, "Groceries");
    assert_eq!(options.flags.len(), 6);

    database.set_account_closed("cash", true).unwrap();
    assert!(database
        .create_manual_transaction(&ManualTransactionDraft {
            account_id: "cash".into(),
            date: date("2026-09-10"),
            payee_name: Some("Must roll back".into()),
            category_id: None,
            memo: String::new(),
            flag_id: None,
            amount: Huf(1),
        })
        .is_err());
    assert!(!database
        .transaction_form_options()
        .unwrap()
        .payees
        .iter()
        .any(|payee| payee.name == "Must roll back"));
}

#[test]
fn manual_transfer_and_register_edit_preserve_pair_and_confirmation_rules() {
    let (_directory, mut database) = database();
    database
        .create_account(&account("other", AccountKind::Credit, 0))
        .unwrap();
    let entered_id = database
        .create_manual_transfer(&ManualTransferInput {
            account_id: "cash".into(),
            counterpart_account_id: "other".into(),
            date: date("2026-09-10"),
            memo: "Payment".into(),
            flag_id: Some("flag-blue".into()),
            amount: Huf(1000),
            direction: Direction::Outflow,
        })
        .unwrap();
    let cash = database.entries("cash").unwrap();
    let other = database.entries("other").unwrap();
    assert_eq!(cash[0].entry.id, entered_id);
    assert_eq!(cash[0].amount, Huf(-1000));
    assert_eq!(cash[0].entry.cleared_state, ClearedState::Cleared);
    assert_eq!(other[0].amount, Huf(1000));
    assert_eq!(other[0].entry.cleared_state, ClearedState::Uncleared);
    database
        .set_cleared_state(&other[0].entry.id, ClearedState::Reconciled, false)
        .unwrap();

    let edit = RegisterEntryEdit {
        id: entered_id.clone(),
        memo: "Changed".into(),
        amount: Huf(-2000),
        cleared_state: ClearedState::Uncleared,
        confirmed: false,
    };
    assert!(matches!(
        database.update_register_entry(&edit),
        Err(LedgerError::ReconciledConfirmationRequired)
    ));
    assert_eq!(database.entries("cash").unwrap()[0].amount, Huf(-1000));
    assert_eq!(database.entries("cash").unwrap()[0].entry.memo, "Payment");
    database
        .update_register_entry(&RegisterEntryEdit {
            confirmed: true,
            ..edit
        })
        .unwrap();
    assert_eq!(database.entries("cash").unwrap()[0].amount, Huf(-2000));
    assert_eq!(database.entries("other").unwrap()[0].amount, Huf(2000));
    assert_eq!(database.entries("cash").unwrap()[0].entry.memo, "Changed");
    assert_eq!(
        database.entries("cash").unwrap()[0].entry.cleared_state,
        ClearedState::Uncleared
    );
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
