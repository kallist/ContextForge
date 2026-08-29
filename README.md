# ContextForge

**Status: Phase 0 + Phase 1 implemented — Safe Repository Map**

ContextForge is a local-first, task-aware context compiler for coding agents. It is intended to answer one practical question: for a specific coding task, which repository context should an agent actually receive?

```text
Repository + Coding Task + Token Budget
                  ↓
            ContextForge
                  ↓
        Task-aware Context Pack
                  ↓
             Coding Agent
```

The product goal is to preserve the context needed to complete a task while reducing irrelevant material and explaining why each important item was selected.

> Coding agents should not need your whole repository. They need the right context.

## Current State

ContextForge now has its first working vertical slice: a buildable, installable TypeScript CLI that safely discovers and maps a local repository. It provides deterministic text and JSON output while enforcing ignore, sensitive-file, binary, file-size, encoding, symlink, junction, and repository-boundary policies.

Task-aware selection, parsers, symbols, SQLite indexing, repository graphs, ranking, token budgeting, Context Packs, benchmarks, MCP, remote providers, and a web UI remain **NOT IMPLEMENTED**.

## Requirements

- Node.js `>=24.15 <25` (the repository pins Node 24.20.0 for development and CI)
- npm

## Development

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The compiled CLI can then be run directly:

```text
node dist/cli/main.js --help
node dist/cli/main.js map .
node dist/cli/main.js map . --json
```

To verify the installable artifact without publishing it:

```text
npm run package:smoke
```

That smoke test runs `npm pack`, installs the tarball into a fresh temporary project, and invokes the installed `contextforge` binary. It does not publish the package.

## Repository Map Behavior

`contextforge map [repository]` defaults to the current directory. If the input is inside a Git worktree, the nearest ancestor containing `.git` becomes the map root; otherwise, the input directory itself is mapped. Public output uses normalized repository-relative paths and never includes file contents or the absolute repository root.

`--json` emits schema version `1.0` with repository identity, deterministic entries, category and language counts, and exclusion reasons. Human-readable output is capped at 200 listed entries while retaining complete counts; JSON contains the complete bounded entry set.

Safety rules are fail-closed and additive:

- built-in exclusions such as `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage`, `vendor`, virtual environments, and `.contextforge` cannot be negated;
- `.gitignore` and `.contextforgeignore` are independent rule families, so a negation in one cannot re-include a path excluded by the other;
- sensitive names (`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`, `credentials*`, and `secrets*`) are hidden before file reads and cannot be re-enabled by ignore negation;
- directory links are never traversed, and resolved paths outside the repository are omitted;
- files larger than 1 MiB are classified without being loaded; unknown content is read through a bounded buffer and checked for binary bytes and valid UTF-8;
- traversal stops with a dedicated error after 100,000 encountered entries or 64 levels.

An ignored directory contributes one exclusion count; unvisited descendants are deliberately not guessed. Filesystem races cannot be eliminated without an OS sandbox. ContextForge resolves and revalidates paths, performs bounded handle reads, compares metadata around reads, and fails closed when a path changes, but this is not an OS-level filesystem sandbox guarantee.

## Project Documents

- [Product Specification](docs/PRODUCT_SPEC.md) — required product behavior, scope, and V1 acceptance criteria.
- [Architecture and Implementation Plan](docs/ARCHITECTURE.md) — approved V1 boundaries and the implementation status of the safe Repository Map vertical slice.
- [Architecture Decision Records](docs/adr/) — accepted runtime, parser, and local-storage decisions with alternatives and consequences.
- [Benchmark](docs/BENCHMARK.md) — evaluation protocol, metric definitions, targets, and current not-run status.
- [Agent Instructions](AGENTS.md) — durable rules for coding agents working in this repository.
- [Original Master Specification](CONTEXTFORGE_MASTER_SPEC.md) — preserved source material.

The next planned engineering phase is **Phase 2 — Language Analysis and Durable Index**, defined in `docs/ARCHITECTURE.md`. It is not part of the current implementation.
