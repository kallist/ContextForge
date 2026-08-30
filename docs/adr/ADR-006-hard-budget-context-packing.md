# ADR-006: Hard-budget Context Packing

## Status

Accepted and implemented for Phase 5 on 2026-08-30. Locally tested on Windows with the checksum-verified official Node 24.20.0 distribution; hosted cross-platform CI remains `NOT RUN`.

## Context

Phase 5 must turn Phase 4 candidates into useful agent context without becoming a second ranking implementation, concatenating top-ranked files, leaking changed or unsafe bytes, or treating a pre-render estimate as a hard output guarantee. Source may contain Markdown fences or terminal controls. A concurrent index activation must not mix generations, and an output failure must not leave a completed-looking partial file.

The generic estimator cannot claim equality with every model tokenizer. The contract therefore needs to name its estimator and define exactly which serialization the requested budget constrains.

## Decision

### One retrieval and generation truth

- `BuildContextPack` invokes `SearchRepository`; `contextforge-structural-v1` remains the only candidate ranking truth.
- Search returns its loaded scan and complete SQLite snapshot as an application-internal execution context. Public Search text/JSON contracts do not serialize that context.
- Pack reads only currently safe snapshot files through the existing boundary-checking source reader. Each file is read once, then hashed and sliced from that same in-memory string. A hash mismatch excludes the bytes as `STALE_SOURCE` and produces an honest partial manifest.
- A concurrent writer may activate generation N+1 after Search loads N; Pack continues entirely from N and never mutates or auto-refreshes the index.

### Estimation and final budget

- `TokenEstimator` is a core port. The built-in implementation is `contextforge-generic-v1`, version `1.0`, with no external tokenizer or model call.
- It normalizes line endings and estimates non-empty text as `ceil(non-newline ASCII bytes / 3) + ceil(non-ASCII UTF-8 bytes / 2) + logical line breaks + 1`.
- The requested budget constrains the complete final Markdown agent payload, including task, headings, repository-relative paths, reasons, line labels, and code fences.
- The alternative JSON is a bounded, deterministic, source-free manifest. It is audit metadata and is not counted in the Markdown budget.
- Packing reserves an empty-render envelope, chooses semantic representations, renders the complete Markdown, measures it, and deterministically evicts or downgrades the lowest-priority non-required unit until it fits. If the envelope and one useful primary unit cannot fit, it returns `BUDGET_TOO_SMALL` and no artifact.

### Section and range policy

- `contextforge-pack-v1` assigns one primary role per path and retains secondary roles instead of duplicating source.
- Repository instructions, primary code, tests, dependencies, documentation, configuration, and optional Git context have stable section order and bounded item policies. Unused capacity is redistributed toward useful higher-priority context.
- Small relevant files may be whole. Larger source prefers complete relevant symbols with bounded parent/import/surrounding lines; Markdown uses fence-aware heading sections; overlapping and nearby ranges merge deterministically.
- Root `AGENTS.md` is whole when small and heading-selected when large. Nested scoped `AGENTS.md` discovery is deferred.
- Output normalizes LF, escapes unsafe control characters, labels repository content as untrusted, and chooses a backtick fence longer than the longest source backtick run.

### Output publication

- Default stdout is Markdown; `--json` selects the manifest. Diagnostics stay on stderr.
- `--out` validates the parent, refuses any existing target, writes and syncs a same-directory temporary file, then publishes it with an exclusive hard link. Failure cleans the temporary path and never overwrites the target.
- Artifacts contain no timestamp or absolute repository path, so identical inputs and generation produce identical bytes.

### Why no embeddings or LLM compression

Embeddings and LLM compression would add provider, secret, cost, nondeterminism, prompt-injection, and reproducibility concerns while creating a second opaque relevance or rewriting stage. Phase 5 therefore uses only the existing explainable structural rank, verified repository bytes, and deterministic syntactic ranges. Both capabilities remain explicit future work rather than hidden dependencies.

## Alternatives considered

- **Top-k whole-file concatenation:** simpler, but wastes tight budgets, loses symbols/tests/instructions, and cannot explain range decisions.
- **A second pack-specific ranker:** rejected because Search and Pack would disagree about relevance.
- **Persisted source chunks or FTS content:** rejected for Phase 5 because current verified reads preserve the local privacy and generation model without a schema migration.
- **Character or byte truncation:** rejected because it can cut syntax, Unicode, Markdown fences, or provenance and still claim a valid pack.
- **Budgeting planning estimates only:** rejected because formatting and fence growth can make the final artifact exceed the request.
- **Content-bearing JSON under the same budget:** rejected because it duplicates source and makes two unrelated serialization sizes compete. The manifest instead records selection truth without source.
- **Overwrite or rename-based output:** rejected because overwrite is unsafe and common rename APIs have platform-specific replacement behavior.

## Consequences

- The hard guarantee is exact relative to the named estimator, not to an unspecified model tokenizer.
- Selection, omissions, partial status, ranges, scores, reasons, strategies, and budget use are inspectable without putting source into the manifest.
- Packing work is bounded by 64 candidates and 32 MiB of verified source plus bounded render reductions. Large repositories may report partial verification rather than silently expanding work.
- Conservative estimation may leave unused model capacity, and heuristic semantic ranges are not program slicing.
- Nested instructions, model-specific tokenizers, benchmark metrics, persisted packs, MCP delivery, and streaming/dynamic context remain deferred.
