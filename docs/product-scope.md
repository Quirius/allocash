# Product scope and milestones

Owner requirements moved from the original project brief. These describe intended
behavior and scope, not completion status. See [status](status.md) for implementation
and validation limits; read only sections relevant to the task.

## Core goals

The application must:

- Run locally on Windows 11.
- Work fully offline.
- Require no login.
- Require no cloud backend.
- Require no banking APIs.
- Use HUF as the base currency.
- Store persistent data locally in SQLite.
- Import YNAB exports.
- Provide a lossless native backup/export format.
- Support manual transaction entry as the primary workflow.
- Match YNAB's Plan/Register behavior closely enough for a comfortable migration.
- Preserve long-term historical reporting.
- Remain straightforward to extend later.

Priority order:

1. Accounting correctness
2. Import correctness
3. Fast keyboard-driven manual input
4. Familiar YNAB behavior
5. Reliable backups
6. Visual polish

Exact pixel-level cloning is not required. Workflow similarity is.

## Recommended technology stack

Default architecture:

- ****Desktop shell:**** Tauri
- ****Frontend:**** React + TypeScript
- ****Database:**** SQLite
- ****Styling:**** CSS/Tailwind or equivalent lightweight approach
- ****Charts:**** capable local JavaScript charting library
- ****Installer:**** native Windows installer produced by Tauri
- ****Testing:**** unit and integration tests around financial logic, imports, transfers, and budgeting

Avoid Electron unless there is a strong technical reason to switch.

Core functionality must never require an internet connection.

## Development philosophy

Do not try to build the entire application at once.

Build in testable layers and validate each accounting layer against imported real YNAB data before continuing.

Preferred order:

1. Data model
2. YNAB importer
3. Accounts/register
4. Transfers and reconciliation
5. Budget engine
6. Scheduled transactions
7. Targets
8. Reports
9. Forecasting
10. UI polish and installer

Whenever behavior is uncertain, prefer:

- deterministic logic
- explicit state
- reversible schema migrations
- source-data preservation
- tests
- clear warnings over silent guesses

Do not start the full Plan engine until imported transactions and account balances are trustworthy.

## Milestones

### v0.1 — Import + Accounts + Register

Implement:

- SQLite schema and migrations
- YNAB ZIP import
- account sidebar
- account groups
- closed accounts
- transaction register
- manual transaction entry
- transfers
- payees
- categories
- memos
- flags
- cleared / uncleared / reconciled state
- date handling
- account balances
- basic reconciliation
- import validation report

Goal: historical transactions and balances match YNAB before budget logic is added.

### v0.2 — Plan / Budget Engine

Implement:

- monthly Plan screen
- category groups
- Assigned
- Activity
- Available
- Ready to Assign
- month rollover
- overspending
- moving money between categories
- credit-card payment category behavior
- category snoozing
- category notes if practical
- hidden categories if needed

Goal: imported historical Plan values should reproduce YNAB behavior closely enough to validate the engine.

### v0.3 — Scheduling / Targets / Workflow

Implement:

- scheduled transactions
- recurring rules
- target definitions
- target snoozing
- reconciliation UX
- transaction flag editor
- payee autofill memory
- keyboard navigation
- reconciled-transaction warnings

### v0.4 — Reports

Implement:

- Net Worth
- Inflow / Outflow
- Spending by Category
- Spending by Payee
- Income vs Expense
- Income Breakdown / Sankey
- Balance Over Time
- Outflow Over Time
- optional Days of Buffering indicator

All reports should support useful date/account/category filters.

### v0.5 — Forecasting

Implement Monte Carlo forecasting with:

- forecast horizon selection
- account/category inclusion filters
- future balance paths
- percentile paths:
  - 10%
  - 25%
  - 50%
  - 75%
  - 90%

Model inputs should eventually include:

- historical spending distributions
- income distributions
- recurring scheduled transactions
- seasonality
- category-level behavior where useful

Do not reduce this to simple average ± random noise if avoidable.

### v1.0 — Migration-ready release

Must include:

- Windows installer
- reliable automatic/local backups
- native export/import
- migration test against final YNAB export
- account-balance verification
- Plan verification
- report verification
- automatic backup before migrations/imports
- good user-facing error handling

## UI direction

The user likes the current YNAB desktop layout.

General direction:

- dark theme
- left account sidebar
- central Plan/Register workspace
- contextual right-side panel where useful
- dense readable tables
- strong keyboard workflow
- familiar green/red financial status cues

Do not copy proprietary branding/assets.

Functional similarity is the objective.

## Scope limits

One budget only.

Do not spend early development time on:

- bank APIs
- cloud sync
- mobile app
- web backend
- multi-user collaboration
- live investment pricing
- advanced loan simulation
- receipt OCR
- AI categorization
- split transactions

## Final migration strategy

Development uses the current YNAB export only as a test dataset.

Before cancelling YNAB, the owner plans to:

1. clean remaining bookkeeping inconsistencies
2. create one final YNAB export
3. import it
4. recreate targets if YNAB omitted definitions
5. recreate recurrence rules if needed
6. validate all current account balances
7. validate recent Plan months
8. validate reports
9. create a native backup
10. then cancel YNAB

Migration is complete only when expected state is reproduced.

## Confirmed product decisions

- Windows 11 desktop: ****yes****
- One budget: ****yes****
- Fully local: ****yes****
- HUF base currency: ****yes****
- Bank APIs: ****no****
- Manual transaction entry: ****yes****
- Split transactions: ****not needed initially****
- Scheduled transactions: ****yes****
- Category snoozing: ****yes****
- Reconciliation: ****yes****
- Transaction flags: ****yes****
- Loan support: ****basic now, expandable later****
- Target system: ****yes****
- Balance Over Time: ****yes****
- Outflow Over Time: ****yes****
- Monte Carlo Forecast: ****yes****
- Native lossless backup/export: ****required****
- YNAB import: ****required****

## Definition of success

The project succeeds when the owner can cancel YNAB and continue budgeting locally without losing the workflow they rely on.

The finished application should be able to:

- import the final YNAB history
- reproduce current balances
- preserve all historical transactions
- budget month by month
- track credit cards correctly
- move money between categories
- manage targets
- manage recurring transactions
- reconcile accounts
- track loans/assets
- report historical behavior
- forecast future balances
- export/restore the entire application state
- operate indefinitely without a subscription or internet connection
