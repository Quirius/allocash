use allocash_lib::{
    database::Database,
    ledger::{AccountKind, CalendarDate},
    ynab_import::{compare_ynab_net_worth, AccountImportMapping},
};
use serde_json::json;
use std::{env, error::Error, ffi::OsString, fs, io, path::PathBuf};

type AnyError = Box<dyn Error + Send + Sync>;

fn required_argument(
    arguments: &mut impl Iterator<Item = OsString>,
    name: &str,
) -> Result<OsString, AnyError> {
    arguments.next().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Missing {name} argument."),
        )
        .into()
    })
}

fn main() -> Result<(), AnyError> {
    let mut arguments = env::args_os().skip(1);
    let export_path = PathBuf::from(required_argument(&mut arguments, "YNAB export ZIP")?);
    let reference_path = PathBuf::from(required_argument(
        &mut arguments,
        "YNAB Net Worth TSV reference",
    )?);
    let as_of_text = required_argument(&mut arguments, "as-of date (yyyy-mm-dd)")?
        .into_string()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "The as-of date is not UTF-8."))?;
    if arguments.next().is_some() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Too many arguments.").into());
    }

    let as_of = CalendarDate::parse(&as_of_text)?;
    let export_bytes = fs::read(&export_path)?;
    let reference_bytes = fs::read(&reference_path)?;
    let source_name = export_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("YNAB export.zip");

    // This database is disposable and exists only to exercise the complete
    // materialization path. Account kind does not affect ledger balances;
    // production import still requires the owner's explicit type/closed mapping.
    let directory = tempfile::tempdir()?;
    let mut database = Database::open(&directory.path().join("validation.sqlite3"))?;
    let staged = database.stage_ynab_zip(source_name, &export_bytes, &as_of)?;
    let mappings = staged
        .account_names
        .iter()
        .enumerate()
        .map(|(index, account_name)| AccountImportMapping {
            source_name: account_name.clone(),
            kind: AccountKind::Tracking,
            closed: false,
            sort_order: index as i64,
        })
        .collect::<Vec<_>>();
    database.materialize_import_accounts(&staged.batch_id, &staged.account_names, &mappings)?;
    database.materialize_import_references(&staged)?;
    let ordinary = database.materialize_ordinary_transactions(&staged)?;
    let transfers = database.materialize_transfers(&staged)?;
    let validation = database.validate_materialized_import(&staged, &as_of)?;
    let comparison =
        compare_ynab_net_worth(&validation.account_balances, &reference_bytes, &as_of)?;

    let result = json!({
        "asOfDate": validation.as_of_date,
        "sourceTransactionCount": validation.source_transaction_count,
        "importedTransactionCount": validation.imported_transaction_count,
        "ordinaryTransactionCount": ordinary.ordinary_transaction_count,
        "heldTransferRowCount": ordinary.held_transfer_row_count,
        "pairedTransferCount": transfers.paired_transfer_count,
        "unresolvedTransferRowCount": validation.unresolved_transfer_row_count,
        "unmaterializedOrdinaryRowCount": validation.unmaterialized_ordinary_row_count,
        "accountCount": validation.account_count,
        "categoryCount": validation.category_count,
        "futureTransactionCount": validation.future_transaction_count,
        "duplicateTransactionCount": validation.duplicate_transaction_count,
        "unknownCategoryCount": validation.unknown_category_names.len(),
        "unknownFlagCount": validation.unknown_flag_names.len(),
        "validationWarningCount": validation.warnings.len(),
        "referenceMonth": comparison.reference_month,
        "referenceAccountCount": comparison.reference_account_count,
        "exactReferenceBalanceMatches": comparison.exact_match_count,
        "referenceBalanceDifferenceCount": comparison.differences.len(),
        "missingReferenceAccountCount": comparison.missing_reference_accounts.len(),
        "unexpectedReferenceAccountCount": comparison.unexpected_reference_accounts.len(),
        "referenceBalancesExact": comparison.is_exact_match(),
    });
    println!("{}", serde_json::to_string_pretty(&result)?);

    if !comparison.is_exact_match() {
        return Err(io::Error::other("Imported balances do not match the YNAB reference.").into());
    }
    Ok(())
}
