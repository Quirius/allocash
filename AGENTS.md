# Allocash agent instructions

Shared instructions for every coding agent (Codex and OpenCode read this file;
Claude Code loads it through `CLAUDE.md`). User instructions take precedence. Run
commands from this checkout root. Load detailed documents only when the task needs
them; never preload all docs or sibling repositories.

## Project

Windows 11, single-user, single-budget, offline HUF envelope-budgeting desktop app
(YNAB-style) with lossless YNAB import and balance validation. Tauri 2, React and
TypeScript, Rust, SQLite. Identifier `com.quirius.allocash`.

## Layout

- `src/app/`: app shell, register editor, reconciliation, Plan, schedule and report
  views. `src/lib/desktop.ts` is the typed IPC boundary; `src/lib/format.ts` owns
  HUF/calendar formatting; other `src/lib/` helpers cover amounts, recurrence,
  register, transactions and undo.
- `src-tauri/src/`: `desktop.rs` exposes commands (Cargo `desktop` feature);
  `database.rs`, `migrations.rs` and `backup.rs` own storage; `ledger.rs` owns the
  ledger, transfers, reconciliation, schedules and reports; `plan.rs` owns monthly
  budgeting, credit funding and targets; `ynab_import.rs` owns staging,
  materialization and validation; `account_management.rs` and `undo.rs` own account
  edits and the session undo stack.
- `src-tauri/migrations/`: immutable SQL migrations. Rust tests are `mod tests`
  blocks plus `src-tauri/src/*_tests.rs`; frontend Vitest tests are in `tests/`.
- Keep tools, caches and artifacts inside this root: portable tools in ignored
  `.tools/`, private exports in ignored `private-data/`. No sibling tool folders and
  no nested `allocash/allocash/`. Installed data lives in the app data directory.

## Commands

Setup, toolchain and YNAB verification recipes: [README.md](README.md). Per-area
first checks: [docs/checks.md](docs/checks.md).

- `npm ci`, then `npm run tauri dev` (desktop) or `npm run dev` (browser preview; no SQLite)
- `npm test` (Vitest), `npm run build` (TypeScript + Vite), `npm run test:core -- <filter>`
  (portable Rust core), `npm run test:rust`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- Documentation-only edits: check links, facts and `git diff --check`; no app suite.

## Non-negotiable safeguards

- Accounting/import correctness precedes input speed, familiar workflow, backups and
  polish. Keep calculations deterministic and inspectable; test financial invariants.
- Money is checked integer HUF, decimal-string IPC and frontend `bigint`; never binary
  floating point. Dates are calendar dates, not UTC timestamps.
- Rust owns financial writes. Use foreign keys and SQL transactions for multi-step
  mutations; schema changes need a new migration and a verified pre-migration backup.
- Preserve raw import data, historical identities, closed accounts and transfer
  linkage. Never silently discard rows, guess ambiguous mappings, overwrite the only
  known-good budget, or weaken reconciled-history confirmation and backup guards.
- Core features stay offline: no required login, bank API, cloud backend, telemetry,
  analytics or uploads. Commit only anonymized fixtures; keep real exports and backups
  private and keep financial details out of logs.
- Do not casually change specified YNAB-like behavior, force split transactions, add
  unused YNAB features or premature abstractions. Ask before major scope changes.

## Where to find things

| Need | Read |
| --- | --- |
| Current state, open gates, dated validation evidence | [docs/status.md](docs/status.md) (summary at top) |
| Storage, backups, IPC, schema, importer design | [docs/architecture.md](docs/architecture.md) |
| Financial behavior | [docs/accounting-rules.md](docs/accounting-rules.md) plus the matching requirement file |
| SQLite, migrations, backup, YNAB import | [docs/architecture.md](docs/architecture.md), [docs/data-requirements.md](docs/data-requirements.md) |
| Accounts, register, transfers, reconciliation | [docs/register-requirements.md](docs/register-requirements.md) |
| Plan, credit funding, targets, schedules | [docs/plan-requirements.md](docs/plan-requirements.md) |
| Reports, forecasting | [docs/report-requirements.md](docs/report-requirements.md), reports in accounting rules |
| Scope, UI direction, milestones, final migration | [docs/product-scope.md](docs/product-scope.md) |
| Decisions | [.project/DECISIONS.md](.project/DECISIONS.md); schema decisions in architecture |
| Every document and what it owns | [docs/README.md](docs/README.md) |

Requirement files state intent and future scope, not implemented fact; accounting
rules and architecture describe implemented contracts; status records limits. Surface
conflicts instead of silently changing financial behavior, and update the document
that owns a changed fact.

## Working rules

- Find files with `rg`/`rg --files` or the harness search tool; read relevant sections
  only and do not reread unchanged files.
- Run the narrowest relevant check first; broaden for failures or real regression
  risk. A zero-match test filter is not a pass. Do not repeat unchanged passing checks.
- Git: Conventional Commits. Standing authorization to commit and push verified task
  changes unless the user says otherwise; never force-push or rewrite published
  history. Releases and tags: [agent-operations](docs/agent-operations.md#git-and-releases).
- Check `git status` first and leave unrelated or another agent's uncommitted work
  untouched. Parallel independent tasks use separate branches in separate worktrees.
- Git history is the change record. Update `docs/status.md` for milestones, gate
  changes or blockers, not every edit. When stopping mid-task, report completed
  changes, outstanding work and verification status.
- Models: cheapest capable tier (Claude Opus > Sonnet > Haiku; OpenAI Sol > Luna);
  subscription logins only. Seek independent review for
  consequential accounting, schema or migration changes. Delegation rules:
  [agent-operations](docs/agent-operations.md#delegation).

## Project HQ reporting

`.project/` holds the schema-version-1 status, roadmap and decisions published from
`main`; [.project/README.md](.project/README.md) owns the contract and the
[completion gate](.project/README.md#reporting-completion-gate). After substantive
pushed work, refresh the affected `.project/` records, set `source.commit` to the
reviewed product commit, run `python scripts/check_project_hq_freshness.py --strict`,
and publish reporting as a separate commit. Never infer completion from activity,
mark unpushed work complete, or claim Project HQ synchronized without checking.
