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

## Plan cash and credit spending

The Plan replays posted on-budget activity one calendar month at a time. Each
closed month carries positive category money forward and resets a negative
category balance. Cash overspending reduces Ready to Assign in the next month;
credit overspending is card debt and does not reduce Ready to Assign.

Within a category/month, cash spending has first claim on the category's
available money. Remaining funded money moves to the mapped card-payment
category for card spending, allocated in the account presentation order. Card
refunds reverse that movement. A posted cash-to-credit transfer reduces the
mapped payment category without changing Ready to Assign. Scheduled, off-budget
and ordinary transfer rows do not affect Plan activity.

## Plan targets

Monthly targets are advisory: they never automatically assign money or change
Ready to Assign, Activity or Available. A target revision takes effect in its
selected month, so future changes do not rewrite historical Plan guidance. An
inactive revision clears a target from that month forward.

`Set aside another` needs its full amount every month. `Refill up to` needs the
difference between its amount and the category's nonnegative opening Available
amount. Both report Funding and To Go from that month's positive assigned amount;
current-month spending and refunds do not alter progress. The initial target
slice supports monthly targets with a day-of-month or last-day due marker; it
does not auto-assign or support other frequencies.

A target can be snoozed for one category and one month. Snoozing retains the
target definition but reports zero Needed, Funded and To Go for that month; it
does not alter the budget's money. Resuming removes only that month's snooze,
and adjacent months continue to use their normal target guidance.

## Reconciled edits

Memo-only edits are allowed without confirmation. Amount changes, clearing-state
changes away from Reconciled and deletions require explicit confirmation for
reconciled entries. Shared transfer changes check both legs, so the unreconciled
side cannot bypass a reconciled counterpart's warning. Confirmation allows the
change; history is not hard-locked. Date/account/category editing and the
reconciliation UI are future operations and must apply the same rule.

## Monthly schedules

The first scheduling slice supports ordinary monthly income and expense schedules,
not recurring transfers. It materializes one uncleared, pending occurrence at a
time. Posting explicitly turns that same row into posted ledger history and creates
the next month (clamping dates such as the 31st to the month's last day); skipping
records the skipped occurrence and advances instead. Pending rows are excluded
from balances and the Plan, and cannot be edited or deleted through the generic
register actions.
An optional end date prevents generation after its inclusive date. Canceling a
schedule removes its pending occurrence but preserves every posted occurrence as
ordinary ledger history.

## Spending reports

Spending by Category and Spending by Payee are read-only tables over posted
ordinary outflows in an inclusive date range. They group by category identity
or payee respectively, include cash and credit accounts by default, and can be
restricted to selected accounts. Transfers, scheduled rows, and inflows/refunds
are excluded from these spending magnitude views.

Net Worth is a separate as-of projection: it sums the signed posted working
balances of every account kind, including closed, loan and tracking accounts.
Transfers remain included there because their two legs net to zero across the
complete account set. Pending scheduled rows remain excluded until posted.

## Validation boundary

The core has tests for migration backup/rollback, WAL-safe backups, transfer
integrity across all account types, exact amounts, calendar dates, future/scheduled
entries, reconciliation guards, closed history and persistence across reopening.
These are anonymized examples, not a claim that imported YNAB balances match yet.
