# Gold Dataset Review — contextforge-dataset-v1

## Review boundary

This review was performed as a separate second pass after corpus authoring and successful identity/range validation, and before any formal A/B/C quality run. No ContextForge, lexical-baseline, or structural-baseline selections or scores were viewed while assigning `REQUIRED` or `SUPPORTING` importance.

The reviewer is the implementing Codex session, not an external human reviewer. “Independent” here means independent of system output and separated from the authoring pass; a later external expert review would strengthen the dataset.

## Frozen scope

- Benchmark version: `contextforge-benchmark-v1`
- Dataset version: `contextforge-dataset-v1`
- Dataset hash: `75685087e8392840b4bb61ae19cef9ccb92df66844e79e0e87a0b7c6437a0002`
- Repositories: 4
- Tasks: 24, with 6 per repository
- Gold files: 74 total, 44 required, 30 supporting
- Gold symbols: 59 total, 44 required, 15 supporting
- Gold ranges: 1 required configuration range

## Balance review

- Languages and contexts include TypeScript/JavaScript, Python, TSX/JS/YAML mixed context, source, tests, configuration, API adapters, and architecture documents.
- Difficulty is fixed from task wording and structural hops: 4 EASY, 11 MEDIUM, and 9 HARD. Difficulty was not assigned from observed scores.
- Categories include 4 exact-symbol controls and 20 non-control tasks across bug fixes, cross-file fixes, tests, concurrency-like behavior, configuration, APIs, refactoring, documentation, and ambiguous natural language.
- Each curated corpus contains similarly named distractors, helpers or hubs, unrelated documentation/configuration, and multiple structural hops.
- The pinned ContextForge corpus is revision `77944250fe022794cb4b86b96415c8fac625f632`, not the mutable Phase 06 worktree.

## Required/supporting review

- `REQUIRED` items were limited to the smallest defensible ownership and behavior path. No task has more than five required symbols or five required files.
- Tests and architecture documents are `SUPPORTING` unless the task directly asks about the test or document.
- Exact identities occur only in tasks explicitly categorized as EASY controls.
- File and symbol importance is consistent; every required symbol/range belongs to a required file.
- The OpenAPI YAML case uses the only manual line range because the file has no parser symbol identity; all other Gold prefers stable path plus qualified symbol.

## Bias and leakage review

- Gold was authored from source behavior and ownership, never from ContextForge output.
- The dataset does not exclusively reward import graphs: it includes semantic wording, file-level docs/config, cross-language relationships that the current graph cannot resolve, and same-name distractors.
- Self-repository bias remains because 6 of 24 tasks use ContextForge itself; the other 18 tasks use independently curated domains.
- Curated-fixture bias remains because each fixture was designed by the benchmark author. This is a limitation, not grounds to alter labels after scoring.
- No Gold object is passed into a system adapter; Gold enters only validation and metric evaluation.

## Findings

- BLOCKING: none after draft validation.
- IMPORTANT: an external human Gold review has not been performed. Retain this limitation in claims.
- MINOR: the initial OpenAPI range ended at line 16 while the frozen file has 15 logical lines. It was corrected before freeze and before any score run.

## Freeze decision

The dataset is frozen for the first formal benchmark. Any later change to corpus bytes, tasks, Gold, importance, metric semantics, or baseline semantics requires a new dataset hash and, when semantics materially change, a new dataset or benchmark version. Poor product results are not a reason to edit this dataset.
