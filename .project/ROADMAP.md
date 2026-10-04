---
schema_version: 1
project_id: "allocash"
plans:
  - id: "allocash-plan-001"
    title: "Materialize historical Plan data from YNAB imports"
    state: "planned"
    window: "Backlog"
    priority: "medium"
    due_date: null
    completed_at: null
    details: "Historical Assigned values now materialize from staged Budget rows without overwriting edits. Activity and Available remain staged until explicit account and credit-payment mappings support comparison."
    acceptance_criteria:
      - "Historical assignments are imported and source Activity/Available values remain available for comparison without discarding source data."
      - "Imported Plan values can be compared with owner reference months."
    blocked_by: []
    evidence:
      - path: "docs/status.md"
        ref: "3902144436aadfad38a458340d725e51fdd59cb1"
        note: "All 1,326 Assigned values from the new export materialized in a disposable database; Activity/Available validation remains open."
      - path: "docs/architecture.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Identifies historical Plan materialization as the next importer phase."
      - path: "docs/product-scope.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Requires Plan verification in the final migration."
  - id: "allocash-plan-002"
    title: "Complete target and recurrence coverage"
    state: "planned"
    window: "Backlog"
    priority: "medium"
    due_date: null
    completed_at: null
    details: "Monthly targets and ordinary income/expense schedules exist; full target frequencies and recurring transfers remain outside the documented implementation."
    acceptance_criteria:
      - "Documented target frequency behavior is implemented and tested."
      - "Recurring transfers preserve linked account movements and are tested."
    blocked_by: []
    evidence:
      - path: "docs/status.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Distinguishes implemented monthly slices from remaining target and recurring-transfer work."
      - path: "docs/plan-requirements.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Describes intended schedule and target behavior."
  - id: "allocash-plan-003"
    title: "Add native backup restore and retention"
    state: "planned"
    window: "Backlog"
    priority: "medium"
    due_date: null
    completed_at: null
    details: "Verified standalone backups exist, but restore and automatic retention are future work."
    acceptance_criteria:
      - "A backup can be restored with validation and a recoverable failure path."
      - "Retention behavior is documented and tested without deleting the only known-good copy."
    blocked_by: []
    evidence:
      - path: "docs/architecture.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Explains backup implementation and restore requirements."
      - path: "docs/status.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Lists restore and retention outside implemented slices."
  - id: "allocash-plan-004"
    title: "Validate Plan and report values with owner data"
    state: "planned"
    window: "Backlog"
    priority: "medium"
    due_date: null
    completed_at: null
    details: "A historical account-balance comparison exists; it does not establish Plan or report correctness. Validation needs reference values without publishing private data."
    acceptance_criteria:
      - "Representative recent Plan months match verified reference values or discrepancies are resolved."
      - "Required historical report values match verified reference values or discrepancies are resolved."
    blocked_by:
      - "allocash-plan-001"
    evidence:
      - path: "docs/status.md"
        ref: "7db87e1bcd62a68111ad94049ec10dd6954506fc"
        note: "Limits the new owner-export result to disposable import validation; exact balances and Plan/report values remain unverified."
      - path: "docs/product-scope.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Lists Plan and report verification in final migration."
  - id: "allocash-plan-005"
    title: "Package and verify a migration-ready Windows release"
    state: "planned"
    window: "Backlog"
    priority: "medium"
    due_date: null
    completed_at: null
    details: "The native desktop executable builds, but installer packaging and final owner-data migration checks are not complete; no release tag was documented at the evidence cutoff."
    acceptance_criteria:
      - "A Windows installer is built and verified."
      - "The final YNAB export imports with account balances, Plan months, and reports verified."
      - "A native backup is created before the release milestone is tagged."
    blocked_by:
      - "allocash-plan-003"
      - "allocash-plan-004"
    evidence:
      - path: "docs/status.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Desktop build passed, but installer and release gates remain."
      - path: "docs/product-scope.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Defines the migration-ready milestone and final migration sequence."
  - id: "allocash-plan-006"
    title: "Verify native Windows desktop build gate"
    state: "completed"
    window: "Backlog"
    priority: "medium"
    due_date: null
    completed_at: null
    details: "The documented Windows MSVC check sequence passed on 2026-09-23 and produced a desktop executable. Exact completion time is unknown; this does not establish installer or migration readiness."
    acceptance_criteria:
      - "Frontend and Rust checks, formatting, and a native desktop build pass on Windows."
    blocked_by: []
    evidence:
      - path: "docs/status.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Records the dated check sequence and successful native desktop build."
milestones:
  - id: "allocash-milestone-001"
    title: "v0.1 Import, Accounts, and Register"
    state: "planned"
    details: "Most listed slices are implemented, but the milestone remains open pending complete owner-data and scope validation; no release tag is documented."
    evidence:
      - path: "docs/product-scope.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Defines the intended v0.1 scope and validation goal."
      - path: "docs/status.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Documents implemented slices and release limits."
  - id: "allocash-milestone-002"
    title: "v0.2 Plan and Budget Engine"
    state: "planned"
    details: "Monthly Plan exists, while imported historical Plan validation remains open."
    evidence:
      - path: "docs/product-scope.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Defines the v0.2 validation goal."
      - path: "docs/status.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Lists current Plan slice and validation limits."
  - id: "allocash-milestone-003"
    title: "v0.3 Scheduling, Targets, and Workflow"
    state: "planned"
    details: "Ordinary monthly scheduling and targets exist, but documented frequency and recurring-transfer coverage remain open."
    evidence:
      - path: "docs/product-scope.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Defines the v0.3 milestone."
      - path: "docs/status.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Lists scheduling and target limits."
  - id: "allocash-milestone-004"
    title: "v0.4 Reports"
    state: "planned"
    details: "Several reports exist, but coverage and owner-data value validation are not established as complete."
    evidence:
      - path: "docs/product-scope.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Defines the v0.4 report scope."
      - path: "docs/status.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Lists implemented reports and validation limits."
  - id: "allocash-milestone-005"
    title: "v0.5 Forecasting"
    state: "planned"
    details: "Deterministic historical-month forecasting exists; the intended Monte Carlo scope and release validation remain open."
    evidence:
      - path: "docs/product-scope.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Defines the v0.5 Monte Carlo scope."
      - path: "docs/status.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Describes the current forecasting slice."
  - id: "allocash-milestone-006"
    title: "v1.0 Migration-ready release"
    state: "planned"
    details: "Requires installer, restore/backup completion, final import, and account, Plan, and report validation."
    evidence:
      - path: "docs/product-scope.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Defines v1.0 gates and final migration sequence."
      - path: "docs/status.md"
        ref: "f19a28b118a220b32f4104d751df3cf97839284b"
        note: "Documents current release limits."
---

# Roadmap context

The front matter is the reporting list. The owner's detailed scope and milestone
definitions remain in [product scope](../docs/product-scope.md); the current
implementation and validation limits remain in [status](../docs/status.md).
Requirements describe intent, not completed behavior. The v0.1 through v0.5
labels above are scope milestones; their historical sequence does not assert that
later implementation waited for an earlier release.

The completed build gate has no verified completion time, so `completed_at` is
null. Backlog and medium are reporting defaults, not owner deadlines or priorities.
