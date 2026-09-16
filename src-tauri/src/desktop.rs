use crate::database::{BudgetInfo, Database};
use crate::ledger::{
    AccountOverview, CalendarDate, LedgerError, ManualTransactionDraft, ManualTransferInput,
    MonthlyScheduleDraft, NetWorthReport, ReconciliationInput, ReconciliationResult,
    ReconciliationReview, RegisterEntry, RegisterEntryEdit, ScheduledOccurrence,
    SpendingCategoryTotal, SpendingReportInput, TransactionFormOptions,
};
use crate::plan::{CategoryTargetDefinition, PlanMonth, PlanSnapshot};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Manager;

// A failed open remains visible in the UI instead of crashing the application.
struct BudgetState(Mutex<Option<Database>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSnapshot {
    budget: BudgetInfo,
    accounts: Vec<AccountOverview>,
    transaction_options: TransactionFormOptions,
}

fn with_database<T>(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, BudgetState>,
    operation: impl FnOnce(&mut Database) -> Result<T, String>,
) -> Result<T, String> {
    let mut slot = state
        .0
        .lock()
        .map_err(|_| "Budget storage is unavailable.")?;
    if slot.is_none() {
        let directory = app
            .path()
            .app_local_data_dir()
            .map_err(|_| "Could not locate the application data folder.")?;
        std::fs::create_dir_all(&directory)
            .map_err(|_| "Could not create the application data folder.")?;
        let database = Database::open(&directory.join("budget.sqlite3"))
            .map_err(|_| "Could not open the local budget database.")?;
        *slot = Some(database);
    }
    operation(
        slot.as_mut()
            .ok_or_else(|| "Budget storage is unavailable.".to_owned())?,
    )
}

fn ledger_error(error: LedgerError) -> String {
    match error {
        LedgerError::ReconciledConfirmationRequired => {
            "reconciled_confirmation_required".to_owned()
        }
        LedgerError::ReconciliationOutOfDate => "reconciliation_out_of_date".to_owned(),
        other => other.to_string(),
    }
}

#[tauri::command]
fn get_budget_info(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
) -> Result<BudgetInfo, String> {
    with_database(&app, &state, |database| {
        database
            .info()
            .map_err(|_| "Could not read budget details.".to_owned())
    })
}

#[tauri::command]
fn get_workspace(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    as_of: String,
) -> Result<WorkspaceSnapshot, String> {
    let as_of = CalendarDate::parse(&as_of)
        .map_err(|_| "The account balance date is invalid.".to_owned())?;
    with_database(&app, &state, |database| {
        Ok(WorkspaceSnapshot {
            budget: database
                .info()
                .map_err(|_| "Could not read budget details.".to_owned())?,
            accounts: database
                .account_overviews(&as_of)
                .map_err(|_| "Could not read account balances.".to_owned())?,
            transaction_options: database
                .transaction_form_options()
                .map_err(|_| "Could not read transaction options.".to_owned())?,
        })
    })
}

#[tauri::command]
fn create_manual_transaction(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    input: ManualTransactionDraft,
) -> Result<String, String> {
    with_database(&app, &state, |database| {
        database
            .create_manual_transaction(&input)
            .map_err(ledger_error)
    })
}

#[tauri::command]
fn create_manual_transfer(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    input: ManualTransferInput,
) -> Result<String, String> {
    with_database(&app, &state, |database| {
        database
            .create_manual_transfer(&input)
            .map_err(ledger_error)
    })
}

#[tauri::command]
fn update_register_entry(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    edit: RegisterEntryEdit,
) -> Result<(), String> {
    with_database(&app, &state, |database| {
        database.update_register_entry(&edit).map_err(ledger_error)
    })
}

#[tauri::command]
fn delete_register_entry(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    id: String,
    confirmed: bool,
) -> Result<(), String> {
    with_database(&app, &state, |database| {
        database.delete_entry(&id, confirmed).map_err(ledger_error)
    })
}

#[tauri::command]
fn preview_account_reconciliation(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    input: ReconciliationInput,
) -> Result<ReconciliationReview, String> {
    with_database(&app, &state, |database| {
        database
            .preview_account_reconciliation(&input)
            .map_err(ledger_error)
    })
}

#[tauri::command]
fn reconcile_account(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    input: ReconciliationInput,
) -> Result<ReconciliationResult, String> {
    with_database(&app, &state, |database| {
        database.reconcile_account(&input).map_err(ledger_error)
    })
}

#[tauri::command]
fn get_account_register(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    account_id: String,
) -> Result<Vec<RegisterEntry>, String> {
    with_database(&app, &state, |database| {
        database
            .register_entries(&account_id)
            .map_err(|_| "Could not read this account register.".to_owned())
    })
}

#[tauri::command]
fn get_scheduled_occurrences(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
) -> Result<Vec<ScheduledOccurrence>, String> {
    with_database(&app, &state, |database| {
        database.scheduled_occurrences().map_err(ledger_error)
    })
}
#[tauri::command]
fn get_spending_by_category(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    input: SpendingReportInput,
) -> Result<Vec<SpendingCategoryTotal>, String> {
    with_database(&app, &state, |database| {
        database.spending_by_category(&input).map_err(ledger_error)
    })
}
#[tauri::command]
fn get_net_worth_report(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    as_of: String,
    compared_to: Option<String>,
) -> Result<NetWorthReport, String> {
    let as_of = CalendarDate::parse(&as_of).map_err(ledger_error)?;
    let compared_to = compared_to
        .map(|date| CalendarDate::parse(&date))
        .transpose()
        .map_err(ledger_error)?;
    with_database(&app, &state, |database| {
        database
            .net_worth_report(&as_of, compared_to.as_ref())
            .map_err(ledger_error)
    })
}
#[tauri::command]
fn create_monthly_schedule(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    input: MonthlyScheduleDraft,
) -> Result<(), String> {
    with_database(&app, &state, |database| {
        database
            .create_monthly_schedule(&input)
            .map_err(ledger_error)
    })
}
#[tauri::command]
fn post_scheduled_occurrence(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    transaction_id: String,
) -> Result<(), String> {
    with_database(&app, &state, |database| {
        database
            .post_scheduled_occurrence(&transaction_id)
            .map_err(ledger_error)
    })
}
#[tauri::command]
fn skip_scheduled_occurrence(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    transaction_id: String,
) -> Result<(), String> {
    with_database(&app, &state, |database| {
        database
            .skip_scheduled_occurrence(&transaction_id)
            .map_err(ledger_error)
    })
}
#[tauri::command]
fn deactivate_schedule(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    schedule_id: String,
) -> Result<(), String> {
    with_database(&app, &state, |database| {
        database
            .deactivate_schedule(&schedule_id)
            .map_err(ledger_error)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanAssignmentInput {
    category_id: String,
    month: String,
    amount: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanMoveInput {
    from_category_id: String,
    to_category_id: String,
    month: String,
    amount: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreditPaymentCategoryInput {
    account_id: String,
    category_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CategoryTargetInput {
    category_id: String,
    effective_month: String,
    target: Option<CategoryTargetDefinition>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CategoryTargetSnoozeInput {
    category_id: String,
    month: String,
    snoozed: bool,
}

#[tauri::command]
fn get_plan_month(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    month: String,
) -> Result<PlanSnapshot, String> {
    let month = PlanMonth::parse(&month).map_err(ledger_error)?;
    with_database(&app, &state, |database| {
        database.plan_month(&month).map_err(ledger_error)
    })
}

#[tauri::command]
fn set_plan_assignment(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    input: PlanAssignmentInput,
) -> Result<(), String> {
    let month = PlanMonth::parse(&input.month).map_err(ledger_error)?;
    let amount = input
        .amount
        .parse::<i64>()
        .map_err(|_| "Expected canonical integer HUF text.".to_owned())?;
    if amount.to_string() != input.amount {
        return Err("Expected canonical integer HUF text.".into());
    }
    with_database(&app, &state, |database| {
        database
            .set_monthly_assignment(&input.category_id, &month, crate::ledger::Huf(amount))
            .map_err(ledger_error)
    })
}

#[tauri::command]
fn move_plan_money(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    input: PlanMoveInput,
) -> Result<(), String> {
    let month = PlanMonth::parse(&input.month).map_err(ledger_error)?;
    let amount = input
        .amount
        .parse::<i64>()
        .map_err(|_| "Expected canonical integer HUF text.".to_owned())?;
    if amount.to_string() != input.amount {
        return Err("Expected canonical integer HUF text.".into());
    }
    with_database(&app, &state, |database| {
        database
            .move_monthly_money(
                &input.from_category_id,
                &input.to_category_id,
                &month,
                crate::ledger::Huf(amount),
            )
            .map_err(ledger_error)
    })
}

#[tauri::command]
fn set_credit_payment_category(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    input: CreditPaymentCategoryInput,
) -> Result<(), String> {
    with_database(&app, &state, |database| {
        database
            .set_credit_payment_category(&input.account_id, input.category_id.as_deref())
            .map_err(ledger_error)
    })
}

#[tauri::command]
fn set_category_target(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    input: CategoryTargetInput,
) -> Result<(), String> {
    let effective_month = PlanMonth::parse(&input.effective_month).map_err(ledger_error)?;
    with_database(&app, &state, |database| {
        database
            .set_category_target(&input.category_id, &effective_month, input.target.as_ref())
            .map_err(ledger_error)
    })
}

#[tauri::command]
fn set_category_target_snoozed(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
    input: CategoryTargetSnoozeInput,
) -> Result<(), String> {
    let month = PlanMonth::parse(&input.month).map_err(ledger_error)?;
    with_database(&app, &state, |database| {
        database
            .set_category_target_snoozed(&input.category_id, &month, input.snoozed)
            .map_err(ledger_error)
    })
}

pub fn run() {
    tauri::Builder::default()
        .manage(BudgetState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_budget_info,
            get_workspace,
            get_account_register,
            get_scheduled_occurrences,
            get_spending_by_category,
            get_net_worth_report,
            create_monthly_schedule,
            post_scheduled_occurrence,
            skip_scheduled_occurrence,
            deactivate_schedule,
            create_manual_transaction,
            create_manual_transfer,
            update_register_entry,
            delete_register_entry,
            preview_account_reconciliation,
            reconcile_account,
            get_plan_month,
            set_plan_assignment,
            move_plan_money,
            set_credit_payment_category,
            set_category_target,
            set_category_target_snoozed
        ])
        .run(tauri::generate_context!())
        .expect("Could not start the desktop application");
}
