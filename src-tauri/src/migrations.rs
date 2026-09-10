use crate::database::DatabaseResult;
use rusqlite::{Connection, OpenFlags, TransactionBehavior};
use std::{path::Path, time::Duration};

const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/0001_budget.sql"),
    include_str!("../migrations/0002_ledger.sql"),
];
pub(crate) const SCHEMA_VERSION: i64 = MIGRATIONS.len() as i64;

pub(crate) fn initialize(connection: &mut Connection, path: Option<&Path>) -> DatabaseResult<()> {
    apply(connection, path, MIGRATIONS)
}

fn apply(connection: &mut Connection, path: Option<&Path>, scripts: &[&str]) -> DatabaseResult<()> {
    // Acquire the write reservation before the version check and hold it through
    // backup + migration, preventing another process from writing between them.
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version: i64 = transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let target = scripts.len() as i64;
    if version < 0 || version > target {
        return Err("Unsupported schema version; the database was not changed.".into());
    }
    if version == target {
        transaction.commit()?;
        return Ok(());
    }
    if version == 0 {
        let objects: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
            [],
            |row| row.get(0),
        )?;
        if objects != 0 {
            return Err("Refusing to initialize an unversioned database containing data.".into());
        }
    } else {
        let path =
            path.ok_or("An existing database must have a backup location before migration.")?;
        verified_backup(path, version, target)?;
    }
    for (index, sql) in scripts.iter().enumerate().skip(version as usize) {
        transaction.execute_batch(sql)?;
        transaction.pragma_update(None, "user_version", index as i64 + 1)?;
    }
    if transaction
        .prepare("PRAGMA foreign_key_check")?
        .query([])?
        .next()?
        .is_some()
    {
        return Err("Migration failed foreign key validation.".into());
    }
    transaction.commit()?;
    Ok(())
}

fn verified_backup(path: &Path, version: i64, target: i64) -> DatabaseResult<()> {
    let directory = path
        .parent()
        .ok_or("Database has no parent directory.")?
        .join("backups");
    std::fs::create_dir_all(&directory)?;
    let pending = tempfile::Builder::new()
        .prefix(&format!("before-v{version}-to-v{target}-"))
        .suffix(".partial")
        .tempfile_in(directory)?;
    // SQLite backup cannot read from the connection holding a write transaction.
    // A separate read-only connection sees the committed state protected by it.
    let source = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    source.busy_timeout(Duration::from_secs(5))?;
    source.backup("main", pending.path(), None)?;
    let backup = Connection::open(pending.path())?;
    // A source in WAL mode can produce a WAL-mode destination. Checkpoint it and
    // switch to DELETE so the saved backup is one self-contained database file.
    backup.pragma_update(None, "journal_mode", "DELETE")?;
    let integrity: String = backup.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    let saved_version: i64 = backup.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if integrity != "ok" || saved_version != version {
        return Err("Pre-migration backup could not be verified.".into());
    }
    if backup
        .prepare("PRAGMA foreign_key_check")?
        .query([])?
        .next()?
        .is_some()
    {
        return Err("Existing database failed foreign key validation.".into());
    }
    drop(backup);
    pending.as_file().sync_all()?;
    let destination = pending.path().with_extension("sqlite3");
    pending.persist_noclobber(destination)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;

    fn version_one(path: &Path) -> Connection {
        let connection = Connection::open(path).unwrap();
        connection.execute_batch(MIGRATIONS[0]).unwrap();
        connection.pragma_update(None, "user_version", 1).unwrap();
        connection
            .execute("UPDATE budget_settings SET name = 'Preserve me'", [])
            .unwrap();
        connection
    }

    #[test]
    fn upgrades_with_a_restorable_backup_and_does_not_repeat_it() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        drop(version_one(&path));
        let database = Database::open(&path).unwrap();
        assert_eq!(database.info().unwrap().name, "Preserve me");
        assert_eq!(database.info().unwrap().schema_version, 2);
        let backups: Vec<_> = std::fs::read_dir(directory.path().join("backups"))
            .unwrap()
            .collect();
        assert_eq!(backups.len(), 1);
        let backup = Connection::open(backups[0].as_ref().unwrap().path()).unwrap();
        assert_eq!(
            backup
                .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            1
        );
        assert_eq!(
            backup
                .query_row::<String, _, _>("SELECT name FROM budget_settings", [], |row| row.get(0))
                .unwrap(),
            "Preserve me"
        );
        assert!(backup.prepare("SELECT * FROM accounts").is_err());
        drop(database);
        Database::open(&path).unwrap();
        assert_eq!(
            std::fs::read_dir(directory.path().join("backups"))
                .unwrap()
                .count(),
            1
        );
    }

    #[test]
    fn backup_failure_prevents_any_upgrade() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let mut connection = version_one(&path);
        std::fs::write(directory.path().join("backups"), "not a directory").unwrap();
        assert!(initialize(&mut connection, Some(&path)).is_err());
        assert_eq!(
            connection
                .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            1
        );
        assert!(connection.prepare("SELECT * FROM accounts").is_err());
        assert!(connection.is_autocommit());
    }

    #[test]
    fn failed_migration_rolls_back_schema_version_and_preserves_backup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let mut connection = version_one(&path);
        let scripts = [
            MIGRATIONS[0],
            "CREATE TABLE temporary_test (id INTEGER); INVALID SQL;",
        ];
        assert!(apply(&mut connection, Some(&path), &scripts).is_err());
        assert!(connection.prepare("SELECT * FROM temporary_test").is_err());
        assert_eq!(
            connection
                .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            1
        );
        assert_eq!(
            std::fs::read_dir(directory.path().join("backups"))
                .unwrap()
                .count(),
            1
        );
        assert!(connection.is_autocommit());
    }

    #[test]
    fn backup_includes_committed_wal_data() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let mut connection = version_one(&path);
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        connection
            .execute("UPDATE budget_settings SET name = 'WAL value'", [])
            .unwrap();
        initialize(&mut connection, Some(&path)).unwrap();
        let saved = std::fs::read_dir(directory.path().join("backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let backup = Connection::open(saved).unwrap();
        assert_eq!(
            backup
                .query_row::<String, _, _>("SELECT name FROM budget_settings", [], |row| row.get(0))
                .unwrap(),
            "WAL value"
        );
    }
}
