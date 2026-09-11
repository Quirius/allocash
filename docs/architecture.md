# Allocash foundation and next steps

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

Schema version 1 contains the single budget's settings. Version 2 adds the ledger,
categories, payees, flags and raw import staging. SQLite `user_version` tracks the
migration version. Published migrations are immutable. Upgrades reserve the write
lock, save and verify a standalone SQLite backup, and apply migrations atomically.
The backup uses a separate read connection while the write reservation prevents
concurrent writers; WAL data is included. A failed backup prevents the upgrade,
and a failed migration rolls back while retaining the verified backup. Initialization
refuses populated unversioned databases and unsupported versions.

The ledger uses signed 64-bit integer forints. Rust must use checked
integer arithmetic. Money crosses JSON IPC as decimal strings and becomes `bigint`
in TypeScript; JavaScript floating point is never used for financial calculations.
Formatting already supports the full signed 64-bit range without rounding.

Transaction dates use validated `yyyy-mm-dd` calendar strings and display as
`yyyy.mm.dd.`. A transaction date is not a UTC timestamp. Use timestamps only for
audit metadata such as creation time.

## Next implementation slice

1. Preserve raw YNAB export files and parse into staging data. Never silently drop a
   row or guess an ambiguous account type, flag, transfer or scheduled entry.
2. Validate imported counts and as-of account balances with anonymized fixtures,
   then the owner's local export. Only then expose register/manual entry workflows.

Reconciliation and the Plan engine follow trustworthy imports and account balances.
The complete scope and financial behavior are in the owner's project brief.

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
until recurrence definitions arrive in a later migration. It is not a recurrence rule.

`import_batches` stores the original archive bytes and their SHA-256 hash;
`import_rows` preserves every CSV/TSV row as its parsed cells with file/row coordinates.
A transaction can link to its source row, with duplicate use of that row rejected.
The staging parser rejects malformed CSV atomically, detects exact duplicate
archives, and reports source-level account/category/payee/flag/date counts and
warnings. Cross-export transaction duplicate detection, historical Plan
preservation, and ledger mapping belong to the next importer phase. No imported
categories or account types are inferred here. Before ledger mapping begins,
every staged account must have exactly one explicit kind/closed-state mapping.
Mapped category groups, categories and payees use deterministic source-derived
IDs and are inserted atomically in source order; imported flag colors reuse the
six stable Allocash flag identities, while unknown colors abort the operation.

## Core API

`src-tauri/src/ledger.rs` exposes typed operations on `Database` for accounts,
categories/payees, transactions, transfers, status changes and as-of balances.
Writes that touch multiple rows or inspect reconciled state reserve a write
transaction. Failed writes roll back; edits to a transfer amount use its canonical
record, and deleting either leg deletes the complete pair. Memo-only edits need
no confirmation. Other implemented changes to reconciled amounts/states or paired
deletions require an explicit confirmation argument from a future UI.

The core API is not exposed as Tauri commands yet; the existing desktop command
still only opens the database and returns budget details. Import/register work
will add the user-facing operations after imported balances are validated.

The default Cargo feature is `desktop`. Disabling it permits the actual SQLite
and ledger tests to run without Tauri, using the same database implementation.
Rust dependencies are locked in `src-tauri/Cargo.lock`.
