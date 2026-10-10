# Implementation and validation status

On 2026-10-10, the sidebar gained an Add Account popup. Its type labels map to
the existing cash, credit, loan and tracking kinds; subtypes add no schema.
Creating an account, its nonzero cleared starting-balance entry, Ready to Assign
category and credit payment-category mapping is atomic and one undoable action.
Starting balances retain their entered sign and date today; credit debt is
entered as a negative amount. A failed account-list refresh can be retried
without replaying creation. Sidebar footer controls stay visible after collapse
and at narrow widths; expanded account groups remain accessible. All 239
frontend tests, the full 194-test Rust suite plus the hidden-payment-category
regression, formatting, Cargo check and independent review passed. Synthetic
browser checks verified centered popup/type selection and sidebar reopening at
700 and 500 pixels. Production and final native builds passed. Installation
preserved budget bytes, the installed executable matches the release build, and
a responsive native window reopened. Owner interaction confirmation remains open.

On 2026-10-10, owner feedback refined clearing icons to crisp SVG circle/C
shapes with grey outlined Uncleared and green filled Cleared states. A saved
status change patches its row in place, then reads workspace balances silently;
it never sets the register to Loading or reloads its rows. Scroll, row identity
and other open editor inputs remain mounted. Failed writes leave the icon
unchanged; a failed balance read retains the saved icon and retries only that
read. All 222 frontend tests, independent review, synthetic browser node-identity
and popup checks, and the production build passed. The native installer passed; installation preserved budget bytes, the installed
executable matches the release build, and a responsive window reopened. Owner
visual confirmation remains open. Rust and schema are unchanged.

On 2026-10-10, register status icons, context actions and due-schedule catch-up
were implemented.
New ordinary manual entries default to Uncleared; the entered and generated
sides of a manual transfer default to Uncleared and Cleared. Posting a due
scheduled occurrence marks it Cleared, including both transfer legs. The
dedicated status command is limited to posted, through-today, non-reconciled
entries and changes only the selected transfer leg. Catch-up posts through the
inclusive local date in one atomic batch, creates a safety backup before writes,
and records one session undo action. A failure rolls back the batch. Due legacy
occurrences on closed accounts or with a closed transfer peer remain pending
and are skipped for explicit recovery. Startup and local-day changes realize due
entries; an open transaction or account editor defers background catch-up.
The register has no row Edit buttons: double-click and right-click Edit open the
original row. Its menu provides status changes, unsaved Duplicate/Make Repeating,
editor routes for flag/memo/category/account, and guarded deletion. Unsupported
approval, matching and export actions remain disabled placeholders. Upcoming
entries have no clearing icon or selector; reconciled locks cannot toggle.
A saved mutation whose refresh fails offers a refresh-only retry.
All 221 frontend tests, the full 188-test Rust suite and two additional cutoff/
recurrence regressions passed, along with formatting, Cargo check, independent
financial review and synthetic browser menu/popup placement checks. Production and native installer builds passed. The installed executable matches
the release build, installation preserved budget bytes, and a responsive native
window reopened. Startup can subsequently realize due entries as documented;
installation preservation is not a claim that automatic realization leaves the
ledger unchanged. Owner interaction checks remain open.

On 2026-10-10, the owner requested a close YNAB dark-theme visual match and
supplied Plan, account-register and transaction-editing references. The first
visual pass now has a compact collapsible sidebar, sidebar view navigation,
full-height independently scrolling tables, a centered Ready to Assign card,
Plan search/filter tabs, group totals/collapse, target bars and Available pills.
Group identity uses IDs; same-name groups remain independent. An unselected
Plan shows derived category monthly totals. Existing credit details, targets,
notes, moves and rename remain available. Backups are under Budget & backups;
Auto-Assign remains omitted. Plan opens by default.
Historical and upcoming edits replace their own table row. New transactions open
at the top, including empty registers; Save and add another starts a fresh draft
only after save and refresh succeed. Secondary options retain account/type,
cleared state and repeat shortcuts. Date/Repeat is portaled outside table scrolling
and positioned within the viewport. Immediate form locks reject pending duplicate
submissions; saved-write refresh failures retry only the refresh. The existing
signed amount parser now also handles the minimum i64 outflow in register edits.
All 204 frontend tests and the production/native installer builds passed, with
independent review of write routing, transfer identity, category rules and
reconciled confirmation. Synthetic headless-browser checks and image inspection
covered expanded/collapsed Plan, register, new/edit states and bottom-row calendar
positioning at desktop widths. No owner data was used in UI tests. Rust accounting,
IPC shapes and schema are unchanged; the prior 183 Rust test result still applies
to the unchanged backend. After the owner closed the app, installation exited
successfully, preserved budget bytes, matched the release executable and reopened
a responsive native window.
This is a first visual pass, not a complete pixel-identical copy. Owner visual and
interaction acceptance and detailed dropdown/secondary-screen references remain
open; no milestone or migration-readiness percentage was advanced.

On 2026-10-10, the owner requested a right-click account editor and clarified
that closed accounts must be emptied manually before deletion. Edit Account now
supports nickname, persistent notes and the open account's Working Balance.
Changing the balance creates one cleared adjustment dated today; budget accounts
use Ready to Assign and off-budget accounts have no category. Exact integer delta
checks, a stale-balance guard and one SQL transaction prevent partial writes.
Cancel writes nothing; failed saves retain the draft, and failed refreshes can be
retried without saving twice. Close/Re-open preserves kind and history; closing
rejects active repeat rules involving either side of the account.
Delete is disabled while any transaction or transfer remains, including future
and scheduled rows. The backend independently rejects nonempty accounts and
linked schedule history. Confirmed deletion creates a safety backup and removes
only empty account metadata, payment mapping and orphan repeat definitions.
Categories, Plan assignments, targets and raw imports remain; manual removal of
history can change Plan values. All account actions participate in session undo.
No schema migration or owner-data edit was performed. All 183 Rust and 186
frontend tests passed, including balance cutoff/overflow, negative adjustments,
atomicity, deletion/history safeguards, repeat closure guards, undo, React editor
behavior and decimal-string IPC contracts. Formatting, independent review and
frontend/native builds passed. The installer exited successfully, budget bytes
were unchanged, and the installed executable matches the release build. Allocash
reopened a responsive native window. Owner account editing, cancel, adjustment,
close/reopen, deletion safeguards and undo confirmation remain open.

On 2026-10-10, the owner requested category renaming. The selected-category Plan
sidebar now offers Rename with a selected name field, Save/Enter and Cancel/Escape.
Failed saves preserve the draft; saving locks duplicate submissions. Names are
trimmed and contain 1?200 Unicode characters. The backend updates only the name
by stable ID in a transaction, retaining ledger links, assignments, targets,
notes and credit payment mappings, and participates in session undo. Successful
renames refresh shared category options for Register and Reports as well as Plan.
Metadata-refresh failure is distinguished from write failure. Exact SQLite
normalization guards the name-derived Ready to Assign role in both directions,
including Unicode-whitespace edge cases. No schema or financial changes.
All 172 Rust tests and 176 frontend tests passed, including identity/financial
preservation, undo, validation/classification guards and actual React name editing,
cancellation, retry, duplicate-write prevention and Unicode limit checks.
Formatting, Cargo check, frontend/native builds and independent review passed.
The installer exited successfully, budget database bytes were unchanged, and the
installed executable matches the release build. Allocash reopened a responsive
native window. Owner rename/cancel/undo and cross-view category-name confirmation
remain open.

On 2026-10-10, the owner requested selection and calculator-style editing in all
amount fields, then clarified replacement, Tab/Enter commit and Escape reset.
All eight monetary controls now share select-all-on-focus/click behavior. Plain
numbers overwrite the selected amount; leading operator keys seed the existing
amount, so selected Assigned 3000 plus typed +3000 becomes 6000. Tab/Enter
commits the field and Escape restores the pre-edit value. Plan blur saves and
form-specific validation/save workflows remain intact. A bounded bigint
arithmetic parser supports precedence, parentheses and exact rational
intermediates, rejecting fractional final HUF, division by zero, malformed input
and signed-range overflow. Outflow expressions are negated as a whole, including
the supported signed minimum. Frontend tests now use jsdom for actual React key,
input, focus and blur ordering. No ledger, schema or backend write changes.
All 170 frontend tests and the frontend build passed, including relative
operators with Shift, replacement, Escape without save, Enter/Tab commit and
canonical value emission before blur saves. Independent review found the Shift
key and outflow precedence issues, both fixed before final checks. The native
Windows installer built successfully. After the owner closed Allocash, its
remaining background process was stopped and the installer exited successfully.
Budget database bytes were unchanged, the installed executable matches the
release build, and Allocash reopened a responsive native window. Owner amount
interaction and undo confirmation remain open.

On 2026-10-10, the owner requested YNAB-style Current Balance and Available for
Payment views for mapped credit categories. The sidebar now has expandable
balance and funding breakdowns, a payment funding message and Total Underfunded.
Both the sidebar amount and category Available use red for negative payment
availability, yellow for nonnegative availability below outstanding card debt,
and green when that debt is covered. The shortfall includes any negative
payment-category deficit. Warnings have text and accessible row descriptions.
The read-only backend fields use the Plan posted/as-of cutoff and checked wide
integer accumulation. Funded spending and refund reversals are observed from
existing derivation, with Other Activity explicitly reconciling unusual activity
to Available. Current Balance reconciles prior balance and monthly inflows and
outflows. Stored assignments, targets, ledger data, funding rules and schema are
unchanged; Auto-Assign and credit category targets remain omitted.
All 169 Rust tests and 151 frontend tests passed, including extended checks for
carry, positive card balances, refunds, payments, other activity and cutoff
exclusion, plus warning thresholds and integer precision. Formatting, Cargo
check, frontend/native builds and independent review passed. The per-user NSIS
installer exited successfully, budget database bytes were unchanged, and the
installed executable matches the release build. Allocash reopened a responsive
native window. Owner credit sidebar interaction and warning confirmation remain
open.

On 2026-10-10, the owner requested excluding targets from budgeted credit-card
payment categories. The selected-category sidebar now hides target progress,
the target editor, no-target prompts and snooze controls for mapped credit
payment categories, and labels their balance Available for Payment. Notes and
the existing balance summary remain available. The backend rejects new target
definitions and snoozing for live credit mappings, including closed cards.
Existing definitions and snoozes remain stored and can be cleared explicitly;
removing the mapping restores ordinary target eligibility. Financial derivation,
budget amounts and the schema are unchanged.
All 169 Rust library tests and 147 frontend tests passed, including target
rejection, preservation, cleanup and unmapping behavior. Formatting, Cargo check,
independent review, frontend and per-user NSIS builds passed. The per-user NSIS installer exited successfully after the owner closed the
window and its remaining background process was stopped. Installation preserved
budget database bytes; the installed executable matches the release build and
reopened a responsive native window. Owner credit and ordinary category sidebar
confirmation remains open.

On 2026-10-10, the owner confirmed a category target test worked, then reported
that upcoming transactions lacked a way to make them repeating. Imported future
ordinary entries had no schedule link, so their editor hid Repeat. Future
Uncleared ordinary transactions and transfers now expose Repeat in the date
picker, defaulting to Never, and Make repeating selects Monthly without advancing
the first date. One-off scheduled entries expose the same shortcut. Saving an
ordinary upcoming entry promotes its existing transaction or transfer pair into
the first pending occurrence in one SQL transaction rather than creating a
duplicate. Transaction IDs, transfer linkage and import provenance are retained;
first-occurrence and template categories follow budget-boundary rules. Cancel
does not write. Existing scheduled edits and the past-entry repeating-copy
workflow retain their behavior. The new desktop command is one undoable action,
uses a local calendar cutoff and rejects non-future, cleared/reconciled, closed,
already scheduled and invalid recurrence requests without partial changes.
All 168 Rust library tests and 147 frontend tests passed. Coverage includes
ordinary inflow/outflow, month-end recurrence, both transfer sides and budget
scopes, imported identity/provenance, rollback, unchanged as-of balance and undo.
Formatting, Cargo check, independent review, frontend and per-user NSIS builds
passed. Installation exited successfully and preserved budget bytes; the installed
executable matches the release build after its expected bundle marker. A responsive
native window reopened. Owner upcoming Repeat, first-occurrence, Save/Cancel and
undo interaction checks remain open; full target/recurrence recreation and the
remaining migration rehearsal are not inferred complete from the target test.

On 2026-10-10, the owner confirmed that installed account balances and the current
month's Ready to Assign match their latest YNAB data. This closes the owner-facing
balance comparison requested after the Plan refresh checks. It does not imply
completion of target/recurrence recreation, additional report comparisons or
the full native backup/reopen migration rehearsal.

On 2026-10-10, the owner confirmed the latest Plan interaction checks passed:
changing Assigned keeps the screen steady, editing a target or note preserves
the selected category and open editor, and Ctrl+Z reverts values without flashing.
This closes those smooth-refresh interaction checks. Money-move-specific checks,
notes across months/reopening and the remaining migration rehearsal gates are
not inferred complete from this confirmation.

On 2026-10-09, the owner reported that any Plan change flashed the whole screen.
The same-month table and category sidebar now remain mounted during saved writes
and background reads; only initial loading and a different selected month use
the loading replacement. Values update in place without a visible loading block
or layout shift. Category selection, scroll position and the open target editor
retain their existing DOM state. Assignment inputs have stable identities,
preserve focused/dirty drafts, and save only on explicit blur. Clean inputs sync
canonical values after refresh or undo, and unchanged values are not resubmitted.
Stale snapshots remain visible while financial controls wait for current data;
handlers also verify the global saved-mutation version and pending state.
Failed reads retain the visible snapshot and drafts. Financial calculations,
IPC contracts and storage are unchanged.
All 145 frontend tests, the frontend build, focused independent code review
and the per-user NSIS build passed. No DOM test environment is installed, and
visual interaction was not inspected. Installation exited successfully,
preserved budget bytes and matched the release executable after its expected
bundle marker. A responsive native window reopened. Owner confirmation that
assignment, target, note and undo updates no longer flash subsequently passed
on 2026-10-10; move-specific confirmation remains open.

On 2026-10-09, the owner requested moving category targets into a vertical
right-hand selected-category panel, persistent category notes and no Auto-Assign.
Clicking a category row or focusing its controls selects it, with an accessible
selected state. The panel contains Available/Assigned/Activity, target progress,
the existing target editor and month-specific snooze. It stacks below the table
on smaller windows, and the table can scroll horizontally rather than clipping.
Notes use the existing category-level SQLite column without a schema migration.
Exact text, whitespace and line breaks persist across months, reopening and
native backup/restore; changes are undoable. Leaving the field saves, and a Save
notes button supports retry. Failed drafts remain keyed to their category, older
completions cannot replace newer drafts, and successful notes immediately reflect
in the cached panel. Plan reads reject stale mutation versions; target saves
capture their category/month and the editor refreshes persisted definitions after
undo without applying an old completion to a new selection. Existing target
calculations and Available-click money moves remain in place.
All 162 Rust library tests and 145 frontend tests passed, including exact note
storage, month/reopen/backup/undo behavior and draft lifecycle checks. Formatting,
Cargo check, independent review, frontend and per-user NSIS builds passed.
Installation exited successfully, preserved budget bytes, and the installed
executable matches the release build after its expected bundle marker. A
responsive native window reopened. Owner category selection, target editing,
notes across months/reopening and undo interaction checks remain open.

On 2026-10-09, the owner requested replacing the separate Plan Move Money form
with a popup opened from a category's Available amount. The clicked category is
the fixed source; a positive Available balance is prefilled for editing and a
grouped dropdown selects the destination, including Ready to Assign. Category
moves atomically adjust both Assigned values. Returning to Ready to Assign
reduces the source assignment and increases the derived unassigned balance,
without assigning to the special Inflow category or changing the schema. Both
routes remain one undoable action. Cancel, Escape and outside clicks dismiss
without writing, and invalid amounts cannot be submitted. Popup drafts survive
their own failed save; month changes and external mutations dismiss stale drafts.
Overlapping writes are distinguished from the move's own start/finish events.
The popup retains its data during Plan reloads, measures its placement and restores
keyboard focus. Other Plan edit controls are inactive while a move is saving.
All 161 Rust library tests and 140 frontend tests passed, including atomic
assignment changes, return-to-Ready derivation, overflow rollback, undo,
fixed-source payloads and popup lifecycle guards. Formatting, default Cargo
check, independent review, frontend and per-user NSIS builds passed. Installation
exited successfully and preserved database bytes; the installed executable matches
the release build after its expected bundle marker. A responsive native window
reopened. Owner popup move, cancellation and undo interaction checks remain open.

On 2026-10-09, the owner reported that the installed undo workflow works well,
then requested budget-aware category entry. Ordinary tracking/loan transactions
and transfers within one budget scope no longer need a category. Cash/credit
inflows default to Ready to Assign; outflows require an explicit category choice.
Transfers crossing the budget boundary use only the budget leg's category,
including entry and editing from the other account. Pending/repeating entries
follow the same rules, while imported history and confirmed reconciliation
adjustments retain their existing contracts. Category changes from a transfer's
other side respect reconciled-history confirmation. Ready to Assign is reused
by semantic group/category identity, including hidden categories, or created
atomically during a saved inflow. Failed saves roll back that category and any
new payee; undo also restores the prior state. Sign and account-scope changes
validate the new direction, while unrelated edits preserve legacy categories.
All 159 core and 134 frontend tests passed, covering budget activity, incoming
Ready to Assign, boundary schedules, peer edits, scope/sign changes, undo,
rollback and checked transfer overflow. Formatting, default Cargo check,
independent review, frontend and per-user NSIS builds passed. The installed
upgrade exited successfully, preserved database bytes and matched the release
executable after its expected bundle marker. A responsive native window reopened.
Owner category-entry and transfer interaction confirmation remains open.

On 2026-10-09, the owner requested Ctrl+Z for saved transaction, Plan and
account changes. The desktop mutation boundary now captures a verified SQLite
snapshot before a successful saved action, with a bounded 30-step session history.
Undo reverses complete transfers, related payees and recurrence state alongside
ordinary transactions, Plan assignments/moves, targets/snoozes, credit-payment
mapping and reconciliation. The generic boundary also supports account metadata
and closed-state changes; this earlier change covered editing and close/reopen,
before the Add Account popup described in the current status entry above.
Existing reconciled-history confirmation and required deletion backups remain
in place.
Failed partial writes restore the prior state; failed undo retains history, and
failed recovery preserves the relevant safety copies. Successful native restore
clears history; reopening starts a new history. No schema change is required.
All 146 core tests passed, covering transfer identity and shared amounts,
reconciled confirmation failures, Plan move conservation, target/snooze reversal,
WAL state, the 30-step limit and corrupt snapshots. Ctrl+Z retains native editing
inside text fields; an Undo button shows the available action. Mutation/undo
barriers prevent concurrent writes and stale status responses. Sequenced Plan,
report and workspace reads ignore superseded responses and reload when pending
actions settle, preserving the Plan month and report filters. Plan save errors
remain visible across automatic reloads, separate from read errors. All 117 frontend
tests, the frontend build, formatting and independent review passed. The per-user
NSIS build passed and the installed app was upgraded with exit code 0. Installation
preserved database bytes, the executable matches the release build after the
expected bundle marker, and a responsive native window reopened. The owner
subsequently confirmed that the installed undo workflow works well; individual
shortcut, Undo-button and native text-editing checks were not separately described.

On 2026-10-08, the owner reported an incorrect large negative Ready to Assign
balance in the October Plan. Investigation reproduced it on an isolated copy of
the installed budget. The calculation omitted credit-to-cash advances, surplus
from cash payments that made credit balances positive, and credit Ready to Assign
inflows that crossed above zero. It also classified payment-category cash
overspending before applying the month's automatic funding/payment deltas.
The corrected derivation counts only newly available funds, subtracts the part
of an advance drawn from an already-funded positive card balance, and applies
payment deltas before classifying closed-month cash overspending. A chronological
prepass uses exactly the eligible posted/as-of entries, so coverage is independent
of iteration order and future ordinary entries cannot affect an older snapshot.
The eligible cash leg determines when an advance contributes; if its debit leg is
outside the view, no positive-balance coverage is inferred from that excluded leg.
The captured budget's October Ready to Assign now computes as zero. Assigned,
Activity, Available, targets and credit mappings are identical across 51 monthly
snapshots before and after the correction. No imported history, assignments or
schema were rewritten. All 137 core tests passed, including focused regressions
for advances, positive credit funding and payment-category rollover. Formatting and independent review passed. Frontend and per-user NSIS builds
passed. The installed app was upgraded with exit code 0 and reopened into a
responsive native window. Installation preserved database bytes; the executable
matches the packaged build, and the reopened budget matches the diagnostic copy
across all tables. Owner screen confirmation remains open.

On 2026-10-08, the owner refined Make repeating to use the next available
occurrence of the original day of month in the current or next month, clamping
29/30/31 to the last available day. The implementation selects strictly after
today: a day still ahead uses this month, otherwise the following month.
Monthly remains the default and the original transaction remains untouched.
The copied draft retains its original day anchor even if the proposed date
clamps; saving February 28 with a 31st anchor therefore advances to March 31.
Changing the proposed date uses the newly selected day instead. Schedule input
accepts an optional dayOfMonth with validated 1-31 bounds and a matching clamped
start date; omitted values retain existing behavior and no schema change is
required. Sixteen date/draft, 23 routing and 24 IPC tests passed, alongside three
monthly-schedule and three scheduled-transfer core tests. Invalid anchors are
rejected before writes. Formatting, frontend build, per-user NSIS build and
independent review passed. The installed app was upgraded with exit code 0 and
reopened into a responsive native window. Installation preserved database bytes;
the installed executable matches the release build after the expected NSIS marker
change. Owner confirmation of the refined default and the clean desktop migration
rehearsal remain open.

On 2026-10-08, the owner clarified that Make repeating must default to one
calendar month after the original transaction date, not after today. The interim
today-based change was reverted. Monthly remains selected; month-end dates clamp
to the following month's final day. All ten date/draft tests passed, including
an original January 31, 2023 transaction defaulting to February 28, 2023 even
when today is October 8, 2026. Original identity and reconciliation state remain
unchanged. Frontend and per-user NSIS builds passed. The installed app was
upgraded with exit code 0 and reopened into a responsive window; installation
preserved database bytes and the executable matches the packaged build. Owner
confirmation of this clarified date default remains open.

After the owner's initial date-default feedback on 2026-10-08, an interim
implementation defaulted to one calendar month after today. The subsequent
clarification above supersedes that interpretation. Monthly remains selected, short months clamp, and
the original transaction is unchanged. All ten date/draft tests passed,
including an old reconciled transaction defaulting from October 8 to November 8.
Frontend and per-user NSIS builds passed. The installed app was upgraded with
exit code 0 and reopened into a responsive window; database bytes were unchanged
by installation and the executable matched the packaged build. Owner confirmation
of the corrected default and the clean migration desktop rehearsal remain open.

On 2026-10-08, the owner requested Repeat inside the date/calendar dropdown and
a Make repeating action for past transactions. New entries default to Never;
pending schedule editing retains its existing frequency. Make repeating below
the stored transaction's date opens a separate composer draft dated one calendar
month later with Monthly selected, clamping short months. The draft copies
payee/category/memo/flag and signed amount; linked transfers resolve their
counterpart by the stored account identity, including duplicate account names.
Opening or canceling the draft has no IPC write path; only Save creates the new
entry through the existing schedule/atomic transfer commands. The original
transaction is not edited. Switching register accounts closes an unsaved editor.
The supported migration choices remain Never, Monthly, Quarterly and Yearly.
Nine date/draft tests, 22 routing tests, 24 IPC tests, the core register identity
test and Rust formatting passed. Independent review found no remaining concrete
blocker. Frontend and per-user NSIS builds passed. The installed app was closed
normally, upgraded with exit code 0 and reopened into a responsive window;
database bytes were unchanged by installation. Installed executable verification
matched the built app apart from the expected NSIS bundle marker. Owner calendar,
draft-cancel and draft-save desktop checks remain open; helper tests and code
review do not establish rendered desktop interaction success.

On 2026-10-08, the matching October 4 Net Worth and Income v Expense references
were located and the current verifier reran a clean import from the unchanged
owner-confirmed export with the approved account/card mappings. It created a new
schema-10 candidate without overwriting prior candidates or the installed budget.
All 34 account balances matched; all 1,326 Assigned, Activity and Available Plan
rows across 51 months matched. Historical reports matched 1,734 account-month
balances and 51 Net Worth totals, plus all supplied January-October Income v
Expense monthly, source/group/category and total/average comparisons. The import
materialized 6,337 transactions and retained 43 duplicate signals. Four unresolved
transfer source rows remain staged; a read-only check confirmed zero inflow and
outflow on all four, with their original source cells preserved.
Candidate integrity, foreign keys and schema checks passed. An identical copy
named `allocash-clean-migration-20261008.sqlite3` was placed in the installed
app's backup folder for owner restore. This clean candidate has no targets or
recurrence definitions; YNAB does not export those rules. Existing rehearsal
schedule definitions are not part of this candidate. Desktop restore, comparison,
native backup/reopen and required target/recurrence recreation remain open before
the clean migration rehearsal can be called complete.

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
