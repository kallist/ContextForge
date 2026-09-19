# ADR: RepoBound v0.5.1 brand migration

Status: Accepted for the v0.5.1 release candidate on 2026-09-19.

## Context

ContextForge v0.5.0 is a verified local-first repository context compiler. The
public product is being renamed RepoBound to improve product identity without
changing the compiler, ranking, packing, persistence or integration contracts.

## Decision

- Display product, package, canonical CLI, canonical Skill, Studio and website
  identities become RepoBound, `@kallist/repobound`, `repobound` and
  `kallist/RepoBound`.
- `contextforge` remains a silent CLI/bin compatibility alias in v0.5.1. Both
  bins execute the same `dist/cli/main.js`; no alias-specific logic is added.
- The existing `.contextforge` state root, SQLite schemas, generation metadata,
  `contextforge-capability` browser-session key and all deterministic serialized
  identifiers remain unchanged. No database or state migration occurs.
- Capsule, Explain, Coverage, Diff, Replay, Review, estimator, ranking, packing,
  benchmark and dataset identifiers beginning `contextforge-` remain stable.
- The MCP server identity `contextforge` and tool names `status`, `index`,
  `search`, `pack` remain protocol-compatible. Human-visible tool titles and
  descriptions use RepoBound. No Review MCP tool is added.
- Private TypeScript symbols and module filenames using `ContextForge` remain to
  avoid risk-only churn. This package is a CLI/server distribution and does not
  introduce a new public JavaScript API surface.
- The hash-covered `# ContextForge Context Pack` serialization heading remains
  unchanged in v0.5.1. Changing it would alter payload hashes, Capsule replay and
  frozen parity for cosmetic reasons.

## Consequences

Existing local indexes, history databases and Capsules remain readable without
copying or rebuilding state. Users migrate commands and installs at their pace;
already-installed `contextforge` Skills are not removed automatically. The
intentional legacy identifiers are documented by the stale-brand audit rather
than cosmetically renamed.
