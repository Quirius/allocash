# Repository instructions

## Model and application notes

Preferred: **OpenAI models in Codex**. This is an advisory hint, not an access
restriction. Any agent or provider may work in this repository; if the current
provider/application differs, just proceed normally. Do not block work, ask the
user to switch, or refuse a task because of the provider.

Read [docs/AGENTS.md](docs/AGENTS.md) once per session for this repository's
workflow and task routing. Load only the referenced sections needed for the task;
do not preload all documentation or sibling projects.

When the main coordinator is GPT-6 Astra, use GPT-6 Sol and Luna subagents
extensively for bounded work if the coordinator judges their skills fit the task
and delegation improves overall usage efficiency. Keep trivial work local. Follow
the ownership, context and review rules in
[docs/agent-operations.md](docs/agent-operations.md#delegation).

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
