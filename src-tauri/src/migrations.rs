use crate::{backup::create_verified_backup, database::DatabaseResult};
use rusqlite::{Connection, TransactionBehavior};
use std::path::Path;

const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/0001_budget.sql"),
    include_str!("../migrations/0002_ledger.sql"),
    include_str!("../migrations/0003_monthly_plan.sql"),
    include_str!("../migrations/0004_category_moves.sql"),
    include_str!("../migrations/0005_credit_payment_categories.sql"),
    include_str!("../migrations/0006_category_targets.sql"),
    include_str!("../migrations/0007_category_target_snoozes.sql"),
    include_str!("../migrations/0008_monthly_schedules.sql"),
    include_str!("../migrations/0009_periodic_targets.sql"),
    include_str!("../migrations/0010_periodic_schedules.sql"),
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
    create_verified_backup(path, &format!("before-v{version}-to-v{target}-"), version)?;
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

    fn version_eight_with_history(path: &Path) -> Connection {
        let mut connection = Connection::open(path).unwrap();
        apply(&mut connection, None, &MIGRATIONS[..8]).unwrap();
        connection.execute_batch(
            "INSERT INTO accounts (id,name,kind) VALUES ('cash','Cash','cash');
             INSERT INTO category_groups (id,name) VALUES ('group','Living');
             INSERT INTO categories (id,group_id,name) VALUES ('rent','group','Rent');
             INSERT INTO transactions (id,account_id,transaction_date,category_id,amount_huf)
                VALUES ('ledger','cash','2026-01-02','rent',-50000);
             INSERT INTO category_target_revisions
                (id,category_id,effective_month,active,behavior,amount_huf,due_kind,due_day)
                VALUES ('target','rent','2026-01',1,'set_aside',50000,'day',5);
             INSERT INTO category_target_snoozes (category_id,month) VALUES ('rent','2026-02');
             INSERT INTO schedules
                (id,account_id,category_id,amount_huf,start_date,day_of_month)
                VALUES ('schedule','cash','rent',-75000,'2026-01-03',3);
             INSERT INTO transactions
                (id,account_id,transaction_date,category_id,amount_huf,cleared_state,posting_state,origin,scheduled_origin_id)
                VALUES ('scheduled-entry','cash','2026-02-03','rent',-75000,'uncleared','scheduled','schedule','schedule');
             INSERT INTO schedule_occurrences (schedule_id,occurrence_date,transaction_id,state)
                VALUES ('schedule','2026-02-03','scheduled-entry','pending');",
        ).unwrap();
        connection
    }

    #[test]
    fn upgrades_with_a_restorable_backup_and_does_not_repeat_it() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        drop(version_one(&path));
        let database = Database::open(&path).unwrap();
        assert_eq!(database.info().unwrap().name, "Preserve me");
        assert_eq!(database.info().unwrap().schema_version, SCHEMA_VERSION);
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

    #[test]
    fn upgrades_a_v8_budget_with_targets_snoozes_schedules_and_ledger_intact() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        drop(version_eight_with_history(&path));

        let database = Database::open(&path).unwrap();
        assert_eq!(database.info().unwrap().schema_version, SCHEMA_VERSION);
        let connection = &database.connection;
        assert_eq!(
            connection
                .query_row::<i64, _, _>(
                    "SELECT amount_huf FROM transactions WHERE id='ledger'",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
            -50000
        );
        assert_eq!(
            connection
                .query_row::<i64, _, _>(
                    "SELECT COUNT(*) FROM category_target_revisions WHERE id='target'",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection.query_row::<(i64, Option<String>), _, _>(
                "SELECT interval_months, first_due_month FROM category_target_revisions WHERE id='target'", [], |row| Ok((row.get(0)?, row.get(1)?))
            ).unwrap(),
            (1, None)
        );
        assert_eq!(
            connection.query_row::<i64, _, _>(
                "SELECT COUNT(*) FROM category_target_snoozes WHERE category_id='rent' AND month='2026-02'", [], |row| row.get(0)
            ).unwrap(),
            1
        );
        assert_eq!(
            connection.query_row::<i64, _, _>(
                "SELECT COUNT(*) FROM schedule_occurrences WHERE schedule_id='schedule' AND state='pending'", [], |row| row.get(0)
            ).unwrap(),
            1
        );
        assert_eq!(
            connection.query_row::<(i64, Option<String>), _, _>(
                "SELECT interval_months, counterpart_account_id FROM schedules WHERE id='schedule'", [], |row| Ok((row.get(0)?, row.get(1)?))
            ).unwrap(),
            (1, None)
        );
        assert_eq!(
            connection
                .query_row::<i64, _, _>(
                    "SELECT COUNT(*) FROM transactions WHERE id='scheduled-entry'",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
            1
        );

        let snapshots: Vec<_> = std::fs::read_dir(directory.path().join("backups"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(snapshots.len(), 1);
        let saved = Connection::open(&snapshots[0]).unwrap();
        assert_eq!(
            saved
                .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            8
        );
        assert_eq!(
            saved
                .query_row::<String, _, _>("PRAGMA quick_check", [], |row| row.get(0))
                .unwrap(),
            "ok"
        );
        assert!(saved
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none());
        assert!(saved
            .prepare("SELECT interval_months FROM category_target_revisions")
            .is_err());
    }

    #[test]
    fn restores_a_supported_v8_backup_from_an_upgraded_copy_and_keeps_original_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let legacy = directory.path().join("legacy.sqlite3");
        drop(version_eight_with_history(&legacy));
        let legacy_bytes = std::fs::read(&legacy).unwrap();

        let live_path = directory.path().join("budget.sqlite3");
        let mut live = Database::open(&live_path).unwrap();
        live.connection
            .execute("UPDATE budget_settings SET name='Current budget'", [])
            .unwrap();
        let backups = directory.path().join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        let backup_path = backups.join("allocash-v8.sqlite3");
        std::fs::copy(&legacy, &backup_path).unwrap();

        live.restore_native_backup("allocash-v8.sqlite3").unwrap();
        assert_eq!(live.info().unwrap().name, "My budget");
        assert_eq!(
            live.connection
                .query_row::<i64, _, _>(
                    "SELECT amount_huf FROM transactions WHERE id='ledger'",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
            -50000
        );
        assert_eq!(
            live.connection
                .query_row::<i64, _, _>(
                    "SELECT interval_months FROM category_target_revisions WHERE id='target'",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
            1
        );
        assert_eq!(
            live.connection
                .query_row::<i64, _, _>(
                    "SELECT interval_months FROM schedules WHERE id='schedule'",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
            1
        );
        assert_eq!(std::fs::read(&backup_path).unwrap(), legacy_bytes);
    }

    #[test]
    fn restore_rejects_future_schema_without_creating_a_safety_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let mut live = Database::open(&path).unwrap();
        live.connection
            .execute("UPDATE budget_settings SET name='Keep live'", [])
            .unwrap();
        let backups = directory.path().join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        let future = backups.join("allocash-future.sqlite3");
        let backup = Connection::open(&future).unwrap();
        backup.execute_batch(MIGRATIONS[0]).unwrap();
        backup
            .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        drop(backup);
        let count_before = std::fs::read_dir(&backups).unwrap().count();

        assert!(live
            .restore_native_backup("allocash-future.sqlite3")
            .is_err());
        assert_eq!(live.info().unwrap().name, "Keep live");
        assert_eq!(std::fs::read_dir(&backups).unwrap().count(), count_before);
    }

    #[test]
    fn recovery_accepts_a_supported_v8_backup_and_preserves_both_sources() {
        let directory = tempfile::tempdir().unwrap();
        let legacy = directory.path().join("legacy.sqlite3");
        drop(version_eight_with_history(&legacy));
        let legacy_bytes = std::fs::read(&legacy).unwrap();
        let path = directory.path().join("budget.sqlite3");
        std::fs::write(&path, b"unreadable live database").unwrap();
        let backups = directory.path().join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        let backup_path = backups.join("allocash-v8.sqlite3");
        std::fs::copy(&legacy, &backup_path).unwrap();

        let (recovered, receipt) =
            Database::recover_unreadable_budget(&path, "allocash-v8.sqlite3").unwrap();
        assert_eq!(recovered.info().unwrap().schema_version, SCHEMA_VERSION);
        assert_eq!(
            recovered
                .connection
                .query_row::<i64, _, _>(
                    "SELECT amount_huf FROM transactions WHERE id='ledger'",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
            -50000
        );
        assert_eq!(std::fs::read(&backup_path).unwrap(), legacy_bytes);
        let preserved = Path::new(&receipt.preserved_data_path).join("budget.sqlite3");
        assert_eq!(
            std::fs::read(preserved).unwrap(),
            b"unreadable live database"
        );
    }

    #[test]
    fn native_backup_round_trip_preserves_periodic_targets_and_transfer_schedules() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("budget.sqlite3");
        let mut database = Database::open(&path).unwrap();
        database.connection.execute_batch(
            "INSERT INTO accounts (id,name,kind) VALUES ('cash','Cash','cash'),('savings','Savings','cash');
             INSERT INTO category_groups (id,name) VALUES ('group','Living');
             INSERT INTO categories (id,group_id,name) VALUES ('rent','group','Rent');
             INSERT INTO category_target_revisions
                (id,category_id,effective_month,active,behavior,amount_huf,due_kind,due_day,interval_months,first_due_month)
                VALUES ('target','rent','2026-01',1,'set_aside',50000,'day',5,3,'2026-04');
             INSERT INTO schedules
                (id,account_id,counterpart_account_id,category_id,amount_huf,start_date,day_of_month,interval_months)
                VALUES ('schedule','cash','savings','rent',-75000,'2026-01-03',3,12);",
        ).unwrap();
        let saved = database.create_native_backup().unwrap();
        database
            .connection
            .execute_batch(
                "UPDATE category_target_revisions SET interval_months=1, first_due_month=NULL;
             UPDATE schedules SET interval_months=1, counterpart_account_id=NULL;",
            )
            .unwrap();
        let name = Path::new(&saved.path)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();
        database.restore_native_backup(name).unwrap();
        assert_eq!(database.connection.query_row::<(i64, Option<String>), _, _>(
            "SELECT interval_months, first_due_month FROM category_target_revisions WHERE id='target'", [], |row| Ok((row.get(0)?, row.get(1)?))
        ).unwrap(), (3, Some("2026-04".into())));
        assert_eq!(database.connection.query_row::<(i64, Option<String>), _, _>(
            "SELECT interval_months, counterpart_account_id FROM schedules WHERE id='schedule'", [], |row| Ok((row.get(0)?, row.get(1)?))
        ).unwrap(), (12, Some("savings".into())));
    }
}
