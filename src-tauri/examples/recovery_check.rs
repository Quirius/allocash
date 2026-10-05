//! Disposable, synthetic rehearsal for unreadable database recovery.
//!
//! Usage:
//!   cargo run --no-default-features --example recovery_check -- prepare <new-target-directory>
//!   cargo run --no-default-features --example recovery_check -- verify <target-directory>
//!
//! `prepare` refuses an existing target and creates only synthetic data there.
//! Run `verify` later, after recovering through the desktop app.

use allocash_lib::{
    database::Database,
    ledger::{Account, AccountKind, CalendarDate, Entry, Huf},
};
use std::{
    env,
    error::Error,
    fs, io,
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, Box<dyn Error + Send + Sync>>;

const DATABASE_NAME: &str = "budget.sqlite3";
const ACCOUNT_ID: &str = "recovery-fixture-account";
const TRANSACTION_ID: &str = "recovery-fixture-inflow";
const EXPECTED_BALANCE: i64 = 12_345;
const AS_OF: &str = "2026-10-05";
const LIVE_BYTES: &[u8] = b"synthetic unreadable Allocash database fixture\n";
const WAL_BYTES: &[u8] = b"synthetic WAL sidecar fixture; not real SQLite data\n";

fn main() {
    if let Err(error) = run() {
        eprintln!("recovery_check: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let mut args = env::args_os().skip(1);
    let command = args
        .next()
        .and_then(|value| value.into_string().ok())
        .ok_or("Usage: recovery_check <prepare|verify> <target-directory>")?;
    let target = args
        .next()
        .map(PathBuf::from)
        .ok_or("An explicit target directory is required.")?;
    if args.next().is_some() {
        return Err("Unexpected extra arguments.".into());
    }

    match command.as_str() {
        "prepare" => prepare(&target),
        "verify" => verify(&target),
        _ => Err("Command must be `prepare` or `verify`.".into()),
    }
}

fn prepare(target: &Path) -> Result<()> {
    match fs::symlink_metadata(target) {
        Ok(_) => {
            return Err(format!("Refusing to use existing target: {}", target.display()).into());
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    fs::create_dir(target)?;
    let database_path = target.join(DATABASE_NAME);
    let database = Database::open(&database_path)?;
    database.create_account(&Account {
        id: ACCOUNT_ID.to_owned(),
        name: "Synthetic recovery fixture account".to_owned(),
        kind: AccountKind::Cash,
        sort_order: 0,
        closed: false,
    })?;
    database.create_transaction(
        &Entry::manual(TRANSACTION_ID, ACCOUNT_ID, CalendarDate::parse(AS_OF)?),
        Huf(EXPECTED_BALANCE),
    )?;
    let backup_path = PathBuf::from(database.create_native_backup()?.path);
    drop(database);

    // Keep byte-for-byte reference copies outside the backups folder. Recovery
    // must preserve the selected backup and archive both unreadable sidecars.
    fs::copy(&backup_path, target.join("expected-backup.sqlite3"))?;
    fs::write(target.join("expected-live.bytes"), LIVE_BYTES)?;
    fs::write(target.join("expected-wal.bytes"), WAL_BYTES)?;
    fs::write(&database_path, LIVE_BYTES)?;
    fs::write(sidecar_path(&database_path, "-wal"), WAL_BYTES)?;

    println!(
        "Prepared synthetic recovery fixture at {}",
        target.display()
    );
    println!("Database: {}", database_path.display());
    println!("Backup: {}", backup_path.display());
    println!("Next: run verify against this target after recovering from that backup.");
    Ok(())
}

fn verify(target: &Path) -> Result<()> {
    let database_path = target.join(DATABASE_NAME);
    if !fs::symlink_metadata(&database_path)?.file_type().is_file() {
        return Err("The recovered database must exist as a regular file.".into());
    }
    let backup_path = only_backup(&target.join("backups"))?;
    let expected_backup = fs::read(target.join("expected-backup.sqlite3"))?;
    if fs::read(&backup_path)? != expected_backup {
        return Err("The selected backup changed from its prepared bytes.".into());
    }

    // The desktop recovery flow has already replaced the live database. Opening
    // it here validates the normal startup path without performing recovery.
    let recovered = Database::open(&database_path)?;
    let balance = recovered.account_balance(ACCOUNT_ID, &CalendarDate::parse(AS_OF)?)?;
    if balance.working != Huf(EXPECTED_BALANCE) {
        return Err(format!(
            "Recovered balance was {}, expected {}.",
            balance.working.0, EXPECTED_BALANCE
        )
        .into());
    }
    drop(recovered);

    let archive = only_preserved_archive(&target.join("backups"))?;
    if fs::read(archive.join(DATABASE_NAME))? != fs::read(target.join("expected-live.bytes"))? {
        return Err("The unreadable database bytes were not preserved exactly.".into());
    }
    if fs::read(archive.join(format!("{DATABASE_NAME}-wal")))?
        != fs::read(target.join("expected-wal.bytes"))?
    {
        return Err("The synthetic WAL bytes were not preserved exactly.".into());
    }
    if fs::read(&backup_path)? != expected_backup {
        return Err("The selected backup changed during recovery.".into());
    }

    let reopened = Database::open(&database_path)?;
    let reopened_balance = reopened.account_balance(ACCOUNT_ID, &CalendarDate::parse(AS_OF)?)?;
    if reopened_balance.working != Huf(EXPECTED_BALANCE) {
        return Err(
            "The recovered database did not retain its expected balance after reopening.".into(),
        );
    }

    println!("Recovery verified at {}", target.display());
    println!(
        "Synthetic account balance: {} HUF",
        reopened_balance.working.0
    );
    println!("Preserved originals: {}", archive.display());
    println!("Backup bytes are unchanged; recovered database reopened successfully.");
    Ok(())
}

fn only_backup(directory: &Path) -> Result<PathBuf> {
    let backups = fs::read_dir(directory)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<io::Result<Vec<_>>>()?
        .into_iter()
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("allocash-") && name.ends_with(".sqlite3"))
        })
        .collect::<Vec<_>>();
    match backups.as_slice() {
        [backup] => Ok(backup.clone()),
        [] => Err("No native Allocash backup was found in the fixture.".into()),
        _ => Err("Expected exactly one native backup in the fixture.".into()),
    }
}

fn only_preserved_archive(directory: &Path) -> Result<PathBuf> {
    let archives = fs::read_dir(directory)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<io::Result<Vec<_>>>()?
        .into_iter()
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("unreadable-budget-"))
                && path.is_dir()
        })
        .collect::<Vec<_>>();
    match archives.as_slice() {
        [archive] => Ok(archive.clone()),
        [] => Err("No preserved unreadable-budget archive was found.".into()),
        _ => Err("Expected exactly one preserved unreadable-budget archive.".into()),
    }
}

fn sidecar_path(database_path: &Path, suffix: &str) -> PathBuf {
    let mut name = database_path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    database_path.with_file_name(name)
}
