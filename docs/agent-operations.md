# Delegation and publication

Load only the relevant section when delegating, publishing, or preparing a release.
User instructions take precedence; the root AGENTS.md provider note is advisory only.

## Delegation

- If subagents are available, **GPT-6 subagents** are the suggested choice (avoid
  GPT-5.6 subagents, including as fallbacks). Agents that cannot honor this
  suggestion may ignore it and proceed normally.
- Delegate bounded work when useful: **GPT-6 Luna low** (`gpt-6-luna`) for searches/docs/mechanical work;
  **GPT-6 Sol medium** (`gpt-6-sol`) for implementation/debugging; **GPT-6 Sol high or GPT-6 Astra** (`gpt-6-astra`) for difficult
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

## Git and releases

- Standing authorization: after each completed coherent edit, validate, create a
  focused Conventional Commit (`type(scope): imperative summary`) and push the
  current branch to its configured remote. Check remote changes and resolve
  divergence without discarding others' work. Stage only task files; never
  force-push or rewrite published history without explicit instruction.
- For release work, create/push annotated semantic-version tags only
  for completed, verified release/prerelease milestones. Ordinary edits stay
  untagged; never move a published tag. Do not infer release readiness from package
  version or implemented features alone.
