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

Current stage: the first v0.1 foundation. Follow the implementation sequence in
section 40 of the brief. Keep the Plan engine out of scope until the import and
register layers have been validated.
