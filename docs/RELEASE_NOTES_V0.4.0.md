# ContextForge v0.4.0 — Review Context

A diff shows changed lines. ContextForge Review traces supported surrounding code
and compiles an explainable Review Context under your token-estimate budget.

- Analyze a local base commit against tracked working-tree changes, with syntax-level
  changed symbols and ranges in supported JavaScript/TypeScript/Python sources.
- Inspect one-hop import, direct symbol reference, test, documentation and supported
  interface/implementation evidence. Structural facts and heuristics stay distinct.
- Inspect the dedicated Review Workspace; PIN, EXCLUDE, PREFER, FOCUS or RANGE a
  safe candidate, then save an immutable child Capsule and compare its context.
- Keep Review provenance in Capsule v2, source-light history, deterministic Explain,
  captured-entity Coverage/Lint, semantic Diff and current-source Replay verification.
- Use `contextforge review` or the local Studio. Normal CLI/MCP search and pack
  retain the V1 default; V2 ranking remains experimental.

Review does not detect bugs, approve PRs, guarantee complete impact or replace a
reviewer. Deleted source is metadata only; untracked files must be staged. The
separate small scenario evaluation is synthetic and does not measure agent success.

See the [product guide](V0.4_PRODUCT_GUIDE.md),
[architecture decision](adr/ADR-014-review-context.md) and
[evaluation](V0.4_REVIEW_EVALUATION.md) for precise limits and reproducible evidence.
Publication status must be verified through the release report and public registry.
