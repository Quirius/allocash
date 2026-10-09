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
scheduling workflow; the core never posts it merely because time passed.

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
Loans and Tracking are off-budget. The Plan uses this classification; it does not
determine an imported transaction's income category.

Closing an account changes its visibility group, preserving its kind, order and
transactions. Its historical balances remain queryable after closure or reopening.
Referenced categories, accounts, payees and flags cannot be deleted out from under
the ledger. Memos, flags and import provenance remain attached to each entry.

IDs are caller-supplied opaque strings. Names are not identities and need not be
unique. The importer must assign stable IDs, preserve original order and resolve
ambiguities explicitly. Raw archives and parsed rows are retained; staging and
cross-export duplicate signals are implemented. See [architecture.md](architecture.md) for import rules.

## Transfers

New register entries accept `Transfer: <account>` and `Payment: <account>` in
the payee field as linked transfers to an exact, unambiguous open account.
Missing, closed, ambiguous and same-account destinations are rejected before
saving. Ordinary payees continue to create ordinary transactions.

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
same pair model. Transfer identity lets reports distinguish movements from ordinary
income/spending; implemented report and Plan semantics are described below.

## Plan cash and credit spending

The Plan replays posted on-budget activity one calendar month at a time, through
an explicit as-of date for the desktop view and export comparison. Future-dated
entries remain in the ledger but do not yet change Plan Activity or Available. An
imported YNAB Budget row's `Assigned` amount can populate the matching
category/month assignment without replacing an existing edit. The importer keeps
source `Activity` and `Available` values for later comparison; Plan activity and
balances continue to be derived from posted ledger entries and account mappings.
Each closed month carries positive category money forward and resets a negative
category balance. Cash overspending reduces Ready to Assign in the next month;
credit overspending is card debt and does not reduce Ready to Assign. Closed-month
cash overspending is classified after automatic card-payment funding and payment
deltas, so a payment category covered within that month is not counted as
uncovered cash spending.

A category money move atomically subtracts from the source month's Assigned
and adds to the destination month's Assigned. Moves require two distinct valid
categories and a positive integer HUF amount, but may exceed source Available.
Negative assignments and availability are allowed; checked arithmetic still
rejects overflow without applying either side. Ready to Assign is unchanged in
the moved month, while existing overspending/rollover rules still apply later.

YNAB's `Inflow: Ready to Assign` category remains on imported ledger entries for
the register. Plan routes its cash activity into the separate Ready to Assign
balance rather than showing it as a spendable category. Credit inflows categorized
to Ready to Assign, or left uncategorized, fund it only to the extent that they
increase a positive card balance; reducing card debt alone does not create spendable money. A cash-to-card
payment that creates a positive card balance also adds that surplus to Ready to
Assign. Credit-to-cash advances add the cash inflow to Ready to Assign, excluding
the part drawn from an existing positive card balance, which was already funded.
The cash leg retains its own posted date and as-of eligibility. Transfers between
on-budget accounts remain outside ordinary category activity. When a
posted transfer crosses between a cash/credit account and a tracking/loan account,
the on-budget leg uses its source category for Plan activity; an uncategorized or
Ready to Assign cash leg changes Ready to Assign. An equivalent credit leg funds
Ready to Assign only through its positive-balance change. The off-budget leg never
funds categories.

Within a category/month, cash spending and the portions of card purchases
covered by positive card balances have first claim on the category's available
money. Remaining funded money moves to the mapped card-payment category for
eligible card purchases in date order. Positive-balance-covered portions do not
fund a payment category and behave like cash spending when classifying
overspending. Card refunds reverse the payment movement. A
posted cash-to-credit transfer reduces the
mapped payment category without changing Ready to Assign. Scheduled rows and
transfers wholly within or outside the budget do not affect Plan activity.

The cash-advance and positive-card-balance rules follow YNAB's documented
[cash advance](https://support.ynab.com/en_us/credit-card-cash-advances-an-overview-Hy6PmlOC9)
and [positive balance](https://support.ynab.com/en_us/credit-cards-with-a-positive-balance-an-overview-By_H6uzJo)
behavior. Imported history and assignments remain unchanged; these are derived
Plan calculations.

## Plan targets

Monthly targets are advisory: they never automatically assign money or change
Ready to Assign, Activity or Available. A target revision takes effect in its
selected month, so future changes do not rewrite historical Plan guidance. An
inactive revision clears a target from that month forward.

`Set aside another` needs its full amount every month. `Refill up to` needs the
difference between its amount and the category's nonnegative opening Available
amount. Both report Funding and To Go from that month's positive assigned amount;
current-month spending and refunds do not alter progress. The initial target
slice supports monthly, quarterly and yearly targets with a day-of-month or
last-day due marker; targets never auto-assign money.

Quarterly/yearly definitions store an explicit first due month. The first cycle
starts at the revision's effective month and ends in that due month; later cycles
repeat every three or twelve months. `Set aside another` requires new assignments
equal to the full amount each cycle. `Refill up to` subtracts the cycle's positive
opening Available balance from that total. Previous net assignments within the
cycle reduce the remaining funding; spending during the cycle does not create
another funding requirement. Needed This Month is the remaining amount divided
by inclusive months through the due month, rounded up to whole HUF. Current-month
positive Assigned supplies Funded, capped at Needed. For periodic targets, To Go
subtracts signed current-month Assigned from Needed, clamped at zero, so removing
money in the current month increases the remaining funding gap.
Snoozed months show zero guidance, and later months catch up on remaining funding.

A target can be snoozed for one category and one month. Snoozing retains the
target definition but reports zero Needed, Funded and To Go for that month; it
does not alter the budget's money. Resuming removes only that month's snooze,
and adjacent months continue to use their normal target guidance.

## Reconciled edits

Memo-only edits are allowed without confirmation. Account, date, payee, category,
flag, amount and clearing-state changes away from Reconciled, and deletions require
explicit confirmation for reconciled entries. Shared transfer amount changes
check both legs, so the unreconciled side cannot bypass a reconciled counterpart's
warning. Budget-boundary category changes also check the budget leg when editing
from its counterpart. Other per-leg metadata changes check the selected leg. Ordinary transactions
can move to another open account and change sign; linked transfer account and
direction remain fixed in register editing. Confirmation allows the
change; history is not hard-locked. Basic reconciliation reviews an account's
cleared balance through an inclusive date, lets the owner match each eligible
posted uncleared/cleared account leg, and then promotes only cleared rows to
Reconciled. Future, scheduled and already reconciled rows remain unchanged.
An adjustment is an explicit fallback for genuinely missing history, not the
normal way to resolve unmatched transaction states.

Manual entry and pending schedules use budget-aware category validation. New
tracking/loan transactions and transfers staying within one budget scope have no
category. Cash/credit inflows default to the semantic Ready to Assign category;
if none exists, it is created atomically with the saved action. Budget outflows
require an explicit category. A crossing transfer stores the category only on
its budget leg, including when entered or edited from the off-budget side.
Imported history remains unchanged, and metadata-only edits retain legacy
off-budget categories. These input rules do not change the import contract or
the confirmed reconciliation-adjustment pathway.

## Recurring schedules

The register composer provides Date and Repeat (Never, Monthly, Quarterly,
Yearly). New future-dated entries with Never become one-time pending schedules,
represented by an end date equal to their start date. Current/past entries with
Never retain manual-entry behavior. Choosing recurrence creates a pending
schedule from the selected date. Existing posted future history is unchanged.
Pending entries can be posted or skipped from the register, from either transfer
leg, in the unified upcoming section. There is no automatic posting on the due date.

Schedules support monthly, quarterly and yearly ordinary income/expenses and
linked account transfers. They materialize one Uncleared, pending occurrence at
a time, with both entries for a transfer. Posting explicitly turns that occurrence
into posted ledger history and creates the next occurrence; skipping records the
skipped occurrence and advances instead. Recurrence retains the start date's
original day, clamping short months to their last day. Pending rows are excluded
from balances and the Plan. Register editing updates the pending occurrence and
its recurrence template, preserving posted history and pending identities. A
scheduled transfer keeps its direction/accounts, shares pending dates, amount,
memo and flag changes, and places a budget-boundary category on its on-budget leg.
Editing from either leg shows the shared pending category. Scheduled rows remain
Uncleared until posted. Register deletion cancels the template and removes its
pending occurrence; it uses the existing pre-deletion safety backup.
An optional end date prevents generation after its inclusive date. Canceling a
schedule removes its pending occurrence, including both linked transfer entries,
but preserves every posted occurrence as ledger history. A budget-boundary
transfer's category belongs to its on-budget entry regardless of the entered side.

## Spending reports

Spending by Category and Spending by Payee are read-only tables over posted
outflows in an inclusive date range. They group by category identity or payee
respectively, include cash and credit accounts by default, and can be restricted
to selected accounts. The on-budget leg of a transfer to a tracking or loan
account counts as spending; transfers within the budget, scheduled rows, and
inflows/refunds are excluded from these spending magnitude views.

Inflow / Outflow is a dense monthly view over the same inclusive scope. It uses
posted, nonzero ordinary entries and the on-budget legs of transfers crossing
to tracking or loan accounts: positive amounts are gross inflows, negative
amounts are positive outflow magnitudes, and difference is inflow minus outflow.
Thus ordinary refunds and reimbursements appear as gross inflows rather than
reducing a prior expense. Months without activity remain in the response so a
later chart has a continuous series.

Income vs Expense uses that same gross-entry scope, but keeps positive and
negative activity separate by category and group. A category with both signs
therefore appears in both sections. It preserves stored group/category order,
including hidden history; null categories form a final `Uncategorized` row.
It returns month-aligned category amounts, period/month totals, monthly averages
rounded to the nearest HUF with half-forint ties away from zero, and a savings
ratio in integer basis points when income is nonzero.

Balance Over Time is a separate, dense as-of working-balance series. Its first
point is the inclusive `from` date, intermediate points are calendar month ends,
and its final point is the inclusive `to` date. It includes all account kinds
and closed history by default; its account selection is independent of activity
reports. Transfers remain included exactly as ledger movements, so a transfer
between two selected accounts nets out while selecting one side changes that
selected aggregate. Pending scheduled rows are excluded until posted.

Outflow Over Time is a dense monthly gross-outflow series. It uses posted
negative ordinary entries and the on-budget legs of transfers to tracking or
loan accounts in the activity-report account scope, with positive refunds
excluded rather than netted. Optional category selection
matches stable category identities; choosing `Uncategorized` explicitly includes
null-category history. Its category series preserve stored order and are aligned
to every returned month, including zero-activity months.

Income Breakdown treats payees as income sources and category groups as aggregate
expense destinations. It includes posted nonzero ordinary entries in the
activity-report account scope; null payees are `No payee` and null expense
categories form a final `Uncategorized` group. For a transfer crossing from a
tracking/loan account into cash/credit, the off-budget account name is the income
source. A categorized transfer out of the budget is an expense. This preserves
the owner's Capital Gains routing as one income source. Transfers within the
budget remain excluded. The visual joins sources to Total Income and
expenses from Total Expenses; its net gain or shortfall is period-level only and
never traces individual funds.

Forecasting is a deterministic, read-only monthly bootstrap. It starts from the
selected accounts' exact posted balance as of the chosen date, then samples whole
completed historical months of posted, non-transfer ordinary activity. This keeps
observed income/expense relationships and irregular months instead of adding
average-based noise. Transfers remain in the starting balance but are never
sampled as future activity. Active recurring schedules and early-posted future
schedule occurrences are added deterministically, while schedule-origin history
is excluded from the bootstrap to prevent double-counting. A category filter
limits negative ordinary activity only, because income sources are payees rather
than budget categories. Scheduled transfer legs share their pair's category filter:
categorized budget-boundary transfers must match the selected category, while
uncategorized internal transfers retain both selected legs so filtering cannot
create money. Account scope still determines which legs affect the projection.

Net Worth is a separate as-of projection: it sums the signed posted working
balances of every account kind, including closed, loan and tracking accounts.
Transfers remain included there because their two legs net to zero across the
complete account set. Pending scheduled rows remain excluded until posted.

## Validation boundary

The core has tests for migration backup/rollback, WAL-safe backups, transfer
integrity across all account types, exact amounts, calendar dates, future/scheduled
entries, reconciliation guards, closed history and persistence across reopening.
These anonymized tests are separate from owner-data validation. See
[status.md](status.md) for the historical reference match and remaining gates.
