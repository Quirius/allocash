# Agent workflow

User instructions take precedence. Complete the requested work without expanding
product scope. Run commands from the `allocash/` checkout root.

## Session startup and context

- Allocash is a Windows 11, single-user, single-budget offline HUF desktop app:
  Tauri 2, React/TypeScript and SQLite. Identifier: `com.quirius.allocash`.
- Keep project source, downloads, tools, caches and check artifacts inside this
  root; portable tools belong in ignored `.tools/`. Do not create sibling tools
  or a nested `allocash/allocash/`. Installed data uses the app data directory.
- Read [status.md](status.md) when choosing next work or assessing release readiness.
  Use [README.md](../README.md) for setup and exact check commands.
- Find paths with `rg --files`/`rg -l`, then search relevant files and symbols.
  Bound initial output to about 100 lines/2,000 tokens; narrow truncated searches.
  Batch independent reads; do not reread unchanged files or load historical context
  without a task-specific reason.
- Module map: `src/app/` contains the app, register editor, reconciliation, Plan,
  schedule and report views; `src/lib/desktop.ts` is the typed IPC boundary;
  `src/lib/format.ts` handles HUF/calendar formatting. Under `src-tauri/src/`,
  `desktop.rs` exposes commands, `database.rs`/`migrations.rs`/`backup.rs` own storage,
  `ledger.rs` owns ledger, schedules and reports, `plan.rs` owns monthly budgeting,
  and `ynab_import.rs` owns staging/materialization/validation. Immutable SQL lives
  in `src-tauri/migrations/`; Rust tests sit beside modules, frontend tests in `tests/`.

## Task routing

Read applicable sections, not every linked file. [README.md](README.md) indexes docs.

| Task | Required context |
| --- | --- |
| Accounting or financial behavior | [accounting-rules.md](accounting-rules.md), relevant requirement file below |
| SQLite, migration, IPC, backup | [architecture.md](architecture.md), [data-requirements.md](data-requirements.md) |
| Accounts, register, transfers, reconciliation | [register-requirements.md](register-requirements.md) |
| Plan, credit funding, targets, schedules | [plan-requirements.md](plan-requirements.md); credit/account semantics in [register-requirements.md](register-requirements.md) |
| YNAB parsing, mapping, validation | Import sections of [architecture.md](architecture.md) and [data-requirements.md](data-requirements.md) |
| Reports, forecasting | Reports sections of [accounting-rules.md](accounting-rules.md) and [report-requirements.md](report-requirements.md) |
| Scope, UI direction, milestones, final migration | [product-scope.md](product-scope.md), [status.md](status.md) |

Requirements describe intended behavior; accounting/architecture describe implemented
contracts; status records completion limits. Surface conflicts rather than silently
changing financial behavior. Update the owning document when its facts change.

## Non-negotiable safeguards

- Accounting/import correctness precedes input speed, familiar workflow, backups
  and polish. Keep calculations deterministic and inspectable; test financial invariants.
- Use checked integer HUF, decimal-string IPC and frontend `bigint`, never binary
  floating point for money. Dates are calendar dates, not UTC timestamps.
- Rust owns financial writes. Use foreign keys and SQL transactions for multi-step
  mutations; schema changes require migrations and verified pre-migration backups.
- Preserve raw import data, historical identities, closed accounts and transfer
  linkage. Never silently discard rows, guess ambiguous mappings, overwrite the only
  known-good budget, or weaken reconciled-history confirmation and backup guards.
- Core functionality remains offline: no required login, bank API, cloud backend,
  telemetry, analytics or automatic uploads. Commit only anonymized fixtures; keep
  real exports/backups private and avoid financial details in logs.
- Do not casually alter specified YNAB-like behavior, force split transactions, add
  unused YNAB features or introduce premature abstractions. Ask before major scope
  changes; document ambiguity instead of making deep assumptions.

## Execution and completion

- Suggested root: **GPT-6 Astra, low reasoning** (owner's "light"); treat as an
  advisory hint, not a requirement. Handle small tasks directly. For delegation or
  consequential financial review, load
  [agent-operations.md](agent-operations.md#delegation).
- If subagents are available, **GPT-6 subagents** are the suggested choice (avoid
  GPT-5.6 subagents, including as fallbacks). Agents that cannot honor this may
  simply ignore it and proceed.
- Use the narrowest relevant check from [checks.md](checks.md); broaden for
  failures or concrete regression risk. Docs-only edits need links/content and
  diff checks, not the application suite. Do not repeat unchanged passing checks.
- Standing authorization to commit/push verified task changes remains in effect
  unless the user says otherwise. When publishing or preparing a release, load
  [agent-operations.md](agent-operations.md#git-and-releases).
- Report result, checks and material limitations briefly; mention Git actions
  when performed and model changes/fallbacks only when relevant.
- When switching unrelated tasks or handing off a long session, retain only the
  objective, relevant paths, decisions, checks and next step. Do not maintain a
  running transcript or claim that old context has been removed.
