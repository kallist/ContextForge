# Changelog

All notable changes to ContextForge will be recorded here.

## Unreleased

## 0.2.0 - 2026-09-04

### Added / experimental

- Deterministic TaskAnalysis, hybrid Retrieval V2 evidence fusion and lexical symbol ownership.
- Bounded transient symbol/caller/test/implementation relationship intelligence.
- Packing ContextPlan and plan-aware Pack V2 with direct-context priority and bounded request-local fragment reuse.
- Final frozen six-system, 720-case evaluation, candidate decision, failure taxonomy, performance and determinism evidence.

### Stable default and limitations

- V1 remains the public CLI/MCP Search and Pack behavior. Selected V2 candidate `contextforge-v2-plan-pack` remains internal only.
- V2 evidence is mixed across budgets; task-aware planning is not proven stably superior. The 0.900 required-symbol target is not met.
- Context-quality measurements do not establish coding-agent success, general token savings or universal superiority.
- No new ranking policy, database migration, provider, public strategy API or V0.3 feature is introduced by release finalization.

## 0.1.1 - 2026-09-01

### Changed

- First public npm release, distributed as `@kallist/contextforge` because npm rejected the unscoped `contextforge` name under its package-name similarity policy.
- Package version advanced to 0.1.1 while the executable remains `contextforge`; production runtime behavior did not change.

## 0.1.0 - 2026-08-31

ContextForge v0.1.0 was a technically completed and tagged release candidate. Public npm publication did not complete because npm rejected the unscoped `contextforge` package name.

### Added

- Safe bounded repository discovery with additive ignore and sensitive-path rules.
- Packaged Tree-sitter WASM analysis for JavaScript, TypeScript, TSX, and Python.
- Atomic generation-based SQLite indexing, repository graph signals, explainable task retrieval, and deterministic hard-budget Context Packing.
- Frozen offline benchmark-v1 evidence with reviewed limitations and negative results.
- Local repository-bound MCP stdio tools for status, index, search, and pack.
- Release hardening for fresh tarball installation, cross-process concurrency, forced-termination recovery, corrupted/future index handling, package-content scanning, MCP soak, and synthetic scale validation.
- Security policy, contribution guide, release checklist, and v0.1.0 release notes.

### Security

- Future index schemas are rejected before schema mutation.
- Corrupt local index databases produce a bounded actionable error without exposing private paths.
- Package smoke rejects unexpected development files, install hooks, private absolute paths, and common credential/private-key patterns.

### Known limitations

- Retrieval is lexical/structural, the estimator is generic rather than model-specific, and TypeScript alias and advanced Python import resolution remain incomplete.
- HTTP/remote MCP, OAuth, multi-root servers, file watching, auto-indexing, embeddings, LLM reranking/compression, and a Web UI are not implemented.
