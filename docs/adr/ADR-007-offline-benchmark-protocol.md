# ADR-007: Frozen Offline Benchmark Protocol

## Status

Accepted for Phase 06. Formal results are published only after the frozen full run and review gates complete.

## Context

Phase 04 and Phase 05 provide an explainable structural ranker and hard-budget semantic packer, but engineering tests and high budget utilization do not show that they select better context than simpler systems. Evaluation must permit good, neutral, or negative results without tuning the evaluated strategy, relabeling Gold, dropping failures, or treating a fixed-budget token difference as token savings.

Gold is especially vulnerable to circularity. A corpus created from ContextForge output would reward the system by construction. A baseline that ignores obvious lexical/path evidence, bypasses safety, or exceeds the serialized budget would also make comparison meaningless.

## Decision

Version the protocol as `contextforge-benchmark-v1` and the frozen 24-task dataset as `contextforge-dataset-v1`.

- Author Gold manually from source behavior and ownership, distinguish `REQUIRED` from `SUPPORTING`, validate stable identities, review before scoring, canonicalize, hash, and freeze.
- Use a pinned Phase 05 ContextForge Git snapshot plus curated TypeScript, Python, and mixed-language repositories.
- Compare `lexical-full-file-v1`, production structural ranking plus whole-file packing, and production structural ranking plus `contextforge-pack-v1`.
- Keep Gold outside system adapter types. All systems share snapshot, task, eligibility, estimator, and final serialized budget semantics.
- Report retrieval recall separately from payload recall. A file never implies all symbols, and a symbol is covered only by full core-range containment.
- Measure token-weighted Gold range precision, repository-content noise, payload tokens, and serialization overhead separately.
- Report token reduction only at paired matched Required Symbol Recall targets using actual emitted payload tokens.
- Preserve raw cases, failures, `NOT REACHED`, worst cases, and language/category/difficulty breakdowns. Use macro averages as the primary aggregate.
- Separate deterministic quality artifacts from environment-dependent repeated latency samples.
- Materialize and index only isolated temporary copies, verify source immutability, remain offline, and execute no corpus code.
- Freeze `contextforge-structural-v1`, `contextforge-pack-v1`, and `contextforge-generic-v1` during Phase 06. Any later product optimization is a separately versioned strategy evaluated against the same frozen data.

## Consequences

The benchmark can show that ContextForge loses or adds little value; that remains valid evidence. The small curated corpus cannot justify universal claims or agent-success claims. Whole-file baselines may lose budget to large instructions or files, which is an intended packing contrast but is visible in diagnostics and overhead. Cross-language and semantic tasks expose current limitations rather than being removed.

The framework is developer tooling and is not shipped as a stable consumer CLI. Generated raw/performance output is ignored by default; a small reviewed reference result may be committed. Future changes to metric, corpus, Gold, or baseline semantics require new hashes and potentially new versions.

## Deferred

Agent execution benchmarks, LLM judges, embeddings, vector search, model reranking, model compression, external corpus downloads, cloud services, MCP, Web UI, and learning from agent outcomes remain deferred.
