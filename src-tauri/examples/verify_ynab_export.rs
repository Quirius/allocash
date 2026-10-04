use allocash_lib::{
    database::Database,
    ledger::{
        AccountKind, BalanceOverTimeInput, CalendarDate, Huf, IncomeBreakdownInput,
        OutflowOverTimeInput, SpendingReportInput,
    },
    plan::PlanMonth,
    ynab_import::{
        compare_ynab_net_worth, parse_huf, AccountImportMapping, ImportedAccountBalance,
    },
};
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::HashSet,
    env,
    error::Error,
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
};

type AnyError = Box<dyn Error + Send + Sync>;

fn reference_month_end(header: &str) -> Result<CalendarDate, AnyError> {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let (name, year) = header
        .split_once(' ')
        .ok_or_else(|| io::Error::other("Invalid Net Worth month header."))?;
    let month = MONTHS
        .iter()
        .position(|candidate| *candidate == name)
        .ok_or_else(|| io::Error::other("Invalid Net Worth month header."))?
        + 1;
    let year: u32 = year.parse()?;
    for day in (28..=31).rev() {
        if let Ok(date) = CalendarDate::parse(&format!("{year:04}-{month:02}-{day:02}")) {
            return Ok(date);
        }
    }
    Err(io::Error::other("Invalid Net Worth month header.").into())
}

fn compare_net_worth_history(
    database: &Database,
    reference_bytes: &[u8],
    as_of: &CalendarDate,
) -> Result<serde_json::Value, AnyError> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .from_reader(reference_bytes);
    let headers = reader.headers()?.clone();
    if headers
        .get(0)
        .map(|header| header.trim_start_matches('\u{feff}'))
        != Some("Account")
        || headers.len() < 2
    {
        return Err(io::Error::other("Invalid Net Worth reference headers.").into());
    }
    let month_ends = headers
        .iter()
        .skip(1)
        .map(reference_month_end)
        .collect::<Result<Vec<_>, _>>()?;
    if month_ends
        .windows(2)
        .any(|pair| pair[0].as_str() >= pair[1].as_str())
    {
        return Err(io::Error::other("Net Worth months are not ascending.").into());
    }
    let first = month_ends.first().unwrap();
    let last = month_ends.last().unwrap();
    let to = if last.as_str()[..7] == as_of.as_str()[..7] {
        as_of.clone()
    } else {
        last.clone()
    };
    if to.as_str() > as_of.as_str() {
        return Err(io::Error::other("Net Worth reference extends beyond the as-of date.").into());
    }
    let report = database.balance_over_time(&BalanceOverTimeInput {
        from: first.clone(),
        to,
        account_ids: Vec::new(),
    })?;
    if report.point_dates.len() != month_ends.len()
        || report
            .point_dates
            .iter()
            .zip(month_ends.iter())
            .any(|(point, month_end)| point.as_str()[..7] != month_end.as_str()[..7])
    {
        return Err(
            io::Error::other("Net Worth reference months do not match report points.").into(),
        );
    }
    let records = reader.records().collect::<Result<Vec<_>, _>>()?;
    let net_worth_row = records
        .iter()
        .find(|record| {
            record
                .get(0)
                .is_some_and(|name| name.eq_ignore_ascii_case("Net Worth"))
        })
        .ok_or_else(|| io::Error::other("Net Worth reference has no total row."))?;
    // The historical report leaves leading months blank before an account first
    // appears. The single-month comparison intentionally requires explicit
    // values, so normalize only these leading blanks in this report check.
    let mut normalized = csv::WriterBuilder::new()
        .delimiter(b'\t')
        .from_writer(Vec::new());
    normalized.write_record(&headers)?;
    for record in &records {
        let mut seen_balance = false;
        let mut fields = Vec::with_capacity(headers.len());
        fields.push(record.get(0).unwrap_or_default().to_owned());
        for field in record.iter().skip(1) {
            if field.trim().is_empty() && seen_balance {
                return Err(io::Error::other("Net Worth has a nonleading blank balance.").into());
            }
            if !field.trim().is_empty() {
                seen_balance = true;
            }
            fields.push(if field.trim().is_empty() {
                "0".to_owned()
            } else {
                field.to_owned()
            });
        }
        normalized.write_record(fields)?;
    }
    let normalized_bytes = normalized.into_inner()?;
    let mut exact_account_months = 0;
    let mut account_difference_count = 0;
    let mut account_set_difference_count = 0;
    let mut exact_total_months = 0;
    let mut exact_net_worth_report_months = 0;
    let mut mismatch_months = Vec::new();
    for (index, point) in report.point_dates.iter().enumerate() {
        let imported = report
            .accounts
            .iter()
            .map(|account| ImportedAccountBalance {
                account_name: account.account_name.clone(),
                working: account.balances[index],
                cleared: Huf(0),
                uncleared: Huf(0),
                reconciled: Huf(0),
            })
            .collect::<Vec<_>>();
        let comparison = compare_ynab_net_worth(&imported, &normalized_bytes, point)?;
        exact_account_months += comparison.exact_match_count;
        account_difference_count += comparison.differences.len();
        account_set_difference_count += comparison.missing_reference_accounts.len()
            + comparison.unexpected_reference_accounts.len();
        let reference_total = parse_huf(net_worth_row.get(index + 1).unwrap_or_default())?;
        let total_matches = report.total_balances[index].0 == reference_total;
        let net_worth_report_matches =
            database.net_worth_report(point, None)?.net_worth.0 == reference_total;
        exact_total_months += usize::from(total_matches);
        exact_net_worth_report_months += usize::from(net_worth_report_matches);
        if !comparison.is_exact_match() || !total_matches || !net_worth_report_matches {
            mismatch_months.push(comparison.reference_month);
        }
    }
    let exact = mismatch_months.is_empty()
        && account_difference_count == 0
        && account_set_difference_count == 0
        && exact_account_months == report.point_dates.len() * report.accounts.len()
        && exact_total_months == report.point_dates.len()
        && exact_net_worth_report_months == report.point_dates.len();
    Ok(json!({
        "exact": exact,
        "monthCount": report.point_dates.len(),
        "accountMonthCount": report.point_dates.len() * report.accounts.len(),
        "exactAccountMonthMatches": exact_account_months,
        "accountDifferenceCount": account_difference_count,
        "accountSetDifferenceCount": account_set_difference_count,
        "exactNetWorthTotalMonths": exact_total_months,
        "exactNetWorthReportMonths": exact_net_worth_report_months,
        "mismatchMonths": mismatch_months,
    }))
}

fn compare_income_expense(
    database: &Database,
    reference_bytes: &[u8],
    as_of: &CalendarDate,
) -> Result<serde_json::Value, AnyError> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .from_reader(reference_bytes);
    let headers = reader.headers()?.clone();
    if headers.get(0) != Some("Category")
        || headers.len() < 4
        || headers.get(headers.len() - 2) != Some("Average")
        || headers.get(headers.len() - 1) != Some("Total")
    {
        return Err(io::Error::other("Invalid Income v Expense reference headers.").into());
    }
    let month_ends = headers
        .iter()
        .skip(1)
        .take(headers.len() - 3)
        .map(reference_month_end)
        .collect::<Result<Vec<_>, _>>()?;
    if month_ends
        .windows(2)
        .any(|pair| pair[0].as_str() >= pair[1].as_str())
    {
        return Err(io::Error::other("Income v Expense months are not ascending.").into());
    }
    let first = month_ends.first().unwrap();
    let last = month_ends.last().unwrap();
    let to = if last.as_str()[..7] == as_of.as_str()[..7] {
        as_of.clone()
    } else {
        last.clone()
    };
    if to.as_str() > as_of.as_str() {
        return Err(
            io::Error::other("Income v Expense reference extends beyond the as-of date.").into(),
        );
    }
    let from = CalendarDate::parse(&format!("{}-01", &first.as_str()[..7]))?;
    let report_input = SpendingReportInput {
        from: from.clone(),
        to: to.clone(),
        account_ids: Vec::new(),
    };
    let report = database.income_vs_expense(&report_input)?;
    let inflow_outflow = database.inflow_outflow_by_month(&report_input)?;
    let outflow_over_time = database.outflow_over_time(&OutflowOverTimeInput {
        from,
        to,
        account_ids: Vec::new(),
        category_ids: Vec::new(),
    })?;
    let spending_categories = database.spending_by_category(&report_input)?;
    if report.months.len() != month_ends.len()
        || report
            .months
            .iter()
            .zip(month_ends.iter())
            .any(|(month, end)| month != &end.as_str()[..7])
    {
        return Err(
            io::Error::other("Income v Expense report months do not match reference.").into(),
        );
    }
    let records = reader.records().collect::<Result<Vec<_>, _>>()?;
    let row = |label: &str| -> Result<&csv::StringRecord, AnyError> {
        let mut found = records.iter().filter(|record| record.get(0) == Some(label));
        let first = found
            .next()
            .ok_or_else(|| io::Error::other(format!("Income v Expense is missing {label}.")))?;
        if found.next().is_some() {
            return Err(io::Error::other(format!("Income v Expense repeats {label}.")).into());
        }
        Ok(first)
    };
    let income = row("Total Income")?;
    let expense = row("Total Expenses")?;
    let net = row("Net Income")?;
    let average_index = headers.len() - 2;
    let average_matches = [
        report.average_monthly_income.0
            == parse_huf(income.get(average_index).unwrap_or_default())?,
        report.average_monthly_expense.0
            == -parse_huf(expense.get(average_index).unwrap_or_default())?,
        report.average_monthly_net_income.0
            == parse_huf(net.get(average_index).unwrap_or_default())?,
    ];
    let income_row_index = records
        .iter()
        .position(|record| record.get(0) == Some("Total Income"))
        .unwrap();
    let expense_row_index = records
        .iter()
        .position(|record| record.get(0) == Some("Total Expenses"))
        .unwrap();
    let income_sources = &records[1..income_row_index];
    let plan_categories = database
        .plan_month(&PlanMonth::parse(&as_of.as_str()[..7])?)?
        .categories
        .into_iter()
        .fold(
            std::collections::BTreeMap::<String, HashSet<String>>::new(),
            |mut groups, category| {
                groups
                    .entry(category.group_name)
                    .or_default()
                    .insert(category.category_name);
                groups
            },
        );
    let mut income_matches = 0;
    let mut expense_matches = 0;
    let mut net_matches = 0;
    let mut income_source_matches = 0;
    let mut expense_group_matches = 0;
    let mut expense_category_matches = 0;
    let mut income_breakdown_group_matches = 0;
    let mut inflow_outflow_matches = 0;
    let mut outflow_over_time_matches = 0;
    let mut spending_category_matches = 0;
    let mut expense_category_average_matches = 0;
    let mut income_source_cells = 0;
    let mut expense_group_cells = 0;
    let mut expense_category_cells = 0;
    let mut spending_category_count = 0;
    let mut mismatch_months = Vec::new();
    for (index, month) in report.monthly_totals.iter().enumerate() {
        let source_income = parse_huf(income.get(index + 1).unwrap_or_default())?;
        let source_expense = -parse_huf(expense.get(index + 1).unwrap_or_default())?;
        let source_net = parse_huf(net.get(index + 1).unwrap_or_default())?;
        let same_income = month.income.0 == source_income;
        let same_expense = month.expense.0 == source_expense;
        let same_net = month.net_income.0 == source_net;
        let same_flow = inflow_outflow.months[index].inflow.0 == source_income
            && inflow_outflow.months[index].outflow.0 == source_expense;
        let same_outflow = outflow_over_time.monthly_totals[index].outflow.0 == source_expense;
        income_matches += usize::from(same_income);
        expense_matches += usize::from(same_expense);
        net_matches += usize::from(same_net);
        inflow_outflow_matches += usize::from(same_flow);
        outflow_over_time_matches += usize::from(same_outflow);
        if !same_income || !same_expense || !same_net {
            mismatch_months.push(month.month.clone());
        }
        let income_breakdown = database.income_breakdown(&IncomeBreakdownInput {
            from: CalendarDate::parse(&format!("{}-01", month.month))?,
            to: if month.month == as_of.as_str()[..7] {
                as_of.clone()
            } else {
                month_ends[index].clone()
            },
            account_ids: Vec::new(),
        })?;
        for source in income_sources {
            let source_name = source.get(0).unwrap_or_default();
            let normalized_name = source_name
                .strip_prefix("Transfer : ")
                .unwrap_or(source_name);
            let source_amount = parse_huf(source.get(index + 1).unwrap_or_default())?;
            let actual: i128 = income_breakdown
                .income_sources
                .iter()
                .filter(|entry| entry.payee_name == normalized_name)
                .map(|entry| i128::from(entry.total.0))
                .sum();
            income_source_matches += usize::from(actual == i128::from(source_amount));
            income_source_cells += 1;
        }
        let mut current_group = None;
        for source in &records[income_row_index + 1..expense_row_index] {
            let label = source.get(0).unwrap_or_default();
            let source_amount = -parse_huf(source.get(index + 1).unwrap_or_default())?;
            let is_current_category = current_group
                .and_then(|group| plan_categories.get(group))
                .is_some_and(|categories| categories.contains(label));
            if !is_current_category && plan_categories.contains_key(label) {
                current_group = Some(label);
                let actual: i64 = report
                    .expense_groups
                    .iter()
                    .find(|group| group.group_name == label)
                    .map(|group| {
                        group
                            .categories
                            .iter()
                            .map(|category| category.amounts[index].0)
                            .sum()
                    })
                    .unwrap_or(0);
                expense_group_matches += usize::from(actual == source_amount);
                let breakdown_amount = income_breakdown
                    .expense_groups
                    .iter()
                    .find(|group| group.group_name == label)
                    .map_or(0, |group| group.total.0);
                income_breakdown_group_matches += usize::from(breakdown_amount == source_amount);
                expense_group_cells += 1;
            } else {
                let actual = report
                    .expense_groups
                    .iter()
                    .find(|group| Some(group.group_name.as_str()) == current_group)
                    .and_then(|group| {
                        group
                            .categories
                            .iter()
                            .find(|category| category.category_name == label)
                    })
                    .map_or(0, |category| category.amounts[index].0);
                expense_category_matches += usize::from(actual == source_amount);
                expense_category_cells += 1;
                if index == 0 {
                    let source_total =
                        -parse_huf(source.get(headers.len() - 1).unwrap_or_default())?;
                    let source_average = -parse_huf(source.get(average_index).unwrap_or_default())?;
                    let spending_total = spending_categories
                        .iter()
                        .find(|category| {
                            category.group_name.as_deref() == current_group
                                && category.category_name == label
                        })
                        .map_or(0, |category| category.total.0);
                    spending_category_matches += usize::from(spending_total == source_total);
                    spending_category_count += 1;
                    let category_average = report
                        .expense_groups
                        .iter()
                        .find(|group| Some(group.group_name.as_str()) == current_group)
                        .and_then(|group| {
                            group
                                .categories
                                .iter()
                                .find(|category| category.category_name == label)
                        })
                        .map_or(0, |category| category.average.0);
                    expense_category_average_matches +=
                        usize::from(category_average == source_average);
                }
            }
        }
    }
    let total_index = headers.len() - 1;
    let total_matches = [
        report.total_income.0 == parse_huf(income.get(total_index).unwrap_or_default())?,
        report.total_expense.0 == -parse_huf(expense.get(total_index).unwrap_or_default())?,
        report.total_net_income.0 == parse_huf(net.get(total_index).unwrap_or_default())?,
    ];
    let exact = mismatch_months.is_empty()
        && income_source_matches == income_source_cells
        && expense_group_matches == expense_group_cells
        && income_breakdown_group_matches == expense_group_cells
        && expense_category_matches == expense_category_cells
        && inflow_outflow_matches == report.monthly_totals.len()
        && outflow_over_time_matches == report.monthly_totals.len()
        && spending_category_matches == spending_category_count
        && expense_category_average_matches == spending_category_count
        && average_matches.iter().all(|matches| *matches)
        && total_matches.iter().all(|matches| *matches);
    Ok(json!({
        "exact": exact,
        "monthCount": report.monthly_totals.len(),
        "incomeMatches": income_matches,
        "expenseMatches": expense_matches,
        "netIncomeMatches": net_matches,
        "incomeSourceCells": income_source_cells,
        "incomeSourceMatches": income_source_matches,
        "expenseGroupCells": expense_group_cells,
        "expenseGroupMatches": expense_group_matches,
        "incomeBreakdownGroupMatches": income_breakdown_group_matches,
        "expenseCategoryCells": expense_category_cells,
        "expenseCategoryMatches": expense_category_matches,
        "inflowOutflowMonthMatches": inflow_outflow_matches,
        "outflowOverTimeMonthMatches": outflow_over_time_matches,
        "spendingCategoryCount": spending_category_count,
        "spendingCategoryMatches": spending_category_matches,
        "totalAverageMatches": average_matches.iter().filter(|matches| **matches).count(),
        "periodTotalMatches": total_matches.iter().filter(|matches| **matches).count(),
        "expenseCategoryAverageMatches": expense_category_average_matches,
        "mismatchMonths": mismatch_months,
    }))
}

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

fn write_rehearsal_candidate(database: &Database, destination: &Path) -> Result<(), AnyError> {
    if destination.extension().and_then(|value| value.to_str()) != Some("sqlite3") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "The candidate must have a .sqlite3 extension.",
        )
        .into());
    }
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let saved = database.create_native_backup()?;
    let mut pending = tempfile::Builder::new()
        .prefix(".allocash-rehearsal-")
        .suffix(".partial")
        .tempfile_in(parent)?;
    let mut source = fs::File::open(saved.path)?;
    io::copy(&mut source, pending.as_file_mut())?;
    pending.as_file().sync_all()?;
    // The saved copy is verified at creation; reopen the delivered bytes too.
    let copy = Database::open(pending.path())?;
    drop(copy);
    pending.persist_noclobber(destination)?;
    Ok(())
}

fn main() -> Result<(), AnyError> {
    let mut inputs = env::args_os().skip(1).collect::<Vec<_>>();
    let candidate_path = if let Some(index) = inputs
        .iter()
        .position(|item| item.to_str() == Some("--candidate"))
    {
        if index + 2 != inputs.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Use --candidate as the final option followed by a .sqlite3 path.",
            )
            .into());
        }
        let destination = PathBuf::from(inputs.pop().unwrap());
        inputs.pop();
        Some(destination)
    } else {
        None
    };
    let mut arguments = inputs.into_iter();
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
    let income_expense_path = arguments.next().map(PathBuf::from);
    if arguments.next().is_some() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Too many arguments.").into());
    }

    let as_of = CalendarDate::parse(&as_of_text)?;
    let export_bytes = fs::read(&export_path)?;
    let reference_bytes = reference_path.as_ref().map(fs::read).transpose()?;
    let income_expense_bytes = income_expense_path.as_ref().map(fs::read).transpose()?;
    let owner_mappings: Option<OwnerMappings> = mappings_path
        .as_ref()
        .map(fs::read)
        .transpose()?
        .map(|bytes| serde_json::from_slice(&bytes))
        .transpose()?;
    if candidate_path.is_some() && (owner_mappings.is_none() || reference_bytes.is_none()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "A rehearsal candidate requires explicit account mappings and a Net Worth reference.",
        )
        .into());
    }
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
    let net_worth_history = reference_bytes
        .as_ref()
        .map(|bytes| compare_net_worth_history(&database, bytes, &as_of))
        .transpose()?;
    let income_expense = income_expense_bytes
        .as_ref()
        .map(|bytes| compare_income_expense(&database, bytes, &as_of))
        .transpose()?;
    let reports_exact = net_worth_history
        .as_ref()
        .is_none_or(|value| value["exact"].as_bool() == Some(true))
        && income_expense
            .as_ref()
            .is_none_or(|value| value["exact"].as_bool() == Some(true));

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
        "netWorthHistoryComparison": net_worth_history,
        "incomeExpenseComparison": income_expense,
    });
    println!("{}", serde_json::to_string_pretty(&result)?);

    if comparison
        .as_ref()
        .is_some_and(|value| !value.is_exact_match())
    {
        return Err(io::Error::other("Imported balances do not match the YNAB reference.").into());
    }
    if !reports_exact {
        return Err(io::Error::other("Imported reports do not match the YNAB references.").into());
    }
    if let Some(path) = candidate_path {
        if plan_comparison
            .as_ref()
            .is_none_or(|value| !value.differences.is_empty())
            || validation.unmaterialized_ordinary_row_count != 0
            || !validation.unknown_category_names.is_empty()
            || !validation.unknown_flag_names.is_empty()
        {
            return Err(io::Error::other("The import has unresolved Plan or ordinary-row validation differences; no rehearsal candidate was written.").into());
        }
        write_rehearsal_candidate(&database, &path)?;
        println!("{{\"rehearsalCandidateCreated\":true}}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_restorable_candidate_without_replacing_an_existing_file() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("source.sqlite3")).unwrap();
        let destination = directory.path().join("rehearsal.sqlite3");
        write_rehearsal_candidate(&database, &destination).unwrap();
        assert_eq!(
            Database::open(&destination)
                .unwrap()
                .info()
                .unwrap()
                .currency,
            "HUF"
        );
        assert!(write_rehearsal_candidate(&database, &destination).is_err());
        assert_eq!(
            Database::open(&destination)
                .unwrap()
                .info()
                .unwrap()
                .currency,
            "HUF"
        );
    }
}
