use crate::database::{BudgetInfo, Database};
use crate::ledger::{
    AccountOverview, CalendarDate, LedgerError, ManualTransactionDraft, ManualTransferInput,
    RegisterEntry, RegisterEntryEdit, TransactionFormOptions,
};
use serde::Serialize;
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

pub fn run() {
    tauri::Builder::default()
        .manage(BudgetState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_budget_info,
            get_workspace,
            get_account_register,
            create_manual_transaction,
            create_manual_transfer,
            update_register_entry,
            delete_register_entry
        ])
        .run(tauri::generate_context!())
        .expect("Could not start the desktop application");
}
