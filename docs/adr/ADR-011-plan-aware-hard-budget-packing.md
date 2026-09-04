# ADR-011: Plan-aware hard-budget packing

## Status

Accepted as maintained experimental architecture in V0.2-05. The frozen corrected/optimized implementation is selected as `contextforge-v2-plan-pack`, with 720 historical case objects reproduced, 19/0 preserved successes, deterministic diagnostics and a measured 1.478582x fixed-corpus ratio within the 1.5x gate. PACK_VALUE_MIXED and task-aware planning NOT PROVEN STABLY SUPERIOR remain explicit. Cross-budget losses and limited performance headroom prevent public-default promotion. ADR-009 and ADR-010 are likewise accepted only for experimental maintenance. The paragraphs below preserve the prior Proposed status and failed-experiment history; see `../V0.2_FINAL_EVALUATION.md` for the final decision.

Proposed. The initial candidate failed quality; V0.2-04R recovered the 8K quality gate but failed performance. V0.2-04P preserves the corrected policy and passes local performance/validation through bounded request-local fragment reuse. Quality remains mixed and task-aware planning is not proven stably superior; public CLI/MCP continue to use V1. ADR-009 and ADR-010 remain Proposed. See `../V0.2_PLAN_AWARE_PACKING_RESULTS.md` for the complete historical chain and final local evidence. Hosted CI and adoption require their separate gates.

## Decision frozen before evaluation

Keep retrieval, relationships, TaskAnalysis, the existing retrieval ContextPlan, Pack V1, serializer, estimator, SQLite schema, and writer semantics unchanged. Add a separate packing projection (`contextforge-pack-plan-v1`) of TaskAnalysis mode/action only. It contains no task text, paths, candidate identities, or Gold. Its four roles are PRIMARY, IMPACT, VALIDATION, SUPPORT; priorities are REQUIRED, HIGH, NORMAL. This avoids changing historical retrieval diagnostics merely to drive packing.

Direct unambiguous identity and verified lexical/owning-symbol evidence supports PRIMARY. Existing dependency/caller/reference/implementation evidence supports IMPACT. Test category or existing test relationships supports VALIDATION. Secondary documentation/configuration/structure supports SUPPORT. Roles can overlap and retain their evidence IDs; no evidence weights change.

The default plan protects PRIMARY and gives IMPACT/VALIDATION an opportunity. Concurrency/refactor promotes IMPACT, test/test-failure promotes VALIDATION, and understand/review/architecture promotes SUPPORT while lowering secondary validation. Neutral ablation preserves PRIMARY protection and assigns other roles NORMAL. These are the existing task actions/modes, not a new taxonomy.

The packer first attempts the strongest fitting direct PRIMARY anchor, then one fitting candidate for each uncovered important role. Remaining candidates use a shared global pool, ordered by directness, previously uncovered role, existing rank, cost, and raw path. Finally it attempts source-range enrichment without evicting selected cores. Every attempted selection is measured using the complete safe serialized Markdown and the unchanged generic-v1 estimator. The final payload is independently verified. A requested role never overrides the hard budget.

There are no token percentages or reserved token accounts: borrowing means selecting another useful item from the shared pool after role opportunities. Unavailable roles cannot strand tokens. Diagnostics report unused opportunities and global selections, not invented borrowed-token amounts. Multi-role coverage token totals overlap; global payload tokens are charged once.

Range options use up to six generation-owned symbols, preferring their complete compact cores; one/two-symbol alternatives permit bounded fallback. Nearby overlapping or adjacent ranges merge with zero gap. Small eligible files may use whole-file context, with symbol alternatives when available. Only after selection may surrounding source be added. Documentation uses existing heading selection, with bounded instruction prefixes. No source rewriting or LLM compression occurs.

Bounds remain 64 candidates/verified sources, 32 MiB source verification, six symbols and twelve ranges per file. Eighteen ordinary files is the sum of V1's five role caps (6+4+4+2+2), shared globally rather than increased. Root repository instructions precede ordinary context and count toward the budget. Drops distinguish GLOBAL_BUDGET, SAFETY_LIMIT, REDUNDANT_RANGE, STALE_SOURCE, UNSUPPORTED_CONTENT, NO_USEFUL_RANGE.

## Complexity and tradeoffs

Selection sorts at most 64 candidates and tries a small bounded number of range options. Exact checks rescan up to 18 selected files' serialized ranges, so the implementation is O(N log N + N * R * P), where R is bounded options and P is serialized selected payload length. It is not a combinatorial solver. Serialization cost is measured rather than moved outside timing. Source is transient; diagnostics contain ranges, evidence, and counts, not source bodies. Reusing the safe serializer deliberately trades some CPU for straightforward exact-budget correctness.

## Evaluation and stop conditions

Add only `contextforge-v2-plan-pack`: identical relationship-enabled retrieval plus the new application/core packer. Preserve previous five-system cases and frozen Gold/metrics/reference outputs. Evaluate 720 formal cases, a neutral-plan ablation, same-environment performance, determinism, and source safety. A new required-context miss among the 19 V1 successes, a quality-floor failure, or a material performance-guardrail failure blocks readiness; do not tune policy to Gold. No public-default switch or release is authorized by this experiment.

## V0.2-04R: one authorized semantic correction

The initial policy above remains historical **NOT SUPPORTED** evidence. Its boolean directness collapsed exact identity, owning-symbol evidence and general verified lexical matches. Uncovered SUPPORT then outranked better retrieved targets; PRIMARY test coverage also stood in for implementation coverage. A generic three-candidate test (compact operation, selected validation, large secondary guide) failed before changing policy.

The revised `direct-context-priority-v1` policy keeps the formal system, packing strategy, four-role plan, range generator and all caps unchanged. Candidate classification adds two orthogonal, source-free dimensions:

- facet: IMPLEMENTATION, VALIDATION, CONFIGURATION, DOCUMENTATION, OTHER, from existing safe category/language/symbol metadata;
- directness: IDENTITY, OWNED_SYMBOL, VERIFIED_LEXICAL, INDIRECT, from existing unambiguous direct evidence. Relationship role coverage alone does not change a production source file into a test facet.

Directness, discrete plan priority and existing retrieval rank precede role novelty. Novelty breaks otherwise equivalent priority/rank ties; compact cost and canonical path finish ordering. Before a role opportunity can consume budget, all stronger direct candidates receive a compact attempt. This ordering rule replaces arbitrary scoring or document penalties.

Within the strongest fitting evidence tier, the anchor prefers the task's target facet. A distinct target-facet opportunity remains if that anchor covers a different facet: test/test-failure targets validation; configuration mode targets configuration; architecture/understand/review targets documentation; explicit FIX/REFACTOR and non-general CHANGE target implementation. GENERAL with the default CHANGE action, and the neutral ablation, use conservative direct-evidence ordering without a facet preference. A different PRIMARY facet does not discharge this opportunity. An unfit target still loses to the exact hard budget.

Candidates first try their cheapest existing useful source option; enrichment follows candidate opportunities. No new source representation, symbol cap, token percentage or special filename is introduced. Trace events include policy identity, phase, rank, facet, directness, compact cost, reason and cumulative serialized tokens.

The selector remains bounded to 64 candidates, with repeated bounded sorts and opportunity guards (worst-case O(N² log N) ordering plus bounded exact serialization work). This correction does not claim an O(N log N) selector or a performance pass. Quality is checked before performance optimization.

Policy and tests are fixed before the 24-task 8K gate. Only if required recall/precision, 19/0, writer success and 41/44 file plus 35/39 symbol retention pass may ablations and formal 720-case evaluation follow. One correction cycle is authorized; a failed corrected gate ends this experiment without further tuning. This ADR remains Proposed.

The corrected evaluation completed 720 cases with zero budget violations, unchanged prior 600 cases and unchanged 120 paired retrieval results. At 8K, required file/symbol recall is .916667/.886364 with 19 successes and zero regressions. Neutral versus task-aware planning remains mixed. On the fixed performance corpus, the same-run ratio of median total time is **1.596x V1**, above 1.5x; packing alone is **2.095x V1**. Repeated full serialization accounts for most measured selection time. The parser-assets negative control also loses a previously retained required file under the shared 18-file cap. These findings block finalization. No optimization, new correction cycle, commit, push or Draft PR follows this stop.

## V0.2-04P: performance-only closeout

A later authorization permits implementation-only optimization of the unchanged corrected policy. Profiling measures 132 complete serializations and 670 item renders per fixed-corpus request, with 514 repeated items. Reuse exact immutable item fragments within one request, bounded to 321 entries and 1,048,576 UTF-16 characters. Range-option identity separates every source/range/metadata combination; there is no persistent or cross-request cache. Capacity exhaustion recomputes exactly and cannot alter selection.

The shared serializer's default item renderer remains unchanged for V1. Pack V2 supplies the request-local renderer during tentative checks, still estimates every complete tentative Markdown, and performs final uncached serialization plus independent exact estimation. Item renders fall to 284; complete serialization, estimator, range-preparation and candidate-attempt counts are unchanged. This removes repeated fragment work without claiming a linear total-cost model: complete joining and estimation still cost O(A * P).

All 120 task/budget payloads and full manifests match pre-opt exactly. The complete 720-case quality artifact and final repeated diagnostics are byte-identical to 04R, preserving 19/0, 41/44 files, 36/39 symbols and zero budget violations. The final same-run optimized total is **1.361x V1** on fixed and **1.019x** on synthetic, versus pre-opt ratios 1.736x and 1.020x in that same run. The historical 1.596x failure remains recorded rather than substituted as the formal denominator.

Contract review classifies parser-assets as a known experimental quality limitation: its rank-38 VERIFIED_LEXICAL configuration item loses the 18-file capacity to stronger OWNED_SYMBOL items, with an explicit SAFETY_LIMIT drop. It does not violate dominance, target-facet opportunity or hard-budget invariants; Gold-required labels are evaluator-only, not mandatory production inclusions. This is not a quality fix, does not imply optimal selection, and does not justify switching public defaults. ADR-011 remains Proposed; final readiness requires the Draft PR and final-head hosted gates after local validation.
