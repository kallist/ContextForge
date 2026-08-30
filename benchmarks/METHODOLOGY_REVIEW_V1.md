# Benchmark Methodology Review — before formal score run

This review was completed after implementation and framework tests, but before the first formal 24-task A/B/C run. It is an independent second-pass review by the implementing Codex session, not an external reviewer.

## Baseline fairness

- `lexical-full-file-v1` uses the production task normalizer and reasonable deterministic path, basename, symbol, and generation-verified source lexical signals. It is neither random nor limited to exact path lookup.
- Its weights and caps live only in benchmark code and cannot modify production ranking.
- `structural-full-file-v1` directly consumes production `searchRepository` candidates; it does not copy or approximate Phase 04 ranking.
- Both whole-file systems use the same serializer, estimator, instruction-first policy, skip-oversized/continue rule, safety snapshot, source hash verification, and final serialized budget check.
- ContextForge uses the real production `buildContextPack`; differences from structural full-file are therefore attributable primarily to production packing and its actual serialization.

Finding: whole-file baselines cannot section-slice a large instruction file while ContextForge can. This is a visible and intentional packing difference, not hidden baseline damage. `WHOLE_FILE_DID_NOT_FIT` remains in raw diagnostics.

## Metric review

- Retrieval file and symbol recall are separate. A ranked file does not grant its symbols.
- Packed symbol recall requires full containment of the parser-reported core range.
- File recall requires selected source content, not a manifest mention.
- Precision uses estimator tokens over exact selected/Gold range intersections. For file-only Gold with no semantic annotation, selected content in that Gold file is relevant; this conservative policy avoids inventing line labels and tends to benefit whole-file systems rather than ContextForge slicing.
- Task/header/fence metadata is serialization overhead, not repository-content noise.
- Zero denominators are `null`, and macro aggregation excludes them rather than treating them as one.
- Matched-recall uses minimum actual emitted tokens from the fixed budget runs. Reduction is paired per task and target; fixed-budget utilization is never called token reduction.
- Win/tie/loss uses Required Symbol Recall first and precision only as a tie-breaker. It is supplemental.

Finding: fixed 2K/4K/8K/16K/32K points are coarser than a 512-token sweep. This can overstate the minimum tokens needed but applies identically to every system and is documented as a V1 limitation.

## Leakage and overfitting review

- System adapter types contain no Gold, importance, or rationale field. Gold is loaded only by validation/evaluation.
- The Gold-leakage regression evaluates the same immutable selection against changed Gold and proves metrics change while selection bytes do not.
- The dataset includes cross-language, documentation, configuration, ambiguous wording, exact controls, and known unsupported relationships rather than only graph-friendly tasks.
- Production `contextforge-structural-v1`, `contextforge-pack-v1`, and `contextforge-generic-v1` files were not edited in Phase 06.
- No formal score had been run when this review was recorded; no task, Gold label, baseline weight, or metric was changed in response to product performance.

## Security and reproducibility review

- Pinned Git materialization uses parameterized `execFile`; corpus paths are canonicalized and bounded.
- Curated copies reject links. All index state is temporary and source hashes are compared before and after each run.
- The harness never executes corpus application code and has no network call site.
- Raw results contain repository IDs, task text, metrics, and relative selected ranges—not source content, secrets, temporary roots, or absolute paths.
- Dataset, fixture, strategy, estimator, budget, system, and commit identities are recorded.

## Pre-run disposition

- BLOCKING: none.
- IMPORTANT: no external human dataset, baseline, metric, leakage, or claims reviewer has participated.
- IMPORTANT: matched-recall resolution is limited to the five fixed budgets.
- MINOR: performance uses one Windows host and three repetitions; it is explicitly not an SLA.

The frozen formal run may proceed. Negative ContextForge results will remain in the result set and will not trigger Phase 06 strategy tuning.
