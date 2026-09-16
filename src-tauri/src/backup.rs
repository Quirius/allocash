use crate::database::DatabaseResult;
use rusqlite::{Connection, OpenFlags};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

/// Creates a verified, self-contained SQLite copy beside the live database.
///
/// The random file name and `persist_noclobber` guarantee that an existing
/// owner backup is never replaced. The copy is deliberately kept in the data
/// directory; callers must not put private financial data in a webview-chosen
/// location.
pub(crate) fn create_verified_backup(
    path: &Path,
    prefix: &str,
    expected_schema_version: i64,
) -> DatabaseResult<PathBuf> {
    let directory = path
        .parent()
        .ok_or("Database has no parent directory.")?
        .join("backups");
    std::fs::create_dir_all(&directory)?;
    let pending = tempfile::Builder::new()
        .prefix(prefix)
        .suffix(".partial")
        .tempfile_in(&directory)?;

    // A separate read-only connection takes an online SQLite snapshot, so a
    // WAL database includes committed changes without copying its WAL file.
    let source = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    source.busy_timeout(Duration::from_secs(5))?;
    source.backup("main", pending.path(), None)?;
    let backup = Connection::open(pending.path())?;
    // Ensure the saved file can be opened on its own rather than depending on
    // a sibling WAL file.
    backup.pragma_update(None, "journal_mode", "DELETE")?;
    let integrity: String = backup.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    let saved_version: i64 = backup.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if integrity != "ok" || saved_version != expected_schema_version {
        return Err("Backup could not be verified.".into());
    }
    if backup
        .prepare("PRAGMA foreign_key_check")?
        .query([])?
        .next()?
        .is_some()
    {
        return Err("Backup failed foreign key validation.".into());
    }
    drop(backup);
    pending.as_file().sync_all()?;
    let destination = pending.path().with_extension("sqlite3");
    pending.persist_noclobber(&destination)?;
    Ok(destination)
}
