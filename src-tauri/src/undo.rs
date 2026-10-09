use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use tempfile::TempDir;

const MAX_UNDO_STEPS: usize = 30;

pub struct UndoSnapshot {
    pub path: PathBuf,
    label: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoStatus {
    pub can_undo: bool,
    pub label: Option<String>,
}

pub struct UndoHistory {
    _directory: Option<TempDir>,
    snapshots: Vec<UndoSnapshot>,
    next_id: u64,
}

impl UndoHistory {
    pub fn new() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Ok(Self {
            _directory: Some(
                tempfile::Builder::new()
                    .prefix("allocash-undo-")
                    .tempdir()?,
            ),
            snapshots: Vec::new(),
            next_id: 0,
        })
    }

    pub fn status(&self) -> UndoStatus {
        UndoStatus {
            can_undo: !self.snapshots.is_empty(),
            label: self.snapshots.last().map(|snapshot| snapshot.label.clone()),
        }
    }

    pub fn capture(
        &mut self,
        connection: &Connection,
        label: &str,
    ) -> Result<UndoSnapshot, String> {
        self.next_id += 1;
        let directory = self
            ._directory
            .as_ref()
            .ok_or_else(|| "Undo history is unavailable after a failed recovery.".to_owned())?;
        let path = directory.path().join(format!("{}.sqlite3", self.next_id));
        connection
            .backup("main", &path, None::<fn(rusqlite::backup::Progress)>)
            .map_err(|_| "Could not create an undo snapshot.".to_owned())?;
        verify_snapshot(&path)?;
        let snapshot = UndoSnapshot {
            path,
            label: label.to_owned(),
        };
        Ok(snapshot)
    }

    pub fn push(&mut self, snapshot: UndoSnapshot) {
        self.snapshots.push(snapshot);
        while self.snapshots.len() > MAX_UNDO_STEPS {
            let expired = self.snapshots.remove(0);
            let _ = std::fs::remove_file(expired.path);
        }
    }

    pub fn clear(&mut self) {
        for snapshot in self.snapshots.drain(..) {
            let _ = std::fs::remove_file(snapshot.path);
        }
    }

    pub fn preserve_directory(&mut self) -> PathBuf {
        self._directory
            .take()
            .map(TempDir::keep)
            .unwrap_or_default()
    }

    pub fn undo(&mut self, connection: &mut Connection) -> Result<(), String> {
        let Some(snapshot) = self.snapshots.last() else {
            return Ok(());
        };
        restore_verified(connection, &snapshot.path)?;
        let snapshot = self.snapshots.pop().expect("snapshot was checked above");
        let _ = std::fs::remove_file(snapshot.path);
        Ok(())
    }

    pub fn restore_snapshot(
        &self,
        connection: &mut Connection,
        path: &std::path::Path,
    ) -> Result<(), String> {
        restore_verified(connection, path)
    }
}

fn verify_snapshot(path: &std::path::Path) -> Result<(), String> {
    let connection = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "The undo snapshot could not be opened.".to_owned())?;
    let integrity: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|_| "The undo snapshot failed integrity validation.".to_owned())?;
    if integrity != "ok" {
        return Err("The undo snapshot failed integrity validation.".to_owned());
    }
    let foreign_key_failure: bool = connection
        .prepare("PRAGMA foreign_key_check")
        .and_then(|mut statement| statement.exists([]))
        .map_err(|_| "The undo snapshot failed integrity validation.".to_owned())?;
    if foreign_key_failure {
        return Err("The undo snapshot failed integrity validation.".to_owned());
    }
    Ok(())
}

fn restore_verified(connection: &mut Connection, source: &std::path::Path) -> Result<(), String> {
    verify_snapshot(source)?;
    let safety = tempfile::Builder::new()
        .prefix("allocash-undo-recovery-")
        .tempfile()
        .map_err(|_| "Could not protect the current budget during undo.".to_owned())?;
    connection
        .backup(
            "main",
            safety.path(),
            None::<fn(rusqlite::backup::Progress)>,
        )
        .map_err(|_| "Could not protect the current budget during undo.".to_owned())?;
    let restored = connection.restore("main", source, None::<fn(rusqlite::backup::Progress)>);
    if restored.is_ok() && connection_integrity(connection) {
        return Ok(());
    }
    if connection
        .restore(
            "main",
            safety.path(),
            None::<fn(rusqlite::backup::Progress)>,
        )
        .is_err()
        || !connection_integrity(connection)
    {
        let recovery_path = safety
            .keep()
            .map(|(_, path)| path)
            .map_err(|_| "Undo failed; current data could not be verified and the safety copy could not be retained.".to_owned())?;
        return Err(
            format!("Undo failed and the current budget could not be verified; stop using this budget. A recovery copy was preserved at {}.", recovery_path.display()),
        );
    }
    Err("Undo failed; the current budget was recovered.".to_owned())
}

fn connection_integrity(connection: &Connection) -> bool {
    connection
        .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        .is_ok_and(|result| result == "ok")
        && connection
            .prepare("PRAGMA foreign_key_check")
            .and_then(|mut statement| statement.exists([]))
            .is_ok_and(|has_failure| !has_failure)
}

#[cfg(test)]
mod tests {
    use super::UndoHistory;
    use rusqlite::Connection;

    #[test]
    fn corrupt_snapshot_leaves_live_database_and_undo_history_intact() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE values_table (value TEXT); INSERT INTO values_table VALUES ('current');").unwrap();
        let mut history = UndoHistory::new().unwrap();
        let snapshot = history.capture(&connection, "Change value").unwrap();
        history.push(snapshot);
        let snapshot_path = history.snapshots.last().unwrap().path.clone();
        std::fs::write(&snapshot_path, b"damaged snapshot").unwrap();

        let error = history.undo(&mut connection).unwrap_err();
        assert!(error.contains("snapshot"));
        let value: String = connection
            .query_row("SELECT value FROM values_table", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "current");
        assert_eq!(history.status().label.as_deref(), Some("Change value"));
    }
}
