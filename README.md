# Allocash

A Windows desktop budgeting app for one local HUF budget, built with Tauri 2,
React, TypeScript and SQLite. No login, cloud backend, bank connection or telemetry.

The repository and folder were renamed from `ynabclone` to `allocash` on
2026-09-10. The repository is [Quirius/allocash](https://github.com/Quirius/allocash).
All project development files live directly inside `allocash/`, including the
ignored `.tools/` folder for portable Node.js, npm cache, browser checks and previews.

## Project status and documentation

The app includes the import/register foundation plus monthly Plan, targets,
schedules, reports, forecasting and verified local backup slices. See
[implementation status](docs/status.md) for validation evidence, feature limits
and the verified native Windows MSVC build gate. Owner-data validation remains
required before tagging a release.

The [documentation map](docs/README.md) routes to architecture, implemented
accounting rules and topic-specific product requirements. Repository agents start
with [AGENTS.md](AGENTS.md).

## Windows development setup

Install Node.js 24 LTS, Rust's stable MSVC toolchain, Microsoft C++ Build Tools
with **Desktop development with C++** and a Windows SDK, and WebView2 Runtime.
Follow the [official Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/).
Restart the terminal after installing tools so PATH is refreshed.

From this repository folder:

```powershell
npm ci
npm run tauri dev
```

The desktop app opens or initializes `budget.sqlite3` in Tauri's local application
data directory, normally `%LOCALAPPDATA%\com.quirius.allocash\` on Windows.
The exact path is available under **Budget details → Local data location**.
Closing and reopening the app preserves the database. The built app works offline;
installing development dependencies initially requires internet access.

For a browser layout preview (Node.js only):

```powershell
npm run dev
```

Open `http://127.0.0.1:1420`. Browser preview does not open SQLite or save a budget.

This checkout also includes a local, ignored portable Node.js runtime. To use it
without a system installation, run this from `allocash/` in PowerShell:

```powershell
$env:PATH = (Resolve-Path '.\.tools\node-v24.21.0-win-x64').Path + ';' + $env:PATH
npm.cmd run dev
```

The project `.npmrc` keeps npm's cache in `.tools/npm-cache`. These local tools
are not part of the Git repository; other checkouts use the prerequisites above.

## Checks and builds

```powershell
npm test
npm run build
npm run test:rust
npm run test:core
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npm run tauri build -- --no-bundle
```

To stage and validate a private YNAB export without retaining a test database or
printing account names and balances (including importing historical `Assigned`
amounts into the disposable database):

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --example verify_ynab_export -- "path/to/export.zip" yyyy-mm-dd
```

For an independent current and historical Net Worth comparison, provide a
matching Net Worth TSV. The example compares every monthly account balance and
the Balance Over Time and Net Worth totals:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --example verify_ynab_export -- "path/to/export.zip" "path/to/net-worth.tsv" yyyy-mm-dd
```

For Plan value comparison, add a fourth argument pointing to a private JSON file
with `exportSha256`, an `accounts` array of explicit `sourceName`, `kind` (`cash`,
`credit`, `loan` or `tracking`), `closed` and `sortOrder` mappings, and a
`creditPayments` array of `accountName`,
`categoryGroup` and `categoryName` mappings. An optional fifth argument writes
row-level Plan differences to a private JSON file. Keep both files in ignored
`private-data/`; the terminal output contains only counts. Matching balances do
not imply matching Plan or report values. An optional sixth argument provides a
matching Income v Expense TSV. With explicit account and card-payment mappings,
the example compares monthly totals, income sources, expense groups/categories,
averages, and the related report totals without printing private amounts:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --example verify_ynab_export -- "path/to/export.zip" "path/to/net-worth.tsv" yyyy-mm-dd "private-data/mappings.json" "private-data/plan-differences.json" "path/to/income-expense.tsv"
```

To create a native candidate for a desktop migration rehearsal, append
`--candidate` and a new `.sqlite3` path to the command above. This requires
explicit account and card-payment mappings, an exact Net Worth reference, an
exact staged Plan comparison, and no unknown categories, unknown flags or
unmaterialized ordinary rows. Supplied report references must also match. The
candidate is written only after those checks pass and never replaces an existing
file. Ambiguous transfer rows remain staged and still need review.

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --example verify_ynab_export -- "path/to/export.zip" "path/to/net-worth.tsv" yyyy-mm-dd "private-data/mappings.json" "private-data/plan-differences.json" "path/to/income-expense.tsv" --candidate "private-data/allocash-rehearsal-v8.sqlite3"
```

Run `npm run rehearse:desktop` to open a desktop build with the distinct
`com.quirius.allocash.rehearsal` identity. Its budget is under
`%LOCALAPPDATA%\com.quirius.allocash.rehearsal\`, separate from the normal
Allocash budget. Copy the candidate into that app's `backups/` folder, select
**Find local backups**, then restore it. Keep its `allocash-*.sqlite3` name so
it appears in the selector. Use the rehearsal budget for workflow
checks; this candidate is not a final migration approval.

For a rehearsal executable that works without a running development server, use
`npm run tauri build -- --no-bundle --config src-tauri/tauri.rehearsal.conf.json`
and open `src-tauri/target/release/allocash.exe`. The debug executable requires
the development server started by `npm run rehearse:desktop`.

Rust checks require a Rust toolchain; the desktop build also requires the Windows
build prerequisites. Installer packaging is deferred; this step builds a desktop
executable only. Frontend integration follows
[Tauri's Vite guide](https://v2.tauri.app/start/frontend/vite/).

The database/ledger tests can run without Tauri or a webview using `npm run test:core`.
The default Cargo `desktop` feature still builds the normal Tauri app. A portable
GNU Rust/C compiler under `.tools/` is available in this checkout for core tests:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
. .\scripts\use-local-tools.ps1
npm.cmd run test:core
```

This activation keeps Rust downloads and temporary build files inside the project.
Use the MSVC toolchain and the prerequisites above for the desktop build; the
portable core test toolchain does not replace those desktop requirements.

## Data safety

Keep real exports and backups outside the repository, or under the ignored
`private-data/` directory. Database files and ZIP/native backups are ignored too.
Only anonymized fixtures should ever be committed.

Fresh databases initialize at schema version 10. Existing databases are backed up
with SQLite's online backup API, checked for integrity, and then upgraded atomically.
The desktop app can also create a verified native backup on demand. Backups live in
a `backups/` folder beside the database. Each is a standalone, lossless SQLite file,
including committed WAL data, and never overwrites an existing backup. A backup
failure aborts an upgrade; a migration failure rolls back all schema changes while
retaining its verified backup. Unknown versions and populated unversioned databases
are rejected. Reopening an up-to-date database does not repeat the migration or
backup. A local backup helps recover from mistakes or corruption, but it remains on
the same disk: copy it to another private drive or storage location for disk-loss
protection. Deleting a register entry or canceling a schedule first creates a
verified safety snapshot; if that snapshot fails, Allocash makes no change. When
the budget opens normally, the desktop app can restore a selected file from its
local `backups/` folder. It validates the selected copy and saves the current
budget before replacing it. Supported older backups are upgraded in a temporary
copy for restore or recovery, preserving the source backup. If the live budget cannot open, the startup screen
can recover from a verified file in the same `backups/` folder. It preserves the
unreadable database and its WAL sidecars in a separate folder before installing
the backup. Copy an external backup into the displayed backups folder and select
Find local backups when needed. Keep an external copy of an important backup;
automatic retention is still future work.

## Git convention

After each completed, coherent edit, run the appropriate checks, create a focused
Conventional Commit (`type(scope): imperative summary`), and push the current
branch. Use annotated semantic-version tags for verified release milestones;
ordinary edits do not need tags. See [release status](docs/status.md) for outstanding gates and
[AGENTS.md](AGENTS.md) for the standing workflow instructions.
