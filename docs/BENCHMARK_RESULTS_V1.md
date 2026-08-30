# ContextForge Offline Benchmark V1 Results

Benchmark: contextforge-benchmark-v1
Dataset: contextforge-dataset-v1
Dataset hash: 75685087e8392840b4bb61ae19cef9ccb92df66844e79e0e87a0b7c6437a0002
Benchmarked commit: 8790fecebe4c9026afdf0e5a6d03cfe7f69cb35d
Mode: FULL
Tasks: 24
Repositories: 4

Quality metrics are deterministic and source-free. Latency is reported separately.

Reference artifacts: `benchmarks/reference/contextforge-benchmark-v1/`. Post-score interpretation and claims review: `benchmarks/RESULTS_REVIEW_V1.md`.

## Retrieval

| System | K | Required file recall | Required symbol recall |
|---|---:|---:|---:|
| lexical-full-file-v1 | 1 | 0.479 | 0.437 |
| lexical-full-file-v1 | 3 | 0.715 | 0.652 |
| lexical-full-file-v1 | 5 | 0.896 | 0.731 |
| lexical-full-file-v1 | 10 | 0.931 | 0.731 |
| structural-full-file-v1 | 1 | 0.299 | 0.326 |
| structural-full-file-v1 | 3 | 0.500 | 0.499 |
| structural-full-file-v1 | 5 | 0.708 | 0.602 |
| structural-full-file-v1 | 10 | 0.896 | 0.731 |
| contextforge-v1 | 1 | 0.299 | 0.326 |
| contextforge-v1 | 3 | 0.500 | 0.499 |
| contextforge-v1 | 5 | 0.708 | 0.602 |
| contextforge-v1 | 10 | 0.896 | 0.731 |

## Fixed-budget quality

| Budget | System | Required file | Required symbol | Overall symbol | Overall Gold | Precision | Noise | Mean payload tokens |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 2000 | lexical-full-file-v1 | 0.736 | 0.758 | 0.793 | 0.736 | 0.140 | 0.860 | 1893.458 |
| 2000 | structural-full-file-v1 | 0.729 | 0.773 | 0.790 | 0.732 | 0.155 | 0.845 | 1924.250 |
| 2000 | contextforge-v1 | 0.757 | 0.758 | 0.761 | 0.741 | 0.161 | 0.839 | 1818.042 |
| 4000 | lexical-full-file-v1 | 0.778 | 0.803 | 0.815 | 0.786 | 0.160 | 0.840 | 2506.417 |
| 4000 | structural-full-file-v1 | 0.771 | 0.773 | 0.783 | 0.768 | 0.145 | 0.855 | 2794.042 |
| 4000 | contextforge-v1 | 0.854 | 0.818 | 0.826 | 0.816 | 0.164 | 0.836 | 2339.708 |
| 8000 | lexical-full-file-v1 | 0.819 | 0.848 | 0.859 | 0.826 | 0.174 | 0.826 | 3510.917 |
| 8000 | structural-full-file-v1 | 0.750 | 0.773 | 0.783 | 0.756 | 0.138 | 0.862 | 3794.667 |
| 8000 | contextforge-v1 | 0.917 | 0.864 | 0.848 | 0.871 | 0.193 | 0.807 | 3453.375 |
| 16000 | lexical-full-file-v1 | 0.924 | 0.917 | 0.902 | 0.893 | 0.177 | 0.823 | 5508.458 |
| 16000 | structural-full-file-v1 | 0.854 | 0.864 | 0.848 | 0.842 | 0.170 | 0.830 | 5801.417 |
| 16000 | contextforge-v1 | 0.917 | 0.864 | 0.870 | 0.891 | 0.185 | 0.815 | 4992.625 |
| 32000 | lexical-full-file-v1 | 0.944 | 0.939 | 0.946 | 0.931 | 0.179 | 0.821 | 9507.125 |
| 32000 | structural-full-file-v1 | 0.896 | 0.909 | 0.913 | 0.893 | 0.154 | 0.846 | 9797.792 |
| 32000 | contextforge-v1 | 0.938 | 0.886 | 0.891 | 0.909 | 0.173 | 0.827 | 7551.000 |

## Tokens at matched required-symbol recall

| Target | System | Tasks reached | Mean actual payload tokens |
|---:|---|---:|---:|
| 80% | lexical-full-file-v1 | 19/22 | 3062.579 |
| 80% | structural-full-file-v1 | 20/22 | 4832.250 |
| 80% | contextforge-v1 | 19/22 | 2329.895 |
| 90% | lexical-full-file-v1 | 19/22 | 3062.579 |
| 90% | structural-full-file-v1 | 20/22 | 4832.250 |
| 90% | contextforge-v1 | 19/22 | 2329.895 |
| 100% | lexical-full-file-v1 | 19/22 | 3062.579 |
| 100% | structural-full-file-v1 | 20/22 | 4832.250 |
| 100% | contextforge-v1 | 19/22 | 2329.895 |

## Matched-recall token reduction

| Target | Baseline | Paired tasks | Mean baseline tokens | Mean ContextForge tokens | Macro mean reduction |
|---:|---|---:|---:|---:|---:|
| 80% | lexical-full-file-v1 | 18 | 2790.389 | 2359.278 | 1.5% |
| 80% | structural-full-file-v1 | 19 | 3405.474 | 2329.895 | 7.8% |
| 90% | lexical-full-file-v1 | 18 | 2790.389 | 2359.278 | 1.5% |
| 90% | structural-full-file-v1 | 19 | 3405.474 | 2329.895 | 7.8% |
| 100% | lexical-full-file-v1 | 18 | 2790.389 | 2359.278 | 1.5% |
| 100% | structural-full-file-v1 | 19 | 3405.474 | 2329.895 | 7.8% |

Reductions are macro means over paired tasks only; negative values mean ContextForge used more estimated payload tokens. `NOT AVAILABLE` means no paired task reached the target.

## Attribution at 8K

Structural ranking vs lexical full-file — required-symbol recall delta: -0.076; precision delta: -0.036.

ContextForge packing vs structural full-file — required-symbol recall delta: 0.091; precision delta: 0.055.

Win/tie/loss vs lexical: 17/2/5.
Win/tie/loss vs structural full-file: 17/7/0.

## Language breakdown

| Language tag | System | Required symbol @8K | Precision @8K |
|---|---|---:|---:|
| javascript | lexical-full-file-v1 | 1.000 | 0.111 |
| javascript | structural-full-file-v1 | 0.000 | 0.025 |
| javascript | contextforge-v1 | 0.000 | 0.078 |
| mixed | lexical-full-file-v1 | 1.000 | 0.200 |
| mixed | structural-full-file-v1 | 1.000 | 0.200 |
| mixed | contextforge-v1 | 1.000 | 0.220 |
| python | lexical-full-file-v1 | 1.000 | 0.218 |
| python | structural-full-file-v1 | 1.000 | 0.214 |
| python | contextforge-v1 | 1.000 | 0.229 |
| typescript | lexical-full-file-v1 | 0.792 | 0.164 |
| typescript | structural-full-file-v1 | 0.688 | 0.119 |
| typescript | contextforge-v1 | 0.813 | 0.190 |
| yaml | lexical-full-file-v1 | 1.000 | 0.199 |
| yaml | structural-full-file-v1 | 1.000 | 0.199 |
| yaml | contextforge-v1 | 1.000 | 0.229 |

## Difficulty breakdown

| difficulty | System | Required symbol @8K | Precision @8K |
|---|---|---:|---:|
| EASY | lexical-full-file-v1 | 0.750 | 0.089 |
| EASY | structural-full-file-v1 | 0.750 | 0.086 |
| EASY | contextforge-v1 | 1.000 | 0.294 |
| HARD | lexical-full-file-v1 | 0.833 | 0.260 |
| HARD | structural-full-file-v1 | 0.875 | 0.197 |
| HARD | contextforge-v1 | 0.875 | 0.221 |
| MEDIUM | lexical-full-file-v1 | 0.900 | 0.133 |
| MEDIUM | structural-full-file-v1 | 0.700 | 0.109 |
| MEDIUM | contextforge-v1 | 0.800 | 0.133 |

## Task-category breakdown

| taskCategory | System | Required symbol @8K | Precision @8K |
|---|---|---:|---:|
| AMBIGUOUS_NATURAL_LANGUAGE | lexical-full-file-v1 | 1.000 | 0.282 |
| AMBIGUOUS_NATURAL_LANGUAGE | structural-full-file-v1 | 1.000 | 0.294 |
| AMBIGUOUS_NATURAL_LANGUAGE | contextforge-v1 | 1.000 | 0.324 |
| API_INTEGRATION | lexical-full-file-v1 | 1.000 | 0.111 |
| API_INTEGRATION | structural-full-file-v1 | 1.000 | 0.123 |
| API_INTEGRATION | contextforge-v1 | 1.000 | 0.127 |
| BUG_FIX | lexical-full-file-v1 | 0.000 | 0.000 |
| BUG_FIX | structural-full-file-v1 | 0.000 | 0.000 |
| BUG_FIX | contextforge-v1 | 0.000 | 0.000 |
| CONCURRENCY | lexical-full-file-v1 | 0.500 | 0.452 |
| CONCURRENCY | structural-full-file-v1 | 0.500 | 0.161 |
| CONCURRENCY | contextforge-v1 | 0.500 | 0.179 |
| CONFIGURATION | lexical-full-file-v1 | 1.000 | 0.150 |
| CONFIGURATION | structural-full-file-v1 | 0.750 | 0.129 |
| CONFIGURATION | contextforge-v1 | 0.750 | 0.151 |
| CROSS_FILE_BUG_FIX | lexical-full-file-v1 | 0.889 | 0.216 |
| CROSS_FILE_BUG_FIX | structural-full-file-v1 | 0.667 | 0.138 |
| CROSS_FILE_BUG_FIX | contextforge-v1 | 1.000 | 0.185 |
| DOCUMENTATION_ARCHITECTURE | lexical-full-file-v1 | N/A | 0.092 |
| DOCUMENTATION_ARCHITECTURE | structural-full-file-v1 | N/A | 0.092 |
| DOCUMENTATION_ARCHITECTURE | contextforge-v1 | N/A | 0.129 |
| EXACT_SYMBOL | lexical-full-file-v1 | 0.750 | 0.089 |
| EXACT_SYMBOL | structural-full-file-v1 | 0.750 | 0.086 |
| EXACT_SYMBOL | contextforge-v1 | 1.000 | 0.294 |
| REFACTOR | lexical-full-file-v1 | 1.000 | 0.250 |
| REFACTOR | structural-full-file-v1 | 1.000 | 0.250 |
| REFACTOR | contextforge-v1 | 1.000 | 0.268 |
| TEST_FAILURE | lexical-full-file-v1 | 1.000 | 0.146 |
| TEST_FAILURE | structural-full-file-v1 | 1.000 | 0.150 |
| TEST_FAILURE | contextforge-v1 | 1.000 | 0.170 |

## Worst ContextForge cases at 8K

| Task | Required file | Required symbol | Missed required context | Attribution |
|---|---:|---:|---|---|
| self-index-activation-race | 0.000 | 0.000 | src/adapters/sqlite/sqlite-index-repository.ts, src/application/build-index.ts, src/adapters/sqlite/sqlite-index-repository.ts#SqliteIndexRepository.buildAndActivate, src/application/build-index.ts#buildIndex | PACKING_DROP |
| self-stale-lexical-source | 1.000 | 0.000 | src/adapters/filesystem/repository-source-reader.ts#FileSystemRepositorySourceReader.readTextFile, src/application/search-repository.ts#searchRepository | PACKING_DROP, RETRIEVAL_MISS |
| self-package-parser-assets | 1.000 | 0.000 | scripts/package-smoke.mjs#run | RETRIEVAL_MISS |
| self-pack-snapshot-architecture | 0.000 | N/A | docs/adr/ADR-006-hard-budget-context-packing.md | RETRIEVAL_MISS |
| self-output-publish-race | 1.000 | 1.000 | none | none |

## Notable ContextForge wins versus lexical full-file at 8K

| Task | ContextForge required symbol | Lexical required symbol | ContextForge precision | Lexical precision |
|---|---:|---:|---:|---:|
| self-pack-exact | 1.000 | 0.000 | 0.825 | 0.000 |
| ts-logout-token-bug | 1.000 | 0.667 | 0.211 | 0.223 |
| self-pack-snapshot-architecture | N/A | N/A | 0.059 | 0.000 |
| ts-users-stay-signed-in | 1.000 | 1.000 | 0.227 | 0.175 |
| py-worker-test-failure | 1.000 | 1.000 | 0.202 | 0.161 |

## Integrity and limitations

- Gold is evaluator-only and was manually authored from repository behavior before the formal score run.
- All systems use the same materialized snapshot, task, estimator, safety boundary, and hard serialized budget.
- `lexical-full-file-v1` uses only task normalization, path/symbol/source lexical evidence, and whole files.
- `structural-full-file-v1` uses production structural ranking and whole files; `contextforge-v1` uses production ranking and packing.
- This finite self/curated dataset may contain self-repository and fixture-authoring bias.
- The generic estimator is not a model tokenizer; no coding agent, LLM judge, network, embedding, or corpus code execution is involved.
- TypeScript aliases, advanced Python imports, pure synonym retrieval, large external repositories, and cross-platform benchmark execution remain limitations or untested paths.

## Performance

Windows `10.0.26200`, x64, Node `v24.20.0`; three 8K repetitions. Values are medians in milliseconds, are environment-specific, and are not an SLA.

| Repository | System | Index | Search | Pack/serialization | Total context generation |
|---|---|---:|---:|---:|---:|
| pinned ContextForge Phase 05 | lexical-full-file-v1 | 774.338 | 180.222 | 197.372 | 377.664 |
| pinned ContextForge Phase 05 | structural-full-file-v1 | 774.338 | 488.733 | 165.786 | 654.635 |
| pinned ContextForge Phase 05 | contextforge-v1 | 774.338 | 462.969 | 147.329 | 602.554 |
| synthetic 1000-file | lexical-full-file-v1 | 4071.117 | 1163.595 | 1737.129 | 2815.722 |
| synthetic 1000-file | structural-full-file-v1 | 4071.117 | 2384.301 | 90.643 | 2461.950 |
| synthetic 1000-file | contextforge-v1 | 4071.117 | 2265.151 | 61.594 | 2326.745 |

## Review disposition

Dataset, baseline fairness, metric, leakage/overfitting, and claims review passed with no blocking finding. An external human did not perform those reviews. The 60% token-reduction target was not met, structural ranking underperformed lexical ranking in aggregate retrieval, and no broad token-savings or coding-agent-success claim is justified. See `benchmarks/RESULTS_REVIEW_V1.md` for failures, allowed claims, and remaining limitations.
