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

The first schema contains only the single budget's name and HUF currency setting.
SQLite `user_version` is the migration version. `0001_budget.sql` is immutable once
released. Later schema changes require a new migration, pre-migration backup and
tests for rollback and preserved data. Initialization refuses populated unversioned
databases and versions this app does not understand. No down migration deletes data.

The ledger migration will use signed 64-bit integer forints. Rust must use checked
integer arithmetic. Money crosses JSON IPC as decimal strings and becomes `bigint`
in TypeScript; JavaScript floating point is never used for financial calculations.
Formatting already supports the full signed 64-bit range without rounding.

Transaction dates will use validated `yyyy-mm-dd` calendar strings and display as
`yyyy.mm.dd.`. A transaction date is not a UTC timestamp. Use timestamps only for
audit metadata such as creation time.

## Next implementation slice

1. Add a tested ledger migration: ordered accounts with independent closed state,
   category groups/categories, payees, stable flags and transaction source metadata.
2. Define transfers as linked pairs with transactional writes; preserve the specified
   cleared/uncleared asymmetry. Define scheduled versus posted instances explicitly.
3. Preserve raw YNAB export files and parse into staging data. Never silently drop a
   row or guess an ambiguous account type, flag, transfer or scheduled entry.
4. Validate imported counts and as-of account balances with anonymized fixtures,
   then the owner's local export. Only then expose register/manual entry workflows.

Reconciliation and the Plan engine follow trustworthy imports and account balances.
The complete scope and financial behavior are in the owner's project brief.
