# Allocash architecture

The project root is `allocash/`; local development tooling lives under its ignored
`.tools/` directory. The desktop app is named Allocash and uses the identifier
`com.quirius.allocash`. Rust's package and library names are `allocash` and
`allocash_lib`, respectively.

## Boundaries

React owns presentation; Rust owns SQLite and financial writes. The frontend uses
typed Tauri commands rather than executing arbitrary SQL. There are no network,
filesystem or shell plugins exposed to the webview. Assets and fonts are local.

`src/lib/desktop.ts` is the IPC boundary. A browser preview explicitly reports
that local storage is unavailable. It never substitutes localStorage or fake data.

`src-tauri/src/database.rs` owns the connection. Foreign keys are enabled on open,
a busy timeout handles brief lock contention, and an immediate SQL transaction
protects schema initialization. A mutex serializes access within the application.
Initialization errors leave the UI open with retry; database contents are not logged.

## Storage, money and dates

Schema version 1 contains the single budget's settings; later immutable migrations
add the ledger, Plan, targets and monthly schedules through version 8. SQLite
`user_version` tracks the migration version. Upgrades reserve the write lock, save
and verify a standalone SQLite backup, and apply migrations atomically. The desktop
app also exposes an on-demand native backup. Both paths use SQLite's online backup
API through a separate read connection, include committed WAL data, convert the copy
to a self-contained journal mode, verify `quick_check`, schema version and foreign
keys, sync it, then atomically persist a unique `.sqlite3` file in `backups/` beside
the database. A failed backup prevents an upgrade; a failed migration rolls back
while retaining the verified backup. Backups are intentionally never deleted or
overwritten. They protect against local mistakes or corruption, not disk loss, so
the owner should copy an important backup elsewhere. Initialization refuses populated
unversioned databases and unsupported versions. Restore is deliberately separate:
it needs connection handoff, a pre-restore snapshot, validation and recovery UX.
The desktop command layer also creates a required safety snapshot immediately before
register deletion (including both transfer legs) and schedule deactivation, which
removes a pending occurrence. It validates the action before snapshotting to avoid
unnecessary files for rejected requests, holds the database mutex across snapshot
and mutation, and aborts the mutation if the snapshot fails. Skipping a schedule
occurrence and reversible Plan configuration changes are intentionally excluded.

The ledger uses signed 64-bit integer forints. Rust must use checked
integer arithmetic. Money crosses JSON IPC as decimal strings and becomes `bigint`
in TypeScript; JavaScript floating point is never used for financial calculations.
Formatting already supports the full signed 64-bit range without rounding.

Transaction dates use validated `yyyy-mm-dd` calendar strings and display as
`yyyy.mm.dd.`. A transaction date is not a UTC timestamp. Use timestamps only for
audit metadata such as creation time.

## Status and requirements

See [status.md](status.md) for implemented slices and release evidence, and the
[documentation map](README.md) for the owner's topic-specific requirements.

## Ledger schema decisions

Account kind (`cash`, `credit`, `loan`, `tracking`) is independent of its closed
state, so closing/reopening preserves type and history. Names need not be unique:
imported identifiers and explicit sort order determine identity and presentation.
Foreign keys restrict deletion of referenced accounts, categories, payees and flags.

Normal transactions store a signed integer amount. Transfers store one positive
amount in `transfers`, with an outflow and inflow transaction referencing it.
Deferred composite foreign keys require both correctly linked legs at commit;
unique constraints and triggers prevent extra legs or transfers to the same account.
The read-only `ledger_entries` view derives the two signed amounts. Each leg keeps
its own date, category, memo, flag and cleared/posting state, preserving imported
history even when the dates or states differ. Pair operations must use SQL transactions.

`posting_state` distinguishes scheduled instances from posted ledger activity;
scheduled instances must be uncleared. `scheduled_origin_id` is opaque provenance
and is not itself a recurrence rule. Monthly recurrence definitions and occurrence
tracking are stored separately by migration 8.

`import_batches` stores the original archive bytes and their SHA-256 hash;
`import_rows` preserves every CSV/TSV row as its parsed cells with file/row coordinates.
A transaction can link to its source row, with duplicate use of that row rejected.
The staging parser rejects malformed CSV atomically, detects exact duplicate
archives, and reports source-level account/category/payee/flag/date counts and
warnings. Ledger mapping and cross-export transaction duplicate detection are
implemented; historical Plan materialization belongs to the next importer phase.
No account types are inferred. Before ledger mapping begins, every staged account
must have exactly one explicit kind/closed-state mapping.
Mapped category groups, categories and payees use deterministic source-derived
IDs and are inserted atomically in source order; imported flag colors reuse the
six stable Allocash flag identities, while unknown colors abort the operation.
Ordinary register rows parse HUF text directly to checked integers and retain
their source-row provenance, dates, metadata and clearing state. Rows that look
like transfers or payments remain in staging until both legs can be paired and
validated; no one-sided account movement is written as ordinary spending.
Transfer materialization requires reciprocal legs with the same accounts, date and
exact opposite nonzero amount. Repeated equal transfers are paired as a balanced
group only when the memo/flag multisets also match; each source leg keeps its own
metadata and provenance. Zero-value, one-sided and otherwise ambiguous pairs stay
in raw staging and appear in the unresolved-row count.

Post-materialization validation keeps source and imported transaction counts
separate, reports any ordinary or transfer-like rows still unmaterialized, and
calculates working, cleared, uncleared and reconciled balances per mapped account
as of an explicit calendar date. It also reports future rows, unknown category or
flag values, repeated rows within an export, and matching rows across staged
exports. Future transactions remain in history but are excluded from earlier
as-of balances.

`compare_ynab_net_worth` parses the matching Net Worth TSV as UTF-8, selects the
month containing the explicit as-of date, excludes the summary row, and compares
the exact account-name/value sets. The `verify_ynab_export` example runs staging,
all materialization passes and this comparison in a disposable database while
reporting counts only. The 2026-09-14 owner reference matched 34 of 34 accounts;
four zero-value transfer rows remain staged without affecting balances.

## Core API

`src-tauri/src/ledger.rs` exposes typed operations on `Database` for accounts,
categories/payees, transactions, transfers, status changes and as-of balances.
Writes that touch multiple rows or inspect reconciled state reserve a write
transaction. Failed writes roll back; edits to a transfer amount use its canonical
record, and deleting either leg deletes the complete pair. Memo-only edits need
no confirmation. Other implemented changes to reconciled amounts/states or paired
deletions require an explicit confirmation argument from the UI.

Tauri commands expose a workspace snapshot with ordered account groups, as-of
balances and form options, then resolve one selected account's register rows.
Payee, category, flag and transfer-counterparty names are joined in Rust so the
frontend never executes SQL. Financial values remain decimal strings through IPC
and become `bigint` only for parsing and formatting in React. Typed desktop mutation
commands create normal transactions and paired transfers, update an entry, or delete
an ordinary/paired entry; Rust keeps the writes atomic and enforces reconciled-history
confirmation.

The default Cargo feature is `desktop`. Disabling it permits the actual SQLite
and ledger tests to run without Tauri, using the same database implementation.
Rust dependencies are locked in `src-tauri/Cargo.lock`.
