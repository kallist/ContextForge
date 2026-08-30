# ContextForge Offline Benchmark Protocol

## Status and versions

- Benchmark implementation: `contextforge-benchmark-v1`
- Dataset: `contextforge-dataset-v1`
- Frozen dataset hash: `75685087e8392840b4bb61ae19cef9ccb92df66844e79e0e87a0b7c6437a0002`
- Formal reference results: **LOCAL PASS on Windows/Node 24.20.0**; see `BENCHMARK_RESULTS_V1.md` and `benchmarks/reference/contextforge-benchmark-v1/`
- Agent execution comparison: **NOT IMPLEMENTED / NOT TESTED**

`contextforge-benchmark-v1` evaluates repository context quality. It does not solve coding tasks, execute corpus code, call a model, or use a judge. A valid negative product result does not invalidate the framework; invalid Gold, leakage, unfair budgets, silently dropped cases, or irreproducible metric semantics do.

The first frozen full run produced all 360 expected task/system/budget records. Repeating the final quality run produced identical SHA-256 hashes for raw JSON, aggregate JSON, and Markdown. The 8K result and matched-recall evidence are intentionally mixed; no general token-savings claim follows from them. The reviewed interpretation is in `BENCHMARK_RESULTS_V1.md`.

## Corpus and tasks

The frozen dataset contains 24 manually authored tasks across four repositories:

1. the read-only ContextForge Phase 05 Git revision `77944250fe022794cb4b86b96415c8fac625f632`;
2. a curated TypeScript authentication repository;
3. a curated Python queue repository;
4. a curated mixed TypeScript/Python/JavaScript/YAML profile repository.

Each repository contributes six tasks. Categories cover exact symbol, bug fix, cross-file bug fix, test failure, concurrency-like behavior, configuration, API integration, refactor, architecture documentation, and ambiguous natural language. The four EASY exact-symbol cases are explicit controls; difficulty is assigned from task wording and required structural hops, never from observed score.

Curated repositories contain similarly named distractors, helpers/hubs, tests, documentation, and configuration. They are deliberately small enough for Gold review, not claims about large production repositories.

## Gold model and freeze

Each task records repository/revision, text, category, language tags, difficulty, notes, and explicit arrays of Gold files, symbols, and ranges. Every Gold item is `REQUIRED` or `SUPPORTING` and has a rationale.

- A Gold file is a canonical repository-relative path.
- A Gold symbol is a path plus current qualified symbol name; source snippets are not copied into the dataset.
- A Gold range is one-based inclusive and is used only when a semantic symbol is unavailable.
- Required symbol/range importance must agree with its Gold file importance.
- Missing files/symbols, invalid ranges, duplicates, absolute/traversing paths, revision mismatch, and fixture hash mismatch fail the run before scoring.

Gold was authored from source behavior and ownership, not from system output. A separate pre-score review pass checked necessity, excessive context, task leakage, exact-identity bias, structural-signal bias, missing tests/docs/config, and category/difficulty balance. The dataset and curated corpus revisions were then canonicalized and frozen. See `benchmarks/GOLD_REVIEW_V1.md`; the reviewer was the same engineering session rather than an external human, which remains a stated limitation.

The dataset hash is SHA-256 over canonical JSON with recursively sorted object keys and array order preserved. Curated repository revisions are independent SHA-256 identities over sorted relative paths and file-content hashes. Changing corpus bytes or definitions breaks validation; semantic changes require a new version when appropriate.

## Systems

### `lexical-full-file-v1`

Uses the production task normalizer plus fixed benchmark-only path, basename, symbol-name/component, and generation-verified source lexical evidence. It uses no graph expansion, related-test/document relationship, Git score, embedding, or model. Weights and per-signal caps are frozen in `benchmarks/src/systems.ts`.

Candidates are ordered deterministically by score, file-category priority, and raw repository-relative path. Packing considers mandatory root instructions and ranked whole files. An oversized file is skipped and the next candidate is considered. No source slicing is allowed.

### `structural-full-file-v1`

Calls the production `searchRepository` path with `contextforge-structural-v1`, then applies the same benchmark whole-file serializer and skip-oversized policy as the lexical baseline. It isolates the value of production structural ranking from Phase 05 packing.

### `contextforge-v1`

Calls production `searchRepository` for retrieval metrics and production `buildContextPack` for the actual payload:

- ranking: `contextforge-structural-v1`;
- packing: `contextforge-pack-v1`;
- estimator: `contextforge-generic-v1` version `1.0`.

No production weights, caps, graph depth, section shares, range rules, or estimator behavior are changed by benchmark configuration.

## Fair comparison envelope

All systems receive the same materialized repository revision, active generation, task text, safe-file eligibility, secret/binary exclusions, source hash verification, token estimator, and requested budget. Baselines serialize the task, repository/generation metadata, file headers, reasons, fences, estimator, and budget; these bytes count toward the same final payload limit. The production payload format remains part of the ContextForge system under evaluation, so serialization overhead is measured separately rather than erased.

The whole-file systems consider root `AGENTS.md` first and otherwise only change retrieval/ranking as declared. ContextForge may select instruction sections because section-aware packing is intentionally part of B-to-C attribution. All payloads must be at or below the requested estimator budget. A system unable to produce useful context records `NO_CONTEXT`; it is not silently dropped.

## Retrieval metrics

Retrieval is evaluated before packing at K = 1, 3, 5, 10, and 20.

- Required File Recall@K = required Gold file paths present in top K / required Gold files.
- Overall File Recall@K = all Gold file paths present in top K / all Gold files.
- Required Symbol Recall@K = required Gold path/qualified-name identities present in candidate `relevantSymbols` in top K / required Gold symbols.
- Overall Symbol Recall@K uses all Gold symbols.

A ranked file does not imply all its symbols were retrieved. Metrics with a zero denominator are `null`/`N/A`, not perfect scores.

## Packing metrics

Budgets are 2,000, 4,000, 8,000, 16,000, and 32,000 estimator tokens.

- File Recall@Budget: a Gold file counts when at least one meaningful source range from that file is in the payload; manifest-only mention does not count.
- Symbol Recall@Budget: a Gold symbol counts only when one selected range fully contains its one-based inclusive core symbol range.
- Overall Gold Recall: required items have weight 2 and supporting items weight 1 across file, symbol, and explicit-range entities. Required file and symbol recall remain the primary metrics and are never hidden by this aggregate.
- Gold Range Precision: estimated tokens in the intersection of selected source ranges and Gold symbol/range regions divided by estimated selected repository-content tokens. When a Gold file has no semantic symbol/range annotation, selected content from that Gold file is treated as relevant.
- Repository Content Noise Ratio = `1 - Gold Range Precision`.
- Repository Content Tokens: estimator tokens from selected source slices only.
- Serialization Overhead Tokens: complete payload tokens minus repository-content tokens; task, headers, paths, reasons, and fences are overhead, not noise.
- Payload Tokens: the estimator count of the actual serialized agent payload; a `NO_CONTEXT` result records zero because no payload was emitted.

All ratios use explicit denominators and are rounded to six decimal places in raw results. Macro averages give every applicable task equal weight; `null` cases are excluded with counts retained in raw data.

## Matched-recall tokens and token reduction

For each task/system and 80%, 90%, and 100% Required Symbol Recall, `Tokens@MatchedRecall` is the minimum **actual payload token count** among the fixed budget runs that reaches the target. It is not the budget upper bound. If no run reaches the target, the value is `NOT REACHED`.

Matched-Recall Token Reduction is computed only for task pairs where ContextForge and the named baseline both reach the same target:

```text
1 - (ContextForge actual payload tokens / baseline actual payload tokens)
```

The report gives the number of comparable task pairs and the macro mean of per-task reductions. A negative value means ContextForge used more tokens. No fixed-budget utilization difference is described as token reduction.

## Aggregation, diagnostics, and determinism

Source-free raw results retain every task/system/budget case and selected range. Machine-readable aggregates cover system/budget, retrieval cutoff, matched recall, paired token reduction, language tag, task category, difficulty, 8K attribution, and win/tie/loss. Primary reporting uses macro averages.

At 8K, win/tie/loss first compares Required Symbol Recall, then Gold Range Precision as the tie-breaker. It supplements rather than replaces raw metrics.

Misses are attributed where possible:

- `RETRIEVAL_MISS`: required identity absent from top 20;
- `PACKING_DROP`: retrieved identity absent from payload;
- `BUDGET_LIMIT`: no useful context or whole file did not fit;
- `UNSUPPORTED`: task language is outside the implemented parser boundary.

Quality JSON and Markdown omit timing and timestamps and must be byte-stable for the same commit, dataset, systems, and budgets. Performance samples are separate, use three repetitions and medians, record OS/architecture/Node, and are environment-specific—not an SLA.

## Isolation and security

Pinned Git materialization uses `execFile` arguments with shell disabled semantics, bounded time/buffers, canonical paths, and read-only Git commands. Curated files are copied without following links. Every repository is indexed once per quality run in an isolated temporary copy. Source-tree hashes before and after execution must match, excluding temporary `.contextforge` state.

The formal benchmark has no network dependency and never executes corpus application code. Generated results contain repository IDs and relative paths only—no source content, secret values, temporary paths, or local absolute paths. Gold is not in any system adapter input type; changing Gold cannot change a system selection.

## Reproduction

Use Node `>=24.15 <25` (the project pins 24.20.0):

```text
npm ci
npm run benchmark:validate
npm run benchmark:smoke
npm run benchmark
npm run benchmark:performance
```

Generated artifacts appear under ignored `.benchmark-output/`:

- `quality-results.json`: all raw cases;
- `aggregate-results.json`: machine-readable aggregates;
- `benchmark-report.md`: deterministic human report;
- `performance-results.json`: environment and raw timing samples.

The versioned reference directory commits these four source-free artifacts for the first formal run. Generated working files remain ignored so later local runs do not dirty the repository.

Normal `npm test` runs benchmark math, schema/parser, invalid-data, baseline, fairness, leakage, budget, determinism, and report tests without running the 24 × 3 × 5 full corpus.

## Limitations and deferred evaluation

The dataset is small, self-repository and curated-fixture bias remain, and no external human Gold review has occurred. The estimator is generic rather than model-specific. Pure synonyms and cross-language semantic relationships are difficult for lexical/structural v1 retrieval. TypeScript path aliases and advanced Python import behavior remain product limitations. Large external production repositories, Linux/macOS benchmark reproduction, agent task success, paid models, LLM judges, embeddings, vector search, LLM reranking/compression, MCP, Web UI, and context learning are not established by this protocol.
