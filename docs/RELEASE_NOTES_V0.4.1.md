# ContextForge 0.4.1

ContextForge 0.4.1 is a narrow correctness hotfix for Review lifecycle behavior.

- A tracked DELETE can produce a metadata-only Review Capsule without requiring
  or reconstructing deleted source bytes.
- Rename signals are isolated to the index generation that observed them, so a
  rename restored to its original path can be indexed normally.

This patch does not add Review modes or MCP tools, change ranking, promote V2,
modify benchmark Gold, migrate the database, introduce Capsule v3, or archive
historical source.
