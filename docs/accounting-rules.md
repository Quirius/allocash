# Ledger accounting rules

## Money and balance dates

All amounts are signed integer forints. Ordinary inflows are positive, outflows
negative, and zero-value historical entries are allowed. Opening balances must
be ordinary dated ledger entries; there is no separate mutable account balance.

`Huf` serializes to canonical decimal JSON strings, including the full signed
64-bit range. JSON numbers, fractional strings, separators and out-of-range values
are rejected. Frontend code can convert the strings to `bigint` for formatting.

Balances are calculated from `ledger_entries` through an explicit, inclusive
`yyyy-mm-dd` cutoff. Only `posted` entries on or before that date count. Future
entries and scheduled instances are preserved in the register but excluded.
An overdue scheduled instance remains excluded until explicitly posted by a
future scheduling workflow; the core never posts it merely because time passed.

- Working balance includes all qualifying entries.
- Cleared balance includes cleared and reconciled entries.
- Uncleared balance includes only uncleared entries.
- Reconciled balance includes only reconciled entries.

Working equals cleared plus uncleared. Checked integer accumulation uses a wider
integer accumulator and rejects final totals outside the signed 64-bit range.
No floating-point aggregate, rounding or silent saturation is used.

## Accounts and historical records

Presentation order is Cash, Credit, Loans, Tracking, Closed, with explicit order
within each group and stable IDs to break ties. Cash and Credit are on-budget;
Loans and Tracking are off-budget. This classification does not implement the
Plan engine or determine an imported transaction's income category.

Closing an account changes its visibility group, preserving its kind, order and
transactions. Its historical balances remain queryable after closure or reopening.
Referenced categories, accounts, payees and flags cannot be deleted out from under
the ledger. Memos, flags and import provenance remain attached to each entry.

IDs are caller-supplied opaque strings. Names are not identities and need not be
unique. The importer must assign stable IDs, preserve original order and resolve
ambiguities explicitly. Raw archives and rows have storage slots now; the parser
and cross-export duplicate detection are the next phase.

## Transfers

A transfer stores one strictly positive integer amount and exactly two linked
entries. The view derives a negative outflow and positive inflow. Deferred foreign
keys ensure both legs belong to that transfer at commit, and a transfer must use
two different accounts. Amount changes affect both legs; deleting either leg
deletes the pair in one SQL transaction. Any failure rolls back the entire write.

The manually entered side defaults to Cleared and its automatically created
counterpart to Uncleared. This applies whether the user entered the inflow or
outflow side. Ordinary manual entries default to Cleared; scheduled entries are
Uncleared and explicitly marked Scheduled.

Each leg retains its own date, category, memo, flag and cleared/posting state.
Therefore an as-of balance can include one leg before the other when the source
dates or posting states differ. The full pair's signed amounts always sum to zero.
Import must not change historical dates to force both sides into the same period.

Cash/credit payments, budget-to-tracking movements and loan payments use this
same pair model. Transfer identity is retained for later reports to distinguish
movements from ordinary income/spending; report and category-budget semantics are
not implemented in this phase.

## Reconciled edits

Memo-only edits are allowed without confirmation. Amount changes, clearing-state
changes away from Reconciled and deletions require explicit confirmation for
reconciled entries. Shared transfer changes check both legs, so the unreconciled
side cannot bypass a reconciled counterpart's warning. Confirmation allows the
change; history is not hard-locked. Date/account/category editing and the
reconciliation UI are future operations and must apply the same rule.

## Validation boundary

The core has tests for migration backup/rollback, WAL-safe backups, transfer
integrity across all account types, exact amounts, calendar dates, future/scheduled
entries, reconciliation guards, closed history and persistence across reopening.
These are anonymized examples, not a claim that imported YNAB balances match yet.
