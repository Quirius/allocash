# Repository instructions

## Model and application notes

Preferred: **OpenAI models in Codex**. This is an advisory hint, not an access
restriction. Any agent or provider may work in this repository; if the current
provider/application differs, just proceed normally. Do not block work, ask the
user to switch, or refuse a task because of the provider.

Read [docs/AGENTS.md](docs/AGENTS.md) once per session for this repository's
workflow and task routing. Load only the referenced sections needed for the task;
do not preload all documentation or sibling projects.

Prefer **GPT-6.1 Sol** (`gpt-6.1-sol`) or **GPT-6 Astra** (`gpt-6-astra`)
as the main coordinator. Both should use **GPT-6 Luna** (`gpt-6-luna`)
subagents for coding, light work, and independent critical review wherever needed
to improve token efficiency. Keep Luna scopes bounded, with clear ownership,
minimal context, and concrete acceptance checks. The main coordinator should
focus on broader decisions and especially heavy tasks, retaining responsibility
for integration and final validation. Escalate difficult or unresolved work to
the coordinator. Keep trivial work local only when delegation overhead would
outweigh the expected savings; never claim unmeasured token savings.

These model preferences do not restrict access or block work when only other
suitable models are available.

## Project HQ reporting

Read [.project/README.md](.project/README.md) and the relevant reporting files
when beginning substantive work. `main` is the reporting branch. Treat
[docs/status.md](docs/status.md) as the implementation and validation record,
[docs/product-scope.md](docs/product-scope.md) as milestone intent, and the
[documentation map](docs/README.md) as the route to detailed requirements.
Refresh reporting when pushed implementation, validation, release readiness,
plans, blockers, milestones, or decisions materially change. Keep stable IDs and
schema version 1; preserve owner plans and unknowns. Only pushed evidence can
support published completion. Follow existing commit/push rules, using a separate
reporting commit after relevant product changes are pushed; disclose unpushed work
in the session handoff. Report stale snapshots or push failures, and never claim
Project HQ synchronized solely because files were pushed.

## Reporting completion gate

After substantive code/design work, finish the Project HQ reporting update before
the final push/handoff. Review changes since STATUS.yaml source.commit and refresh
affected status, plans, blockers, milestones, decisions and evidence. Set the
source SHA only to the actual reviewed product/design commit, not the reporting
commit; never advance it merely to suppress a warning or infer progress from
activity. Preserve owner plans, stable IDs and unknown values.

Run `python scripts/check_project_hq_freshness.py --strict` after the report
update and before pushing its reporting commit. Resolve any stale-report result;
if blocked, disclose the remaining stale scope rather than claiming completion.
Follow existing Git rules, push the reporting commit, and confirm its remote
publication before saying the report is published. Do not create timestamp-only
follow-up commits or claim dashboard synchronization without checking it.

The default GitHub Actions invocation is advisory for stale reports: it emits a
warning and succeeds. Missing/invalid source metadata and checker/Git errors
still fail. A successful Action does not certify report freshness; HQ retains its
independent amber stale-report warning. The `--strict` mode is the agent's
completion gate and fails on stale reports as well.

