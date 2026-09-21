# Implementation and validation status

Reviewed against the checkout on 2026-09-21. This is a documentation inventory,
not a fresh application test or owner-data validation run.

## Implemented slices

- Schema migrations through version 8; typed integer-HUF ledger, linked transfers,
  editable register and basic reconciliation.
- YNAB raw archive/row staging, explicit account mapping, conservative transfer
  pairing, duplicate signals and exact as-of reference comparison.
- Monthly Plan assignments, category money moves, cash/credit handling and mapped
  card-payment categories; monthly targets and month-specific target snoozes.
- Monthly ordinary income/expense schedules with post, skip and deactivate actions.
- Spending, inflow/outflow, income/expense, income breakdown, balance/outflow over
  time and net-worth reports, plus deterministic historical-month forecasting.
- Verified standalone SQLite backups before migrations, on demand, and before
  register deletion or schedule deactivation.

See [accounting-rules.md](accounting-rules.md) for implemented semantics and
[architecture.md](architecture.md) for storage/import boundaries. These slices do
not establish completion of every feature in the product requirements.

## Evidence and remaining gates

The existing project record reports that the 2026-09-14 owner export matched all
34 YNAB reference working balances exactly. Four zero-value transfer rows remain
preserved in staging without affecting balances. This is historical evidence,
not a claim that a new export or all Plan/report values have been validated.

Native Windows MSVC desktop-build verification remains undocumented as complete;
it is still the recorded v0.1 release gate. Plan/schedule/report work has proceeded,
so older instructions to start that work only after v0.1 are sequencing intent,
not an accurate description of today's implementation. No release tag existed at
this review. Verify the gate before declaring or tagging a release.

Historical Plan import/materialization, full target frequencies, recurring
transfers, backup restore/retention and installer packaging remain outside the
implemented slices documented here. Consult topic requirements before choosing
next work; do not treat this list as an exhaustive backlog.

Update this file with dated evidence when a gate changes. Keep test counts and
machine-specific baseline failures out of always-loaded instructions.
