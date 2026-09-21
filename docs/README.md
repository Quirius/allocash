# Documentation map

Start with [agent workflow](AGENTS.md) for repository work. Read only the topics
needed for the task; this index does not require loading every linked document.

| Document | Owns |
| --- | --- |
| [Status](status.md) | Implemented slices, historical validation and open release gates |
| [Architecture](architecture.md) | Storage, backups, IPC, ledger schema and importer design |
| [Accounting rules](accounting-rules.md) | Implemented financial contracts and edge cases |
| [Product scope](product-scope.md) | Goals, milestone intent, UI, exclusions and final migration |
| [Register requirements](register-requirements.md) | Accounts, manual entry, transfers, reconciliation and owner workflows |
| [Plan requirements](plan-requirements.md) | Budgeting, category structure, schedules and target scope |
| [Data requirements](data-requirements.md) | Lossless backups, YNAB import, integrity, testing and privacy |
| [Report requirements](report-requirements.md) | Intended reports and forecasting capabilities |

Requirement files preserve the owner's original brief, including examples and
future scope; they are not claims that every feature exists. For changes, update
the document that owns the fact and link to it elsewhere. The root
[README](../README.md) owns development setup and command recipes.
