# ContextForge

**Status: Phase 0–3 implemented — Safe Repository Map, Durable Language Index, and Repository Graph**

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

ContextForge now safely discovers a repository, parses approved JavaScript/JSX, TypeScript/TSX, and Python files with packaged Tree-sitter WASM grammars, extracts symbols and imports, resolves bounded repository-local imports, derives explainable test/documentation relationships, collects optional bounded Git signals, and atomically activates one durable SQLite generation. Text and JSON inspection expose indexed structure without storing full source content.

Task understanding, candidate retrieval, ranking, graph expansion for tasks, token budgeting, Context Packs, benchmark scoring, MCP, remote providers, and a web UI remain **NOT IMPLEMENTED**.

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
node dist/cli/main.js index .
node dist/cli/main.js inspect src/services/memory.ts . --json
node dist/cli/main.js graph src/services/memory.ts . --json
```

To verify the installable artifact without publishing it:

```text
npm run package:smoke
```

That smoke test runs `npm pack`, installs the tarball into a fresh temporary project, and invokes the installed `contextforge` binary. It does not publish the package.

## Language analysis and index behavior

`contextforge index [repository]` starts from the Safe Repository Map; no parser or import record can bypass its ignore, sensitive-file, binary, size, encoding, or repository-boundary decisions. JavaScript and JSX use the packaged JavaScript grammar; TypeScript, TSX, and Python use distinct packaged grammars. Runtime and grammar initialization is centralized and cached. A syntax-error tree is retained as `degraded` with a bounded diagnostic when Tree-sitter can still recover structure. Missing or checksum-invalid required grammar assets fail the command explicitly.

Symbols include deterministic repository-relative IDs, qualified names such as `MemoryService.finalizeRun`, kind, parent identity, export/public metadata where structural evidence exists, and one-based line/UTF-8-byte-column ranges. Imports retain the raw module specifier, import kind, useful names, and source range. V1 currently recognizes static JavaScript imports, side-effect imports, common `require`, dynamic `import`, re-exports, and Python `import`/`from ... import`; it deliberately does not resolve them to repository files or construct a graph.

The local database is `.contextforge/index.sqlite`, and `.contextforge/` remains a non-negatable built-in scan exclusion. SQLite runs with WAL, foreign keys, defensive mode, disabled extension loading, and a bounded writer timeout. One `BEGIN IMMEDIATE` transaction writes and validates a complete generation, marks it complete, changes `active_generation_id`, and commits. A failure before commit rolls back the generation and leaves the old active snapshot visible. Readers keep their old WAL snapshot through a concurrent activation. A second writer returns `INDEX_BUSY` after the bounded timeout.

Every eligible text file is hashed with SHA-256. A later index reuses analysis only when the repository-relative path, content hash, and analysis version match; changed and added files are parsed, deleted files disappear from the new complete snapshot. Metadata such as size and mtime is retained for inspection but is never trusted instead of the content hash. Files that keep changing after one bounded retry are recorded as failed without aborting the rest of the generation.

`contextforge inspect <relative-path> [repository] [--json]` is a read-only proof/diagnostic command over the active SQLite generation. It is not task-aware search or ranking. The database stores metadata, hashes, ranges, symbols, imports, and bounded diagnostics—not full source content.

## Repository Graph and signals

`contextforge index` derives Phase 3 data after language analysis and before the same generation is activated. Import resolutions, graph edges, Git signals, files, symbols, and raw imports therefore share one transaction and generation. A graph derivation or persistence failure rolls back the new generation and preserves the prior complete active snapshot.

The graph persists only bounded file relationships: internal imports, related tests, and related documentation. File containment and symbol parentage reuse normalized Phase 2 records; reverse dependencies are queried from forward import edges. Every relationship has a stable repository-relative identity, type, confidence, derivation, and evidence. Structural facts use confidence `1.0`; heuristic test/documentation relationships remain labeled and ambiguous matches do not become high-confidence edges.

JavaScript/TypeScript resolution supports common repository-relative source extensions, directory `index` files, and explicit NodeNext compiled-extension mappings such as `.js` to a unique `.ts`/`.tsx` source candidate. Python resolution supports common repository-root packages with `__init__.py` and explicit relative imports. Every raw import is retained as `resolved_internal`, `external`, `unresolved`, `ambiguous`, or `unsafe`; only a unique internal target creates an edge. Repository escapes are never read or linked.

Git collection is read-only, parameterized without a shell, bounded to the latest 100 commits, and optional. The graph remains valid with an explicit `unavailable` Git status outside Git or when Git fails. Per-file signals include tracked state, modified/added/deleted/untracked status, recent commit count, last commit hash, and timestamp. A deleted path is retained only when it was an approved safe file in the previous active generation; it remains an auxiliary Git signal and does not become a current Graph node.

Current limitations: TypeScript/JavaScript path aliases, package `exports`, complete compiler resolution, Python `sys.path` mutation, custom import hooks, comprehensive namespace packages, and non-literal dynamic imports are **NOT IMPLEMENTED**. Documentation relationship scanning is bounded to 2,000 approved documents or 16 MiB per generation. Phase 3 does not perform task retrieval or ranking.

`contextforge graph <relative-path> [repository] [--json]` reports outgoing and reverse imports, related tests, related documentation, import-resolution statuses, file symbols and symbol parents, and Git signals. Output contains no absolute repository path, ANSI state, SQLite identity, source text, or ranking score.

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
- [Architecture and Implementation Plan](docs/ARCHITECTURE.md) — approved V1 boundaries and implementation status through the Repository Graph vertical slice.
- [Architecture Decision Records](docs/adr/) — accepted runtime, parser, local-storage, and Repository Graph decisions with alternatives and consequences.
- [Benchmark](docs/BENCHMARK.md) — evaluation protocol, metric definitions, targets, and current not-run status.
- [Agent Instructions](AGENTS.md) — durable rules for coding agents working in this repository.
- [Original Master Specification](CONTEXTFORGE_MASTER_SPEC.md) — preserved source material.

The next planned engineering phase is **Phase 4 — Task Retrieval and Explainable Ranking**, defined in `docs/ARCHITECTURE.md`. It is not part of the current implementation.
