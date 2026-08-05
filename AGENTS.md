# Alpha Agent Governance

The `alpha` branch is an autonomous product experiment. Agents may optimize it for rapid product learning without preserving `main` quality gates, architecture, or implementation compatibility.

The following safety rules are mandatory:

- Do not expose, transmit, or commit secrets, credentials, tokens, private user data, logs containing private data, or local configuration without explicit user authorization.
- Do not perform destructive system or Git operations. Preserve unrelated work and never directly rewrite or delete protected branch history.
- Back up user configuration before migration. Migrations must be recoverable, preserve the previous usable data on failure, and fail without silently discarding user data.
- Irreversible in-game actions and actions that consume ships, currency, items, or other resources must default to disabled, require explicit user confirmation, and fail closed when state, targeting, or confirmation is uncertain.
- Clearly label experimental builds and releases as alpha or experimental so users do not mistake them for stable builds.
- A release must at minimum build successfully and start successfully before publication.

Compatibility with `main` architecture and quality standards is not required on `alpha`. The `alpha` branch must not be merged wholesale into `main`; any promotion to `main` must be selected and reworked as independently reviewed changes.
