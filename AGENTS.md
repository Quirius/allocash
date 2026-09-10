# Repository instructions

The project, repository and root folder are named **allocash** (renamed from
`ynabclone` on 2026-09-10). Use **Allocash** as the displayed app name and
`com.quirius.allocash` as the desktop identifier. The GitHub repository is
`https://github.com/Quirius/allocash`.

Keep all project source, downloads, portable tools, caches and check artifacts
inside this `allocash/` root. Local development tools belong in the ignored
`.tools/` directory. Do not create a sibling tools folder or a nested
`allocash/allocash/` directory. Installed app budget data uses the documented
Windows application data directory.

Read [AGENTS (1).md](<AGENTS (1).md>) before making changes. It is the owner's
authoritative product brief and implementation guidance.

Current stage: v0.1 ledger foundation implemented. Schema version 2, verified
pre-migration backups, typed ledger operations and as-of account balances have
native Rust tests. The next phase is the YNAB importer and validation summary
(section 40, steps 8–9), followed by the account/register UI. Keep the Plan engine
out of scope until the import and register layers have been validated.

## Git workflow

The owner authorizes committing and pushing after every completed, coherent edit.
Treat related file edits as one logical change; run the appropriate checks, commit
that change, and push it before moving to the next change or ending the task.
No additional confirmation is needed for these routine commits and pushes.

- Use Conventional Commits: `type(scope): imperative summary`, with types such as
  `feat`, `fix`, `refactor`, `test`, `docs`, `build`, and `chore`.
- Keep commits focused and independently understandable. Include relevant
  validation and any unavailable checks in the commit body when helpful.
- Stage only files belonging to the current change; keep personal data and local
  tools ignored. Do not rewrite published history or force-push without an explicit request.
- Push the current branch to its configured remote (currently `main` on `origin`).
  Check for remote changes and resolve divergence without discarding others' work.
- Add and push annotated semantic-version tags for completed, verified release
  milestones, such as `v0.1.0-alpha.1` for a tested prerelease or `v0.1.0` for the
  complete v0.1 milestone. Do not tag ordinary edits or move an existing tag.
- The initial foundation has no release tag yet: native build verification and
  the v0.1 import/register milestone are still outstanding.
