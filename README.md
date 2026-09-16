# Allocash

A Windows desktop budgeting app for one local HUF budget, built with Tauri 2,
React, TypeScript and SQLite. No login, cloud backend, bank connection or telemetry.

The repository and folder were renamed from `ynabclone` to `allocash` on
2026-09-10. The repository is [Quirius/allocash](https://github.com/Quirius/allocash).
All project development files live directly inside `allocash/`, including the
ignored `.tools/` folder for portable Node.js, npm cache, browser checks and previews.

## Current step

The v0.1 import/register foundation is implemented:

- Dark desktop shell with the Cash / Credit / Loans / Tracking / Closed groups.
- Versioned SQLite migrations, persistent budget settings and verified backups before upgrades.
- Ledger tables for accounts, category groups/categories, payees, flags and transactions.
- Transfers with one shared amount and two linked entries, plus raw import staging tables.
- Typed account/transaction operations, paired transfer edits/deletion and reconciled-edit confirmation.
- Exact as-of balances with separate cleared, uncleared and reconciled totals.
- Import validation with source/ledger counts, per-account balance buckets, unresolved
  mappings and transfer rows, plus within-export and cross-export duplicate signals.
- UTF-8-safe YNAB Net Worth comparison against materialized working balances.
- Persisted account sidebar groups and an editable transaction register with resolved
  payees, categories, flags, transfers and exact balance totals.
- Keyboard-friendly manual entry with payee/category memory, paired account transfers,
  exact HUF validation and cleared-by-default behavior.
- Atomic register amount, memo and cleared-state edits, including paired transfer
  updates/deletion and explicit confirmation when reconciled history is affected.
- Visible database startup/error states and a browser-only layout preview.
- Exact integer HUF formatting and timezone-free calendar date formatting.
- Native Rust tests for migrations, backups, ledger invariants and preserved history,
  plus frontend formatting and desktop-bridge tests.

The YNAB importer preserves the original archive and every CSV/TSV row, requires
explicit account mappings, materializes ordinary transactions and only provable
transfer pairs, and produces an exact as-of validation report without guessing
ambiguous financial data. No financial data is seeded; the six specified flag
definitions are initialized. A fresh owner export has completed the v0.1 validation
gate with all 34 working balances matching YNAB exactly. Four zero-value transfer
rows remain preserved for review and do not affect balances. The basic
reconciliation workflow is complete; the remaining v0.1 release gate is a native
Windows MSVC desktop-build verification. See [the architecture](docs/architecture.md).
The backend accounting behavior is documented in [accounting rules](docs/accounting-rules.md).

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

To validate a private YNAB export against a matching Net Worth TSV without
retaining a test database or printing account names and balances:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --example verify_ynab_export -- "path/to/export.zip" "path/to/net-worth.tsv" yyyy-mm-dd
```

Rust checks require a Rust toolchain; the desktop build also requires the Windows
build prerequisites. Installer
packaging is deferred; this step builds a desktop executable only. Frontend
integration follows [Tauri's Vite guide](https://v2.tauri.app/start/frontend/vite/).

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

Fresh databases initialize at schema version 8. Existing databases are backed up
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
verified safety snapshot; if that snapshot fails, Allocash makes no change. Restore
and automatic retention are still future work.

## Git convention

After each completed, coherent edit, run the appropriate checks, create a focused
Conventional Commit (`type(scope): imperative summary`), and push the current
branch. Use annotated semantic-version tags for verified release milestones;
ordinary edits do not need tags. The foundation is not tagged as a release while
native build verification remains outstanding. See [AGENTS.md](AGENTS.md) for the
standing workflow instructions.
