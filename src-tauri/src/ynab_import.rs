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
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashSet},
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
    pub payee_names: Vec<String>,
    pub flag_names: Vec<String>,
    pub latest_transaction_date: Option<String>,
    pub future_transaction_count: usize,
    pub files: Vec<ImportFileSummary>,
    pub warnings: Vec<String>,
}

/// An explicit owner decision for an imported account. YNAB's current TSV
/// export has account names but no trustworthy account-kind/closed metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountImportMapping {
    pub source_name: String,
    pub kind: AccountKind,
    pub closed: bool,
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

fn hex_sha256(source: &[u8]) -> String {
    format!("{:x}", Sha256::digest(source))
}
