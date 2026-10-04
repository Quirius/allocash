use allocash_lib::{
    database::Database,
    ledger::{AccountKind, CalendarDate},
    plan::PlanMonth,
    ynab_import::{compare_ynab_net_worth, AccountImportMapping},
};
use serde::Deserialize;
use serde_json::json;
use std::{collections::HashSet, env, error::Error, ffi::OsString, fs, io, path::PathBuf};

type AnyError = Box<dyn Error + Send + Sync>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerMappings {
    export_sha256: String,
    accounts: Vec<AccountImportMapping>,
    credit_payments: Vec<CreditPaymentMapping>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreditPaymentMapping {
    account_name: String,
    category_group: String,
    category_name: String,
}

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
    let second = required_argument(&mut arguments, "as-of date or YNAB Net Worth TSV reference")?;
    let third = arguments.next();
    let (reference_path, as_of_argument) = match third {
        Some(date) => (Some(PathBuf::from(second)), date),
        None => (None, second),
    };
    let as_of_text = as_of_argument
        .into_string()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "The as-of date is not UTF-8."))?;
    let mappings_path = arguments.next().map(PathBuf::from);
    let plan_differences_path = arguments.next().map(PathBuf::from);
    if arguments.next().is_some() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Too many arguments.").into());
    }

    let as_of = CalendarDate::parse(&as_of_text)?;
    let export_bytes = fs::read(&export_path)?;
    let reference_bytes = reference_path.as_ref().map(fs::read).transpose()?;
    let owner_mappings: Option<OwnerMappings> = mappings_path
        .as_ref()
        .map(fs::read)
        .transpose()?
        .map(|bytes| serde_json::from_slice(&bytes))
        .transpose()?;
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
    if owner_mappings
        .as_ref()
        .is_some_and(|mapping| mapping.export_sha256 != staged.sha256)
    {
        return Err(io::Error::other("The account mapping belongs to a different export.").into());
    }
    let default_mappings = staged
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
    let mappings = owner_mappings
        .as_ref()
        .map_or(default_mappings.as_slice(), |mapping| {
            mapping.accounts.as_slice()
        });
    database.materialize_import_accounts(&staged.batch_id, &staged.account_names, &mappings)?;
    database.materialize_import_references(&staged)?;
    if let Some(mapping) = &owner_mappings {
        let accounts = database.accounts()?;
        let categories = database
            .plan_month(&PlanMonth::parse(&as_of_text[..7])?)?
            .categories;
        let credit_count = accounts
            .iter()
            .filter(|account| account.kind == AccountKind::Credit)
            .count();
        let mut seen = HashSet::new();
        for payment in &mapping.credit_payments {
            let account = accounts
                .iter()
                .find(|account| {
                    account.name == payment.account_name && account.kind == AccountKind::Credit
                })
                .ok_or_else(|| {
                    io::Error::other("A credit payment mapping has no matching credit account.")
                })?;
            let category = categories
                .iter()
                .find(|category| {
                    category.group_name == payment.category_group
                        && category.category_name == payment.category_name
                })
                .ok_or_else(|| {
                    io::Error::other("A credit payment mapping has no matching category.")
                })?;
            if !seen.insert(account.id.as_str()) {
                return Err(io::Error::other(
                    "A credit account has more than one payment mapping.",
                )
                .into());
            }
            database.set_credit_payment_category(&account.id, Some(&category.category_id))?;
        }
        if seen.len() != credit_count {
            return Err(
                io::Error::other("Every credit account needs a payment category mapping.").into(),
            );
        }
    }
    let plan = database.materialize_historical_plan_assignments(&staged)?;
    let ordinary = database.materialize_ordinary_transactions(&staged)?;
    let transfers = database.materialize_transfers(&staged)?;
    let validation = database.validate_materialized_import(&staged, &as_of)?;
    let plan_comparison = owner_mappings
        .as_ref()
        .map(|_| database.compare_staged_plan_values_as_of(&staged, &as_of))
        .transpose()?;
    if let Some(path) = plan_differences_path {
        let comparison = plan_comparison.as_ref().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "Plan differences require account mappings.",
            )
        })?;
        fs::write(path, serde_json::to_vec_pretty(&comparison.differences)?)?;
    }
    let comparison = reference_bytes
        .as_ref()
        .map(|bytes| compare_ynab_net_worth(&validation.account_balances, bytes, &as_of))
        .transpose()?;

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
        "historicalPlanAssignmentCount": plan.assignment_count,
        "historicalPlanMonthCount": plan.month_count,
        "accountMappingProvided": owner_mappings.is_some(),
        "creditPaymentMappingCount": owner_mappings.as_ref().map(|mapping| mapping.credit_payments.len()),
        "planValueComparison": plan_comparison.as_ref().map(|value| json!({
            "sourceRowCount": value.source_row_count,
            "monthCount": value.month_count,
            "assignedMatchCount": value.assigned_match_count,
            "activityMatchCount": value.activity_match_count,
            "availableMatchCount": value.available_match_count,
            "differenceCount": value.differences.len(),
        })),
        "futureTransactionCount": validation.future_transaction_count,
        "duplicateTransactionCount": validation.duplicate_transaction_count,
        "unknownCategoryCount": validation.unknown_category_names.len(),
        "unknownFlagCount": validation.unknown_flag_names.len(),
        "validationWarningCount": validation.warnings.len(),
        "referenceMonth": comparison.as_ref().map(|value| &value.reference_month),
        "referenceAccountCount": comparison.as_ref().map(|value| value.reference_account_count),
        "exactReferenceBalanceMatches": comparison.as_ref().map(|value| value.exact_match_count),
        "referenceBalanceDifferenceCount": comparison.as_ref().map(|value| value.differences.len()),
        "missingReferenceAccountCount": comparison.as_ref().map(|value| value.missing_reference_accounts.len()),
        "unexpectedReferenceAccountCount": comparison.as_ref().map(|value| value.unexpected_reference_accounts.len()),
        "referenceBalancesExact": comparison.as_ref().map(|value| value.is_exact_match()),
    });
    println!("{}", serde_json::to_string_pretty(&result)?);

    if comparison
        .as_ref()
        .is_some_and(|value| !value.is_exact_match())
    {
        return Err(io::Error::other("Imported balances do not match the YNAB reference.").into());
    }
    Ok(())
}
