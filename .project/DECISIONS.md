---
schema_version: 1
project_id: "allocash"
decisions:
  - id: "allocash-decision-001"
    title: "Keep the budgeting app local and single-budget"
    context: "The confirmed product scope calls for one offline Windows 11 budget in HUF, without a login, cloud backend, or bank API."
    state: "resolved"
    resolution: "Build a local Windows desktop application with one HUF budget and SQLite persistence."
    decided_at: null
    evidence:
      - path: "docs/product-scope.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Lists confirmed scope decisions and exclusions; decision time is not recorded."
  - id: "allocash-decision-002"
    title: "Preserve YNAB data and validate before migration"
    context: "The migration plan requires historical transactions and budget behavior to be reproduced before YNAB is cancelled."
    state: "resolved"
    resolution: "Import YNAB exports conservatively, preserve source data, and validate balances, Plan months, and reports against owner references before completing migration."
    decided_at: null
    evidence:
      - path: "docs/product-scope.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Defines final migration sequence and success criteria."
      - path: "docs/data-requirements.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Requires raw-source preservation and warns against guessing ambiguous mappings."
  - id: "allocash-decision-003"
    title: "Use integer HUF and keep financial writes in Rust"
    context: "Financial calculations and storage need deterministic, inspectable behavior."
    state: "resolved"
    resolution: "Store signed integer forints, transfer decimal strings over typed IPC, and perform SQLite financial writes in Rust transactions."
    decided_at: null
    evidence:
      - path: "docs/architecture.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Documents the implemented architecture; no original decision time is recorded."
      - path: "docs/AGENTS.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "States the accounting and storage safeguards."
  - id: "allocash-decision-004"
    title: "Require a lossless local backup before migration"
    context: "YNAB exports omit some application state, and destructive changes must not remove the only known-good data."
    state: "resolved"
    resolution: "Provide a lossless native backup, with verified snapshots before migrations and destructive actions; restore remains a separate planned capability."
    decided_at: null
    evidence:
      - path: "docs/data-requirements.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Makes native lossless backup a requirement."
      - path: "docs/architecture.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Describes implemented verified snapshots and the separate restore work."
  - id: "allocash-decision-005"
    title: "Make Allocash the highest-priority active project until migration readiness"
    context: "The owner needs to replace YNAB before cancelling the subscription and prefers the final week before 2026-10-30 to remain free unless critical recovery work is needed."
    state: "resolved"
    resolution: "Prioritize Allocash above the other active projects until a safe migration-ready release is reached, targeting 2026-10-21. Treat 2026-10-22 through 2026-10-30 as contingency-only."
    decided_at: "2026-10-04"
    evidence: []
  - id: "allocash-decision-006"
    title: "Freeze pre-migration scope to migration essentials"
    context: "The accounting and import core is already strongly validated, while restore, packaging, workflow rehearsal, and final migration checks remain. Expanding secondary features would increase deadline risk."
    state: "resolved"
    resolution: "Before 2026-10-21, prioritize only workflow gaps that block real use, restore/recovery, installer packaging, migration rehearsal, final data checks, and critical fixes. Defer non-blocking report completeness, forecasting polish, broader target/recurrence coverage, and other feature expansion until after migration."
    decided_at: "2026-10-04"
    evidence: []
---

# Decision context

Historical decision times were not recorded in the cited sources, so their `decided_at` values remain
null. Owner deadline and prioritization decisions made on 2026-10-04 are recorded with that date. The architecture entry records an implemented contract; it does not claim
to reconstruct a historical design discussion. Detailed product intent remains
in [product scope](../docs/product-scope.md) and [requirements](../docs/README.md).
