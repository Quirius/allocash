# Import, backup and integrity requirements

Owner requirements moved from the original project brief. These describe intended
behavior and scope, not completion status. See [status](status.md) for implementation
and validation limits; read only sections relevant to the task.

## Native backup/export

This is critical.

The application must provide a lossless native format because YNAB export does not preserve every feature.

Possible format:

- portable SQLite database
- and/or archive such as `.sbudget`

Native backup must preserve:

- accounts
- account group/order
- transactions
- linked transfers
- categories and ordering
- targets
- target snoozes
- scheduled definitions
- generated scheduled instances
- flags
- cleared/reconciled states
- payee memory
- settings
- notes
- schema version
- useful report preferences

Also support open exports where practical:

- CSV
- TSV
- JSON

The user must never be locked into the app.

## Automatic backups

Recommended:

- backup before import
- backup before schema migration
- backup before destructive bulk operations
- periodic timestamped backups
- configurable retention later

Never overwrite the only known-good budget during import.

## YNAB import

Current test dataset is a YNAB ZIP export.

Known characteristics:

- historical Plan data
- Register transactions
- future/scheduled-looking transactions
- recurrence definitions may be missing
- target definitions may be missing

Importer responsibilities:

1. Preserve raw source files.
2. Parse all accounts.
3. Parse all transactions.
4. Preserve account names.
5. Preserve categories.
6. Preserve payees.
7. Preserve memos.
8. Preserve cleared/reconciled status.
9. Preserve flags where possible.
10. Detect/link transfers where reliable.
11. Preserve future transactions.
12. Preserve historical Plan amounts.
13. Avoid incorrectly including future uncleared scheduled entries in current real balances.
14. Produce a migration summary.
15. Warn on ambiguous mappings.

Never silently discard rows.

## Import validation

v0.1 should include a validation summary.

Useful checks:

- transaction count
- account count
- category count
- per-account balance
- cleared balance
- reconciled balance if derivable
- latest transaction date
- future transaction count
- unresolved transfer pairs
- unknown categories
- unknown flags
- duplicate detection

Where known YNAB screenshots/reference values exist, compare against them.

Balance disagreements must be investigated before later phases.

## Data integrity

Strongly recommended:

- enable SQLite foreign keys
- version schema migrations
- use SQL transactions for multi-step financial writes
- validate transfer pairs
- make balances reproducible from ledger where appropriate
- store money as integers
- retain import/source identifiers
- avoid destructive import overwrite
- preserve historical objects rather than deleting them unnecessarily

Financial invariants should have tests.

## Testing priorities

### Transfers

Test:

- budget↔budget
- cash→credit payment
- budget↔tracking
- budget↔loan
- amount edits
- paired deletion
- cleared-state asymmetry

### Balances

Test:

- manual transactions
- scheduled uncleared entries
- future transactions
- reconciled history
- closed accounts

### Budget

Test:

- assignment
- spending
- rollover
- overspending
- moving money
- refill targets
- set-aside targets

### Import

Test:

- no lost rows
- duplicate prevention
- future entries
- transfer detection
- account type mapping
- closed accounts

Use anonymized fixtures in the repository.

## Security and privacy

This application handles personal financial data.

Requirements:

- offline-first
- no telemetry by default
- no analytics by default
- no automatic external upload
- no cloud database
- no real YNAB export committed to public Git
- avoid sensitive details in logs

Use anonymized test data in Git.
