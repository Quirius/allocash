# Project HQ reporting contract

These files prepare repository data for a future Project HQ importer. The dashboard
does not yet consume them. `STATUS.yaml` summarizes the current published state;
the single YAML front matter blocks in `ROADMAP.md` and `DECISIONS.md` hold the
machine-readable plans, milestones, and decisions. Markdown below those blocks
provides context, not a second task list. Schema version 1 and stable IDs must be
preserved when editing existing records; never reuse an ID.

`STATUS.yaml` uses `schema_version`, `project_id`, `name`, `repository`, `status`,
`description`, `objective`, `phase`, `progress`, `next_action`, `updated_at`,
`source`, `summary`, and `evidence`. Status is `Active`, `Planning`, `In Progress`,
`Review`, `Archived`, or null. `progress.percent` is null unless an explicit
scoped human assessment exists, in which case it is a number from 0 to 100;
`progress.basis` is `manual` or `unknown`, with scope in `rationale`.
`ROADMAP.md` front matter has `schema_version`, `project_id`, `plans`, and
`milestones`; item states are `planned`, `blocked`, or `completed`. Plan windows
are `Today`, `This week`, `Next week`, `Later`, or `Backlog`; priorities are
`high`, `medium`, or `low`. `DECISIONS.md` front matter has `schema_version`,
`project_id`, and `decisions`, with `open` or `resolved` states. Use null for
unknown dates and times, and UTC ISO 8601 strings ending in `Z` for known times.
Evidence uses repository-relative `path`, full pushed `ref`, and `note` (or an
exact external `url` and `note`). IDs must be unique across plans, milestones,
and decisions and remain stable as state changes.

The reporting branch is `main`, the established development and remote default
branch. `source.branch` and `source.commit` identify the pushed product/documentation
revision inspected for claims, not the reporting commit. The initial evidence
cutoff is `f19a28b118a220b32f4104d751df3cf97839284b` on `origin/main`.
Each evidence entry points to a repository-relative path at that pushed commit.
These files themselves remain pending publication until committed and pushed.

Read [implementation status](../docs/status.md), [product scope](../docs/product-scope.md),
the [documentation map](../docs/README.md), and relevant requirements before updating
the report. Requirements and milestones describe intent; source code, tests, and
status evidence establish implementation and validation. Do not infer completion
or project percentages from activity. Unknown values remain null. `Backlog` and
`medium` are reporting defaults when no owner schedule or priority is recorded;
they create no new commitment. A near-term relative window needs `window_as_of`.

After a relevant product change is pushed, inspect its pushed commit, refresh
materially changed status, plans, blockers, milestones, decisions, and evidence,
then publish a separate reporting commit under the repository's Git policy. Do
not mark unpushed work complete in a published snapshot; describe it in the
session handoff. Use actual UTC times for report edits and verified evidence,
without treating them as product-update times. A reporting-only commit does not
require a timestamp-only follow-up. Report push failure or stale snapshots
honestly, and do not claim Project HQ has synchronized until an importer confirms
it. Keep private financial data, credentials, and machine paths out of these files.
