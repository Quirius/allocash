---
schema_version: 1
project_id: "allocash"
plans:
  - id: "allocash-plan-001"
    title: "Materialize historical Plan data from YNAB imports"
    state: "completed"
    window: "Backlog"
    priority: "medium"
    due_date: null
    completed_at: "2026-10-04T10:28:46Z"
    details: "Historical Assigned values materialize from staged Budget rows without overwriting edits. Owner-confirmed account and credit-payment mappings support comparison of staged Activity and Available values; remaining discrepancies belong to validation."
    acceptance_criteria:
      - "Historical assignments are imported and source Activity/Available values remain available for comparison without discarding source data."
      - "Imported Plan values can be compared with owner reference months."
    blocked_by: []
    evidence:
      - path: "docs/status.md"
        ref: "2bb31400fb6eb74257a4f712dfc8d8a2fee9522a"
        note: "Records 1,326 imported assignments and mapped comparison results, with the payment mappings confirmed by the owner."
      - path: "docs/status.md"
        ref: "45fc8606a57b83df66b2be16d04afd7b1a8a4827"
        note: "Mapped Plan comparison is implemented; credit payment and current-month differences remain."
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
    details: "The October 2026 export matches all 34 Net Worth reference balances and all 1,326 Assigned, Activity, and Available Plan rows across 51 months. Report values still need independent comparison without publishing private data."
    acceptance_criteria:
      - "Representative recent Plan months match verified reference values or discrepancies are resolved."
      - "Required historical report values match verified reference values or discrepancies are resolved."
    blocked_by: []
    evidence:
      - path: "docs/status.md"
        ref: "7d80939c400efc8f788567dfe7b55109f52e9276"
        note: "Records exact Plan and account-balance agreement after positive-card-balance funding correction; report validation remains open."
      - path: "docs/status.md"
        ref: "37f5178ba88aac2717dbf9f971b62a07d7bfee28"
        note: "Records the earlier partial Plan comparison before the final funding correction."
      - path: "docs/status.md"
        ref: "dbf34207af49e55b23b221a53df50b3f273b8378"
        note: "Records the as-of Plan comparison and its remaining historical card-payment differences."
      - path: "docs/status.md"
        ref: "45fc8606a57b83df66b2be16d04afd7b1a8a4827"
        note: "Records exact account balances and quantified Plan differences while report validation remains open."
      - path: "docs/status.md"
        ref: "7db87e1bcd62a68111ad94049ec10dd6954506fc"
        note: "Earlier disposable import check before independent reference data was available."
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
    details: "The native desktop executable builds and the October export matches account balances and all Plan rows, but installer packaging, report validation, and final owner-data migration checks remain open; no release tag was documented at the evidence cutoff."
    acceptance_criteria:
      - "A Windows installer is built and verified."
      - "The final YNAB export imports with account balances, Plan months, and reports verified."
      - "A native backup is created before the release milestone is tagged."
    blocked_by:
      - "allocash-plan-003"
      - "allocash-plan-004"
    evidence:
      - path: "docs/status.md"
        ref: "7d80939c400efc8f788567dfe7b55109f52e9276"
        note: "Records exact account and Plan comparison, with report and release gates still open."
      - path: "docs/status.md"
        ref: "45fc8606a57b83df66b2be16d04afd7b1a8a4827"
        note: "Records the earlier validation state before full Plan agreement."
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
    details: "Monthly Plan exists and the October export matches all 1,326 historical Plan rows; milestone scope and release validation remain open."
    evidence:
      - path: "docs/status.md"
        ref: "7d80939c400efc8f788567dfe7b55109f52e9276"
        note: "Records exact historical Plan comparison without asserting release completion."
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
