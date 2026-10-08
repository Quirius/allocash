# Implementation and validation status

On 2026-10-08, the owner accepted the revised upcoming register display and
confirmed that YNAB has not changed since the October 4 export. That export is
therefore the owner's current migration source; a newer export is not required
for this rehearsal while the source remains unchanged. Register responsiveness,
upcoming deletion and the unified display now have owner confirmation.
The original ZIP was recovered from the candidate's preserved import archive,
with SHA-256 matching the approved mappings. The installed schema-10 budget
passed read-only SQLite integrity and foreign-key checks and retains that archive.
A separate clean import and independent reference rerun remain pending the
location of the previously supplied Net Worth and Income v Expense TSV files.
No new candidate or live-budget replacement was performed in this check.

On 2026-10-08, the owner restored the verified October 4 rehearsal candidate
into the installed app and confirmed register responsiveness and upcoming-entry
deletion. The owner then identified future imported Uncleared rows that were
not visually distinguished, and requested a single register workflow without
the separate Scheduled tab. Imported future rows retain ordinary posting state
because YNAB exports do not supply recurrence definitions. The register now
groups pending scheduled entries and future ordinary rows above current/past
transactions, with muted styling and a divider. Each section keeps a 100-row
page limit, and pending schedules retain Edit/Post/Skip. This is a display change;
imported identities, recurrence rules, balances and posting semantics remain
unchanged. The focused register partition test, 22 transaction-routing tests, one schedule
test, frontend build and per-user NSIS package build passed. Independent review
found no blocking issue. The installed app was closed normally, upgraded with
installer exit code 0 and reopened into a responsive native window. Database
bytes were unchanged by installation. The installed executable matches the
built executable apart from the expected NSIS bundle marker. Computer Use
remained unavailable, so owner confirmation of the revised display and the full
fresh-export migration rehearsal remain open.

On 2026-10-08, the existing per-user x64 NSIS package installed successfully
in silent mode with exit code 0. The installed executable, version 0.1.0
uninstall registration and Start menu shortcut were verified. The installed
executable launched into a responsive native window titled Allocash. Package
SHA-256: `513277c338d3ccbfa2a10f686fdbc0f292dbbb1396105d20cda81be1f7336d5a`.
The Computer Use connection was unavailable, but the owner confirmed that the
installed window displays the normal app screen. Installation and first launch
are verified; this does not establish a completed release. Register responsiveness, upcoming deletion and the full clean
migration rehearsal remain open; the manual readiness estimate is unchanged.

On 2026-10-05, the owner confirmed the upcoming-entry editing correction and
requested the next step. A separate synthetic desktop profile then passed the
unreadable-database startup recovery workflow: selecting its verified backup
restored the expected account balance, and closing/reopening the desktop retained
it. The recovery-check example verified the selected backup was byte-for-byte
unchanged and both unreadable database and WAL bytes were preserved exactly.
The owner rehearsal budget was not used or changed. The reusable fixture refuses
an existing preparation directory; its separate Tauri identity and commands are
documented in the README. Example compilation, Rust formatting, frontend build
and native recovery-check build passed.

An English, per-user x64 NSIS installer was also built successfully with the
normal `com.quirius.allocash` identity. The setup artifact is approximately
2.9 MB, unsigned, and skips WebView2 installation, requiring the existing runtime.
Installer build-time downloads were hash-validated by Tauri. Installation and
first launch remain unverified; this is packaging evidence, not a completed
release or final clean migration. The manual migration-readiness estimate remains
76/100, and register responsiveness and upcoming deletion still need owner
feedback.

Documentation reviewed against the checkout on 2026-09-24, including the recorded
2026-09-23 build verification below. This review is not a fresh application test
or owner-data validation run.

## Implemented slices

- Schema migrations through version 10; typed integer-HUF ledger, linked transfers,
  editable register and basic reconciliation.
- YNAB raw archive/row staging, explicit account mapping, conservative transfer
  pairing, duplicate signals and exact as-of reference comparison. Historical
  `Assigned` amounts from Budget rows can be imported by the core importer.
- Monthly Plan assignments, category money moves, cash/credit handling and mapped
  card-payment categories; monthly, quarterly and yearly targets with explicit due
  settings, monthly funding guidance and month-specific target snoozes.
- Monthly, quarterly and yearly income/expense and linked transfer schedules with
  post, skip and deactivate actions.
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

On 2026-10-05, the owner-data candidate was generated from the October 4 export
after exact account, historical Plan and supplied report comparisons, then
staged in the isolated rehearsal profile. The owner reported successful restore,
backup creation and ordinary transaction entry/edit/delete checks. The transfer
rehearsal exposed that choosing a transfer label in Payee created an ordinary
transaction. New entries now route exact `Transfer:`/`Payment:` account labels
through linked transfer creation and reject unresolved destinations. Ten new
payee-routing tests, 18 IPC tests, the existing paired-transfer Rust regression
and frontend build passed. The corrected transfer workflow still needs owner
retesting; Plan moves, reconciliation, recovery and the full rehearsal remain open.

The owner subsequently confirmed that transfer-payee entry works. The Plan
rehearsal found that Assigned inputs retained stale values after money moves,
and requested moves that can leave negative category balances. Assigned inputs
now refresh from persisted assignments, moves may exceed source Available, and
negative Assigned/Available values have green highlights. All 16 Plan tests,
Rust formatting and frontend build passed, including negative moves, reversal,
unchanged Ready to Assign/account balances and overflow rollback. The
standalone rehearsal build also passed and launched with embedded frontend
assets. The corrected Plan workflow still needs owner retesting; reconciliation,
recovery and the full rehearsal remain open. The manual readiness estimate is
unchanged.

Later on 2026-10-05, the owner confirmed the corrected Plan money moves,
including negative balances. Clearing and reconciliation passed when exercised
with posted transactions through the selected as-of date; future-dated entries
remain excluded by the existing contract. The owner also confirmed that a
verified backup removed a subsequent test transaction on restore, returned the
account/category balances to their prior values, and persisted after closing
and reopening the standalone rehearsal app. These are owner-reported desktop
checks. Startup recovery of an unreadable database, targets/schedules needed for
daily use, installer verification and the full clean migration remain open.
The manual readiness estimate has not been reassessed.

On 2026-10-05, the owner confirmed that daily use requires both category targets
and scheduled transactions, including transfers, with monthly, quarterly and
yearly recurrence. Periodic targets now spread a period total through an explicit
due month and show the remaining funding needed this month. Due dates come from
target settings, never category names. Recurring transfers materialize and post
linked uncleared legs together; skip/deactivate preserve posted history. Calendar
recurrence clamps short months while retaining the original day. Forecast tests
cover selected accounts and shared transfer-category filters. Schema 10 preserves
existing monthly definitions, and older supported backups are upgraded in an
isolated copy before restore/recovery, preserving the original backup.

The change passed 122 Rust core tests, 73 frontend tests, formatting and frontend
build checks. The standalone Windows rehearsal build passed and launched against
the upgraded rehearsal budget; yearly target due-month and scheduled-transfer
controls were inspected without saving new entries. A fresh schema-10 disposable
owner-data candidate still matched all
34 account balances, all 1,326 Assigned/Activity/Available rows, 1,734 historical
account-month balances, 51 Net Worth totals and all supplied Income v Expense
comparisons. Four unresolved zero-value transfer rows remain held and duplicate
signals remain retained as before. Owner desktop rehearsal of the new targets and
schedules remains open; weekly/custom recurrence remains deferred.

The owner then reported that a periodic target and scheduled transfer both worked,
and clarified that scheduled entry should happen in the register's date/repeat
workflow. The register composer now provides Date and Repeat Never/Monthly/
Quarterly/Yearly. A new future entry with Never creates one pending occurrence;
recurring entries use the selected date as their start. Pending rows display S
and provide Post/Skip in the register. Both transfer legs resolve to the same
atomic occurrence action, without requiring the separate Scheduled view. Current
or past entries with Never retain manual behavior. Posting remains explicit.
The 22 transaction-routing frontend tests, 48 ledger tests, formatting and
frontend build passed. The full frequency list in the YNAB screenshot is not yet
implemented; the owner-required monthly/quarterly/yearly subset is supported.
The standalone rehearsal build passed and launched; the register's Date/Repeat
controls and pending S status were visually inspected without saving new data.

The owner confirmed register Date/Repeat entry worked, but closed the app because
of heavy lag. A read-only-source diagnostic on an isolated rehearsal copy found
1,832 rows in the largest register; its database read took about 46–48 ms in a
debug build. The frontend rendered every row at once. The register now renders
at most 100 rows per page, with Previous/Next controls and the full history kept
accessible. Page selection survives save/reload and clamps when history shrinks;
switching accounts starts at the first page. This reduces DOM work without
changing ledger queries, dates, money or stored history. It is a likely lag
contributor, not a measured guarantee that every cause is resolved. The frontend
and standalone rehearsal builds passed. Desktop inspection verified ranges
1–100 and 101–200 and navigation back to the newest entries. Owner responsiveness
retesting remains open.

The next owner check found that upcoming entries lacked the register Edit action.
Upcoming scheduled rows now open the usual editor, including Date and Repeat.
Edits update the pending occurrence and its future template without replacing
identities or altering posted occurrences. Transfer edits from either leg keep
the pair's amounts/dates consistent and expose the shared pending category.
Non-date edits preserve the original recurrence day after short-month clamping;
changing an advanced recurring occurrence to Never retains one-time semantics.
Scheduled rows remain pending and Uncleared until explicitly posted. Deletion
stops repeats, removes the pending entry/pair and preserves posted history, using
the existing pre-deletion backup. The change passed all 129 Rust core tests,
24 desktop IPC frontend tests, formatting and frontend build checks. An
independent read-only review supplemented the recurrence and transfer tests.
The standalone rehearsal build passed and launched against the existing budget.
Owner upcoming-entry edit/delete rehearsal remains open.

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

Weekly/custom target and schedule frequencies, automatic backup
retention, remaining report value validation and installer packaging remain outside
the implemented slices documented here. Consult topic requirements before choosing next work;
do not treat this list as an exhaustive backlog.

Update this file with dated evidence when a gate changes. Keep test counts and
machine-specific baseline failures out of always-loaded instructions.
