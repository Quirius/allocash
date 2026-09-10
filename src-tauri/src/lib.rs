mod database;

use database::{BudgetInfo, Database};
use std::sync::Mutex;
use tauri::Manager;

// A failed open remains visible in the UI instead of crashing the application.
struct BudgetState(Mutex<Option<Database>>);

#[tauri::command]
fn get_budget_info(
    app: tauri::AppHandle,
    state: tauri::State<'_, BudgetState>,
) -> Result<BudgetInfo, String> {
    let mut slot = state.0.lock().map_err(|_| "Budget storage is unavailable.")?;
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
    slot.as_ref()
        .ok_or_else(|| "Budget storage is unavailable.".to_owned())?
        .info()
        .map_err(|_| "Could not read budget details.".to_owned())
}

pub fn run() {
    tauri::Builder::default()
        .manage(BudgetState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![get_budget_info])
        .run(tauri::generate_context!())
        .expect("Could not start the desktop application");
}
