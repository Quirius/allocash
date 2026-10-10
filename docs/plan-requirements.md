# Plan, schedule and target requirements

Owner requirements moved from the original project brief. These describe intended
behavior and scope, not completion status. See [status](status.md) for implementation
and validation limits; read only sections relevant to the task.

## Scheduled transactions

Scheduled transactions are essential.

YNAB exports may include future transaction instances while losing recurrence definitions, so recurrence must be a separate stored object.

Suggested schedule fields:

- id
- account
- payee
- category
- amount
- memo
- flag
- inflow/outflow direction
- repeat rule
- next occurrence
- start date
- optional end date
- active/inactive
- created timestamp

Example:

`OTP -> OTP Garmin Loan | 7 325 Ft | Monthly | 6th`

Current known behavior:

- repeating transactions typically repeat on the same calendar day monthly
- scheduled transactions are Uncleared
- recurrence rules may be reviewed/recreated manually after final YNAB migration

The migration-critical frequencies confirmed on 2026-10-05 are monthly,
quarterly and yearly, for ordinary transactions and linked account transfers.
Recurrence uses the selected start date and retains its original day of month;
short months clamp that occurrence to the last day without losing the anchor.
Scheduled transfer occurrences have two linked Uncleared entries. Posting,
skipping or canceling an occurrence handles both entries together.

Native backup/export must preserve recurrence rules exactly.

Future Uncleared ordinary entries, including imported upcoming transactions and
linked transfers, expose Repeat inside the date picker with Never as default.
Make repeating selects Monthly without advancing their existing future date.
Saving converts the existing entry or transfer pair into the first pending
occurrence in place, preserving its identity and imported provenance rather than
duplicating that occurrence. Cancel leaves both the entry and recurrence unchanged.
Already scheduled one-off entries can become repeating through the same controls.
Past entries retain the separate unsaved-copy Make repeating workflow.

## Moving assigned money

Click a category's Available amount to open a move popup anchored to that amount.
The clicked category is the fixed source; choose a destination from a grouped
dropdown, including Ready to Assign. Prefill a positive Available balance and
select it for editing; zero or negative balances start with an empty amount.
Saving subtracts from the source month's Assigned and adds the same amount to
the destination month's Assigned. Returning money to Ready to Assign reduces
only the source assignment, allowing Ready to Assign to increase through its
normal derivation. There is no separate Move Money form or source dropdown.
Cancel, Escape and outside clicks dismiss without saving. Moves remain one
undoable saved action and permit positive amounts exceeding Available, consistent
with negative assignments and balances already supported by the Plan.

## Targets

Categories mapped to budgeted credit-card payments do not offer category targets
or target snoozing. Their sidebar shows payment availability and notes instead.
Existing target definitions remain stored but are inactive in the Plan while the
category is mapped to a card; removing the mapping makes them available again.
This changes target eligibility, not card balances, funding or payment calculations.

Mapped credit payment categories show expandable Current Balance and Available
for Payment views in the sidebar. The former separates prior balance from this
month's spending/outflows and payments/inflows. The latter separates carried
payment money, Assigned, net Funded Spending and Payments Made, with Other
Activity shown when needed to explain the exact balance. Both use the Plan's
posted-entry date cutoff. The sidebar and category Available amount are red when
payment availability is negative, yellow when nonnegative payment availability
is below the outstanding card debt, and green when that debt is fully covered.
Total Underfunded includes both any negative payment availability and the
remaining card debt. These are payment warnings, independent of category targets;
Auto-Assign and debt payoff targets are omitted from this owner workflow.

YNAB target definitions may not survive export.

The user is willing to recreate targets once after migration, but the app must support comparable functionality afterward.

Required frequencies:

- Weekly
- Monthly
- Yearly
- Custom

Required due dates:

- specific day
- Last Day of Month
- equivalent recurring behavior as needed

Required target behaviors include:

### Set aside another X

Contribute the full target amount each target period regardless of leftover money.

### Refill up to X

Fund only enough to reach the target available amount.

Example:

Target: `Refill up to 20 000 Ft`

If 7,000 Ft remains from last month, only 13,000 Ft is needed.

Targets should support:

- amount
- frequency
- due date
- behavior
- snoozing
- progress display
- Needed This Month
- Funded
- To Go

Target definitions must be preserved by native backup/export.

For migration, the owner uses monthly, quarterly and yearly category targets.
Quarterly/yearly amounts are totals for their target period, funded gradually
through an explicit first due month and due-day setting. A date in the category
name is just part of its name; it never supplies target settings. Funding guidance
divides the remaining period amount by the months remaining, including the due
month, rounding up to whole HUF. After the first due month, the cycle repeats
every three or twelve months. Monthly targets retain their existing behavior.
Weekly and broader custom recurrence remain outside this migration slice.

## Category snoozing

Support snoozing a target for a selected month.

Expected behavior:

- temporarily ignore the target for that month's funding requirement
- keep the target definition intact
- snooze state is month-specific

## Plan / budget engine

Core concepts:

- Assigned
- Activity
- Available
- Ready to Assign

Requirements:

- monthly budget periods
- rollover
- category groups
- category ordering
- overspending
- money movement
- credit-card-aware behavior
- target progress
- snoozed state
- hidden categories if supported
- persistent category notes

Clicking anywhere on a category row selects it, including Assigned, Activity
and Available. Keyboard focus on the row's controls also selects it. The selected
category's balance summary, target progress, target editor and month-specific
snooze controls appear vertically in a right-hand panel, below the table on
narrow windows. The separate target form is removed. Auto-Assign is omitted from
this owner workflow.

Notes belong to the category rather than a budget month. Preserve arbitrary
text, whitespace and line breaks across month changes, reopening, and native
backup/restore. Notes save on leaving the field, with explicit save/retry feedback;
failed or still-edited drafts remain attached to their category. Saved note changes
participate in session undo. Existing target calculations and effective-month
rules remain unchanged.

Saving Plan changes refreshes the current month's data in place. Keep the table,
selection, scroll position and sidebar mounted while a save or background read
is pending. Only initial loading and changing months may replace the table with
a loading view. Stale values remain visible but financial write controls wait for
the current snapshot; refresh failures retain the last visible data and drafts.

Do not reconstruct historical Plan solely from current balances if imported YNAB Plan data contains historical assignment state. Preserve source history.

Money moves change the selected month's Assigned amounts in both categories;
Available is recalculated and Ready to Assign is unchanged. A positive move may
exceed the source category's Available amount, leaving Assigned or Available
negative. Negative Assigned and Available values are highlighted in green.

## Category structure

Preserve exact final order from imported YNAB data.

Known major groups:

- Fixed expenses
- Living expenses
- Leisure
- Giving
- Savings

Known categories include:

### Fixed expenses

- Rent 115 000 HUF on the 10th
- Utilities
- OTP Garmin Loan
- YNAB
- Boot.dev

### Living expenses

- Car maintenance
- Groceries
- Dining
- Household
- Travel
- Health
- Clothing
- Small fees
- Biggy Pank

### Leisure

- Nightlife
- Fun
- Games
- Volleyball (sports)

### Giving

- Charity
- Gifts

### Savings

- Vacation
- Savings
- Overflow

Imported ordering is authoritative.
