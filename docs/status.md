# Implementation and validation status

Documentation reviewed against the checkout on 2026-09-24, including the recorded
2026-09-23 build verification below. This review is not a fresh application test
or owner-data validation run.

## Implemented slices

- Schema migrations through version 8; typed integer-HUF ledger, linked transfers,
  editable register and basic reconciliation.
- YNAB raw archive/row staging, explicit account mapping, conservative transfer
  pairing, duplicate signals and exact as-of reference comparison. Historical
  `Assigned` amounts from Budget rows can be imported by the core importer.
- Monthly Plan assignments, category money moves, cash/credit handling and mapped
  card-payment categories; monthly targets and month-specific target snoozes.
- Monthly ordinary income/expense schedules with post, skip and deactivate actions.
- Spending, inflow/outflow, income/expense, income breakdown, balance/outflow over
  time and net-worth reports, plus deterministic historical-month forecasting.
- Verified standalone SQLite backups before migrations, on demand, and before
  register deletion or schedule deactivation.
- Local native backup restore for an open budget, with source validation, a
  verified pre-restore safety copy, and post-restore validation/recovery.
- Startup recovery from an unreadable budget using a verified local backup,
  with the original SQLite files preserved in a separate folder.

On 2026-10-04, register editing gained account, date, payee, category, flag and
ordinary inflow/outflow direction corrections without replacing transaction
identities. Reconciled metadata changes require
confirmation, transfer dates remain per-leg, and category/date corrections feed
financial views. The correction path passed 94 Rust core tests, 58 frontend tests,
and the frontend build. This is automated validation, not an owner workflow
rehearsal or a new native desktop build.

On 2026-10-04, local backup restore was added for a budget that opens normally.
The selected backup is validated before use, a verified copy of the current
budget is saved, and the restored database is checked before the app refreshes
its workspace. A failed restore attempts to recover the prior budget from that
copy. The restore tests cover a WAL-backed round trip and invalid sources; the
96 Rust tests and frontend build passed. A full owner workflow rehearsal remains
a separate gate.

On 2026-10-04, startup recovery gained a separate path for an unreadable live
database. It validates a selected local backup before replacement, preserves
the unreadable database and WAL sidecars, and reopens the replacement. A valid
live database is refused by this route. The disposable tests cover recovery,
file preservation and invalid inputs; 99 desktop Rust tests, 58 frontend
tests and frontend build passed. The backup and recovery UI still needs a
desktop workflow rehearsal before the migration gate closes.

On 2026-10-04, the YNAB verifier gained an explicit native rehearsal-candidate
output. It requires owner account mappings and exact Net Worth/Plan comparisons,
rejects unresolved ordinary rows and unknown categories/flags, checks supplied
reports, and never overwrites a candidate path. An anonymized end-to-end fixture
produced a restorable SQLite candidate; a mismatched Net Worth reference wrote
none. The candidate writer test passed. A Windows rehearsal build with the
distinct `com.quirius.allocash.rehearsal` identifier launched and created its
own data folder without creating the normal app folder. This establishes a safe
handoff for desktop checks, not a completed owner workflow or clean migration
rehearsal. The 76/100 owner migration-readiness estimate is unchanged.

See [accounting-rules.md](accounting-rules.md) for implemented semantics and
[architecture.md](architecture.md) for storage/import boundaries. These slices do
not establish completion of every feature in the product requirements.

## Evidence and remaining gates

The existing project record reports that the 2026-09-14 owner export matched all
34 YNAB reference working balances exactly. Four zero-value transfer rows remain
preserved in staging without affecting balances. This is historical evidence,
not a claim that a new export or all Plan/report values have been validated.

On 2026-10-04, the owner's new YNAB ZIP was staged and materialized in a disposable
database as of 2026-10-04. It contained 34 accounts, 27 categories, and 6,341
register rows. The importer materialized 5,053 ordinary rows and 642 transfer
pairs (1,284 rows), with no unmaterialized ordinary rows, unknown categories, or
unknown flags. Four zero-value transfer-like rows remain staged; 43 repeated row
signatures were flagged for review, not removed. The ZIP also contains 1,326
historical Plan rows across 51 months (2022-08 through 2026-10). A follow-up
disposable run materialized all 1,326 `Assigned` values without error. Source
`Activity` and `Available` remain staged for comparison after explicit account
kind and credit-payment mapping. A matching Net Worth TSV subsequently confirmed
all 34 account balances exactly, with no missing or extra accounts. The owner
identified 5 cash, 2 credit, 2 loan and 25 tracking accounts; 15 tracking accounts
are closed. The owner confirmed both card-payment mappings. Comparing Plan
through the export's 2026-10-04 as-of date excludes future-dated ledger entries.
Card-payment funding follows purchase dates and gives positive-balance-covered
spending first claim on category money. The owner's card Activity breakdowns
isolated the remaining differences to funded spending; after that correction,
the disposable comparison matches all 1,326 `Assigned`, `Activity`, and
`Available` values across 51 months. All 34 reference balances still match.
Imported Ready to Assign rows now retain their category in the register while
Plan routes their cash activity to its separate Ready to Assign balance; the
34-account and Assigned comparisons stayed unchanged after this correction.
The Capital Gains tracking route now appears as one Income Breakdown source
when it crosses into an on-budget account. The owner's Net Worth TSV also has
monthly history from August 2022 through October 2026. A disposable comparison
matched all 1,734 account-month balances and all 51 monthly totals from both
Balance Over Time and Net Worth reports. Historical blank cells before an account
first appears were treated as zero; there were no later blank account cells.
The owner's Income v Expense TSV covers January through October 2026, with the
last month compared through the export's 2026-10-04 as-of date. Including only
transfers across the budget boundary brought all 10 monthly income, expense,
and net totals into exact agreement. The comparison also matches 40 income-source
cells, 50 expense-group cells, 200 expense-category cells, all 20 category totals
and averages, and the three period totals and averages. Related Inflow / Outflow,
Outflow Over Time, Spending by Category, and Income Breakdown values agree for
this scope. Spending by Payee, other date/account filters, and forecast values
still need independent references. These runs used temporary databases and did
not modify the owner's live budget. The 2026-10-04 report correction passed all
93 Rust core tests and the disposable import/report comparisons.

The native Windows MSVC desktop-build gate was verified on 2026-09-23. On a
Windows 11 machine with Node.js 24.19.0, Rust 1.98.1 (`stable-x86_64-pc-windows-msvc`)
and Visual Studio Build Tools 2022 (C++ x64 tools), the full check sequence passed:
`npm test` (58), `npm run build`, `npm run test:rust` (86), `npm run test:core` (86),
`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, and
`npm run tauri build -- --no-bundle`, which produced
`src-tauri/target/release/allocash.exe` and exited 0. This is a build/verification
record, not owner-data or Plan/report value validation. Plan/schedule/report work
has proceeded, so older instructions to start that work only after v0.1 are
sequencing intent, not an accurate description of today's implementation. No
release tag existed at this review; tag only after owner-data validation.

Full target frequencies, recurring transfers, automatic backup
retention, remaining report value validation and installer packaging remain outside
the implemented slices documented here. Consult topic requirements before choosing next work;
do not treat this list as an exhaustive backlog.

Update this file with dated evidence when a gate changes. Keep test counts and
machine-specific baseline failures out of always-loaded instructions.
