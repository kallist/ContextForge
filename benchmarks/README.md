# ContextForge offline benchmark

This directory contains the frozen, offline `contextforge-benchmark-v1` protocol implementation and `contextforge-dataset-v1`. It is developer evaluation tooling, not a production CLI feature, and is excluded from the npm package.

## Layout

- `dataset-v1.json`: 24 manually authored tasks and Gold annotations.
- `dataset-v1.lock.json`: frozen canonical dataset hash and review state.
- `GOLD_REVIEW_V1.md`: pre-score Gold review and known review limitation.
- `METHODOLOGY_REVIEW_V1.md`: pre-score baseline, metric, leakage, security, and reproducibility review.
- `RESULTS_REVIEW_V1.md`: post-score failure, claims, and final integrity review.
- `corpus/`: curated TypeScript, Python, and mixed-language repositories.
- `reference/contextforge-benchmark-v1/`: versioned source-free raw, aggregate, report, and performance evidence from the first formal run.
- `schema/`: versioned dataset and quality-result schema descriptions.
- `src/`: materialization, baselines, production adapters, metrics, aggregation, and deterministic report generation.

The fourth corpus is the read-only Git snapshot `77944250fe022794cb4b86b96415c8fac625f632`. The harness materializes it with parameterized, shell-free Git commands into a temporary directory. Curated fixtures are copied into temporary directories. Index state is therefore isolated under temporary `.contextforge/` directories; the source checkout and fixture sources are hashed before and after each run.

## Commands

```text
npm run benchmark:validate
npm run benchmark:smoke
npm run benchmark:quality
npm run benchmark:performance
npm run benchmark
```

Generated source-free outputs are written to ignored `.benchmark-output/`. `benchmark` and `benchmark:quality` run all 24 tasks, three systems, and 2K/4K/8K/16K/32K budgets. Performance is separate because timing is environment-dependent.

## Integrity boundary

Gold is accepted only by validation and metric evaluation. System adapters accept task text, repository runtime, and budget; their types do not accept Gold. All three systems use the same safe indexed snapshot and `contextforge-generic-v1` estimator. No corpus application code is executed, no network is used, and no production ranking or packing parameter is benchmark-configurable.
