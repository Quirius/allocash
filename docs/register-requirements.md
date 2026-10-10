# Account and register requirements

Owner requirements moved from the original project brief. These describe intended
behavior and scope, not completion status. See [status](status.md) for implementation
and validation limits; read only sections relevant to the task.

## Amount entry

All monetary entry fields select their full contents on focus or click. Typing a
plain number replaces the selected value; typing `+`, `-`, `*` or `/` first uses
the selected existing amount as the left operand. For example, `+3000` applied
to a selected `3000` becomes `6000`. Expressions use normal precedence and may
include parentheses. Tab or Enter commits the field; Escape restores its value
from before editing. Plan assignments save on blur, while transaction, schedule,
target and reconciliation forms retain their existing validation/save workflow.
Only whole HUF results in the applicable signed range are accepted, with no
silent rounding; invalid drafts remain available for correction.

## Category names

Category names can be edited from the selected category's Plan sidebar using
Rename, followed by Save or Cancel. Enter saves and Escape cancels the name edit;
failed saves preserve the draft. Names are trimmed and must contain 1–200 Unicode
characters. Renaming preserves category identity, transactions, assignments,
targets, notes and credit payment mappings, refreshes Register/Reports category
choices, and participates in saved-action undo. The special Ready to Assign
classification cannot be changed through renaming.

## Account model

Top-level account groups must appear in this order:

1. Cash
2. Credit
3. Loans
4. Tracking
5. Closed

Preserve user-defined order within each group.

### On-budget

Only:

- Cash
- Credit

participate in category budgeting.

### Off-budget

- Loans
- Tracking

affect net worth and relevant reports but do not fund budget categories.

### Closed

Closed accounts:

- remain in the database unless explicitly deleted after being emptied
- preserve full history
- appear under Closed
- can be reopened
- must never lose transaction history when reopened

### Account editing and explicit deletion

Right-clicking an account opens Edit Account; the register also offers an Edit
account button. Nickname and persistent notes are editable without changing its
ID or account kind. For open accounts, Working Balance is the posted balance
through today. Saving a changed balance creates one cleared adjustment dated
today, with Ready to Assign for budget accounts and no category for off-budget
accounts. The displayed balance is checked again before saving; stale or invalid
changes fail atomically. Cancel does not write. Close/Re-open preserves history.
Active repeat rules involving the account must be stopped before closing it.

The owner explicitly permits deleting a closed account only after manually
emptying it. Delete remains disabled while transactions or transfers remain,
including future and scheduled rows. Register deletion retains existing paired
transfer, reconciliation confirmation and backup safeguards; removing history
can change Plan values. Account deletion requires confirmation and a verified
backup, rejects linked schedule history, and removes only empty account metadata,
its payment mapping and orphan repeat definitions. Categories, assignments,
targets and raw import records remain. Editing, close/reopen and deletion can be
undone within the session.

## Money and date formatting

Base currency: HUF.

Preferred display:

`1 234 567 Ft`

Preferred date format:

`yyyy.mm.dd.`

Financial values must never use binary floating point.

Prefer integer forints internally.

## Transaction model

Required transaction fields include:

- account
- date
- payee
- category
- memo
- outflow
- inflow
- flag
- cleared state
- reconciled state
- transfer linkage
- scheduled-origin metadata where relevant
- source/import identifiers where useful

### Split transactions

The user does not use split transactions in their normal workflow.

Do not prioritize them.

The schema may leave room to add them later without destructive migration.

## Manual transaction behavior

Normal manually created transaction:

- defaults to ****Cleared****

Scheduled transaction:

- defaults to ****Uncleared****
- is entered in the register using Date and Repeat, without requiring a separate
  scheduler menu
- Repeat belongs inside the date/calendar dropdown, with Never as the new-entry
  default; monthly, quarterly and yearly remain the supported migration frequencies
- a future date with Repeat Never creates one pending occurrence; Monthly,
  Quarterly and Yearly repeat from the selected date
- can be posted or skipped directly in either account's register; a scheduled
  transfer acts on both linked legs together
- can be edited using the register editor, including Date and Repeat; changes
  update the pending entry and future repeats while preserving posted history
- deleting an upcoming entry stops its repeats and removes the pending entry
  (both linked legs for transfers), with the normal safety backup
- remains excluded from posted balances and Plan until posted

The account register is the owner's schedule workspace; do not expose a separate
Scheduled tab. Pending scheduled entries and all ordinary transactions dated
after today appear together at the top, visually muted and separated from
transactions through today. Imported future rows retain their cleared state and
ordinary transaction identity; displaying them as upcoming does not invent a
recurrence rule or change financial posting semantics. Pending schedules retain
their register Edit, Post and Skip actions.

A posted transaction through today offers Make repeating below its date in the
editor. It opens a separate new draft copied from the stored transaction, dated
the next occurrence strictly after today of the original day in the current or
next month, with Monthly selected. If that day is unavailable, use the last day
of that month. Keep the original day as the recurrence anchor when this default
date is saved; changing the draft date selects a new anchor.
Payee, category, memo, flag and signed amount are preserved; transfers preserve
their selected account and counterpart. Opening or canceling the draft performs
no writes and never changes the original transaction or its reconciled state.
Only saving creates the new recurring entry, using the normal atomic schedule
and linked-transfer paths.

Transfer counterpart:

- manually entered side is Cleared
- automatically generated paired side is Uncleared

Example:

User enters in OTP:

`OTP -> Cash | 10 000 Ft`

Expected:

- OTP side: Cleared
- Cash counterpart: Uncleared

This behavior is intentional.

## Transfers

Transfers must be first-class linked pairs.

Examples:

- `Transfer: Cash`
- `Transfer: Revolut`
- `Transfer: Erste Credit`
- `Payment: OTP Garmin Loan`

Requirements:

- paired sides remain linked
- editing an amount updates both sides safely
- deleting one side handles the other consistently
- account balances remain correct
- transfer flows must not be reported as ordinary spending/income where YNAB-like behavior requires exclusion
- support budget↔budget, budget↔tracking, budget↔loan, and cash↔credit transfers

Reporting semantics for transfers are important.

Category entry follows the budget boundary. Cash and credit accounts are in the
budget; tracking and loan accounts are outside it. New ordinary off-budget
transactions have no category. Budget inflows default to Ready to Assign, while
budget outflows require an explicit category choice without a remembered payee
default. An explicitly selected inflow category remains valid for refunds.

Transfers between two budget accounts or two off-budget accounts have no category.
For a transfer crossing the boundary, only the budget leg has a category: money
entering the budget defaults to Ready to Assign, and money leaving requires an
explicit choice. Entry and editing from either account use that same budget-side
category. These rules also apply to pending and repeating transactions. Imported
history is preserved; unrelated edits do not erase legacy off-budget categories.

## Reimbursement workflow

The owner deliberately avoids split transactions.

Typical case:

1. A 1,000 Ft expense is paid for two people.
2. The transaction is flagged for correction.
3. The other person later repays 500 Ft, possibly into a different account.
4. The logical situation is represented with separate transactions:
   - 500 Ft real expense
   - 500 Ft transfer/reimbursement-related movement
5. Memo may say `common costs`.

Memos and flags are important. Do not force this into split transactions.

## Flags

Support six editable flags.

Current preferred setup:

1. Red — `Unknown problem...`
2. Orange — `Correction`
3. Yellow — `Check`
4. Green
5. Blue
6. Purple — `WTH is this??`

Persist:

- name
- color
- ordering
- stable identity

Native backups must preserve them.

## Cleared and reconciled states

Distinguish:

- Uncleared
- Cleared
- Reconciled

When editing a reconciled transaction:

- memo-only edits should be allowed without warning
- edits to date, amount, account, category, transfer linkage, etc. should warn
- the user may still proceed after confirmation

Do not hard-lock reconciled history.

Reconciliation must allow comparing app balance with the real account balance.

## Payee autocomplete

Payee entry is high priority.

Remember whether a payee usually receives inflows or outflows where it improves
entry speed. Category history can remain stored, but budget outflows require an
explicit category choice. Selecting a payee must not supply that choice silently.

## Keyboard navigation

Transaction entry should work efficiently without the mouse.

`Tab` should move logically between fields.

Requirements:

- predictable tab order
- skip irrelevant fields where practical
- payee autofill should influence focus intelligently
- Enter should commit where appropriate
- avoid focus traps

Keyboard entry speed matters more than animation.

## Date entry

Use:

- compact date field
- dropdown calendar
- easy keyboard entry

Display:

`2026.09.10.`

## Credit accounts

Credit cards are on-budget.

Known examples:

- OTP Credit
- Erste Credit

Need YNAB-like handling for:

- credit spending
- payment category behavior
- transfers/payments from cash accounts
- outstanding balances
- reconciliation

Do not treat credit purchases as immediate cash-account outflows.

## Loans

Loans are off-budget.

Current loans are 0% and mainly tracked by transactions.

Known example:

`OTP Garmin Loan`

For early versions:

- balance tracking
- payment transfers
- simple progress display
- minimum payment metadata
- due-day/payoff metadata where useful

Leave room later for:

- interest rate
- amortization
- payoff estimate
- simulator

Advanced loan simulation is not a v0.1 blocker.

## Tracking / asset accounts

Tracking accounts are off-budget.

They affect net worth and reports when selected, but require no budget categories.

Examples include:

- PMÁP accounts
- investment accounts
- gold
- Pokémon collection
- rent deposit
- Civic
- portfolios

Some may be maintained through manual balance adjustments rather than market-price APIs.

No live investment pricing is required.

## Capital Gains workflow

The user uses a tracking account named `Capital Gains`.

Purpose:

Investment/asset withdrawals may pass through it so ordinary income-source reports are not inflated by transfers from assets.

Important:

- do not automatically treat every tracking→budget transfer as salary/income
- reports must distinguish transfer flows from true income
- preserve the user's manual routing/category choices

The final YNAB dataset may be cleaned up before final migration.

## Undo saved actions

Ctrl+Z reverses the latest saved budgeting action, with an Undo button showing
which action is available. Creation, edits and deletion include complete linked
transfers and associated recurring state. Plan assignments, money moves, targets,
snoozes, card-payment mapping and account reconciliation are undoable actions.
The same backend action boundary supports account metadata and closed-state
changes. It does not add an account-management screen.

One action creates one undo step. Repeated undo walks backward through up to 30
saved actions in the current app session. Reopening the app or successfully
restoring a backup clears the session history. There is no redo command in this
slice. Failed saves do not replace the latest valid undo step. Typing in inputs,
text areas or editable text retains the field's native Ctrl+Z behavior. Undo is
unavailable while a saved mutation or restore is in progress; new saved actions
cannot interleave with undo and its view refresh. All balances and active views
refresh after undo, preserving selected Plan month and report filters.
