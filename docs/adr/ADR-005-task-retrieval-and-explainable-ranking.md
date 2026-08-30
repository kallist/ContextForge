# ADR-005: Task Retrieval and Explainable Ranking

## Status

Accepted and implemented for Phase 4 on 2026-08-30. Locally tested on Windows with the checksum-verified official Node 24.20.0 distribution; the hosted cross-platform matrix remains `NOT RUN`.

## Context

Phase 4 must retrieve source literals such as `INDEX_BUSY` even though the Phase 2/3 SQLite index deliberately stores metadata, symbols, imports, graph relations, and hashes rather than source text. Retrieval must not mix an active generation's structure with changed working-tree bytes, persist unnecessary source-derived secrets, or make `search` mutate the index.

Three lexical approaches were compared:

- a generation-verified working-tree scan has no new persisted source data and directly validates the bytes used as evidence, at the cost of bounded per-search I/O;
- a generation-bound term index makes search faster but adds schema, incremental maintenance, storage, deletion, and secret-literal review costs;
- SQLite FTS5 provides indexed text search but normally persists source-derived content and adds tokenizer/portability behavior to the package contract.

A Windows spike confirmed that `node:sqlite` could create and query an FTS5 virtual table on Node 24.10.0, 24.19.0, and the checksum-verified official Node 24.20.0 runtime. That proves local availability only; it does not remove the persistence/privacy cost or establish a cross-platform package contract.

## Decision

### Lexical retrieval

- Use a **generation-verified working-tree scan** for V1.
- Load one complete active `RepositoryIndexSnapshot` in a SQLite read transaction. All files, symbols, imports, graph edges, and Git signals used by the search are materialized from that one generation before the transaction closes.
- Scan only safe text files already present in that snapshot and still approved by the current Safe Repository Map.
- Read each bounded file through the existing boundary-checking source reader, hash the actual bytes read, and use lexical matches only when that SHA-256 equals the active generation's hash.
- Treat added, deleted, unreadable, content-status-changed, size-changed, or hash-mismatched files as `INDEX_STALE`; exclude mismatched bytes from lexical evidence. Never auto-index.
- Scan at most 10,000 files and 64 MiB per search. Direct metadata candidates are verified first, then remaining paths in stable order. If the work bound prevents complete verification, report `PARTIAL` and `LEXICAL_SCAN_TRUNCATED` rather than claiming a fully fresh working tree.
- Persist no source, lexical terms, match locations, task, candidate, or score rows. SQLite schema version 2 remains unchanged.

### Candidate model

- Rank one file envelope per repository-relative path. Merge path, symbol, import, lexical, graph, and Git evidence into that envelope.
- Preserve matched symbols, stable symbol identities, and source ranges in `relevantSymbols`; cap the public list at 32. A file and its symbols never occupy separate result ranks.
- Mark origin as `DIRECT`, `EXPANDED`, or `DIRECT_AND_EXPANDED`.

### Ranking strategy

Version the fixed strategy as `contextforge-structural-v1`. Ranking uses additive relative points; scores are not probabilities.

| Direct signal | Proposed points |
|---|---:|
| Exact qualified symbol | 120 |
| Exact repository path | 110 |
| Exact symbol | 100 |
| Exact basename | 82 |
| Exact technical source literal | 58 |
| Symbol component | 42 |
| Import/module metadata | 34 |
| Path component | 30 |
| Source lexical occurrence 1 / 2 / 3 | 28 / 8 / 4 |

Caps are part of the strategy: identity 150, lexical 120, structural 65, and Git 5. One lexical query signal contributes at most 50 points, so repeated appearances of one term cannot replace coverage of several task terms. Git dirty contributes 2 and bounded recency contributes at most 3; Git never discovers a candidate.

Graph expansion uses at most 24 primary seeds, depth 2, 24 neighbors per node, 128 new files, 32 expansion reasons per candidate, and 256 final internal candidates. An inherited relation starts with:

```text
seed score × 0.32 × distance decay × relation factor × edge confidence × hub damping
```

Distance decay is `0.58` at depth 1 and `0.34` at depth 2. Relation factors are import dependency `0.72`, reverse import `0.52`, test `0.78`, and documentation `0.38`. Hub damping is `min(1, log2(3) / log2(2 + degree))`. Per-seed visited nodes/edges terminate cycles; family/evidence caps bound multi-path accumulation.

Stable ordering is final score descending, origin priority, file-category priority, then raw repository-relative path. Every accepted numeric contribution retains a structured reason, and `rawScore` is reconstructible from `scoreContributions` within ordinary floating-point tolerance.

## Consequences

- Search remains local, read-only, offline, source-private in SQLite, and compatible with the existing generation model.
- Exact identities, several distinct task terms, tests, imports, reverse imports, and task-aware documentation can all affect ranking without an embedding or LLM.
- Search latency remains proportional to bounded verified source bytes. Repositories beyond the scan bound receive honest partial verification and may miss lexical-only candidates outside the scanned subset.
- Hashing the bytes actually ranked prevents stale bytes from being presented as generation evidence. Filesystem TOCTOU after the completed read cannot be eliminated without an OS snapshot, but it cannot change the already-hashed evidence bytes.
- Pure synonym understanding, Chinese-to-English mapping, embeddings, fuzzy spelling, compiler-complete module resolution, token budgets, Context Packs, benchmark scoring, and MCP remain outside Phase 4.
