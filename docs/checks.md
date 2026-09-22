# Targeted checks

Run from the repository root after the setup in [README.md](../README.md).
Choose the affected row; these are starting points, not a mandatory checklist.
Confirm the selected command executes tests (a zero-match filter is not a pass).
Narrow to a specific test name when useful; broaden for cross-cutting changes or
concrete regression risk. Do not repeat passing checks without a relevant change.

| Area / source | First check |
| --- | --- |
| `src/lib/format.ts` | `npm test -- tests/format.test.ts` |
| `src/lib/desktop.ts` IPC wrapper | `npm test -- tests/desktop.test.ts` |
| Reconciliation UI logic | `npm test -- tests/reconciliation.test.ts` |
| Schedule UI logic | `npm test -- tests/schedule.test.ts` |
| `src-tauri/src/ledger.rs`: register, transfers, schedules, reports | `npm run test:core -- ledger_tests::` |
| `src-tauri/src/plan.rs`: Plan, credit funding, targets | `npm run test:core -- plan::tests::` |
| `src-tauri/src/ynab_import.rs` | `npm run test:core -- ynab_import_tests::` |
| `src-tauri/src/database.rs` | `npm run test:core -- database::tests::` |
| `src-tauri/src/migrations.rs` and SQL schema | `npm run test:core -- migrations::tests::` and `npm run test:core -- schema_tests::` |
| Backup/restore | Search `src-tauri/src/*tests.rs` for backup/restore cases; run the matching test filter with `npm run test:core -- <filter>` |
| UI/component or TypeScript changes beyond the tested helpers | Relevant tests above plus `npm run build` for type/build validation; inspect changed interaction as needed |
| Documentation only | Check changed links, facts and `git diff --check`; no application suite |

For financial changes, also read the relevant safeguards/requirements routed from
[AGENTS.md](AGENTS.md#task-routing). Shared accounting or schema changes can require
`npm run test:core` across modules. Full frontend checks are `npm test`.
Desktop/native builds and toolchain instructions live in the root README; a browser
preview or portable core test does not verify the Windows MSVC desktop build.
