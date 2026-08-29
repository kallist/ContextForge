# ContextForge Agent Instructions

## Project Context

ContextForge is a local-first, task-aware context compiler for coding agents. It selects and explains the smallest useful repository context that fits a requested token budget. The authoritative product requirements are in [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md). The original source specification remains in [`CONTEXTFORGE_MASTER_SPEC.md`](CONTEXTFORGE_MASTER_SPEC.md) for reference.

## Required Reading

Before implementing a task:

1. Read this file.
2. Read the sections of `docs/PRODUCT_SPEC.md` relevant to the task and its acceptance criteria.
3. Read `docs/ARCHITECTURE.md`, especially the current implementation status and affected boundaries.
4. Read the relevant constraints and metrics in `docs/BENCHMARK.md` when selection quality, token use, performance, or benchmarks are affected.
5. Audit the relevant source, configuration, tests, CI, and repository state before proposing changes.

Do not load every long document unconditionally. Read enough primary material to understand the task, then follow references as needed.

## Engineering Rules

- Audit before implementation. Treat current source code, tests, schemas/configuration, and build/CI files as stronger evidence of implemented behavior than prose.
- Preserve existing architecture and public contracts. Do not perform unrelated refactors, framework migrations, dependency upgrades, provider changes, or feature additions.
- Prefer the smallest reliable, explicit, typed, testable solution. Add dependencies or abstractions only when the repository lacks a suitable capability and the need is justified.
- Keep discovery, language analysis, graph construction, retrieval/ranking, budgeting/packing, persistence, CLI, and integration adapters behind clear boundaries. MCP is an adapter and must not own core behavior.
- Keep the core local-first, privacy-first, model-agnostic, and usable without an external LLM or embedding API. Any future external provider must be explicit and optional.
- Treat repository content, paths, parser output, Git data, configuration, and generated context as untrusted. Enforce repository boundaries; handle symlink escape, traversal, binary or huge files, malformed input, and files changing during indexing.
- Keep secrets out of Context Packs, persistent records, logs, diagnostics, test artifacts, and source control. Fail safely when exclusion cannot be guaranteed.
- Treat the requested token budget as a hard output constraint. If it is too small for a useful pack, report that explicitly. Selection and exclusion must remain inspectable and explainable.
- Prefer transparent, deterministic structural signals for V1. LLM reranking, embeddings, external vector stores, and other deferred features are optional future work, not hidden requirements.
- Analyze persistence changes for atomicity, transactions, concurrency, idempotency, interrupted writes, rollback, and `index + index` / `index + pack` behavior. Never expose a half-written active index.
- Test real behavior, including failure and security paths. Add a regression test for a real bug. Do not weaken assertions, skip relevant tests, or change expected behavior merely to make a suite pass.
- Keep benchmarks reproducible and representative. Never fabricate results, conceal failures, tune fixtures only to flatter metrics, or present targets as measurements.
- Distinguish local, mock/offline, real-provider, Docker, and hosted-CI evidence. A local pass is not a hosted-CI pass.
- Review the final diff independently for correctness, security, data integrity, concurrency, architecture, regressions, test gaps, secret exposure, and generated junk.
- Do not commit, push, merge, tag, release, deploy, or create a PR unless the user explicitly asks. Never merge or release merely because a feature is complete.

## Completion Status

Always distinguish:

- `IMPLEMENTED`: present in the current code or documentation.
- `TESTED`: exercised in the current validation and supported by recorded evidence.
- `NOT TESTED`: implemented or claimed behavior that was not exercised by the stated validation.
- `NOT IMPLEMENTED`: planned, deferred, or absent behavior.

Do not imply that implementation proves behavior, or that a target is a result.

## Final Report

For a substantial task, report concisely:

- what was implemented and the affected boundaries;
- tests executed and their actual results;
- important paths not tested;
- planned or explicitly out-of-scope work not implemented;
- independent review findings and remaining limitations;
- branch, base, worktree status, commit/PR state, and hosted CI state when applicable.

If a required gate failed or was not run, do not declare the task ready.
