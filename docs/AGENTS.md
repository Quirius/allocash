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

## Models and delegation

- Default root: **GPT-6 Astra, low reasoning** (owner's "light"), configured in
  `../.codex/config.toml`. Config changes do not switch an already-running session.
  Preserve the selected setting; report a known mismatch once.
- Delegate bounded work when useful: **Luna low** for searches/docs/mechanical work;
  **Terra medium** for implementation/debugging; **Sol high or Astra** for difficult
  architecture, accounting/schema/Plan logic or a concrete cheaper-model failure.
  Use the lowest sufficient effort and disclose unavailable overrides/fallbacks.
- Prefer one worker for small tasks. Use fresh context, explicit owned files,
  relevant rules/skills and an acceptance check. Avoid overlapping edits, whole-chat
  copies and recursive delegation. Workers return paths, checks and blockers briefly.
- Seek an independent qualified review for consequential accounting, schema,
  migration, transfer, reconciliation, credit-card or budget-engine changes when
  practical. Review supplements deterministic tests; it does not replace them.
- Recommend an exact different root setting only when the coordinator needs it
  throughout the task; prefer a specialist for an isolated hard part. Never claim
  an unverified model, reasoning level, capability or token saving.

## Verification and completion

- Run targeted checks first, broaden for concrete regression risk or failures.
  One agent owns each run; summarize failures without dumping passing logs. Do not
  repeat passing checks absent a relevant change. Docs-only edits need link/content
  and diff checks, not the application suite.
- Frontend: `npm test`, `npm run build`. Native core: `npm run test:core`.
  Desktop/native and toolchain setup: see the root README. A browser preview or
  portable GNU core check does not verify the Windows MSVC desktop build.
- Keep documentation focused: one home per fact, task routes instead of duplicated
  specifications, no recurring progress transcripts. Report material context drivers
  once; suggest a short handoff/fresh chat when useful. Do not claim prior context
  has been removed or estimate actual token savings from file size alone.
- Standing authorization: after each completed coherent edit, validate, create a
  focused Conventional Commit (`type(scope): imperative summary`) and push the
  current branch to its configured remote. Check remote changes and resolve
  divergence without discarding others' work. Stage only task files; never
  force-push or rewrite published history without explicit instruction.
- Evaluate tags after each task: create/push annotated semantic-version tags only
  for completed, verified release/prerelease milestones. Ordinary edits stay
  untagged; never move a published tag. Do not infer release readiness from package
  version or implemented features alone.
- Final report: result and checks/limits, commit message/hash and pushed branch/result,
  tag or why none, actual coordinator and worker model/effort/responsibility (say
  when exact runtime settings are unknown), and whether a root-setting change is
  needed. Do not omit required commit/push attempts or delegation decisions.
