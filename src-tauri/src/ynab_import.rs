//! Lossless staging for YNAB ZIP exports.
//!
//! This module deliberately does not create ledger records. A YNAB export can
//! contain ambiguous account types, transfers, scheduled instances, and Plan
//! history; those need an explicit mapping step. Until then, the archive and
//! every CSV or TSV record are retained for a later, auditable import.
use crate::{
    database::Database,
    ledger::{AccountKind, CalendarDate},
};
use csv::{ReaderBuilder, StringRecord};
use rusqlite::{params, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fmt,
    io::{Cursor, Read},
};
use zip::ZipArchive;

const MAX_UNCOMPRESSED_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug)]
pub enum ImportError {
    InvalidValue(&'static str),
    InvalidArchive(String),
    InvalidDelimited {
        source_file: String,
        message: String,
    },
    DuplicateArchive,
    Storage(rusqlite::Error),
    Serialization(serde_json::Error),
}

impl fmt::Display for ImportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidValue(message) => formatter.write_str(message),
            Self::InvalidArchive(_) => {
                formatter.write_str("The selected file is not a readable YNAB ZIP export.")
            }
            Self::InvalidDelimited { .. } => {
                formatter.write_str("A delimited file in the selected export could not be read.")
            }
            Self::DuplicateArchive => {
                formatter.write_str("This exact YNAB export has already been staged.")
            }
            Self::Storage(_) => formatter.write_str("The import could not be saved."),
            Self::Serialization(_) => {
                formatter.write_str("The import rows could not be preserved.")
            }
        }
    }
}

impl std::error::Error for ImportError {}
impl From<rusqlite::Error> for ImportError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error)
    }
}
impl From<serde_json::Error> for ImportError {
    fn from(error: serde_json::Error) -> Self {
        Self::Serialization(error)
    }
}

pub type ImportResult<T> = Result<T, ImportError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceFileKind {
    Register,
    Accounts,
    Categories,
    Budget,
    Unknown,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFileSummary {
    pub source_file: String,
    pub kind: SourceFileKind,
    pub headers: Vec<String>,
    /// Includes the header row, because every delimited record is staged.
    pub raw_row_count: usize,
    pub data_row_count: usize,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportValidationSummary {
    pub batch_id: String,
    pub sha256: String,
    pub archive_file_count: usize,
    pub delimited_file_count: usize,
    pub raw_row_count: usize,
    pub data_row_count: usize,
    pub register_row_count: usize,
    pub account_names: Vec<String>,
    pub category_names: Vec<String>,
    pub categories: Vec<ImportedCategory>,
    pub payee_names: Vec<String>,
    pub flag_names: Vec<String>,
    pub latest_transaction_date: Option<String>,
    pub future_transaction_count: usize,
    pub files: Vec<ImportFileSummary>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, std::hash::Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedCategory {
    pub group_name: String,
    pub name: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionMaterializationSummary {
    pub ordinary_transaction_count: usize,
    pub held_transfer_row_count: usize,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferMaterializationSummary {
    pub paired_transfer_count: usize,
    pub unresolved_row_count: usize,
}

struct TransferCandidate {
    row_id: String,
    account: String,
    target: String,
    date: CalendarDate,
    amount: i64,
    payee: String,
    memo: String,
    flag: String,
    cleared: &'static str,
}

/// An explicit owner decision for an imported account. YNAB's current TSV
/// export has account names but no trustworthy account-kind/closed metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountImportMapping {
    pub source_name: String,
    pub kind: AccountKind,
    pub closed: bool,
    pub sort_order: i64,
}

/// Refuses an incomplete or stale account mapping before any ledger write.
pub fn validate_account_mappings(
    account_names: &[String],
    mappings: &[AccountImportMapping],
) -> ImportResult<()> {
    let expected = account_names
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let supplied = mappings
        .iter()
        .map(|mapping| mapping.source_name.as_str())
        .collect::<BTreeSet<_>>();
    if supplied.len() != mappings.len() {
        return Err(ImportError::InvalidValue(
            "Every imported account needs exactly one mapping.",
        ));
    }
    let orders = mappings
        .iter()
        .map(|mapping| mapping.sort_order)
        .collect::<BTreeSet<_>>();
    if orders.len() != mappings.len() || orders.iter().any(|order| *order < 0) {
        return Err(ImportError::InvalidValue(
            "Imported account order must be unique and non-negative.",
        ));
    }
    if expected.len() != account_names.len() || expected.len() != supplied.len() {
        return Err(ImportError::InvalidValue(
            "The account mapping does not match the staged export.",
        ));
    }
    if expected
        .iter()
        .zip(supplied.iter())
        .any(|(left, right)| *left != *right)
    {
        return Err(ImportError::InvalidValue(
            "The account mapping does not match the staged export.",
        ));
    }
    Ok(())
}

impl Database {
    /// Creates only explicitly mapped accounts. Source rows remain staged; no
    /// transactions are materialized until their full mapping is validated.
    pub fn materialize_import_accounts(
        &mut self,
        batch_id: &str,
        account_names: &[String],
        mappings: &[AccountImportMapping],
    ) -> ImportResult<()> {
        validate_account_mappings(account_names, mappings)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM import_batches WHERE id=?1)",
            [batch_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(ImportError::InvalidValue(
                "The staged import batch was not found.",
            ));
        }
        for mapping in mappings {
            let id = format!(
                "import-account-{}",
                hex_sha256(format!("{batch_id}:{}", mapping.source_name).as_bytes())
            );
            transaction.execute(
                "INSERT INTO accounts (id,name,kind,sort_order,closed) VALUES (?1,?2,?3,?4,?5)",
                params![
                    id,
                    mapping.source_name,
                    mapping.kind,
                    mapping.sort_order,
                    mapping.closed
                ],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Creates reference records only after the staged summary is complete.
    /// Existing flag identities are reused by color; unknown colors abort.
    pub fn materialize_import_references(
        &mut self,
        summary: &ImportValidationSummary,
    ) -> ImportResult<()> {
        let allowed_flags = ["red", "orange", "yellow", "green", "blue", "purple"];
        if summary
            .flag_names
            .iter()
            .any(|flag| source_flag_color(flag).is_none_or(|color| !allowed_flags.contains(&color)))
        {
            return Err(ImportError::InvalidValue(
                "The export contains an unknown flag color.",
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM import_batches WHERE id=?1)",
            [&summary.batch_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(ImportError::InvalidValue(
                "The staged import batch was not found.",
            ));
        }
        let mut groups = Vec::new();
        let mut seen_groups = HashSet::new();
        for category in &summary.categories {
            if seen_groups.insert(category.group_name.as_str()) {
                groups.push(category.group_name.as_str());
            }
        }
        for (order, group) in groups.iter().enumerate() {
            transaction.execute(
                "INSERT INTO category_groups (id,name,sort_order) VALUES (?1,?2,?3)",
                params![
                    import_id(&summary.batch_id, "group", group),
                    group,
                    order as i64
                ],
            )?;
        }
        for (order, category) in summary.categories.iter().enumerate() {
            transaction.execute(
                "INSERT INTO categories (id,group_id,name,sort_order) VALUES (?1,?2,?3,?4)",
                params![
                    import_id(
                        &summary.batch_id,
                        "category",
                        &format!("{}:{}", category.group_name, category.name)
                    ),
                    import_id(&summary.batch_id, "group", &category.group_name),
                    category.name,
                    order as i64
                ],
            )?;
        }
        for payee in &summary.payee_names {
            transaction.execute(
                "INSERT INTO payees (id,name) VALUES (?1,?2)",
                params![import_id(&summary.batch_id, "payee", payee), payee],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Imports only ordinary register rows. Transfer-like rows remain staged so
    /// a later pass can prove and create both linked legs together.
    pub fn materialize_ordinary_transactions(
        &mut self,
        summary: &ImportValidationSummary,
    ) -> ImportResult<TransactionMaterializationSummary> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let staged = {
            let mut query = transaction.prepare("SELECT id,source_file,row_number,raw_data FROM import_rows WHERE batch_id=?1 ORDER BY source_file,row_number")?;
            let rows = query
                .query_map([&summary.batch_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let mut headers: HashMap<String, Vec<String>> = HashMap::new();
        let mut ordinary = 0usize;
        let mut held = 0usize;
        for (row_id, source_file, row_number, raw_data) in staged {
            let raw: RawCsvRow = serde_json::from_str(&raw_data)?;
            if row_number == 1 {
                headers.insert(
                    source_file,
                    raw.cells
                        .iter()
                        .map(|value| normalize_header(value))
                        .collect(),
                );
                continue;
            }
            let Some(header) = headers.get(&source_file) else {
                return Err(ImportError::InvalidValue(
                    "A staged source file has no header row.",
                ));
            };
            if classify(header) != SourceFileKind::Register {
                continue;
            }
            let get = |name| {
                value(&raw.cells, field(header, name))
                    .map(str::trim)
                    .unwrap_or("")
            };
            let payee = get("payee");
            let combined_category = get("category group/category");
            if is_transfer_like(payee, combined_category) {
                held += 1;
                continue;
            }
            let account = get("account");
            let date = parse_export_date(get("date")).ok_or(ImportError::InvalidValue(
                "An imported transaction has an invalid date.",
            ))?;
            let outflow = parse_huf(get("outflow"))?;
            let inflow = parse_huf(get("inflow"))?;
            if outflow < 0 || inflow < 0 || (outflow != 0 && inflow != 0) {
                return Err(ImportError::InvalidValue(
                    "Imported inflow/outflow columns are inconsistent.",
                ));
            }
            let amount = inflow
                .checked_sub(outflow)
                .ok_or(ImportError::InvalidValue(
                    "An imported HUF amount is out of range.",
                ))?;
            let cleared = match get("cleared").to_ascii_lowercase().as_str() {
                "uncleared" => "uncleared",
                "cleared" => "cleared",
                "reconciled" => "reconciled",
                _ => {
                    return Err(ImportError::InvalidValue(
                        "An imported cleared state is unknown.",
                    ))
                }
            };
            let group = get("category group");
            let category = get("category");
            let category_id = (!group.is_empty() && !category.is_empty()).then(|| {
                import_id(
                    &summary.batch_id,
                    "category",
                    &format!("{group}:{category}"),
                )
            });
            let payee_id =
                (!payee.is_empty()).then(|| import_id(&summary.batch_id, "payee", payee));
            let flag_id = source_flag_color(get("flag")).map(|color| format!("flag-{color}"));
            transaction.execute(
                "INSERT INTO transactions (id,account_id,transaction_date,payee_id,category_id,memo,flag_id,amount_huf,cleared_state,posting_state,origin,import_row_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'posted','import',?10)",
                params![import_id(&summary.batch_id, "transaction", &row_id), import_id(&summary.batch_id, "account", account), date.as_str(), payee_id, category_id, get("memo"), flag_id, amount, cleared, row_id],
            )?;
            ordinary += 1;
        }
        transaction.commit()?;
        Ok(TransactionMaterializationSummary {
            ordinary_transaction_count: ordinary,
            held_transfer_row_count: held,
        })
    }

    /// Pairs only unique reciprocal legs with the same date and opposite exact
    /// amount. Ambiguous or one-sided rows remain staged and are reported.
    pub fn materialize_transfers(
        &mut self,
        summary: &ImportValidationSummary,
    ) -> ImportResult<TransferMaterializationSummary> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let staged = load_staged_rows(&transaction, &summary.batch_id)?;
        let mut headers: HashMap<String, Vec<String>> = HashMap::new();
        let mut candidates = Vec::new();
        for (row_id, source_file, row_number, raw_data) in staged {
            let raw: RawCsvRow = serde_json::from_str(&raw_data)?;
            if row_number == 1 {
                headers.insert(
                    source_file,
                    raw.cells.iter().map(|v| normalize_header(v)).collect(),
                );
                continue;
            }
            let Some(header) = headers.get(&source_file) else {
                return Err(ImportError::InvalidValue(
                    "A staged source file has no header row.",
                ));
            };
            if classify(header) != SourceFileKind::Register {
                continue;
            }
            let get = |name| {
                value(&raw.cells, field(header, name))
                    .map(str::trim)
                    .unwrap_or("")
            };
            let Some(target) = transfer_target(get("payee")) else {
                continue;
            };
            let outflow = parse_huf(get("outflow"))?;
            let inflow = parse_huf(get("inflow"))?;
            if outflow < 0 || inflow < 0 || (outflow != 0 && inflow != 0) {
                return Err(ImportError::InvalidValue(
                    "Imported inflow/outflow columns are inconsistent.",
                ));
            }
            let cleared = parse_cleared(get("cleared"))?;
            candidates.push(TransferCandidate {
                row_id,
                account: get("account").into(),
                target: target.into(),
                date: parse_export_date(get("date")).ok_or(ImportError::InvalidValue(
                    "An imported transaction has an invalid date.",
                ))?,
                amount: inflow
                    .checked_sub(outflow)
                    .ok_or(ImportError::InvalidValue(
                        "An imported HUF amount is out of range.",
                    ))?,
                payee: get("payee").into(),
                memo: get("memo").into(),
                flag: get("flag").to_ascii_lowercase(),
                cleared,
            });
        }
        let mut used = vec![false; candidates.len()];
        let mut pairs = Vec::new();
        for index in 0..candidates.len() {
            if used[index] {
                continue;
            }
            let left = &candidates[index];
            let matches = (0..candidates.len())
                .filter(|other| {
                    !used[*other] && *other != index && reciprocal(left, &candidates[*other])
                })
                .collect::<Vec<_>>();
            if matches.len() == 1 {
                let other = matches[0];
                let reverse_matches = (0..candidates.len())
                    .filter(|candidate| {
                        !used[*candidate]
                            && *candidate != other
                            && reciprocal(&candidates[other], &candidates[*candidate])
                    })
                    .count();
                if reverse_matches == 1 {
                    used[index] = true;
                    used[other] = true;
                    pairs.push((index, other));
                }
            }
        }
        for (left_index, right_index) in &pairs {
            let left = &candidates[*left_index];
            let right = &candidates[*right_index];
            let (out, incoming) = if left.amount < 0 {
                (left, right)
            } else {
                (right, left)
            };
            let amount = out.amount.checked_abs().ok_or(ImportError::InvalidValue(
                "An imported HUF amount is out of range.",
            ))?;
            let mut ids = [out.row_id.as_str(), incoming.row_id.as_str()];
            ids.sort();
            let transfer_id = import_id(&summary.batch_id, "transfer", &ids.join(":"));
            let out_id = import_id(&summary.batch_id, "transaction", &out.row_id);
            let in_id = import_id(&summary.batch_id, "transaction", &incoming.row_id);
            transaction.execute(
                "INSERT INTO transfers (id,amount_huf,outflow_id,inflow_id) VALUES (?1,?2,?3,?4)",
                params![transfer_id, amount, out_id, in_id],
            )?;
            insert_import_transfer_leg(
                &transaction,
                summary,
                out,
                &out_id,
                &transfer_id,
                "outflow",
            )?;
            insert_import_transfer_leg(
                &transaction,
                summary,
                incoming,
                &in_id,
                &transfer_id,
                "inflow",
            )?;
        }
        transaction.commit()?;
        Ok(TransferMaterializationSummary {
            paired_transfer_count: pairs.len(),
            unresolved_row_count: used.iter().filter(|used| !**used).count(),
        })
    }
}

#[derive(Serialize, Deserialize)]
struct RawCsvRow {
    cells: Vec<String>,
}

struct ParsedCsvFile {
    source_file: String,
    rows: Vec<Vec<String>>,
}

impl Database {
    /// Stages an entire export in one transaction. A parse or database failure
    /// leaves no partial batch behind.
    pub fn stage_ynab_zip(
        &mut self,
        source_name: &str,
        source_bytes: &[u8],
        as_of: &CalendarDate,
    ) -> ImportResult<ImportValidationSummary> {
        if source_name.trim().is_empty() {
            return Err(ImportError::InvalidValue(
                "An import file name is required.",
            ));
        }
        if source_bytes.is_empty() {
            return Err(ImportError::InvalidValue("The selected export is empty."));
        }

        let sha256 = hex_sha256(source_bytes);
        let batch_id = format!("ynab-{sha256}");
        let (parsed_files, archive_file_count, skipped_files) = parse_zip(source_bytes)?;
        let summary = summarize(
            &batch_id,
            &sha256,
            archive_file_count,
            skipped_files,
            &parsed_files,
            as_of,
        );

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if transaction
            .query_row(
                "SELECT 1 FROM import_batches WHERE sha256=?1",
                [&sha256],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some()
        {
            return Err(ImportError::DuplicateArchive);
        }
        transaction.execute(
            "INSERT INTO import_batches (id,source_name,source_bytes,sha256) VALUES (?1,?2,?3,?4)",
            params![batch_id, source_name, source_bytes, sha256],
        )?;
        for file in &parsed_files {
            for (index, cells) in file.rows.iter().enumerate() {
                let row_id = format!("{batch_id}:{}:{}", file.source_file, index + 1);
                let raw_data = serde_json::to_string(&RawCsvRow {
                    cells: cells.clone(),
                })?;
                transaction.execute(
                    "INSERT INTO import_rows (id,batch_id,source_file,row_number,raw_data) VALUES (?1,?2,?3,?4,?5)",
                    params![row_id, batch_id, file.source_file, index as i64 + 1, raw_data],
                )?;
            }
        }
        transaction.commit()?;
        Ok(summary)
    }
}

fn parse_zip(source_bytes: &[u8]) -> ImportResult<(Vec<ParsedCsvFile>, usize, Vec<String>)> {
    let mut archive = ZipArchive::new(Cursor::new(source_bytes))
        .map_err(|error| ImportError::InvalidArchive(error.to_string()))?;
    let mut files = Vec::new();
    let mut skipped_files = Vec::new();
    let mut source_names = HashSet::new();
    let mut uncompressed_size = 0u64;
    let mut archive_file_count = 0usize;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| ImportError::InvalidArchive(error.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        archive_file_count += 1;
        let source_file = entry.name().to_owned();
        if entry.enclosed_name().is_none() {
            return Err(ImportError::InvalidArchive(format!(
                "Unsafe archive path: {source_file}"
            )));
        }
        if !source_names.insert(source_file.clone()) {
            return Err(ImportError::InvalidArchive(format!(
                "Duplicate archive file name: {source_file}"
            )));
        }
        uncompressed_size = uncompressed_size
            .checked_add(entry.size())
            .ok_or_else(|| ImportError::InvalidArchive("Archive is too large.".into()))?;
        if uncompressed_size > MAX_UNCOMPRESSED_ARCHIVE_BYTES {
            return Err(ImportError::InvalidArchive("Archive is too large.".into()));
        }
        let delimiter = match source_file
            .rsplit_once('.')
            .map(|(_, extension)| extension.to_ascii_lowercase())
            .as_deref()
        {
            Some("csv") => b',',
            Some("tsv") => b'\t',
            _ => {
                skipped_files.push(source_file);
                continue;
            }
        };
        let mut contents = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut contents).map_err(|error| {
            ImportError::InvalidArchive(format!("Could not read {source_file}: {error}"))
        })?;
        files.push(ParsedCsvFile {
            source_file: source_file.clone(),
            rows: parse_delimited(&source_file, &contents, delimiter)?,
        });
    }
    files.sort_by(|left, right| left.source_file.cmp(&right.source_file));
    skipped_files.sort();
    Ok((files, archive_file_count, skipped_files))
}

fn parse_delimited(
    source_file: &str,
    contents: &[u8],
    delimiter: u8,
) -> ImportResult<Vec<Vec<String>>> {
    let contents = contents
        .strip_prefix(&[0xef, 0xbb, 0xbf])
        .unwrap_or(contents);
    let mut reader = ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delimiter)
        .from_reader(Cursor::new(contents));
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|error| ImportError::InvalidDelimited {
            source_file: source_file.to_owned(),
            message: error.to_string(),
        })?;
        rows.push(string_record_cells(&record));
    }
    Ok(rows)
}

fn string_record_cells(record: &StringRecord) -> Vec<String> {
    record.iter().map(str::to_owned).collect()
}

fn summarize(
    batch_id: &str,
    sha256: &str,
    archive_file_count: usize,
    skipped_files: Vec<String>,
    parsed_files: &[ParsedCsvFile],
    as_of: &CalendarDate,
) -> ImportValidationSummary {
    let mut warnings = Vec::new();
    if parsed_files.is_empty() {
        warnings.push("The archive contains no CSV or TSV files to stage.".into());
    }
    if !skipped_files.is_empty() {
        warnings.push(format!(
            "{} non-delimited source file(s) remain preserved in the archive but have no row staging.",
            skipped_files.len()
        ));
    }

    let mut account_names = BTreeSet::new();
    let mut category_names = BTreeSet::new();
    let mut categories = Vec::new();
    let mut seen_categories = HashSet::new();
    let mut payee_names = BTreeSet::new();
    let mut flag_names = BTreeSet::new();
    let mut latest_transaction_date: Option<String> = None;
    let mut future_transaction_count = 0usize;
    let mut register_row_count = 0usize;
    let mut raw_row_count = 0usize;
    let mut data_row_count = 0usize;
    let mut files = Vec::new();

    for file in parsed_files {
        let headers = file.rows.first().cloned().unwrap_or_default();
        let normalized_headers = headers
            .iter()
            .map(|value| normalize_header(value))
            .collect::<Vec<_>>();
        let kind = classify(&normalized_headers);
        let header_count = usize::from(!headers.is_empty());
        let file_data_row_count = file.rows.len().saturating_sub(header_count);
        raw_row_count += file.rows.len();
        data_row_count += file_data_row_count;
        if kind == SourceFileKind::Unknown && !headers.is_empty() {
            warnings.push(format!(
                "{} has unrecognized headers and remains raw staging only.",
                file.source_file
            ));
        }
        if kind == SourceFileKind::Register {
            register_row_count += file_data_row_count;
            if field(&normalized_headers, "account").is_none() {
                warnings.push(format!(
                    "{} looks like a register but has no Account column; its account is not inferred from the file path.",
                    file.source_file
                ));
            }
        }

        for row in file.rows.iter().skip(header_count) {
            let account_index = field(&normalized_headers, "account").or_else(|| {
                if kind == SourceFileKind::Accounts {
                    field(&normalized_headers, "name")
                } else {
                    None
                }
            });
            if let Some(name) = value(row, account_index) {
                add_name(&mut account_names, name);
            }
            if let Some(name) = value(row, field(&normalized_headers, "category")) {
                add_name(&mut category_names, name);
                if let Some(group) = value(row, field(&normalized_headers, "category group")) {
                    if !group.trim().is_empty() && !name.trim().is_empty() {
                        let imported = ImportedCategory {
                            group_name: group.trim().into(),
                            name: name.trim().into(),
                        };
                        if seen_categories.insert(imported.clone()) {
                            categories.push(imported);
                        }
                    }
                }
            } else if let Some(name) =
                value(row, field(&normalized_headers, "category group/category"))
            {
                add_name(&mut category_names, name);
            }
            if let Some(name) = value(row, field(&normalized_headers, "payee")) {
                add_name(&mut payee_names, name);
            }
            if let Some(name) = value(row, field(&normalized_headers, "flag")) {
                add_name(&mut flag_names, name);
            }
            if kind == SourceFileKind::Register {
                if let Some(date) = value(row, field(&normalized_headers, "date")) {
                    match parse_export_date(date) {
                        Some(parsed) => {
                            if latest_transaction_date
                                .as_ref()
                                .is_none_or(|latest| parsed.as_str() > latest)
                            {
                                latest_transaction_date = Some(parsed.as_str().into());
                            }
                            if parsed.as_str() > as_of.as_str() {
                                future_transaction_count += 1;
                            }
                        }
                        None if !date.trim().is_empty() => warnings.push(format!(
                            "{} has a transaction date that was not counted because its format is ambiguous: {}.",
                            file.source_file,
                            date.trim()
                        )),
                        None => warnings.push(format!("{} has a register row without a date.", file.source_file)),
                    }
                } else {
                    warnings.push(format!(
                        "{} has a register row without a Date column.",
                        file.source_file
                    ));
                }
            }
        }
        files.push(ImportFileSummary {
            source_file: file.source_file.clone(),
            kind,
            headers,
            raw_row_count: file.rows.len(),
            data_row_count: file_data_row_count,
        });
    }
    warnings.push("Transfers, account types, cleared states, ledger balances, and cross-export transaction duplicates are not inferred during raw staging; they require the explicit mapping phase.".into());
    ImportValidationSummary {
        batch_id: batch_id.into(),
        sha256: sha256.into(),
        archive_file_count,
        delimited_file_count: parsed_files.len(),
        raw_row_count,
        data_row_count,
        register_row_count,
        account_names: account_names.into_iter().collect(),
        category_names: category_names.into_iter().collect(),
        categories,
        payee_names: payee_names.into_iter().collect(),
        flag_names: flag_names.into_iter().collect(),
        latest_transaction_date,
        future_transaction_count,
        files,
        warnings,
    }
}

fn normalize_header(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn classify(headers: &[String]) -> SourceFileKind {
    let has = |name| headers.iter().any(|header| header == name);
    if has("date") && (has("outflow") || has("inflow") || has("amount")) {
        SourceFileKind::Register
    } else if (has("account") || has("name")) && has("type") {
        SourceFileKind::Accounts
    } else if has("category") && has("category group") {
        SourceFileKind::Categories
    } else if has("month") && has("category") {
        SourceFileKind::Budget
    } else {
        SourceFileKind::Unknown
    }
}

fn field(headers: &[String], expected: &str) -> Option<usize> {
    headers.iter().position(|header| header == expected)
}

fn value<'a>(row: &'a [String], index: Option<usize>) -> Option<&'a str> {
    index.and_then(|index| row.get(index)).map(String::as_str)
}

fn add_name(names: &mut BTreeSet<String>, value: &str) {
    let trimmed = value.trim();
    if !trimmed.is_empty() {
        names.insert(trimmed.into());
    }
}

fn parse_export_date(value: &str) -> Option<CalendarDate> {
    let value = value.trim();
    if let Ok(date) = CalendarDate::parse(value) {
        return Some(date);
    }
    let parts = value.split('/').collect::<Vec<_>>();
    if parts.len() != 3
        || parts
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return None;
    }
    let (year, month, day) = if parts[0].len() == 4 {
        // Modern YNAB TSV exports use the unambiguous yyyy/mm/dd form.
        (parts[0], parts[1], parts[2])
    } else if parts[2].len() == 4 {
        // Older CSV exports use the locale-specific month/day/year form.
        (parts[2], parts[0], parts[1])
    } else {
        return None;
    };
    CalendarDate::parse(&format!("{year:0>4}-{month:0>2}-{day:0>2}")).ok()
}

/// Parses integer HUF text without floating point or rounding. Spaces are
/// accepted only as digit grouping and the optional currency suffix is exact.
pub fn parse_huf(value: &str) -> ImportResult<i64> {
    let trimmed = value.trim();
    let number = trimmed.strip_suffix("Ft").unwrap_or(trimmed).trim();
    if number.is_empty() {
        return Ok(0);
    }
    let unsigned = number.strip_prefix('-').unwrap_or(number);
    let groups = unsigned.split(' ').collect::<Vec<_>>();
    let grouped_correctly = groups.len() == 1
        || ((1..=3).contains(&groups[0].len())
            && groups.iter().skip(1).all(|group| group.len() == 3));
    if unsigned.is_empty()
        || !grouped_correctly
        || groups
            .iter()
            .any(|group| group.is_empty() || !group.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err(ImportError::InvalidValue(
            "An imported HUF amount has an unsupported format.",
        ));
    }
    let compact = number.replace(' ', "");
    compact
        .parse()
        .map_err(|_| ImportError::InvalidValue("An imported HUF amount is out of range."))
}

fn is_transfer_like(payee: &str, combined_category: &str) -> bool {
    let category = combined_category.trim().to_ascii_lowercase();
    transfer_target(payee).is_some() || category == "category not needed"
}

fn transfer_target(payee: &str) -> Option<&str> {
    let (prefix, target) = payee.split_once(':')?;
    let prefix = prefix.trim().to_ascii_lowercase();
    let target = target.trim();
    ((prefix == "transfer" || prefix == "payment") && !target.is_empty()).then_some(target)
}

fn source_flag_color(flag: &str) -> Option<&'static str> {
    let color = flag
        .trim()
        .split_once(" - ")
        .map_or(flag.trim(), |value| value.0)
        .trim();
    match color.to_ascii_lowercase().as_str() {
        "red" => Some("red"),
        "orange" => Some("orange"),
        "yellow" => Some("yellow"),
        "green" => Some("green"),
        "blue" => Some("blue"),
        "purple" => Some("purple"),
        _ => None,
    }
}

fn parse_cleared(value: &str) -> ImportResult<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "uncleared" => Ok("uncleared"),
        "cleared" => Ok("cleared"),
        "reconciled" => Ok("reconciled"),
        _ => Err(ImportError::InvalidValue(
            "An imported cleared state is unknown.",
        )),
    }
}

fn reciprocal(left: &TransferCandidate, right: &TransferCandidate) -> bool {
    left.amount != 0
        && left.account == right.target
        && left.target == right.account
        && left.date.as_str() == right.date.as_str()
        && left.amount.checked_neg() == Some(right.amount)
}

type StagedRow = (String, String, i64, String);

fn load_staged_rows(transaction: &Transaction<'_>, batch_id: &str) -> ImportResult<Vec<StagedRow>> {
    let mut query = transaction.prepare("SELECT id,source_file,row_number,raw_data FROM import_rows WHERE batch_id=?1 ORDER BY source_file,row_number")?;
    let rows = query
        .query_map([batch_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn insert_import_transfer_leg(
    transaction: &Transaction<'_>,
    summary: &ImportValidationSummary,
    candidate: &TransferCandidate,
    id: &str,
    transfer_id: &str,
    direction: &str,
) -> ImportResult<()> {
    let flag_id = source_flag_color(&candidate.flag).map(|color| format!("flag-{color}"));
    transaction.execute(
        "INSERT INTO transactions (id,account_id,transaction_date,payee_id,memo,flag_id,cleared_state,posting_state,origin,import_row_id,transfer_id,transfer_direction) VALUES (?1,?2,?3,?4,?5,?6,?7,'posted','import',?8,?9,?10)",
        params![id, import_id(&summary.batch_id, "account", &candidate.account), candidate.date.as_str(), import_id(&summary.batch_id, "payee", &candidate.payee), candidate.memo, flag_id, candidate.cleared, candidate.row_id, transfer_id, direction],
    )?;
    Ok(())
}

fn hex_sha256(source: &[u8]) -> String {
    format!("{:x}", Sha256::digest(source))
}

fn import_id(batch_id: &str, kind: &str, source: &str) -> String {
    format!(
        "import-{kind}-{}",
        hex_sha256(format!("{batch_id}:{source}").as_bytes())
    )
}
