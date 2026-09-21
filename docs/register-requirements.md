# Account and register requirements

Owner requirements moved from the original project brief. These describe intended
behavior and scope, not completion status. See [status](status.md) for implementation
and validation limits; read only sections relevant to the task.

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

- remain in the database
- preserve full history
- appear under Closed
- can be reopened
- must never lose transaction history when reopened

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

Remember useful payee defaults such as:

- last category
- whether it was usually inflow or outflow
- other useful recent behavior if it improves entry speed

Example:

Selecting `Spar` should likely prefill:

- category: Groceries
- direction: Outflow

If the payee is normally income, the form should avoid unnecessary focus in Outflow.

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
