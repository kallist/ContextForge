# ADR-003: Local Index Storage

## Status

Accepted for V1 on 2026-08-29. Implemented for Phase 2 on 2026-08-30 and locally tested against real temporary SQLite databases on Windows with Node 24.20.0. Hosted cross-platform validation remains `NOT RUN`.

## Context

ContextForge needs incremental file metadata, symbols, graph edges, diagnostics, and index-version state. It must support `index + index` and `index + pack`, recover from process interruption, and never expose a half-indexed repository as active. Storage is local to one machine and must not require an external database service or a separately compiled npm addon.

Local JSON is easy to inspect but makes atomic multi-entity updates, indexed lookup, concurrent readers, and crash recovery application responsibilities. SQLite provides transactions, indexes, queryable relations, and write-ahead logging. Node 24 ships `node:sqlite`, avoiding a third-party native addon. The API is release-candidate in Node 24.15+; the audited Node 24.10 implementation works but still identifies itself as experimental and is not the accepted V1 baseline.

## Decision

- Use **SQLite through Node 24.15+'s built-in `node:sqlite` `DatabaseSync` API**. Pin V1 to the Node 24 LTS line and retest before any future major-runtime upgrade.
- Store local state under the indexed repository's `.contextforge/` directory. Do not store full source content; persist hashes, file metadata, symbols, graph edges, diagnostics, and generation metadata.
- Enable defensive mode and foreign keys, disable extension loading, configure bounded SQLite limits, and use WAL mode. Keep the database on a local filesystem; reject or clearly warn on unsupported network-filesystem placement rather than claiming safe multi-host use.
- Use immutable logical **index generations**. Every indexed row belongs to one generation, and metadata identifies one active completed generation.
- A writer starts `BEGIN IMMEDIATE`, builds a new generation, validates it, marks it complete, and changes `active_generation_id` in the same transaction. Only then does it commit.
- Keep the previous active generation visible to readers until commit. A second writer waits only for a bounded busy timeout, then returns a clear `INDEX_BUSY` failure; it must not start a competing partial build.
- Any error or interruption before commit rolls back the new generation and leaves the prior active generation unchanged. The writer must explicitly attempt rollback on handled errors.
- `pack` opens a read transaction, captures one active generation, and uses it consistently. WAL permits the reader to continue on its snapshot while a writer prepares the next commit.
- Incremental indexing hashes every eligible current file. Unchanged hashes reuse prior parsed records into the new generation; changed files are reparsed; deleted files are absent. Parser failures are recorded in the new generation and use textual fallback where safe.
- Before serializing a selected excerpt, `pack` revalidates the current file hash. A mismatch produces a bounded stale-index error or explicit refresh path; it must not emit stale line ranges against changed content.
- Apply bounded checkpoint and old-generation cleanup after successful activation, never before. Cleanup failure does not invalidate the active generation.

## Alternatives Considered

### Local JSON files

Rejected for the main index. Correct atomic replacement of several related datasets, query indexes, and cross-process concurrency would recreate database behavior in application code. JSON remains suitable for configuration, manifests, and benchmark cases.

### Embedded key-value store

Rejected for V1. Graph and symbol lookups would need custom secondary indexes and transaction semantics, while adding another dependency without a clear benefit over SQLite.

### Third-party SQLite Node bindings

Packages such as native SQLite addons may offer different async or performance characteristics, but add prebuilt-binary and compilation risk. The built-in Node API is sufficient for a local CLI's single-writer design.

### External database

Rejected by the local-first V1 scope.

## Consequences

- Node 24.15+ is a runtime requirement, and `node:sqlite` is still release-candidate rather than fully stable. Database calls are synchronous; storage operations must remain bounded and should not be exposed directly to CLI/MCP adapters.
- SQLite permits multiple readers but only one writer. The application must provide clear busy timeouts and errors.
- WAL relies on same-host shared memory and is unsuitable for network filesystems.
- Holding one atomic generation transaction is the simplest correct V1 design but may increase WAL size for large repositories; performance and disk behavior must be benchmarked before optimizing to staged generations.
- Generation duplication stores metadata, not repository source. Retention must remain bounded.
- The Phase 2 baseline schema contained only `repository_state`, `index_generation`, `indexed_file`, `symbol`, and `import_record`. Phase 3 migrates it to schema version 2 and adds generation-bound import-resolution, graph-edge, and Git-signal tables. Ranking, candidates, embeddings, Memory, and MCP tables are not pre-created.
- A generation is a complete snapshot. Identical SHA-256 plus a compatible analysis version copies normalized analysis into the new generation without reparsing; mtime and size are metadata, not reuse proof.
- The implementation retains the active generation and its previous completed generation. Cleanup runs only after activation and is reported as a non-fatal warning if deferred.

## Sources

- [Node.js 24 built-in SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [SQLite WAL behavior and concurrency](https://sqlite.org/wal.html)
- [SQLite transaction and `BEGIN IMMEDIATE` semantics](https://sqlite.org/lang_transaction.html)
