# ADR-009: Hybrid Retrieval and Task-aware Context Planning

## Status

Accepted as maintained experimental architecture in V0.2-05. The foundation is used by all three V2 candidates, including the selected `contextforge-v2-plan-pack`. Deterministic provenance and application boundaries are retained; quality remains mixed and V1 remains public/default. Acceptance is an architecture-maintenance decision, not a superiority or promotion claim. See `../V0.2_FINAL_EVALUATION.md`.

Earlier Proposed decisions and evaluation checkpoints below are preserved as history; this final status supersedes their conditional adoption language.

## Context

The frozen `contextforge-benchmark-v1` disproved aggregate superiority of `contextforge-structural-v1` over the benchmark lexical ranker. At 8K, structural whole-file required-symbol recall and precision were `.773` and `.138`, versus lexical `.848` and `.174`. Production Pack recovered the structural result to `.864` and `.193`, but matched-recall token reduction remained `1.5%` versus lexical and `7.8%` versus structural whole-file.

V0.2-01 replayed all 24 tasks with source-free diagnostics. Among the 43 required files present in both candidate sets, lexical ranked 23 ahead of structural V1, structural ranked 13 ahead, and 7 tied; structural also found one required file absent from lexical. Structural V1 still had preserved exact-symbol, cross-file, test, and ambiguous-task wins. Common natural terms could receive exact-symbol identity weight, 16 tasks had a structural top-five score tie, file-level lexical matches did not directly identify the owning symbol, and fixed Pack allocation dropped ranked required context in two key cases.

The evidence does not justify replacing structural retrieval with the benchmark baseline, mutating V1 weights, persisting source/full text, or requiring embeddings/LLMs.

## Decision

For V0.2 implementation, design one deterministic retrieval pipeline with:

- a bounded `TaskAnalysis` that distinguishes explicit identity/technical signals from general terms and derives a small task mode/risk set;
- a path-free `ContextPlan` that describes required/preferred/optional context roles without selecting files;
- complementary candidate sources for identity, generation-verified lexical matches, lexical-to-symbol ownership, existing structural/test/documentation relationships, bounded impact, and weak Git;
- provenance-preserving `CandidateEvidence` and ambiguity-aware fusion into one file envelope with nested relevant symbols;
- a separately versioned, explainable `contextforge-retrieval-v2` ranker whose final weights are frozen only during implementation/ablation;
- a later `contextforge-pack-v2` that uses plan roles while retaining the exact final serialized hard-budget guarantee;
- side-by-side V1/V2 execution on the unchanged frozen benchmark before any production default switch.

The first implementation slice should use existing schema-version-2 snapshot data and transient verified source evidence. No SQLite schema change is approved by this ADR.

## Alternatives

### Retune structural V1

Rejected. It mutates frozen behavior, encourages five-case overfitting, and does not add missing candidate/symbol/planning contracts.

### Replace structural retrieval with lexical full-file

Rejected. The baseline has benchmark-specific weights/packing, loses structural successes, and is not a production architecture.

### Hybrid lexical and structural evidence without TaskAnalysis/plan

Not sufficient as the complete design. It can improve candidates but leaves common-term ambiguity and task-independent allocation unresolved. It is useful as an ablation.

### Embeddings, LLM rewriting/reranking, vector storage, or cloud services

Deferred. They add provider, privacy, determinism, cost, and packaging concerns, and the observed primary failures have deterministic explanations.

### Full LSP/compiler semantic index

Deferred. It is disproportionate to current evidence and the lightweight packaged product boundary.

### SQLite FTS or persisted source terms

Deferred until measured scan cost proves necessary. Generation-verified transient reads retain the current privacy/snapshot contract.

## Consequences

- Retrieval becomes explicitly multi-source, but duplicate evidence cannot create duplicate file ranks.
- V2 can preserve exact/graph strengths while measuring lexical and symbol ownership independently through ablation.
- New contracts and strategy identities add implementation complexity and require strict caps, stable ordering, parity tests, and source-free diagnostics.
- Context planning can reduce fixed-section failures, but Pack remains the sole hard-budget authority and may report unsatisfied roles.
- V1 remains immutable and benchmarkable; V2 receives no superiority claim until the proposed gate passes.

## Benchmark Implications

The formal comparison adds `contextforge-v2` to the same 24 tasks, five budgets, Gold, snapshot, estimator, serializer accounting, and metrics. V1's 360 cases and artifacts remain unchanged. Research ablations run at 8K and cannot replace the final four-system, five-budget comparison. Targeted regressions are correctness evidence only.

## Compatibility and Migration

- Preserve `contextforge-structural-v1`, `contextforge-pack-v1`, and `contextforge-generic-v1` 1.0.
- Prefer no schema migration for TaskAnalysis, planning, lexical ownership, fusion, or first-stage impact evidence.
- Existing CLI/MCP arguments and one shared application pipeline remain.
- Any future persisted symbol relationship requires a separate generation-consistent schema/migration decision.
- Production default activation is a later reviewed release decision.

## Security

All candidate sources remain inside the Safe Repository Map and one active generation. Lexical evidence accepts only verified bytes; ignored/sensitive/generated/dependency/outside-root content remains ineligible. Task analysis executes no task or repository content. Task, plans, source terms, evidence, and source bodies are not persisted. Diagnostics use repository-relative identities and bounded metadata only.

## V0.2-02 Evidence

The first slice implemented deterministic TaskAnalysis/ContextPlan, source-provenance evidence, ambiguity-aware identity/lexical/symbol fusion, lexical-to-symbol ownership, existing structural support, and a shared application Retrieval V2 path. It required no SQLite migration and preserved the V1 CLI/MCP default, V1 strategy identities, verified-source invariant, graph bounds, estimator, and Pack V1 algorithm.

On the unchanged frozen 8K evaluation, V2 retained V1 required-file recall `.917` and required-symbol recall `.864`, while overall Gold recall moved from `.871` to `.882`, range precision from `.193` to `.197`, and noise from `.807` to `.803`. Retrieval ranks improved materially through K=10, but the final symbol-recall target `.900` was not met and one former success regressed at 8K. The evidence classification is **MIXED**, not accepted improvement. Detailed results and limitations are recorded in `docs/V0.2_RETRIEVAL_FOUNDATION_RESULTS.md`.

## V0.2-03 Evidence

V0.2-03 added transient, one-hop, fact/heuristic-explicit relationship evidence through the shared V2 fusion/ranking path. On the unchanged frozen 8K comparison it preserved V2 required-file and required-symbol recall (`.917`/`.864`) but reduced overall Gold from `.882` to `.871` and precision from `.196758` to `.194651`. It established the general direct-caller mechanism and improved the stale-source `readTextFile -> readOnce` pre-Pack ranks; unchanged Pack V1 still dropped the required context through `SECTION_LIMIT`. The evidence remains **MIXED**, so this ADR stays Proposed. The narrower decision and measurements are in ADR-010 and `docs/V0.2_RELATIONSHIP_LINKING_RESULTS.md`.

## Open Conditions Before Acceptance

- resolve the measured stale-source Pack residual without benchmark-specific logic;
- demonstrate the remaining symbol-ownership and document-retrieval failure classes improve on the frozen benchmark;
- demonstrate no V1 parity regression when shared helpers are introduced;
- meet the frozen quality, hard-budget, determinism, security, and performance gates;
- resolve plan-role behavior under tight budgets;
- complete independent review with no blocking findings.

Until then this ADR remains **Proposed**.
