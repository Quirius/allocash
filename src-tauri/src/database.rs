use crate::{
    backup::create_verified_backup,
    migrations::{self, SCHEMA_VERSION},
};
use rusqlite::Connection;
use serde::Serialize;
use std::{
    error::Error,
    path::{Path, PathBuf},
    time::Duration,
};

pub type DatabaseResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

pub struct Database {
    pub(crate) connection: Connection,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBackupReceipt {
    pub path: String,
    pub schema_version: i64,
}

impl Database {
    pub fn open(path: &Path) -> DatabaseResult<Self> {
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        migrations::initialize(&mut connection, Some(path))?;
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

    pub fn create_native_backup(&self) -> DatabaseResult<NativeBackupReceipt> {
        let path = create_verified_backup(
            &self.path,
            &format!("allocash-manual-v{SCHEMA_VERSION}-"),
            SCHEMA_VERSION,
        )?;
        Ok(NativeBackupReceipt {
            path: path.to_string_lossy().into_owned(),
            schema_version: SCHEMA_VERSION,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn initialize(connection: &mut Connection) -> DatabaseResult<()> {
        migrations::initialize(connection, None)
    }

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
        assert_eq!(reopened.info().unwrap().schema_version, 8);
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

    #[test]
    fn creates_independent_verified_backups_without_overwriting_an_existing_copy() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let database = Database::open(&path).unwrap();
        database
            .connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        database
            .connection
            .execute("UPDATE budget_settings SET name = 'Snapshot value'", [])
            .unwrap();

        let first = database.create_native_backup().unwrap();
        let second = database.create_native_backup().unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(first.schema_version, SCHEMA_VERSION);
        assert!(std::path::Path::new(&first.path).is_file());
        assert!(std::path::Path::new(&second.path).is_file());

        let backup = Connection::open(&first.path).unwrap();
        assert_eq!(
            backup
                .query_row::<String, _, _>("SELECT name FROM budget_settings", [], |row| row.get(0))
                .unwrap(),
            "Snapshot value"
        );
        assert_eq!(
            backup
                .query_row::<String, _, _>("PRAGMA quick_check", [], |row| row.get(0))
                .unwrap(),
            "ok"
        );
        assert!(backup
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none());
    }

    #[test]
    fn backup_destination_failure_preserves_the_live_database() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let database = Database::open(&path).unwrap();
        database
            .connection
            .execute("UPDATE budget_settings SET name = 'Still live'", [])
            .unwrap();
        std::fs::write(directory.path().join("backups"), "not a directory").unwrap();

        assert!(database.create_native_backup().is_err());
        assert_eq!(database.info().unwrap().name, "Still live");
        assert_eq!(
            std::fs::read(directory.path().join("backups")).unwrap(),
            b"not a directory"
        );
    }
}
