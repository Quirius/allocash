use crate::{
    backup::create_verified_backup,
    migrations::{self, SCHEMA_VERSION},
    undo::{UndoHistory, UndoStatus},
};
use rusqlite::Connection;
use serde::Serialize;
use std::{
    error::Error,
    path::{Path, PathBuf},
    time::Duration,
};
use tempfile::TempDir;

pub type DatabaseResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

pub struct Database {
    pub(crate) connection: Connection,
    path: PathBuf,
    undo: UndoHistory,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRestoreReceipt {
    pub safety_backup_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRecoveryReceipt {
    pub preserved_data_path: String,
}

/// A validated current-schema backup. Older supported backups are migrated in
/// a private temporary copy; retaining this value keeps that copy alive while
/// SQLite reads it during restore or recovery.
struct PreparedBackup {
    path: PathBuf,
    _temporary: Option<TempDir>,
}

impl Database {
    pub fn open(path: &Path) -> DatabaseResult<Self> {
        if path.exists() {
            // Inspect an existing file before opening it for writes. A failed
            // writable SQLite open can otherwise alter or remove WAL sidecars
            // that recovery must preserve with an unreadable database.
            let inspection =
                Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            let integrity: String =
                inspection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
            if integrity != "ok" {
                return Err("The local budget database failed its integrity check.".into());
            }
        }
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        migrations::initialize(&mut connection, Some(path))?;
        // Validate the singleton before retaining the connection in app state.
        let database = Self {
            connection,
            path: path.to_owned(),
            undo: UndoHistory::new()?,
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
        self.create_backup("manual")
    }

    pub fn create_safety_backup(&self) -> DatabaseResult<NativeBackupReceipt> {
        self.create_backup("safety")
    }

    pub fn list_native_backups(&self) -> DatabaseResult<Vec<String>> {
        Self::list_native_backups_at(&self.path)
    }

    pub fn list_native_backups_at(path: &Path) -> DatabaseResult<Vec<String>> {
        let directory = Self::backup_directory_at(path)?;
        std::fs::create_dir_all(&directory)?;
        let mut names = Vec::new();
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with("allocash-") && name.ends_with(".sqlite3") {
                    names.push(name);
                }
            }
        }
        names.sort();
        Ok(names)
    }

    pub fn restore_native_backup(&mut self, name: &str) -> DatabaseResult<NativeRestoreReceipt> {
        // Names, rather than paths supplied by the webview, confine restore to
        // the application's own backups folder and exclude symlinks.
        let candidate = Self::validated_backup_path(&self.path, name)?;
        let safety = self.create_backup("before-restore")?;
        let result = self.connection.restore(
            "main",
            &candidate.path,
            None::<fn(rusqlite::backup::Progress)>,
        );
        if result.is_ok() && Self::verify_connection(&self.connection).is_ok() {
            self.undo.clear();
            return Ok(NativeRestoreReceipt {
                safety_backup_path: safety.path,
            });
        }
        // SQLite's backup API rolls back an incomplete restore. Still restore
        // our verified snapshot explicitly before allowing another operation.
        if self
            .connection
            .restore("main", &safety.path, None::<fn(rusqlite::backup::Progress)>)
            .is_err()
            || Self::verify_connection(&self.connection).is_err()
        {
            return Err(format!(
                "Restore failed and automatic recovery could not be verified. The safety backup remains at {}. Stop using this budget until it is recovered.",
                safety.path
            ).into());
        }
        Err("Restore failed; the original budget was recovered from its safety backup.".into())
    }

    pub fn undo_status(&self) -> UndoStatus {
        self.undo.status()
    }

    pub fn undo_last_action(&mut self) -> Result<UndoStatus, String> {
        self.undo.undo(&mut self.connection)?;
        Ok(self.undo.status())
    }

    /// Run a mutation as one session-only undo step. The snapshot is captured
    /// through SQLite's backup API, which includes committed WAL contents.
    pub fn undoable<T>(
        &mut self,
        label: &str,
        operation: impl FnOnce(&mut Self) -> Result<T, String>,
    ) -> Result<T, String> {
        let before = self.undo.capture(&self.connection, label)?;
        let changes_before: i64 = self
            .connection
            .query_row("SELECT total_changes()", [], |row| row.get(0))
            .map_err(|_| "Could not prepare undo history.".to_owned())?;
        match operation(self) {
            Ok(value) => {
                let changes_after: i64 = self
                    .connection
                    .query_row("SELECT total_changes()", [], |row| row.get(0))
                    .map_err(|_| "Could not verify the saved change.".to_owned())?;
                if changes_after > changes_before {
                    self.undo.push(before);
                } else {
                    let _ = std::fs::remove_file(before.path);
                }
                Ok(value)
            }
            Err(error) => {
                let changes_after: i64 = self
                    .connection
                    .query_row("SELECT total_changes()", [], |row| row.get(0))
                    .unwrap_or(changes_before);
                if changes_after > changes_before {
                    if let Err(restore_error) = self
                        .undo
                        .restore_snapshot(&mut self.connection, &before.path)
                    {
                        let retained = self.undo.preserve_directory();
                        return Err(format!(
                            "{error}; rollback failed: {restore_error}. The pre-action snapshot was preserved in {}.",
                            retained.display()
                        ));
                    }
                }
                let _ = std::fs::remove_file(before.path);
                Err(error)
            }
        }
    }

    pub fn recover_unreadable_budget(
        path: &Path,
        name: &str,
    ) -> DatabaseResult<(Self, NativeRecoveryReceipt)> {
        if !std::fs::symlink_metadata(path)?.file_type().is_file() {
            return Err("The live budget is not a regular database file.".into());
        }
        let live = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let check: rusqlite::Result<String> =
            live.query_row("PRAGMA quick_check", [], |row| row.get(0));
        if matches!(check, Ok(ref result) if result == "ok") {
            let version: i64 = live.pragma_query_value(None, "user_version", |row| row.get(0))?;
            if version != SCHEMA_VERSION || Self::verify_connection(&live).is_ok() {
                return Err("The live database is valid or has a different schema version; recovery was not started.".into());
            }
        }
        drop(live);

        let candidate = Self::validated_backup_path(path, name)?;
        let parent = path.parent().ok_or("Database has no parent directory.")?;
        let pending = tempfile::Builder::new()
            .prefix("allocash-recovery-")
            .suffix(".partial")
            .tempfile_in(parent)?;
        let source = Connection::open_with_flags(
            &candidate.path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        source.backup("main", pending.path(), None)?;
        drop(source);
        let recovered_copy = Connection::open_with_flags(
            pending.path(),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        Self::verify_connection(&recovered_copy)?;
        drop(recovered_copy);
        pending.as_file().sync_all()?;

        let files = Self::database_files(path)?
            .into_iter()
            .filter_map(|file| match std::fs::symlink_metadata(&file) {
                Ok(metadata) if metadata.file_type().is_file() => Some(Ok(file)),
                Ok(_) => Some(Err("A live database sidecar is not a regular file.".into())),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => Some(Err(error.into())),
            })
            .collect::<DatabaseResult<Vec<_>>>()?;
        let archive = tempfile::Builder::new()
            .prefix("unreadable-budget-")
            .tempdir_in(Self::backup_directory_at(path)?)?
            .keep();
        let mut moved = Vec::new();
        for file in files {
            let saved = archive.join(file.file_name().ok_or("Invalid database file name.")?);
            if let Err(error) = std::fs::rename(&file, &saved) {
                Self::put_files_back(&moved)?;
                return Err(error.into());
            }
            moved.push((file, saved));
        }
        if let Err(error) = pending.persist_noclobber(path) {
            Self::put_files_back(&moved)?;
            return Err(error.into());
        }
        match Self::open(path) {
            Ok(database) => Ok((
                database,
                NativeRecoveryReceipt {
                    preserved_data_path: archive.to_string_lossy().into_owned(),
                },
            )),
            Err(error) => {
                // Retain the rejected replacement too, then put every original
                // file back. Never remove the only copy of damaged data.
                for file in Self::database_files(path)? {
                    if file.exists() {
                        let mut saved_name = std::ffi::OsString::from("rejected-");
                        saved_name.push(file.file_name().ok_or("Invalid database file name.")?);
                        std::fs::rename(&file, archive.join(saved_name))?;
                    }
                }
                Self::put_files_back(&moved)?;
                Err(format!("Recovery could not open the replacement; the original files were restored: {error}").into())
            }
        }
    }

    fn database_files(path: &Path) -> DatabaseResult<Vec<PathBuf>> {
        let name = path.file_name().ok_or("Invalid database file name.")?;
        Ok(["", "-wal", "-shm"]
            .iter()
            .map(|suffix| {
                let mut sidecar = name.to_os_string();
                sidecar.push(suffix);
                path.with_file_name(sidecar)
            })
            .collect())
    }

    fn put_files_back(moved: &[(PathBuf, PathBuf)]) -> DatabaseResult<()> {
        for (original, saved) in moved.iter().rev() {
            std::fs::rename(saved, original)?;
        }
        Ok(())
    }

    fn backup_directory_at(path: &Path) -> DatabaseResult<PathBuf> {
        Ok(path
            .parent()
            .ok_or("Database has no parent directory.")?
            .join("backups"))
    }

    fn validated_backup_path(path: &Path, name: &str) -> DatabaseResult<PreparedBackup> {
        if !name.starts_with("allocash-")
            || !name.ends_with(".sqlite3")
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
        {
            return Err("Invalid backup name.".into());
        }
        let backup_directory = Self::backup_directory_at(path)?;
        let directory_metadata = std::fs::symlink_metadata(&backup_directory)?;
        if !directory_metadata.is_dir() || directory_metadata.file_type().is_symlink() {
            return Err("The backups folder is not a regular directory.".into());
        }
        let candidate = backup_directory.join(name);
        if !std::fs::symlink_metadata(&candidate)?.file_type().is_file() {
            return Err("The selected backup is not a regular file.".into());
        }
        let version = Self::verify_supported_backup(&candidate)?;
        if version == SCHEMA_VERSION {
            Self::verify_connection(&Connection::open_with_flags(
                &candidate,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )?)?;
            return Ok(PreparedBackup {
                path: candidate,
                _temporary: None,
            });
        }

        // Upgrade only an isolated copy. The original backup remains untouched
        // and the migration mechanism verifies its own pre-upgrade snapshot.
        let temporary = tempfile::tempdir_in(&backup_directory)?;
        let upgraded_path = temporary.path().join("upgraded.sqlite3");
        let source =
            Connection::open_with_flags(&candidate, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        source.backup("main", &upgraded_path, None)?;
        drop(source);
        let mut upgraded = Connection::open(&upgraded_path)?;
        upgraded.pragma_update(None, "foreign_keys", "ON")?;
        migrations::initialize(&mut upgraded, Some(&upgraded_path))?;
        Self::verify_connection(&upgraded)?;
        drop(upgraded);
        Ok(PreparedBackup {
            path: upgraded_path,
            _temporary: Some(temporary),
        })
    }

    /// Performs source validation without a writable open, before any copy or
    /// migration can occur. Supported historical schemas are then upgraded on
    /// an isolated copy and subjected to exact-current validation.
    fn verify_supported_backup(path: &Path) -> DatabaseResult<i64> {
        let connection =
            Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let integrity: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if integrity != "ok" || !(1..=SCHEMA_VERSION).contains(&version) {
            return Err("The backup has invalid data or an unsupported schema version.".into());
        }
        if connection
            .prepare("PRAGMA foreign_key_check")?
            .query([])?
            .next()?
            .is_some()
        {
            return Err("The backup failed foreign key validation.".into());
        }
        let (count, currency): (i64, String) = connection.query_row(
            "SELECT COUNT(*), COALESCE(MAX(currency), '') FROM budget_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        if count != 1 || currency != "HUF" {
            return Err("The backup is not an Allocash HUF budget.".into());
        }
        Ok(version)
    }

    fn verify_connection(connection: &Connection) -> DatabaseResult<()> {
        let integrity: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if integrity != "ok" || version != SCHEMA_VERSION {
            return Err("The backup has invalid data or an unsupported schema version.".into());
        }
        if connection
            .prepare("PRAGMA foreign_key_check")?
            .query([])?
            .next()?
            .is_some()
        {
            return Err("The backup failed foreign key validation.".into());
        }
        // `user_version` alone cannot prove that a database still has the
        // tables its migration chain is expected to produce.
        for table in [
            "accounts",
            "budget_settings",
            "category_groups",
            "categories",
            "category_month_assignments",
            "category_month_moves",
            "category_target_revisions",
            "category_target_snoozes",
            "credit_payment_categories",
            "flags",
            "import_batches",
            "import_rows",
            "payees",
            "schedule_occurrences",
            "schedules",
            "transactions",
            "transfers",
        ] {
            let exists: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1)",
                [table],
                |row| row.get(0),
            )?;
            if !exists {
                return Err("The backup is missing required budget data.".into());
            }
        }
        for (table, column) in [
            ("category_target_revisions", "interval_months"),
            ("category_target_revisions", "first_due_month"),
            ("schedules", "interval_months"),
            ("schedules", "counterpart_account_id"),
        ] {
            let exists: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name=?2)",
                [table, column],
                |row| row.get(0),
            )?;
            if !exists {
                return Err("The backup is missing required budget data.".into());
            }
        }
        let (count, currency): (i64, String) = connection.query_row(
            "SELECT COUNT(*), COALESCE(MAX(currency), '') FROM budget_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        if count != 1 || currency != "HUF" {
            return Err("The backup is not an Allocash HUF budget.".into());
        }
        Ok(())
    }

    fn create_backup(&self, purpose: &str) -> DatabaseResult<NativeBackupReceipt> {
        let path = create_verified_backup(
            &self.path,
            &format!("allocash-{purpose}-v{SCHEMA_VERSION}-"),
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
    use crate::ledger::{
        Account, AccountKind, CalendarDate, Direction, Entry, Huf, MonthlyScheduleDraft,
        TransferDraft,
    };

    fn account(id: &str, kind: AccountKind, sort_order: i64) -> Account {
        Account {
            id: id.into(),
            name: id.into(),
            kind,
            sort_order,
            closed: false,
        }
    }

    fn date(text: &str) -> CalendarDate {
        CalendarDate::parse(text).unwrap()
    }

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
        assert_eq!(reopened.info().unwrap().schema_version, SCHEMA_VERSION);
        assert!(!reopened.undo_status().can_undo);
    }

    #[test]
    fn undo_restores_successful_actions_and_rolls_back_partial_failures() {
        let directory = tempfile::tempdir().unwrap();
        let mut database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database
            .undoable("Rename budget", |database| {
                database
                    .connection
                    .execute("UPDATE budget_settings SET name = 'Changed'", [])
                    .map_err(|error| error.to_string())?;
                Ok(())
            })
            .unwrap();
        assert_eq!(
            database.undo_status().label.as_deref(),
            Some("Rename budget")
        );
        assert_eq!(database.info().unwrap().name, "Changed");
        database.undo_last_action().unwrap();
        assert_eq!(database.info().unwrap().name, "My budget");
        assert!(!database.undo_status().can_undo);
        assert!(!database.undo_last_action().unwrap().can_undo);

        let result: Result<(), String> = database.undoable("Failed rename", |database| {
            database
                .connection
                .execute("UPDATE budget_settings SET name = 'Partial'", [])
                .map_err(|error| error.to_string())?;
            Err("simulated failure".to_owned())
        });
        assert_eq!(result.unwrap_err(), "simulated failure");
        assert_eq!(database.info().unwrap().name, "My budget");
        assert!(!database.undo_status().can_undo);

        database.undoable("No-op", |_| Ok(())).unwrap();
        assert!(!database.undo_status().can_undo);
    }

    #[test]
    fn restore_clears_session_undo_history() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let mut database = Database::open(&path).unwrap();
        let saved = database.create_native_backup().unwrap();
        database
            .undoable("Rename", |database| {
                database
                    .connection
                    .execute("UPDATE budget_settings SET name = 'Changed'", [])
                    .map_err(|error| error.to_string())?;
                Ok(())
            })
            .unwrap();
        let name = Path::new(&saved.path)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        database.restore_native_backup(&name).unwrap();
        assert!(!database.undo_status().can_undo);
        assert_eq!(database.info().unwrap().name, "My budget");
    }

    #[test]
    fn undo_handles_account_metadata_and_closed_state_across_multiple_steps() {
        let directory = tempfile::tempdir().unwrap();
        let mut database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
        database
            .create_account(&crate::ledger::Account {
                id: "cash".into(),
                name: "Cash".into(),
                kind: crate::ledger::AccountKind::Cash,
                sort_order: 0,
                closed: false,
            })
            .unwrap();
        database
            .undoable("Close account", |database| {
                database
                    .set_account_closed("cash", true)
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        database
            .undoable("Rename account", |database| {
                database
                    .connection
                    .execute("UPDATE accounts SET name = 'Renamed' WHERE id = 'cash'", [])
                    .map_err(|error| error.to_string())?;
                Ok(())
            })
            .unwrap();
        let current = database.accounts().unwrap();
        assert_eq!(current[0].name, "Renamed");
        assert!(current[0].closed);
        database.undo_last_action().unwrap();
        let after_rename = database.accounts().unwrap();
        assert_eq!(after_rename[0].name, "Cash");
        assert!(after_rename[0].closed);
        database.undo_last_action().unwrap();
        let after_close = database.accounts().unwrap();
        assert!(!after_close[0].closed);
        assert!(!database.undo_status().can_undo);
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
            .create_account(&account("cash", AccountKind::Cash, 0))
            .unwrap();
        database
            .create_transaction(
                &Entry::manual("preserve", "cash", date("2026-09-10")),
                Huf(-10),
            )
            .unwrap();
        database
            .connection
            .execute("UPDATE budget_settings SET name = 'Still live'", [])
            .unwrap();
        std::fs::write(directory.path().join("backups"), "not a directory").unwrap();

        assert!(database.create_native_backup().is_err());
        assert_eq!(database.info().unwrap().name, "Still live");
        assert_eq!(
            database
                .connection
                .query_row::<i64, _, _>("SELECT COUNT(*) FROM transactions", [], |row| row.get(0))
                .unwrap(),
            1
        );
        assert_eq!(
            std::fs::read(directory.path().join("backups")).unwrap(),
            b"not a directory"
        );
    }

    #[test]
    fn pre_delete_snapshot_preserves_an_entry_and_both_transfer_legs() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let mut database = Database::open(&path).unwrap();
        database
            .create_account(&account("cash", AccountKind::Cash, 0))
            .unwrap();
        database
            .create_account(&account("other", AccountKind::Cash, 1))
            .unwrap();
        database
            .create_transaction(
                &Entry::manual("ordinary", "cash", date("2026-09-10")),
                Huf(-10),
            )
            .unwrap();
        database
            .create_transfer(&TransferDraft::manual(
                "paired",
                Huf(20),
                Entry::manual("paired-out", "cash", date("2026-09-10")),
                Entry::manual("paired-in", "other", date("2026-09-10")),
                Direction::Outflow,
            ))
            .unwrap();

        let receipt = database.create_safety_backup().unwrap();
        assert!(receipt.path.contains("allocash-safety-v"));
        database.delete_entry("ordinary", false).unwrap();
        database.delete_entry("paired-out", false).unwrap();

        let backup = Connection::open(receipt.path).unwrap();
        assert_eq!(
            backup
                .query_row::<i64, _, _>("SELECT COUNT(*) FROM transactions", [], |row| row.get(0))
                .unwrap(),
            3
        );
        assert_eq!(
            database
                .connection
                .query_row::<i64, _, _>("SELECT COUNT(*) FROM transactions", [], |row| row.get(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn pre_deactivation_snapshot_preserves_the_active_schedule_and_pending_entry() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let mut database = Database::open(&path).unwrap();
        database
            .create_account(&account("cash", AccountKind::Cash, 0))
            .unwrap();
        database
            .create_monthly_schedule(&MonthlyScheduleDraft {
                account_id: "cash".into(),
                counterpart_account_id: None,
                start_date: date("2026-09-10"),
                day_of_month: None,
                end_date: None,
                interval_months: 1,
                payee_name: Some("Rent".into()),
                category_id: None,
                memo: "September".into(),
                flag_id: None,
                amount: Huf(-100),
            })
            .unwrap();
        let occurrence = database.scheduled_occurrences().unwrap().remove(0);

        let receipt = database.create_safety_backup().unwrap();
        database
            .deactivate_schedule(&occurrence.schedule_id)
            .unwrap();

        let backup = Connection::open(receipt.path).unwrap();
        assert_eq!(
            backup
                .query_row::<i64, _, _>("SELECT active FROM schedules", [], |row| row.get(0))
                .unwrap(),
            1
        );
        assert_eq!(
            backup
                .query_row::<i64, _, _>(
                    "SELECT COUNT(*) FROM transactions WHERE posting_state='scheduled'",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
            1
        );
        assert!(database.scheduled_occurrences().unwrap().is_empty());
    }

    #[test]
    fn restores_a_verified_backup_and_preserves_the_replaced_budget() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let mut database = Database::open(&path).unwrap();
        database
            .connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        database
            .connection
            .execute("UPDATE budget_settings SET name = 'Saved state'", [])
            .unwrap();
        let saved = database.create_native_backup().unwrap();
        database
            .connection
            .execute("UPDATE budget_settings SET name = 'Current state'", [])
            .unwrap();
        let name = Path::new(&saved.path)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();

        let receipt = database.restore_native_backup(name).unwrap();
        assert_eq!(database.info().unwrap().name, "Saved state");
        let safety = Connection::open(&receipt.safety_backup_path).unwrap();
        assert_eq!(
            safety
                .query_row::<String, _, _>("SELECT name FROM budget_settings", [], |row| row.get(0))
                .unwrap(),
            "Current state"
        );
        drop(database);
        assert_eq!(
            Database::open(&path).unwrap().info().unwrap().name,
            "Saved state"
        );
    }

    #[test]
    fn rejects_invalid_restore_sources_without_touching_the_budget() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let mut database = Database::open(&path).unwrap();
        database
            .connection
            .execute("UPDATE budget_settings SET name = 'Keep me'", [])
            .unwrap();
        let backups = directory.path().join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        std::fs::write(backups.join("allocash-invalid.sqlite3"), b"not sqlite").unwrap();
        assert!(database
            .restore_native_backup("allocash-invalid.sqlite3")
            .is_err());
        assert!(database.restore_native_backup("../budget.sqlite3").is_err());
        assert_eq!(database.info().unwrap().name, "Keep me");
        assert_eq!(
            database.list_native_backups().unwrap(),
            vec!["allocash-invalid.sqlite3"]
        );
        assert_eq!(std::fs::read_dir(backups).unwrap().count(), 1);
    }

    #[test]
    fn recovers_an_unreadable_budget_and_preserves_its_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let database = Database::open(&path).unwrap();
        database
            .connection
            .execute("UPDATE budget_settings SET name = 'Known good'", [])
            .unwrap();
        let saved = database.create_native_backup().unwrap();
        drop(database);
        std::fs::write(&path, b"unreadable live database").unwrap();
        let wal = directory.path().join("budget.sqlite3-wal");
        std::fs::write(&wal, b"preserve the WAL too").unwrap();
        assert!(Database::open(&path).is_err());
        let name = Path::new(&saved.path)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();

        let (recovered, receipt) = Database::recover_unreadable_budget(&path, name).unwrap();
        assert_eq!(recovered.info().unwrap().name, "Known good");
        let archive = Path::new(&receipt.preserved_data_path);
        assert_eq!(
            std::fs::read(archive.join("budget.sqlite3")).unwrap(),
            b"unreadable live database"
        );
        assert_eq!(
            std::fs::read(archive.join("budget.sqlite3-wal")).unwrap(),
            b"preserve the WAL too"
        );
        assert!(Path::new(&saved.path).is_file());
        drop(recovered);
        assert_eq!(
            Database::open(&path).unwrap().info().unwrap().name,
            "Known good"
        );
    }

    #[test]
    fn recovery_refuses_healthy_live_data_and_invalid_backups() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let database = Database::open(&path).unwrap();
        let saved = database.create_native_backup().unwrap();
        drop(database);
        let name = Path::new(&saved.path)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();
        assert!(Database::recover_unreadable_budget(&path, name).is_err());
        assert_eq!(
            Database::open(&path).unwrap().info().unwrap().currency,
            "HUF"
        );
        std::fs::write(&path, b"damaged live data").unwrap();
        assert!(Database::recover_unreadable_budget(&path, "../budget.sqlite3").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"damaged live data");
        assert_eq!(
            std::fs::read_dir(directory.path().join("backups"))
                .unwrap()
                .count(),
            1
        );
    }

    #[test]
    fn recovers_a_structurally_broken_current_schema() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let database = Database::open(&path).unwrap();
        let saved = database.create_native_backup().unwrap();
        drop(database);
        let broken = Connection::open(&path).unwrap();
        broken.execute("DROP TABLE budget_settings", []).unwrap();
        drop(broken);
        assert!(Database::open(&path).is_err());
        let name = Path::new(&saved.path)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();

        let (recovered, receipt) = Database::recover_unreadable_budget(&path, name).unwrap();
        assert_eq!(recovered.info().unwrap().currency, "HUF");
        let archived =
            Connection::open(Path::new(&receipt.preserved_data_path).join("budget.sqlite3"))
                .unwrap();
        assert!(archived.prepare("SELECT * FROM budget_settings").is_err());
    }
}
