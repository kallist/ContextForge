# ContextForge Benchmark Specification

## Status

- **Benchmark implementation: NOT IMPLEMENTED**
- **Offline benchmark results: NOT RUN / NOT TESTED**
- **Real coding-agent comparison: NOT RUN / NOT TESTED**

The values in the Target Metrics section are engineering goals, not observed results.

## Benchmark Goals

The benchmark must supply evidence for three product questions:

1. Did ContextForge select the right context?
2. Did it use fewer tokens?
3. Can it explain why the context was selected?

The offline suite is a V1 requirement. It must exercise the production indexing, retrieval, ranking, budgeting, and packing path rather than a benchmark-only approximation.

## Benchmark Case Format

Each versioned case must define:

- repository or fixture identity and version;
- coding task;
- gold files;
- gold symbols;
- optional gold documentation;
- token budget.

Cases should also record why each gold item is required, expected safety exclusions, relevant configuration, and any legitimate alternative selections. The implemented format must distinguish a missing annotation from an intentionally empty gold set.

## Gold Context

Gold context is the minimum defensible set of repository items a competent agent needs for the task, not every file that might be interesting. Gold files and symbols should be reviewed independently of ContextForge output to avoid circular labels.

Gold annotations must use stable file identities and unambiguous symbol/range references. When a repository version changes, cases must either remain pinned or be re-reviewed. Disagreements and acceptable alternatives should be recorded rather than silently resolved in favor of the product.

## Language Coverage

The initial offline suite must cover:

- TypeScript/JavaScript;
- Python;
- at least one mixed-language repository.

Coverage should include source, tests, repository instructions, and architecture documentation where relevant. Fixtures must be representative enough to exercise ambiguity, dependency expansion, exclusions, and tight budgets; trivial cases alone are insufficient.

## Offline Metrics

### File Recall@Budget

The fraction of required gold files represented in the selected Context Pack while respecting the case budget.

```text
matched gold files / total gold files
```

A file counts as represented when the selected full file or selected excerpt covers the annotated required content. The benchmark must document its exact matching rule.

### Symbol Recall@Budget

The fraction of required gold symbols represented in the selected Context Pack while respecting the case budget.

```text
matched gold symbols / total gold symbols
```

Symbol identity and overlap rules must be versioned with the benchmark.

### Precision

The fraction of selected evaluable items that are relevant under the case annotations.

```text
relevant selected items / selected evaluable items
```

Reports must say whether the unit is files, symbols, ranges, or a separately reported set. File and symbol precision must not be blended without a defined weighting.

### Token Count

The total tokens in the generated Context Pack under the declared estimator/tokenizer, including structural and explanation overhead. Reports must include the requested budget and whether final serialization complied with it.

### Token Reduction

The reduction relative to a declared baseline context for the same repository and task.

```text
1 - (ContextForge token count / baseline token count)
```

The baseline—such as all eligible repository content—must be reproducible and use the same tokenizer and safety exclusions. A change in baseline definition invalidates direct historical comparison unless results are recomputed.

### Selected File Count

The number of distinct repository files represented by full content or excerpts. Reports should additionally separate full files from excerpts when implemented.

### Index Duration

Elapsed time for a cold or incremental index operation, reported separately. Results must identify which mode ran and the repository state.

### Pack Duration

Elapsed time to derive task signals, retrieve, expand, rank, budget, and serialize a Context Pack against an already defined index state. Any excluded setup must be stated.

## Explanation Quality

Explainability is a product goal even though the source specification does not set a numeric explanation target. Each selected item must have non-empty, inspectable reasons tied to actual retrieval or structural evidence. The suite should validate reason presence, supported reason categories, and consistency between `context.md` and `context.json`.

Human evaluation of reason usefulness may be added later, but it must be reported separately from deterministic offline metrics.

## Target Metrics

Desired V1 engineering targets:

| Metric | Target | Current result |
|---|---:|---|
| Gold File Recall@Budget | ≥ 90% | NOT RUN / NOT TESTED |
| Gold Symbol Recall@Budget | ≥ 85% | NOT RUN / NOT TESTED |
| Token Reduction | ≥ 60% | NOT RUN / NOT TESTED |

Targets apply only to a disclosed, versioned benchmark suite. They are not acceptance evidence until actual runs, case-level results, aggregate method, environment, and failures are recorded.

The source specification defines no numeric precision, duration, or explanation-quality threshold. Those values must not be invented; any later threshold requires an explicit product decision.

## Required Correctness and Safety Checks

Benchmark and adjacent test evidence must cover:

- relevant selection and irrelevant exclusion;
- hard budget enforcement, including unusably small budgets;
- accurate symbols and line ranges;
- related-test and task-aware documentation discovery;
- bounded graph expansion;
- secret and sensitive-file exclusion;
- repository boundary, path traversal, and symlink protection;
- graceful per-file parser failure;
- safe incremental indexing and reader-visible atomicity;
- stable output for identical inputs where practical.

Security failures are not acceptable tradeoffs for higher recall. Unsafe candidates must not count as desirable gold context.

## Performance Measurement

Cold index, incremental index, and pack latency must be measured. Every published run should record at least:

- ContextForge version or commit;
- benchmark suite version;
- operating system and relevant hardware/runtime details;
- repository identity, size, language distribution, and eligible file count;
- warm/cold cache conditions;
- concurrency and configured work limits;
- tokenizer/estimator and budget;
- per-case values plus the aggregation method.

No performance claim should be made from unrecorded or incomparable environments.

## Agent Benchmark

A future optional evaluation may compare:

```text
Coding agent without ContextForge
vs
the same coding agent with ContextForge
```

Possible measures include task success, tests passed, input/output tokens, tool calls, files read, latency, and cost. A defensible comparison should pin agent/model versions and settings, task/repository versions, tool permissions, timeout, run count, and success rubric, then report variance and failures.

Current agent-benchmark status: **NOT RUN / NOT TESTED**.

Real or paid model evaluation must not be a mandatory CI dependency. It should be explicit, bounded, and reported separately from offline deterministic gates.

## Benchmark Integrity

- Never fabricate, interpolate, or imply missing results.
- Never present target values as measurements.
- Do not weaken gold annotations, budgets, assertions, or fixtures merely to improve scores.
- Do not rely only on artificially easy fixtures; include ambiguous and failure cases.
- Preserve and report failure cases, zero-result cases, invalid packs, and budget violations.
- Version repositories/fixtures, gold labels, metric code, tokenizer, configuration, and aggregation rules.
- Keep raw case-level results available for audit; aggregate values must be reproducible from them.
- Separate cold and incremental performance, local and hosted runs, and offline and paid-agent evidence.
- Do not claim hosted CI success from a local run.
- Prevent secrets, private repository source, and local absolute paths from entering public benchmark artifacts.

## Reporting Template

When the benchmark exists, each run should report:

```text
Status: PASS / FAIL / ERROR / NOT RUN
ContextForge version:
Suite version:
Environment:
Configuration and tokenizer:
Cases attempted/completed/failed:
File Recall@Budget:
Symbol Recall@Budget:
Precision (unit):
Token Count and compliance:
Token Reduction and baseline:
Selected File Count:
Cold Index Duration:
Incremental Index Duration:
Pack Duration:
Failure cases:
Artifact locations:
```

Until a benchmark implementation and actual run exist, all result fields remain `NOT RUN / NOT TESTED`.
