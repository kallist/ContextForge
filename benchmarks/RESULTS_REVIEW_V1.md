# Benchmark Results and Claims Review — contextforge-benchmark-v1

This is the post-score review for the first frozen formal run. It was performed after the pre-score Gold and methodology reviews and without changing the dataset, baselines, production ranking, production packing, or estimator. It is an independent review pass by the implementing Codex session, not an external-human review.

## Evidence identity

- Benchmarked commit: `8790fecebe4c9026afdf0e5a6d03cfe7f69cb35d`
- Benchmark: `contextforge-benchmark-v1`
- Dataset: `contextforge-dataset-v1`
- Dataset hash: `75685087e8392840b4bb61ae19cef9ccb92df66844e79e0e87a0b7c6437a0002`
- Quality matrix: 24 tasks × 3 systems × 5 budgets = 360 recorded cases
- Production strategies: `contextforge-structural-v1`, `contextforge-pack-v1`, `contextforge-generic-v1` version `1.0`

## Result review

At 8K, `contextforge-v1` produced 0.917 required-file recall, 0.864 required-symbol recall, 0.848 overall-symbol recall, 0.193 Gold-range precision, and 0.807 repository-content noise. The corresponding lexical whole-file values were 0.819, 0.848, 0.859, 0.174, and 0.826; structural whole-file values were 0.750, 0.773, 0.783, 0.138, and 0.862.

This does not show a uniform ContextForge win. Relative to lexical at 8K, ContextForge improved required-file recall by 0.097, required-symbol recall by 0.015, and precision by 0.019, but reduced overall-symbol recall by 0.011. Structural ranking alone reduced required-symbol recall by 0.076 and precision by 0.036 relative to lexical. Production packing then improved required-symbol recall by 0.091 and precision by 0.055 relative to structural whole-file.

At 80%, 90%, and 100% required-symbol recall, the finite task labels caused the same reached-task sets at all three thresholds. On paired tasks, ContextForge used a mean 2,359.28 payload tokens versus 2,790.39 for lexical (18 pairs), with a macro mean per-task reduction of 1.5%. It used a mean 2,329.89 tokens versus 3,405.47 for structural whole-file (19 pairs), with a macro mean reduction of 7.8%. The reduction is the mean of per-task ratios, not the ratio of these displayed means. The desired 60% target was not met.

Win/tie/loss at 8K, using required-symbol recall and then precision, was 17/2/5 versus lexical and 17/7/0 versus structural whole-file. These counts are supplemental; they do not override the raw metrics or convert into an accuracy claim.

## Failure review

Four ContextForge cases missed required context at 8K:

1. `self-index-activation-race`: required files and symbols were retrieved but dropped during packing; required file/symbol recall 0/0 (`PACKING_DROP`).
2. `self-stale-lexical-source`: both required files appeared, but both required symbol cores were absent; one was outside top 20 and one was dropped (`RETRIEVAL_MISS`, `PACKING_DROP`).
3. `self-package-parser-assets`: the required file appeared, but `scripts/package-smoke.mjs#run` was not a top-20 relevant symbol (`RETRIEVAL_MISS`).
4. `self-pack-snapshot-architecture`: the required ADR was not retrieved (`RETRIEVAL_MISS`); this task has no required symbol denominator.

A fifth notable loss is `self-output-publish-race`: required-symbol recall was complete for both ContextForge and lexical, but ContextForge precision was 0.126 versus lexical 0.223. It is retained as a loss rather than hidden behind perfect recall.

Notable wins include `self-pack-exact` (required-symbol recall 1.0 versus lexical 0.0, precision 0.825 versus 0.0) and `ts-logout-token-bug` (1.0 versus 0.667 required-symbol recall). These examples do not erase the failures above.

## Performance review

The performance run used Windows `10.0.26200`, x64, Node `v24.20.0`, three repetitions, and an 8K budget. Medians are environment-specific and are not an SLA.

| Repository | System | Index ms | Search ms | Pack/serialization ms | Total context generation ms |
|---|---|---:|---:|---:|---:|
| pinned ContextForge Phase 05 | lexical-full-file-v1 | 774.338 | 180.222 | 197.372 | 377.664 |
| pinned ContextForge Phase 05 | structural-full-file-v1 | 774.338 | 488.733 | 165.786 | 654.635 |
| pinned ContextForge Phase 05 | contextforge-v1 | 774.338 | 462.969 | 147.329 | 602.554 |
| synthetic 1000-file | lexical-full-file-v1 | 4071.117 | 1163.595 | 1737.129 | 2815.722 |
| synthetic 1000-file | structural-full-file-v1 | 4071.117 | 2384.301 | 90.643 | 2461.950 |
| synthetic 1000-file | contextforge-v1 | 4071.117 | 2265.151 | 61.594 | 2326.745 |

Index time is shared by systems within a repetition and is reported separately from warm context generation. Component medians need not sum exactly to the median total because each column is aggregated independently.

## Determinism and integrity review

Two consecutive final full-quality runs produced identical bytes:

- `quality-results.json`: `175ec7327dba2880324dad56d8d055fba2f09992a957bfe754607c6d9c1394a6`
- `aggregate-results.json`: `a3cd681db283fd7a34522f7254247ffd4320abefb54ab6cae5ee4918bf4915a3`
- `benchmark-report.md`: `e6283faeb037f39151351b0b1abdbf054385dbeccf46fce9a41afa3f1f070023`

The raw quality artifact itself was unchanged by post-score report-field improvements. Performance output intentionally contains nondeterministic timing and is kept outside quality determinism claims.

- Gold leakage: PASS; Gold is absent from system adapter inputs, and the regression test changes Gold without changing selection.
- Dataset freeze: PASS; canonical hash and curated/pinned revisions validate before scoring.
- Baseline fairness: PASS; same snapshot, task, safety boundary, estimator, budget semantics, instruction policy, and final serialized budget.
- Case completeness: PASS; all 360 expected records are present; no failed or unfavorable case was removed.
- Production tuning: NONE; no Phase 04/05 production ranking, packing, graph, section, or estimator file changed.
- Network/source execution: NONE; corpus application code was not executed.
- Production CLI alignment: PASS after adding a same-index/task/budget E2E equality assertion between CLI manifest selection and the benchmark `contextforge-v1` adapter.

## Claims disposition

ALLOWED: “ContextForge provides a frozen, reproducible offline benchmark with 24 Gold tasks, three systems, and five budgets.”

ALLOWED with complete qualifier: “On `contextforge-benchmark-v1` at 8K, `contextforge-v1` measured 0.917 required-file recall, 0.864 required-symbol recall, and 0.193 Gold-range precision.”

ALLOWED with paired-sample qualifier: “At matched required-symbol recall on paired benchmark-v1 tasks, ContextForge's macro mean token reduction was 1.5% versus lexical whole-file and 7.8% versus structural whole-file.”

NOT ALLOWED: a generic “ContextForge saves tokens,” “60% token reduction,” “better than grep,” “95% accuracy,” coding-agent success, cross-platform performance, or large-repository claim.

## Disposition

- Dataset Review: PASS, with no external-human review.
- Baseline Fairness Review: PASS.
- Metric Review: PASS.
- Leakage / Overfitting Review: PASS.
- Claims Review: PASS for the narrow claims above.
- BLOCKING: none.
- IMPORTANT: structural ranking underperformed lexical ranking in aggregate retrieval on this dataset; retain for future strategy work rather than tuning Phase 6.
- IMPORTANT: external-human Gold/methodology/claims review remains NOT TESTED.
- MINOR: matched-recall resolution is limited to five budget points, and performance is one-host/three-repetition evidence.

Phase 6 framework readiness is not contingent on ContextForge winning. The framework is ready; strong product-performance claims are not.
