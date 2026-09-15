**# AGENTS.md**

**## Project: Allocash — Local YNAB-Style Budgeting App**

The project, repository and root folder are named **\*\*allocash\*\*** (renamed from

\`ynabclone\` on 2026-09-10). Display the app name as **\*\*Allocash\*\*** and use

\`com.quirius.allocash\` as the desktop identifier. The GitHub repository is

\`https\://github.com/Quirius/allocash\`.

Keep all project source, downloads, portable tools, caches and check artifacts

inside this \`allocash/\` root. Local development tools belong in the ignored

\`.tools/\` directory. Do not create a sibling tools folder or a nested

\`allocash/allocash/\` directory. Installed app budget data uses the documented

Windows application data directory.

**### Purpose**

Build a Windows 11 desktop budgeting application that closely reproduces the parts of YNAB actually used by the owner, without requiring a subscription, online account, cloud sync, bank APIs, or any remote backend.

The application should preserve the zero-based/envelope budgeting workflow, import the owner's historical YNAB data, remain fully local, and be portable enough that the user is never locked into this app either.

This project is for one user and one budget.

**### Current stage**

The v0.1 import/register validation is complete. Schema version 2, verified

pre-migration backups, typed ledger/import operations, grouped account balances,

manual transactions, paired transfers and safe register editing have native/frontend

tests. A fresh owner export matched all 34 YNAB reference working balances exactly;

four zero-value transfer rows remain preserved for review without affecting balances.

The next phase is the basic reconciliation workflow before the Plan engine. Desktop

MSVC build verification also remains outstanding.

**### Git workflow**

The owner authorizes committing and pushing after every completed, coherent edit.

Treat related file edits as one logical change; run the appropriate checks, commit

that change, and push it before moving to the next change or ending the task.

No additional confirmation is needed for these routine commits and pushes.

\- Use Conventional Commits: \`type(scope): imperative summary\`, with types such as

  \`feat\`, \`fix\`, \`refactor\`, \`test\`, \`docs\`, \`build\`, and \`chore\`.

\- Keep commits focused and independently understandable. Include relevant

  validation and any unavailable checks in the commit body when helpful.

\- Stage only files belonging to the current change; keep personal data and local

  tools ignored. Do not rewrite published history or force-push without an explicit request.

\- Push the current branch to its configured remote (currently \`main\` on \`origin\`).

  Check for remote changes and resolve divergence without discarding others' work.

\- Add and push annotated semantic-version tags for completed, verified release

  milestones, such as \`v0.1.0-alpha.1\` for a tested prerelease or \`v0.1.0\` for the

  complete v0.1 milestone. Do not tag ordinary edits or move an existing tag.

\- The initial foundation has no release tag yet: basic reconciliation and desktop

  native build verification remain before the v0.1 milestone is complete.

**### Codex model-routing policy**

The repository-local \`.codex/config.toml\` sets **\*\*GPT-5.6 Terra with High reasoning\*\***

as the main/coordinator model and **\*\*GPT-5.6 Luna with Medium reasoning\*\*** as the

default spawned subagent. Keep the main Allocash session on Terra High for normal

work; do not require the owner to manually switch the main model for routine tasks.

Model routing happens through spawned subagents. The main thread does **\*\*not\*\***

transparently change its own model mid-session. Choose the cheapest model that can

reliably complete a subtask and escalate only when the work warrants it:

\- **\*\*Luna Medium\*\***: repository exploration, searches, documentation, simple tests,

  CSS/UI polish, repetitive/mechanical edits, straightforward configuration work,

  and other low-risk tasks with a well-defined solution.

\- **\*\*Terra High\*\***: normal feature implementation, refactoring, reconciliation work,

  ordinary debugging, integration work, and moderately complex code changes.

\- **\*\*Sol High\*\***: architecture decisions, accounting invariants, schema/database

  design, Plan/budget-engine logic, difficult debugging after Terra struggles,

  consequential financial-logic review, and final review of high-risk changes.

For work that spans difficulty levels, keep Terra as coordinator and delegate the

appropriate pieces to Luna or Sol. Prefer Luna for inexpensive parallel exploration

and verification. Use explicit Sol subagents sparingly for tasks where the added

reasoning quality materially reduces financial or architectural risk.

For consequential accounting, schema, transfer, reconciliation, credit-card, or

budget-engine changes, request a Sol High review when practical before considering

the change complete. A Sol review is an additional check; the implementing agent

must still add and run the relevant deterministic tests.

If subagent model overrides are unavailable or fail in the installed Codex version,

do not claim that a task ran on another model. Continue on Terra High for ordinary

work and tell the owner when a critical task would benefit from manually selecting

Sol instead.

**---**

**## 1. Core goals**

The application must:

\- Run locally on Windows 11.

\- Work fully offline.

\- Require no login.

\- Require no cloud backend.

\- Require no banking APIs.

\- Use HUF as the base currency.

\- Store persistent data locally in SQLite.

\- Import YNAB exports.

\- Provide a lossless native backup/export format.

\- Support manual transaction entry as the primary workflow.

\- Match YNAB's Plan/Register behavior closely enough for a comfortable migration.

\- Preserve long-term historical reporting.

\- Remain straightforward to extend later.

Priority order:

1\. Accounting correctness

2\. Import correctness

3\. Fast keyboard-driven manual input

4\. Familiar YNAB behavior

5\. Reliable backups

6\. Visual polish

Exact pixel-level cloning is not required. Workflow similarity is.

**---**

**## 2. Recommended technology stack**

Default architecture:

\- **\*\*Desktop shell:\*\*** Tauri

\- **\*\*Frontend:\*\*** React + TypeScript

\- **\*\*Database:\*\*** SQLite

\- **\*\*Styling:\*\*** CSS/Tailwind or equivalent lightweight approach

\- **\*\*Charts:\*\*** capable local JavaScript charting library

\- **\*\*Installer:\*\*** native Windows installer produced by Tauri

\- **\*\*Testing:\*\*** unit and integration tests around financial logic, imports, transfers, and budgeting

Avoid Electron unless there is a strong technical reason to switch.

Core functionality must never require an internet connection.

**---**

**## 3. Development philosophy**

Do not try to build the entire application at once.

Build in testable layers and validate each accounting layer against imported real YNAB data before continuing.

Preferred order:

1\. Data model

2\. YNAB importer

3\. Accounts/register

4\. Transfers and reconciliation

5\. Budget engine

6\. Scheduled transactions

7\. Targets

8\. Reports

9\. Forecasting

10\. UI polish and installer

Whenever behavior is uncertain, prefer:

\- deterministic logic

\- explicit state

\- reversible schema migrations

\- source-data preservation

\- tests

\- clear warnings over silent guesses

Do not start the full Plan engine until imported transactions and account balances are trustworthy.

**---**

**## 4. Milestones**

**### v0.1 — Import + Accounts + Register**

Implement:

\- SQLite schema and migrations

\- YNAB ZIP import

\- account sidebar

\- account groups

\- closed accounts

\- transaction register

\- manual transaction entry

\- transfers

\- payees

\- categories

\- memos

\- flags

\- cleared / uncleared / reconciled state

\- date handling

\- account balances

\- basic reconciliation

\- import validation report

Goal: historical transactions and balances match YNAB before budget logic is added.

**### v0.2 — Plan / Budget Engine**

Implement:

\- monthly Plan screen

\- category groups

\- Assigned

\- Activity

\- Available

\- Ready to Assign

\- month rollover

\- overspending

\- moving money between categories

\- credit-card payment category behavior

\- category snoozing

\- category notes if practical

\- hidden categories if needed

Goal: imported historical Plan values should reproduce YNAB behavior closely enough to validate the engine.

**### v0.3 — Scheduling / Targets / Workflow**

Implement:

\- scheduled transactions

\- recurring rules

\- target definitions

\- target snoozing

\- reconciliation UX

\- transaction flag editor

\- payee autofill memory

\- keyboard navigation

\- reconciled-transaction warnings

**### v0.4 — Reports**

Implement:

\- Net Worth

\- Inflow / Outflow

\- Spending by Category

\- Spending by Payee

\- Income vs Expense

\- Income Breakdown / Sankey

\- Balance Over Time

\- Outflow Over Time

\- optional Days of Buffering indicator

All reports should support useful date/account/category filters.

**### v0.5 — Forecasting**

Implement Monte Carlo forecasting with:

\- forecast horizon selection

\- account/category inclusion filters

\- future balance paths

\- percentile paths:

  - 10%

  - 25%

  - 50%

  - 75%

  - 90%

Model inputs should eventually include:

\- historical spending distributions

\- income distributions

\- recurring scheduled transactions

\- seasonality

\- category-level behavior where useful

Do not reduce this to simple average ± random noise if avoidable.

**### v1.0 — Migration-ready release**

Must include:

\- Windows installer

\- reliable automatic/local backups

\- native export/import

\- migration test against final YNAB export

\- account-balance verification

\- Plan verification

\- report verification

\- automatic backup before migrations/imports

\- good user-facing error handling

**---**

**## 5. Account model**

Top-level account groups must appear in this order:

1\. Cash

2\. Credit

3\. Loans

4\. Tracking

5\. Closed

Preserve user-defined order within each group.

**### On-budget**

Only:

\- Cash

\- Credit

participate in category budgeting.

**### Off-budget**

\- Loans

\- Tracking

affect net worth and relevant reports but do not fund budget categories.

**### Closed**

Closed accounts:

\- remain in the database

\- preserve full history

\- appear under Closed

\- can be reopened

\- must never lose transaction history when reopened

**---**

**## 6. Money and date formatting**

Base currency: HUF.

Preferred display:

\`1 234 567 Ft\`

Preferred date format:

\`yyyy.mm.dd.\`

Financial values must never use binary floating point.

Prefer integer forints internally.

**---**

**## 7. Transaction model**

Required transaction fields include:

\- account

\- date

\- payee

\- category

\- memo

\- outflow

\- inflow

\- flag

\- cleared state

\- reconciled state

\- transfer linkage

\- scheduled-origin metadata where relevant

\- source/import identifiers where useful

**### Split transactions**

The user does not use split transactions in their normal workflow.

Do not prioritize them.

The schema may leave room to add them later without destructive migration.

**---**

**## 8. Manual transaction behavior**

Normal manually created transaction:

\- defaults to **\*\*Cleared\*\***

Scheduled transaction:

\- defaults to **\*\*Uncleared\*\***

Transfer counterpart:

\- manually entered side is Cleared

\- automatically generated paired side is Uncleared

Example:

User enters in OTP:

\`OTP -> Cash | 10 000 Ft\`

Expected:

\- OTP side: Cleared

\- Cash counterpart: Uncleared

This behavior is intentional.

**---**

**## 9. Transfers**

Transfers must be first-class linked pairs.

Examples:

\- \`Transfer: Cash\`

\- \`Transfer: Revolut\`

\- \`Transfer: Erste Credit\`

\- \`Payment: OTP Garmin Loan\`

Requirements:

\- paired sides remain linked

\- editing an amount updates both sides safely

\- deleting one side handles the other consistently

\- account balances remain correct

\- transfer flows must not be reported as ordinary spending/income where YNAB-like behavior requires exclusion

\- support budget↔budget, budget↔tracking, budget↔loan, and cash↔credit transfers

Reporting semantics for transfers are important.

**---**

**## 10. Reimbursement workflow**

The owner deliberately avoids split transactions.

Typical case:

1\. A 1,000 Ft expense is paid for two people.

2\. The transaction is flagged for correction.

3\. The other person later repays 500 Ft, possibly into a different account.

4\. The logical situation is represented with separate transactions:

   - 500 Ft real expense

   - 500 Ft transfer/reimbursement-related movement

5\. Memo may say \`common costs\`.

Memos and flags are important. Do not force this into split transactions.

**---**

**## 11. Flags**

Support six editable flags.

Current preferred setup:

1\. Red — \`Unknown problem...\`

2\. Orange — \`Correction\`

3\. Yellow — \`Check\`

4\. Green

5\. Blue

6\. Purple — \`WTH is this??\`

Persist:

\- name

\- color

\- ordering

\- stable identity

Native backups must preserve them.

**---**

**## 12. Cleared and reconciled states**

Distinguish:

\- Uncleared

\- Cleared

\- Reconciled

When editing a reconciled transaction:

\- memo-only edits should be allowed without warning

\- edits to date, amount, account, category, transfer linkage, etc. should warn

\- the user may still proceed after confirmation

Do not hard-lock reconciled history.

Reconciliation must allow comparing app balance with the real account balance.

**---**

**## 13. Payee autocomplete**

Payee entry is high priority.

Remember useful payee defaults such as:

\- last category

\- whether it was usually inflow or outflow

\- other useful recent behavior if it improves entry speed

Example:

Selecting \`Spar\` should likely prefill:

\- category: Groceries

\- direction: Outflow

If the payee is normally income, the form should avoid unnecessary focus in Outflow.

**---**

**## 14. Keyboard navigation**

Transaction entry should work efficiently without the mouse.

\`Tab\` should move logically between fields.

Requirements:

\- predictable tab order

\- skip irrelevant fields where practical

\- payee autofill should influence focus intelligently

\- Enter should commit where appropriate

\- avoid focus traps

Keyboard entry speed matters more than animation.

**---**

**## 15. Date entry**

Use:

\- compact date field

\- dropdown calendar

\- easy keyboard entry

Display:

\`2026.09.10.\`

**---**

**## 16. Scheduled transactions**

Scheduled transactions are essential.

YNAB exports may include future transaction instances while losing recurrence definitions, so recurrence must be a separate stored object.

Suggested schedule fields:

\- id

\- account

\- payee

\- category

\- amount

\- memo

\- flag

\- inflow/outflow direction

\- repeat rule

\- next occurrence

\- start date

\- optional end date

\- active/inactive

\- created timestamp

Example:

\`OTP -> OTP Garmin Loan | 7 325 Ft | Monthly | 6th\`

Current known behavior:

\- repeating transactions typically repeat on the same calendar day monthly

\- scheduled transactions are Uncleared

\- recurrence rules may be reviewed/recreated manually after final YNAB migration

Native backup/export must preserve recurrence rules exactly.

**---**

**## 17. Targets**

YNAB target definitions may not survive export.

The user is willing to recreate targets once after migration, but the app must support comparable functionality afterward.

Required frequencies:

\- Weekly

\- Monthly

\- Yearly

\- Custom

Required due dates:

\- specific day

\- Last Day of Month

\- equivalent recurring behavior as needed

Required target behaviors include:

**### Set aside another X**

Contribute the full target amount each target period regardless of leftover money.

**### Refill up to X**

Fund only enough to reach the target available amount.

Example:

Target: \`Refill up to 20 000 Ft\`

If 7,000 Ft remains from last month, only 13,000 Ft is needed.

Targets should support:

\- amount

\- frequency

\- due date

\- behavior

\- snoozing

\- progress display

\- Needed This Month

\- Funded

\- To Go

Target definitions must be preserved by native backup/export.

**---**

**## 18. Category snoozing**

Support snoozing a target for a selected month.

Expected behavior:

\- temporarily ignore the target for that month's funding requirement

\- keep the target definition intact

\- snooze state is month-specific

**---**

**## 19. Plan / budget engine**

Core concepts:

\- Assigned

\- Activity

\- Available

\- Ready to Assign

Requirements:

\- monthly budget periods

\- rollover

\- category groups

\- category ordering

\- overspending

\- money movement

\- credit-card-aware behavior

\- target progress

\- snoozed state

\- hidden categories if supported

\- notes if practical

Do not reconstruct historical Plan solely from current balances if imported YNAB Plan data contains historical assignment state. Preserve source history.

**---**

**## 20. Category structure**

Preserve exact final order from imported YNAB data.

Known major groups:

\- Fixed expenses

\- Living expenses

\- Leisure

\- Giving

\- Savings

Known categories include:

**### Fixed expenses**

\- Rent 115 000 HUF on the 10th

\- Utilities

\- OTP Garmin Loan

\- YNAB

\- Boot.dev

**### Living expenses**

\- Car maintenance

\- Groceries

\- Dining

\- Household

\- Travel

\- Health

\- Clothing

\- Small fees

\- Biggy Pank

**### Leisure**

\- Nightlife

\- Fun

\- Games

\- Volleyball (sports)

**### Giving**

\- Charity

\- Gifts

**### Savings**

\- Vacation

\- Savings

\- Overflow

Imported ordering is authoritative.

**---**

**## 21. Credit accounts**

Credit cards are on-budget.

Known examples:

\- OTP Credit

\- Erste Credit

Need YNAB-like handling for:

\- credit spending

\- payment category behavior

\- transfers/payments from cash accounts

\- outstanding balances

\- reconciliation

Do not treat credit purchases as immediate cash-account outflows.

**---**

**## 22. Loans**

Loans are off-budget.

Current loans are 0% and mainly tracked by transactions.

Known example:

\`OTP Garmin Loan\`

For early versions:

\- balance tracking

\- payment transfers

\- simple progress display

\- minimum payment metadata

\- due-day/payoff metadata where useful

Leave room later for:

\- interest rate

\- amortization

\- payoff estimate

\- simulator

Advanced loan simulation is not a v0.1 blocker.

**---**

**## 23. Tracking / asset accounts**

Tracking accounts are off-budget.

They affect net worth and reports when selected, but require no budget categories.

Examples include:

\- PMÁP accounts

\- investment accounts

\- gold

\- Pokémon collection

\- rent deposit

\- Civic

\- portfolios

Some may be maintained through manual balance adjustments rather than market-price APIs.

No live investment pricing is required.

**---**

**## 24. Capital Gains workflow**

The user uses a tracking account named \`Capital Gains\`.

Purpose:

Investment/asset withdrawals may pass through it so ordinary income-source reports are not inflated by transfers from assets.

Important:

\- do not automatically treat every tracking→budget transfer as salary/income

\- reports must distinguish transfer flows from true income

\- preserve the user's manual routing/category choices

The final YNAB dataset may be cleaned up before final migration.

**---**

**## 25. Native backup/export**

This is critical.

The application must provide a lossless native format because YNAB export does not preserve every feature.

Possible format:

\- portable SQLite database

\- and/or archive such as \`.sbudget\`

Native backup must preserve:

\- accounts

\- account group/order

\- transactions

\- linked transfers

\- categories and ordering

\- targets

\- target snoozes

\- scheduled definitions

\- generated scheduled instances

\- flags

\- cleared/reconciled states

\- payee memory

\- settings

\- notes

\- schema version

\- useful report preferences

Also support open exports where practical:

\- CSV

\- TSV

\- JSON

The user must never be locked into the app.

**---**

**## 26. Automatic backups**

Recommended:

\- backup before import

\- backup before schema migration

\- backup before destructive bulk operations

\- periodic timestamped backups

\- configurable retention later

Never overwrite the only known-good budget during import.

**---**

**## 27. YNAB import**

Current test dataset is a YNAB ZIP export.

Known characteristics:

\- historical Plan data

\- Register transactions

\- future/scheduled-looking transactions

\- recurrence definitions may be missing

\- target definitions may be missing

Importer responsibilities:

1\. Preserve raw source files.

2\. Parse all accounts.

3\. Parse all transactions.

4\. Preserve account names.

5\. Preserve categories.

6\. Preserve payees.

7\. Preserve memos.

8\. Preserve cleared/reconciled status.

9\. Preserve flags where possible.

10\. Detect/link transfers where reliable.

11\. Preserve future transactions.

12\. Preserve historical Plan amounts.

13\. Avoid incorrectly including future uncleared scheduled entries in current real balances.

14\. Produce a migration summary.

15\. Warn on ambiguous mappings.

Never silently discard rows.

**---**

**## 28. Import validation**

v0.1 should include a validation summary.

Useful checks:

\- transaction count

\- account count

\- category count

\- per-account balance

\- cleared balance

\- reconciled balance if derivable

\- latest transaction date

\- future transaction count

\- unresolved transfer pairs

\- unknown categories

\- unknown flags

\- duplicate detection

Where known YNAB screenshots/reference values exist, compare against them.

Balance disagreements must be investigated before later phases.

**---**

**## 29. Reports**

**### Net Worth**

Show:

\- assets

\- debts

\- net worth

\- change

\- optional debt ratio

\- date range

\- account filters

**### Inflow / Outflow**

Show monthly:

\- inflows

\- outflows

\- difference

\- savings ratio if useful

**### Spending by Category**

Support:

\- donut/pie

\- optional bar mode

\- category filters

\- account filters

\- date range

\- totals

\- averages

**### Spending by Payee**

Support:

\- donut/pie

\- optional bar mode

\- account/category/date filters

\- long-tail grouping such as \`All Other Payees\`

**### Income vs Expense**

Tabular monthly report with:

\- income groups

\- categories

\- month columns

\- average

\- total

\- net income

\- savings ratio

**### Income Breakdown / Sankey**

Desired flow:

\`Income sources -> Budget -> Category groups -> Categories / Net Gain\`

Transfers must not distort true income.

**### Balance Over Time**

Required features:

\- account filters

\- grouped/separate account view

\- group-by-type

\- trendline

\- step graph

\- optional scheduled-transaction projection

\- date range

\- hover values

**### Outflow Over Time**

Required.

Support useful account/category/date filters and trend visualization.

**### Days of Buffering**

Low priority.

May remain a small informational indicator. Do not make it central.

**---**

**## 30. Monte Carlo forecast**

Required advanced report.

It must not require investments to become on-budget accounts.

Allow the user to select what balances/accounts/categories are included.

Desired percentile paths:

\- 10%

\- 25%

\- 50%

\- 75%

\- 90%

Potential inputs:

\- historical income

\- historical category expenses

\- irregular expenses

\- seasonality

\- scheduled recurring transactions

\- known targets

\- configurable horizon

Keep simulation assumptions inspectable/configurable later.

**---**

**## 31. UI direction**

The user likes the current YNAB desktop layout.

General direction:

\- dark theme

\- left account sidebar

\- central Plan/Register workspace

\- contextual right-side panel where useful

\- dense readable tables

\- strong keyboard workflow

\- familiar green/red financial status cues

Do not copy proprietary branding/assets.

Functional similarity is the objective.

**---**

**## 32. Scope limits**

One budget only.

Do not spend early development time on:

\- bank APIs

\- cloud sync

\- mobile app

\- web backend

\- multi-user collaboration

\- live investment pricing

\- advanced loan simulation

\- receipt OCR

\- AI categorization

\- split transactions

**---**

**## 33. Data integrity**

Strongly recommended:

\- enable SQLite foreign keys

\- version schema migrations

\- use SQL transactions for multi-step financial writes

\- validate transfer pairs

\- make balances reproducible from ledger where appropriate

\- store money as integers

\- retain import/source identifiers

\- avoid destructive import overwrite

\- preserve historical objects rather than deleting them unnecessarily

Financial invariants should have tests.

**---**

**## 34. Testing priorities**

**### Transfers**

Test:

\- budget↔budget

\- cash→credit payment

\- budget↔tracking

\- budget↔loan

\- amount edits

\- paired deletion

\- cleared-state asymmetry

**### Balances**

Test:

\- manual transactions

\- scheduled uncleared entries

\- future transactions

\- reconciled history

\- closed accounts

**### Budget**

Test:

\- assignment

\- spending

\- rollover

\- overspending

\- moving money

\- refill targets

\- set-aside targets

**### Import**

Test:

\- no lost rows

\- duplicate prevention

\- future entries

\- transfer detection

\- account type mapping

\- closed accounts

Use anonymized fixtures in the repository.

**---**

**## 35. Security and privacy**

This application handles personal financial data.

Requirements:

\- offline-first

\- no telemetry by default

\- no analytics by default

\- no automatic external upload

\- no cloud database

\- no real YNAB export committed to public Git

\- avoid sensitive details in logs

Use anonymized test data in Git.

**---**

**## 36. Final migration strategy**

Development uses the current YNAB export only as a test dataset.

Before cancelling YNAB, the owner plans to:

1\. clean remaining bookkeeping inconsistencies

2\. create one final YNAB export

3\. import it

4\. recreate targets if YNAB omitted definitions

5\. recreate recurrence rules if needed

6\. validate all current account balances

7\. validate recent Plan months

8\. validate reports

9\. create a native backup

10\. then cancel YNAB

Migration is complete only when expected state is reproduced.

**---**

**## 37. Coding-agent instructions**

When working in this repository:

1\. Read this file before architectural changes.

2\. Do not casually change established financial behavior.

3\. Prefer small coherent commits.

4\. Add tests for accounting logic.

5\. Never change schema without a migration.

6\. Preserve imported source data.

7\. Avoid remote dependencies for core functionality.

8\. Keep the app fully usable offline.

9\. Keep Windows 11 as the target platform.

10\. Ask before major product-scope changes.

11\. Do not add a YNAB feature merely because YNAB has it if the owner does not use it.

12\. Prefer specified YNAB-like behavior where defined.

13\. Document ambiguity rather than making deep assumptions.

14\. Avoid premature abstraction.

15\. Keep calculations deterministic and inspectable.

**---**

**## 38. Suggested repository structure**

\`\`\`text

/

├─ AGENTS.md

├─ README.md

├─ package.json

├─ src/

│  ├─ app/

│  ├─ components/

│  ├─ features/

│  │  ├─ accounts/

│  │  ├─ transactions/

│  │  ├─ budget/

│  │  ├─ targets/

│  │  ├─ schedules/

│  │  ├─ reports/

│  │  └─ forecasting/

│  ├─ lib/

│  └─ styles/

├─ src-tauri/

│  ├─ src/

│  ├─ migrations/

│  └─ Cargo.toml

├─ tests/

│  ├─ fixtures/

│  ├─ import/

│  ├─ ledger/

│  └─ budget/

├─ docs/

│  ├─ architecture.md

│  ├─ accounting-rules.md

│  ├─ import-format.md

│  └─ roadmap.md

└─ sample-data/

   └─ README.md

\`\`\`

Do not commit the owner's real financial export to a public repository.

**---**

**## 39. Confirmed product decisions**

\- Windows 11 desktop: **\*\*yes\*\***

\- One budget: **\*\*yes\*\***

\- Fully local: **\*\*yes\*\***

\- HUF base currency: **\*\*yes\*\***

\- Bank APIs: **\*\*no\*\***

\- Manual transaction entry: **\*\*yes\*\***

\- Split transactions: **\*\*not needed initially\*\***

\- Scheduled transactions: **\*\*yes\*\***

\- Category snoozing: **\*\*yes\*\***

\- Reconciliation: **\*\*yes\*\***

\- Transaction flags: **\*\*yes\*\***

\- Loan support: **\*\*basic now, expandable later\*\***

\- Target system: **\*\*yes\*\***

\- Balance Over Time: **\*\*yes\*\***

\- Outflow Over Time: **\*\*yes\*\***

\- Monte Carlo Forecast: **\*\*yes\*\***

\- Native lossless backup/export: **\*\*required\*\***

\- YNAB import: **\*\*required\*\***

**---**

**## 40. Immediate next task**

Continue **\*\*v0.1\*\*** with the basic reconciliation workflow before the Plan engine.

Progress: the desktop scaffold, schema v2, ledger/import foundation and editable

account/register UI (steps 1–15) are implemented, including explicit account

mapping, conservative transfer pairing, keyboard-friendly manual entry, reconciled

edit safeguards and an auditable as-of validation summary. A fresh owner export

matched all 34 YNAB Net Worth reference working balances exactly; four zero-value transfer

rows remain preserved for review without affecting balances. Desktop MSVC build

verification also remains outstanding. Run \`npm run test\:core\` for native ledger/import tests.

Completed implementation sequence:

1\. Scaffold Tauri + React + TypeScript.

2\. Add SQLite access layer.

3\. Define migrations.

4\. Define Account schema.

5\. Define Transaction schema.

6\. Define Category / Payee / Flag schema.

7\. Define transfer-link model.

8\. Build YNAB import parser.

9\. Build import validation summary.

10\. Build account sidebar.

11\. Build transaction register.

12\. Implement manual transaction creation.

13\. Implement paired transfers.

14\. Implement cleared/reconciled states.

15\. Compare imported balances against YNAB reference values.

Do not start the full Plan engine until basic reconciliation is implemented and the

register/import layer remains validated.

**---**

**## 41. Definition of success**

The project succeeds when the owner can cancel YNAB and continue budgeting locally without losing the workflow they rely on.

The finished application should be able to:

\- import the final YNAB history

\- reproduce current balances

\- preserve all historical transactions

\- budget month by month

\- track credit cards correctly

\- move money between categories

\- manage targets

\- manage recurring transactions

\- reconcile accounts

\- track loans/assets

\- report historical behavior

\- forecast future balances

\- export/restore the entire application state

\- operate indefinitely without a subscription or internet connection
**---**

**## 42. Autonomous Git completion and reporting**

For every completed, coherent coding task or repository edit, the agent must finish the Git workflow autonomously rather than leaving it for the owner.

Required completion behavior:

- Run the appropriate validation/checks for the change.
- Commit the completed coherent change using the repository's Conventional Commit rules.
- Push the commit to the current branch's configured remote.
- Do not ask for routine confirmation before committing or pushing when the change is within the requested task.
- Evaluate tagging after each completed task. Tagging is decided autonomously by the agent according to the existing semantic-version and milestone policy in this file.
- Create and push an annotated tag when the agent judges that the completed, verified state warrants a release or prerelease tag.
- Do not create a tag merely because a commit was made; ordinary edits should remain untagged when no release milestone or meaningful prerelease boundary has been reached.
- Never move or overwrite an existing published tag unless the owner explicitly requests it.

At the end of each task, explicitly tell the owner what Git actions were performed. The completion message should state:

- the commit message (and commit hash when available),
- the branch that was pushed,
- whether the push succeeded,
- whether a tag was created and pushed, including its name, or that no tag was warranted for this change,
- any validation/checks that could not be run or did not pass.

Do not silently omit the Git completion step. A task that changes repository files is not considered finished until the required commit and push have been attempted and their result has been articulated to the owner. Tagging remains an agent judgment under the existing release-tagging rules.
