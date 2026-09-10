use rusqlite::{Connection, TransactionBehavior};
use serde::Serialize;
use std::{
    error::Error,
    path::{Path, PathBuf},
    time::Duration,
};

const SCHEMA_VERSION: i64 = 1;
const INITIAL_SCHEMA: &str = include_str!("../migrations/0001_budget.sql");
type DatabaseResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

pub struct Database {
    connection: Connection,
    path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetInfo {
    pub name: String,
    pub currency: String,
    pub schema_version: i64,
    pub database_path: String,
}

impl Database {
    pub fn open(path: &Path) -> DatabaseResult<Self> {
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        initialize(&mut connection)?;
        // Validate the singleton before retaining the connection in app state.
        let database = Self {
            connection,
            path: path.to_owned(),
        };
        database.info()?;
        Ok(database)
    }

    pub fn info(&self) -> DatabaseResult<BudgetInfo> {
        Ok(self.connection.query_row(
            "SELECT name, currency FROM budget_settings WHERE id = 1",
            [],
            |row| {
                Ok(BudgetInfo {
                    name: row.get(0)?,
                    currency: row.get(1)?,
                    schema_version: SCHEMA_VERSION,
                    database_path: self.path.to_string_lossy().into_owned(),
                })
            },
        )?)
    }
}

fn initialize(connection: &mut Connection) -> DatabaseResult<()> {
    // Lock before inspecting the version: two app launches cannot both migrate.
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version: i64 = transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    match version {
        SCHEMA_VERSION => {}
        0 => {
            let objects: i64 = transaction.query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
                [],
                |row| row.get(0),
            )?;
            if objects != 0 {
                return Err(
                    "Refusing to initialize an unversioned database containing data.".into(),
                );
            }
            transaction.execute_batch(INITIAL_SCHEMA)?;
            transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        _ => return Err("Unsupported schema version; the database was not changed.".into()),
    }
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializes_and_reopens_without_resetting_budget() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let database = Database::open(&path).unwrap();
        assert_eq!(database.info().unwrap().currency, "HUF");
        let foreign_keys: i64 = database
            .connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .unwrap();
        assert_eq!(foreign_keys, 1);
        database
            .connection
            .execute("UPDATE budget_settings SET name = 'Test budget'", [])
            .unwrap();
        drop(database);
        let reopened = Database::open(&path).unwrap();
        assert_eq!(reopened.info().unwrap().name, "Test budget");
        assert_eq!(reopened.info().unwrap().schema_version, 1);
    }

    #[test]
    fn refuses_unknown_schema_without_changing_it() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.pragma_update(None, "user_version", 99).unwrap();
        assert!(initialize(&mut connection).is_err());
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 99);
        assert!(connection.is_autocommit());
    }

    #[test]
    fn preserves_existing_unversioned_data() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE existing (value TEXT); INSERT INTO existing VALUES ('keep');",
            )
            .unwrap();
        assert!(initialize(&mut connection).is_err());
        let value: String = connection
            .query_row("SELECT value FROM existing", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "keep");
        assert!(connection.is_autocommit());
    }

    #[test]
    fn enforces_one_huf_budget() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize(&mut connection).unwrap();
        assert!(connection
            .execute("INSERT INTO budget_settings VALUES (2, 'Other', 'HUF')", [])
            .is_err());
        assert!(connection
            .execute("UPDATE budget_settings SET currency = 'EUR'", [])
            .is_err());
        assert!(connection
            .execute("UPDATE budget_settings SET name = '   '", [])
            .is_err());
    }

    #[test]
    fn fails_on_corrupt_files_without_replacing_them() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        std::fs::write(&path, b"not a database").unwrap();
        assert!(Database::open(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"not a database");
    }
}
