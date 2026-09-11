use crate::{
    database::Database,
    ledger::CalendarDate,
    ynab_import::{
        parse_huf, validate_account_mappings, AccountImportMapping, ImportError, SourceFileKind,
    },
};
use std::io::{Cursor, Write};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

fn date(value: &str) -> CalendarDate {
    CalendarDate::parse(value).unwrap()
}

fn fixture_zip(files: &[(&str, &str)]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, contents) in files {
        writer.start_file(name, options).unwrap();
        writer.write_all(contents.as_bytes()).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn database() -> (tempfile::TempDir, Database) {
    let directory = tempfile::tempdir().unwrap();
    let database = Database::open(&directory.path().join("budget.sqlite3")).unwrap();
    (directory, database)
}

#[test]
fn stages_every_csv_record_and_reports_source_level_validation() {
    let (_directory, mut database) = database();
    let archive = fixture_zip(&[
        (
            "Fixture/Register.csv",
            "Account,Flag,Date,Payee,Category Group/Category,Category Group,Category,Memo,Outflow,Inflow,Cleared\nCash,Red,1/3/2026,Groceries,Living/Groceries,Living,Groceries,Milk,1234,,Cleared\nCash,,2027-01-03,Employer,Income/Salary,Income,Salary,, ,5000,Reconciled\n",
        ),
        ("Fixture/Accounts.csv", "Name,Type\nCash,Checking\nCredit,CreditCard\n"),
        ("Fixture/notes.txt", "This stays in the preserved ZIP."),
    ]);

    let summary = database
        .stage_ynab_zip("anonymized-fixture.zip", &archive, &date("2026-09-11"))
        .unwrap();

    assert_eq!(summary.archive_file_count, 3);
    assert_eq!(summary.delimited_file_count, 2);
    assert_eq!(summary.raw_row_count, 6);
    assert_eq!(summary.data_row_count, 4);
    assert_eq!(summary.register_row_count, 2);
    assert_eq!(summary.account_names, ["Cash", "Credit"]);
    assert_eq!(summary.category_names, ["Groceries", "Salary"]);
    assert_eq!(summary.payee_names, ["Employer", "Groceries"]);
    assert_eq!(summary.flag_names, ["Red"]);
    assert_eq!(
        summary.latest_transaction_date.as_deref(),
        Some("2027-01-03")
    );
    assert_eq!(summary.future_transaction_count, 1);
    assert_eq!(summary.files[0].kind, SourceFileKind::Accounts);
    assert_eq!(summary.files[1].kind, SourceFileKind::Register);
    assert!(summary
        .warnings
        .iter()
        .any(|warning| warning.contains("non-delimited")));

    let saved_bytes: Vec<u8> = database
        .connection
        .query_row("SELECT source_bytes FROM import_batches", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(saved_bytes, archive);
    assert_eq!(
        database
            .connection
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM import_rows", [], |row| row.get(0))
            .unwrap(),
        6
    );
    let row: String = database
        .connection
        .query_row(
            "SELECT raw_data FROM import_rows WHERE source_file='Fixture/Register.csv' AND row_number=2",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&row).unwrap()["cells"][0],
        "Cash"
    );
}

#[test]
fn rejects_an_exact_duplicate_without_creating_a_second_batch() {
    let (_directory, mut database) = database();
    let archive = fixture_zip(&[("Fixture/Register.csv", "Date,Outflow\n2026-01-03,100\n")]);
    database
        .stage_ynab_zip("fixture.zip", &archive, &date("2026-09-11"))
        .unwrap();
    assert!(matches!(
        database.stage_ynab_zip("copy.zip", &archive, &date("2026-09-11")),
        Err(ImportError::DuplicateArchive)
    ));
    assert_eq!(
        database
            .connection
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM import_batches", [], |row| row.get(0))
            .unwrap(),
        1
    );
}

#[test]
fn malformed_csv_does_not_leave_a_partial_batch() {
    let (_directory, mut database) = database();
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .start_file(
            "Fixture/Register.csv",
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
        )
        .unwrap();
    // CSV records must be valid UTF-8. The raw archive is never staged when
    // even one record cannot be decoded, avoiding a misleading partial import.
    writer.write_all(b"Date,Outflow\n\xff,100").unwrap();
    let archive = writer.finish().unwrap().into_inner();
    assert!(matches!(
        database.stage_ynab_zip("broken.zip", &archive, &date("2026-09-11")),
        Err(ImportError::InvalidDelimited { .. })
    ));
    assert_eq!(
        database
            .connection
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM import_batches", [], |row| row.get(0))
            .unwrap(),
        0
    );
    assert_eq!(
        database
            .connection
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM import_rows", [], |row| row.get(0))
            .unwrap(),
        0
    );
}

#[test]
fn stages_modern_ynab_tsv_files() {
    let (_directory, mut database) = database();
    let archive = fixture_zip(&[(
        "Fixture/Register.tsv",
        "Account\tDate\tPayee\tOutflow\tInflow\tCleared\nCash\t2026/09/10\tMarket\t1234\t\tCleared\nCash\t2026/10/10\tEmployer\t\t5000\tReconciled\n",
    )]);
    let summary = database
        .stage_ynab_zip("fixture.zip", &archive, &date("2026-09-11"))
        .unwrap();
    assert_eq!(summary.delimited_file_count, 1);
    assert_eq!(summary.register_row_count, 2);
    assert_eq!(summary.account_names, ["Cash"]);
    assert_eq!(summary.payee_names, ["Employer", "Market"]);
    assert_eq!(summary.future_transaction_count, 1);
}

#[test]
fn account_mappings_must_cover_each_staged_name_once() {
    let names = vec!["Cash".into(), "Card".into()];
    let valid = vec![
        AccountImportMapping {
            source_name: "Cash".into(),
            kind: crate::ledger::AccountKind::Cash,
            closed: false,
            sort_order: 0,
        },
        AccountImportMapping {
            source_name: "Card".into(),
            kind: crate::ledger::AccountKind::Tracking,
            closed: true,
            sort_order: 1,
        },
    ];
    assert!(validate_account_mappings(&names, &valid).is_ok());
    assert!(validate_account_mappings(&names, &valid[..1]).is_err());
    assert!(validate_account_mappings(&names, &[valid[0].clone(), valid[0].clone()]).is_err());
}

#[test]
fn materializes_only_explicitly_mapped_accounts() {
    let (_directory, mut database) = database();
    database
        .connection
        .execute(
            "INSERT INTO import_batches (id,source_name,source_bytes,sha256) VALUES ('batch','fixture.zip',X'00',?1)",
            ["b".repeat(64)],
        )
        .unwrap();
    let names = vec!["Closed asset".into()];
    let mappings = vec![AccountImportMapping {
        source_name: "Closed asset".into(),
        kind: crate::ledger::AccountKind::Tracking,
        closed: true,
        sort_order: 0,
    }];
    database
        .materialize_import_accounts("batch", &names, &mappings)
        .unwrap();
    let accounts = database.accounts().unwrap();
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].name, "Closed asset");
    assert_eq!(accounts[0].kind, crate::ledger::AccountKind::Tracking);
    assert!(accounts[0].closed);
}

#[test]
fn materializes_categories_payees_and_known_flags() {
    let (_directory, mut database) = database();
    let archive = fixture_zip(&[(
        "Fixture/Register.tsv",
        "Account\tFlag\tDate\tPayee\tCategory Group\tCategory\tOutflow\tInflow\nCash\tRed\t2026/09/10\tMarket\tLiving\tGroceries\t100\t0\nCash\tOrange\t2026/09/11\tLandlord\tFixed\tRent\t500\t0\n",
    )]);
    let summary = database
        .stage_ynab_zip("fixture.zip", &archive, &date("2026-09-11"))
        .unwrap();
    database.materialize_import_references(&summary).unwrap();
    for table in ["category_groups", "categories", "payees"] {
        let count: i64 = database
            .connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 2, "{table}");
    }
    let groups = database
        .connection
        .prepare("SELECT name FROM category_groups ORDER BY sort_order")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(groups, ["Living", "Fixed"]);
    assert_eq!(
        database
            .connection
            .query_row::<String, _, _>("SELECT id FROM flags WHERE color='red'", [], |row| row
                .get(0))
            .unwrap(),
        "flag-red"
    );
}

#[test]
fn huf_parsing_is_exact_and_rejects_fractional_or_overflow_values() {
    assert_eq!(parse_huf("1 234 567 Ft").unwrap(), 1_234_567);
    assert_eq!(parse_huf("0 Ft").unwrap(), 0);
    assert_eq!(parse_huf("-42 Ft").unwrap(), -42);
    for invalid in [
        "1.00 Ft",
        "1,000 Ft",
        "1 2 Ft",
        "+1 Ft",
        "9223372036854775808 Ft",
    ] {
        assert!(parse_huf(invalid).is_err(), "{invalid}");
    }
}

#[test]
fn materializes_ordinary_transactions_and_holds_transfers() {
    let (_directory, mut database) = database();
    let archive = fixture_zip(&[(
        "Fixture/Register.tsv",
        "Account\tFlag\tDate\tPayee\tCategory Group/Category\tCategory Group\tCategory\tMemo\tOutflow\tInflow\tCleared\nCash\tRed\t2026/09/10\tMarket\tLiving/Groceries\tLiving\tGroceries\tFood\t1 234 Ft\t0 Ft\tReconciled\nCash\t\t2026/09/11\tTransfer : Card\tCategory Not Needed\t\t\t\t500 Ft\t0 Ft\tCleared\n",
    )]);
    let summary = database
        .stage_ynab_zip("fixture.zip", &archive, &date("2026-09-11"))
        .unwrap();
    let mappings = [AccountImportMapping {
        source_name: "Cash".into(),
        kind: crate::ledger::AccountKind::Cash,
        closed: false,
        sort_order: 0,
    }];
    database
        .materialize_import_accounts(&summary.batch_id, &summary.account_names, &mappings)
        .unwrap();
    database.materialize_import_references(&summary).unwrap();
    let result = database
        .materialize_ordinary_transactions(&summary)
        .unwrap();
    assert_eq!(result.ordinary_transaction_count, 1);
    assert_eq!(result.held_transfer_row_count, 1);
    let entry = &database
        .entries(&database.accounts().unwrap()[0].id)
        .unwrap()[0];
    assert_eq!(entry.amount.0, -1234);
    assert_eq!(entry.entry.memo, "Food");
    assert_eq!(entry.entry.import_row_id.is_some(), true);
}
