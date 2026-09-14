use crate::database::{BudgetInfo, Database};
use crate::ledger::{AccountOverview, CalendarDate, RegisterEntry};
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
}

fn with_database<T>(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, BudgetState>,
    operation: impl FnOnce(&Database) -> Result<T, String>,
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
        slot.as_ref()
            .ok_or_else(|| "Budget storage is unavailable.".to_owned())?,
    )
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
        })
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
            get_account_register
        ])
        .run(tauri::generate_context!())
        .expect("Could not start the desktop application");
}
