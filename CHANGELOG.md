# Changelog

All notable changes to ContextForge will be recorded here.

## Unreleased

## 0.1.0 - 2026-08-31

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
