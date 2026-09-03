# ADR-010: Bounded Relationship Intelligence for Retrieval

## Status

Proposed. V0.2-03 is implemented as a benchmark-selectable experiment, but the frozen quality evidence is mixed and does not justify a public-default switch or acceptance as a generally superior ranker.

## Context

V0.2-02 showed that required files and symbols can remain in ranked candidates while Pack V1 drops them. It also identified a separate retrieval boundary: a lower-level matched helper did not reliably expose its higher-level caller. The persisted schema-version-2 graph contains file imports and test/document relationships plus symbol definitions, but no compiler-complete call/reference/type graph. Adding a compiler/LSP, database migration, recursive graph closure, or benchmark-specific rule would exceed the phase boundary.

## Decision

Add one transient, deterministic `RelationshipEvidenceV2` contract and one bounded relationship family inside the existing CandidateEvidence/Fusion/Ranking V2 pipeline.

- Derive exact direct-call and TypeScript `implements` facts only from active-generation-hash-verified source and the existing parser/import resolution.
- Reuse existing generation-graph import/test facts without persisting or independently double-scoring duplicate edges.
- Keep structural facts and heuristics explicit; facts require `EXACT`, heuristics require lower confidence.
- Expand only from strong seeds at distance one with per-seed, per-kind, total-evidence, final-candidate, and hub-damping bounds.
- Fail closed for ambiguity, dynamic dispatch, degraded parsing, or unsupported semantics.
- Keep Pack V1, schema version 2, writer transactions, public CLI/MCP V1 defaults, and the generic estimator unchanged.

## Alternatives

### Persist a call/reference graph

Rejected for this phase. It requires a schema/migration and new generation-write semantics before the measured value justifies the storage boundary.

### Add TypeScript compiler or LSP analysis

Rejected. It is disproportionate to the current lightweight local package, does not solve Python/JavaScript dynamism uniformly, and introduces packaging/performance complexity.

### Infer callers from textual call-like matches

Rejected. It would serialize heuristic guesses as semantic facts and amplify common-symbol noise.

### Recursively compute impact closure

Rejected. It creates cycle/hub/O(N^2) risk and overstates runtime impact. V0.2-03 is direct one-hop evidence only.

## Consequences

- Exact supported relations retain symbol identity, source location, generation, and explanation.
- Repeated relation paths merge into one candidate and one semantic relationship; provenance richness cannot create unbounded score.
- TypeScript, JavaScript, and Python intentionally expose different reliable subsets behind one output shape.
- Request-time parsing adds measurable cost; explicit source prefiltering and caps kept warm Search/Pack within the proposed 1.5x V1 guardrail on both measured corpora.
- Pack V1 can still discard improved relationship candidates. That is evidence for V0.2-04, not authority to change packing here.

## Benchmark Evidence

The additive `contextforge-v2-relations` system ran on the unchanged 24-task/five-budget dataset for a 600-case comparison. At 8K it preserved V2 required-file and required-symbol recall (`.917`/`.864`), while overall Gold moved `.882 -> .871` and precision `.196758 -> .194651`; the paired outcome was 2 wins, 21 ties, 1 loss. It improved the stale-source required symbol ranks from `4,missing` to `3,21` through the exact `readTextFile -> readOnce` caller fact, but unchanged Pack V1 dropped both by `SECTION_LIMIT`. The 19 known V1 successes had zero new misses.

This supports **RELATIONSHIP_VALUE_MIXED**: the mechanism has general behavior-level and one frozen-case retrieval value, but aggregate quality does not show superiority. See `docs/V0.2_RELATIONSHIP_LINKING_RESULTS.md`.

## Compatibility and Migration

- SQLite schema changed: no; migrations: none.
- Generation writer/activation/rollback/`INDEX_BUSY`: unchanged.
- `contextforge-structural-v1`, `contextforge-retrieval-v2`, `contextforge-pack-v1`, and `contextforge-generic-v1`: preserved.
- Public CLI/MCP Search and Pack: remain V1 by default.
- The experimental relation strategy is available only to internal benchmark/test composition.

## Security

Only eligible files from one active generation enter derivation. Source must match the indexed hash. Candidate Fusion rejects targets outside that snapshot. Relationships store no source body, secret, absolute path, or credential and execute no repository code, shell, network, or model.

## Open Conditions Before Acceptance

- demonstrate aggregate relationship value without V2-relative quality loss;
- retain the protected V1 successes and security/performance/determinism gates;
- decide whether transient derivation remains appropriate after broader external repositories are measured;
- implement and evaluate plan-aware Pack V2 separately for ranked-but-dropped required context;
- complete a later reviewed public-contract decision before any V2 default switch.

ADR-009 remains Proposed; this ADR refines its bounded-impact decision and does not accept the overall V2 architecture by implication.
