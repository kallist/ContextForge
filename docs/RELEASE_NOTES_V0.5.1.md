# RepoBound v0.5.1 — Brand Migration

ContextForge is now RepoBound. This release is the renamed continuation of the
same verified local-first repository context compiler, not a rewrite or a new
ranking system.

## Changed

- product and Studio display name: RepoBound;
- target GitHub repository: `kallist/RepoBound`;
- npm package: `@kallist/repobound`;
- canonical CLI: `repobound`;
- canonical Agent Skill: `repobound`;
- website, social assets and maintained documentation branding.

## Preserved

- compiler, retrieval, ranking and Pack behavior;
- frozen benchmark Gold and all V1/V2 strategy identities;
- Capsule, Review, Explain, Coverage, Diff and Replay semantics;
- database schema and `.contextforge` state root;
- MCP server compatibility identity and exact tool set: `status`, `index`,
  `search`, `pack`;
- V1 as the public default.

## Compatibility

The historical `@kallist/contextforge` package remains available during migration
and continues to provide the `contextforge` executable. RepoBound's canonical and
only executable is `repobound`; both packages can coexist. Existing local state
and Capsules remain readable. Stable serialized `contextforge-*` identifiers
intentionally remain unchanged. Historical ContextForge tags, releases and
evidence remain available.

The old npm package is deprecated only after the new RepoBound package has been
published and verified from a fresh public-registry consumer. It is never
unpublished by this migration.
