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

Native backup/export must preserve recurrence rules exactly.

## Targets

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
- notes if practical

Do not reconstruct historical Plan solely from current balances if imported YNAB Plan data contains historical assignment state. Preserve source history.

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
