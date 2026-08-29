# ADR-004: Repository Graph and Structural Signals

## Status

Accepted and implemented for Phase 3 on 2026-08-30. Locally tested on Windows with Node 24.20.0. Hosted cross-platform validation remains `NOT RUN`.

## Context

Phase 2 atomically publishes files, symbols, and raw imports as one immutable SQLite generation. Phase 3 must resolve repository-local imports and add useful test, documentation, and Git signals without exposing mixed snapshots, inventing compiler truth, or prebuilding Phase 4 ranking infrastructure.

Import resolution is structural only when one indexed repository file satisfies a bounded rule. Test and documentation relationships may be heuristic and therefore require explicit confidence and evidence. Git is auxiliary and may be unavailable. File-to-symbol containment and symbol parentage already exist in normalized Phase 2 tables, so persisting duplicate graph edges would create consistency risk without adding query capability.

## Decision

- Derive the complete Repository Graph from the files, symbols, imports, and bounded approved documentation text of the generation being built.
- Persist raw-import resolutions, bounded file-to-file edges, repository Git availability, and per-indexed-file Git signals in the same `BEGIN IMMEDIATE` transaction as Phase 2 data. Set `active_generation_id` only after validating all records. Graph and language data therefore share one generation identity and activation boundary.
- Recompute derived graph metadata from the current normalized generation on every index. Unchanged source analysis remains hash-reused; graph derivation does not reparse source and needs no invalidation subsystem.
- Persist only `FILE_IMPORTS_FILE`, `TEST_RELATES_TO_FILE`, and `DOCUMENT_RELATES_TO_FILE` edges. Query file containment and symbol parentage from existing `indexed_file` and `symbol` rows. Derive reverse imports from the forward edge index.
- Give files repository-relative external identities (`file:<relative-path>`), retain Phase 2 stable symbol IDs, and hash edge kind/source/target into a deterministic edge ID. Absolute paths and SQLite row IDs are never public identities.
- Mark every import as `resolved_internal`, `external`, `unresolved`, `ambiguous`, or `unsafe`. Only `resolved_internal` creates an import edge. Multiple valid candidates remain ambiguous; repository escapes remain unsafe and are never read or linked.
- Treat import edges as structural facts with confidence `1.0`. Test and documentation heuristics retain `derivation=heuristic`, bounded confidence, and sorted evidence. Direct test imports and exact documented repository paths are structural facts.
- Keep Git signals separate from graph edges but generation-bound. The adapter uses parameterized, read-only `execFile` calls with `shell: false`, a bounded history window, timeout, and output limit. Git failure degrades to an explicit unavailable record. The approved Git path set is the union of current safe indexed files and the previous safe generation, allowing a deleted prior file to retain a dirty signal without accepting arbitrary Git-reported paths or recreating a current file node.
- Migrate the internal SQLite schema from version 1 to version 2 in place. A Phase 2 active generation remains readable with `graph = null`; users must re-run `contextforge index` before graph inspection.

## Supported Resolution Boundary

- JavaScript/TypeScript: repository-relative static imports, side-effect imports, literal `require`, literal dynamic imports, re-exports, common source extensions, directory `index` files, and explicit NodeNext `.js → .ts/.tsx`, `.mjs → .mts`, `.cjs → .cts`, and `.jsx → .tsx` candidates.
- Python: repository-root packages with `__init__.py`, ordinary module files, package `__init__.py`, and explicit relative imports. Advanced `sys.path` mutation, custom import hooks, comprehensive namespace-package behavior, and dynamic imports are outside V1.
- Bare JavaScript/TypeScript package names remain external. `tsconfig.json`/`jsconfig.json` path aliases are not resolved in Phase 3.

## Consequences

- Readers cannot observe Phase 2 data from one snapshot and Graph data from another.
- A graph failure increases the duration of the single writer transaction but leaves the prior active generation intact.
- Full derived-graph rebuild is simpler and safer than incremental invalidation. Its cost is measured separately from parsing and SQLite writes.
- Conservative unresolved/ambiguous results reduce false positive edges at the cost of incomplete relationships for unsupported module systems.
- Documentation scanning retains at most 2,000 approved documents or 16 MiB of approved documentation text per build and limits extracted path references and module heuristics.
- Phase 4 retrieval, ranking, task-aware graph expansion, token budgets, Context Packs, benchmark scoring, and MCP remain unimplemented.
