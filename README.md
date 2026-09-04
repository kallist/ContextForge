# ContextForge

**Status: ContextForge v0.2.0 — stable V1 CLI/MCP with internal experimental V2 intelligence**

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

ContextForge now safely discovers and indexes a repository, derives a generation-bound graph, retrieves explainable task candidates, and compiles selected current source into deterministic Markdown under a hard declared token-estimate budget. Packing reuses the Phase 4 ranking truth, prefers complete symbols and small whole files, allocates first-class instruction/code/dependency/test/documentation/configuration sections, verifies source hashes against one active generation, and records selections and bounded exclusions in a source-free manifest. Phase 6 adds a frozen, offline benchmark; Phase 7 exposes the same Index, Search, and Pack application behavior through a local MCP stdio adapter.

Remote MCP/HTTP, remote providers, model-specific tokenizers, nested-directory `AGENTS.md` scope, and a web UI remain **NOT IMPLEMENTED**. V1 retrieval and packing are transparent lexical/structural heuristics; embeddings, LLM reranking, synonym understanding, and Chinese-to-English semantic translation are not implied.

## Requirements

- Node.js `>=24.15 <25` (the repository pins Node 24.20.0 for development and CI)
- npm

## Release status

ContextForge v0.1.1 is the first public npm distribution, published as the scoped CLI package `@kallist/contextforge` under the MIT License. The v0.1.0 implementation was completed and tagged, but npm rejected its unscoped `contextforge` package name under the registry's package-name similarity policy. The distribution is a command-line application and local MCP stdio server; it does not promise a stable JavaScript library API or package `exports` surface.

Internal parser, SQLite, ranking, and packing modules may change between releases. Review the trust model and generated Context Packs before forwarding repository content outside your local trust boundary.

## Install

Use Node.js `>=24.15 <25`, then install the public package from npm:

```text
npm install -g @kallist/contextforge
contextforge --version
```

To verify this exact release, install `@kallist/contextforge@0.2.0`. The executable remains `contextforge`. Publication and verification status are recorded in the [V0.2 release report](docs/V0.2_RELEASE_REPORT.md).

Index a repository and produce task-aware context:

```text
contextforge index /path/to/repository
contextforge search "fix stale index activation" /path/to/repository --json
contextforge pack "fix stale index activation" /path/to/repository --budget 8000 --out context.md
```

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
node dist/cli/main.js search "fix memory disable race condition" .
node dist/cli/main.js search "MemoryService.finalizeRun" . --limit 20 --json
node dist/cli/main.js pack "fix memory disable race condition" . --budget 8000
node dist/cli/main.js pack "fix memory disable race condition" . --budget 8000 --json
node dist/cli/main.js pack "fix memory disable race condition" . --budget 8000 --out context.md
node dist/cli/main.js mcp --repository .
```

A minimal source-checkout quickstart is:

```text
npm ci
npm run build
node dist/cli/main.js index .
node dist/cli/main.js search "fix stale index activation" . --json
node dist/cli/main.js pack "fix stale index activation" . --budget 8000 --out context.md
```

For source-checkout packaging validation, create a tarball with `npm pack`, install that tarball into a clean temporary project, and run its `contextforge` bin. `npm run package:smoke` performs this complete flow automatically and deletes its temporary files.

To verify the installable artifact without publishing it:

```text
npm run package:smoke
```

That smoke test runs `npm pack`, installs the tarball into a fresh temporary project, exercises the installed CLI and packaged parsers/SQLite, then connects an official MCP client to the installed stdio server for `status`, `index`, `search`, and `pack`. It does not publish the package.

For release-candidate validation, `npm run release:hardening` exercises installed-package OS processes, crash recovery, SQLite integrity, multiple MCP servers, determinism, a 1,200-file synthetic repository, and a 1,000-request MCP soak. `npm run release:check` composes the technical gates but never pushes, tags, publishes, or creates a release. The frozen full benchmark remains a separate `npm run benchmark` gate.

## MCP integration

After building, start one local stdio server bound to one repository:

```text
node /absolute/path/to/ContextForge/dist/cli/main.js mcp --repository /absolute/path/to/repository
```

The global npm installation provides `contextforge mcp --repository <path>`. An MCP-compatible host should configure that executable and its arguments, use stdio as the transport, and leave stdout to protocol traffic.

The server uses the official split TypeScript SDK (`@modelcontextprotocol/server` 2.0.0), supports its modern `2026-07-28` negotiation and legacy initialization compatibility, and exposes four tools:

- `status` reports `MISSING`, `CURRENT`, `STALE`, or `PARTIAL` without source or absolute paths.
- `index` explicitly mutates only `.contextforge` runtime index state; it does not change repository source or Git.
- `search` is a bounded read-only view of production `contextforge-structural-v1` results.
- `pack` returns the production hard-budget Markdown once in MCP text content, with source-free compact metadata in structured content.

Repository binding is resolved once at startup. Tool calls cannot redirect the server to another root, and Search/Pack never auto-index. A stale Pack remains explicitly `PARTIAL` and excludes source that no longer matches the active generation. The declared budget covers the ContextForge Markdown payload under `contextforge-generic-v1`, not MCP wire framing or a model-specific tokenizer.

Stdio inherits the permissions of the local host process; it is not remote authentication or an OS filesystem sandbox. ContextForge adds no network listener, telemetry, command-execution tool, arbitrary-file tool, Resources, or Prompts. Official-client stdio interoperability is tested, but actual Codex, Claude Code, Cursor, paid-agent task success, and remote MCP hosts are **NOT TESTED**.

## Offline benchmark evidence

### V0.2 experimental intelligence

V0.2 adds deterministic TaskAnalysis, hybrid evidence fusion and lexical symbol ownership, bounded relationship intelligence, and an experimental ContextPlan/Pack V2 pipeline. The selected experimental candidate is `contextforge-v2-plan-pack`. It remains **internal only**: there is no public V2 CLI flag or MCP strategy field. Search and Pack continue to use **V1 by default**.

The final comparison contains six systems, 24 frozen tasks, four repositories and five budgets (720 cases). At 8K, the selected candidate has required-symbol recall 0.886364 versus V1's 0.863636 and Overall Gold recall 0.899802 versus 0.870866. Required-file recall is unchanged at 0.916667. It retains 36/39 pre-Pack-present required symbols versus the relationship candidate's Pack V1 result of 35/39, and preserves the 19 V1 successes with no new misses.

Evidence remains mixed: the candidate has weaker 2K symbol recall and weaker 16K/32K file recall than the V2 Pack V1 alternatives; precision is weaker outside 8K versus the relationship alternative. Task-aware planning is not proven stably superior. The 0.900 required-symbol design target is not met. **Coding-agent success was not measured.** See [final evaluation](docs/V0.2_FINAL_EVALUATION.md) for all budgets, failures, measured performance and exact claim boundaries.

### Preserved V1 evidence

`contextforge-benchmark-v1` contains 24 frozen Gold tasks across a pinned ContextForge revision and curated TypeScript, Python, and mixed-language repositories. It runs offline against `lexical-full-file-v1`, `structural-full-file-v1`, and the production `contextforge-v1` path at 2K, 4K, 8K, 16K, and 32K estimator-token budgets.

The first formal run is published in [Benchmark Results V1](docs/BENCHMARK_RESULTS_V1.md). It shows mixed evidence rather than a blanket win: at 8K, ContextForge reached 0.917 required-file recall, 0.864 required-symbol recall, and 0.193 Gold-range precision; structural ranking alone underperformed the lexical baseline on this dataset, while production packing recovered recall and precision relative to structural whole-file packing. At matched required-symbol recall, paired macro token reductions were 1.5% versus lexical whole-file and 7.8% versus structural whole-file—well below the 60% product target. These figures describe this finite benchmark only, not coding-agent success or a general token-savings claim.

```text
npm run benchmark:validate
npm run benchmark:smoke
npm run benchmark
npm run benchmark:performance
```

## Language analysis and index behavior

`contextforge index [repository]` starts from the Safe Repository Map; no parser or import record can bypass its ignore, sensitive-file, binary, size, encoding, or repository-boundary decisions. JavaScript and JSX use the packaged JavaScript grammar; TypeScript, TSX, and Python use distinct packaged grammars. Runtime and grammar initialization is centralized and cached. A syntax-error tree is retained as `degraded` with a bounded diagnostic when Tree-sitter can still recover structure. Missing or checksum-invalid required grammar assets fail the command explicitly.

Symbols include deterministic repository-relative IDs, qualified names such as `MemoryService.finalizeRun`, kind, parent identity, export/public metadata where structural evidence exists, and one-based line/UTF-8-byte-column ranges. Imports retain the raw module specifier, import kind, useful names, and source range. V1 currently recognizes static JavaScript imports, side-effect imports, common `require`, dynamic `import`, re-exports, and Python `import`/`from ... import`; Phase 3 resolves the bounded repository-local subset described below.

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

## Task retrieval and explainable ranking

Run `contextforge index .` first, then use `contextforge search "<coding task>" [repository] [--limit <n>] [--json]`. Search is read-only: it never auto-indexes or changes the active generation. Empty tasks and tasks over 16 KiB are rejected; camelCase, PascalCase, snake_case, kebab-case, dotted identifiers, paths, filenames, technical literals, numbers, and CJK terms are normalized deterministically. Coding verbs such as `disable`, `retry`, `rollback`, and `lock` retain value, while generic words such as `fix` are downweighted rather than silently deleting the rest of the query.

`contextforge-structural-v1` ranks one file envelope per path, preserving matched symbol ranges without separate file/symbol ranks. Exact qualified symbols, paths, symbols, basenames, source literals, identifier/path/import components, imports, reverse imports, tests, documentation, and weak generation-bound Git signals contribute visible relative points. Identity, lexical, structural, per-query-term, and Git caps prevent repetition and recency from dominating. Graph expansion is bounded to 24 seeds, depth 2, 24 neighbors per node, and 128 new files; degree-aware damping suppresses common `utils`, README, and test-helper hubs. Scores are relative relevance points, not probabilities.

Source lexical matching does not store source or source-derived term rows in SQLite. Search reads bounded current bytes and accepts lexical evidence only when their SHA-256 equals the selected active generation. A mismatch reports `STALE`, excludes those bytes, and preserves generation semantics. The scan is capped at 10,000 files/64 MiB; reaching the cap reports `PARTIAL` rather than claiming complete freshness. Pure synonyms, semantic paraphrases, fuzzy spelling, and Chinese-to-English code mapping remain limitations.

## Token budget and Context Packing

`contextforge pack "<coding task>" [repository] --budget <tokens>` invokes the same `contextforge-structural-v1` Search use case, then applies `contextforge-pack-v1`. The default stdout artifact is Markdown and the budget covers that complete serialized payload, including task text, headings, paths, reasons, and dynamically sized code fences. `--json` emits the deterministic source-free manifest; manifest bytes are audit metadata and are not included in the Markdown budget. `--out <path>` publishes either artifact atomically and refuses to overwrite an existing file.

The built-in `contextforge-generic-v1` estimator (version `1.0`) is deterministic, local, and deliberately conservative for code and multilingual text. It is not a model tokenizer, so the hard guarantee is relative to the estimator and version named in the manifest. If the format envelope plus one useful primary unit cannot fit, Pack returns `BUDGET_TOO_SMALL` instead of emitting malformed or misleading context.

Pack reads, hashes, and slices each selected file from one in-memory source string. Bytes that no longer match the active generation are excluded and reported; a concurrent index activation cannot mix generations. Root `AGENTS.md` is included whole when small and heading-selected when large. Nested scoped instruction discovery, semantic program slicing, model tokenizers, persisted packs, and automatic output overwrite are **NOT IMPLEMENTED**.

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

## Trust model and release limitations

ContextForge reads local repository content with the permissions of the invoking user and returns selected content to that local CLI user or MCP host. Repository source, documentation, tasks, Git output, parser data, and tool input may be untrusted. ContextForge does not execute repository source, expose shell or arbitrary-file MCP tools, upload repository data, start a network listener, or collect telemetry. It stores derived metadata and hashes in `.contextforge/index.sqlite`, not full source or task history.

Sensitive filenames and ignored paths are excluded before retrieval, but ContextForge cannot guarantee detection of every inline secret inside otherwise eligible source. Generated Context Packs can contain untrusted instructions from repository files and must be reviewed before forwarding outside the local trust boundary. SQLite WAL state is supported only on a local filesystem; UNC and network filesystems are unsupported.

Known V0.1 limitations include the generic non-model tokenizer, weak pure-synonym/semantic retrieval, incomplete TypeScript alias/package-exports and advanced Python import resolution, one repository per MCP process, no auto-index, and no real coding-host task-success evidence. Structural ranking underperformed lexical ranking in aggregate retrieval on benchmark-v1; the published negative evidence is intentional.

## Project Documents

- [Product Specification](docs/PRODUCT_SPEC.md) — required product behavior, scope, and V1 acceptance criteria.
- [Architecture and Implementation Plan](docs/ARCHITECTURE.md) — approved V1 boundaries and implementation status through local MCP integration.
- [Architecture Decision Records](docs/adr/) — accepted runtime, parser, local-storage, graph, ranking, packing, benchmark, and local MCP decisions.
- [Benchmark](docs/BENCHMARK.md) — frozen evaluation protocol, metric definitions, reproduction commands, and evidence boundary.
- [Benchmark Results V1](docs/BENCHMARK_RESULTS_V1.md) — reviewed formal quality and environment-specific performance results.
- [V0.2 Retrieval Research](docs/V0.2_RETRIEVAL_RESEARCH.md) — frozen-benchmark failure analysis across all 24 tasks; preserves the pre-implementation evidence.
- [Retrieval V2 Design](docs/V0.2_RETRIEVAL_DESIGN.md) — TaskAnalysis, ContextPlan, hybrid-retrieval contracts, implemented V0.2-02 boundary, and deferred Pack V2 work.
- [V0.2 Retrieval Foundation Results](docs/V0.2_RETRIEVAL_FOUNDATION_RESULTS.md) — frozen four-system V0.2-02 quality, ablation, performance, regression, and compatibility evidence.
- [V0.2 Relationship Linking Results](docs/V0.2_RELATIONSHIP_LINKING_RESULTS.md) — frozen five-system V0.2-03 relationship, failure, ablation, performance, and limitation evidence.
- [Plan-aware Packing Results](docs/V0.2_PLAN_AWARE_PACKING_RESULTS.md) — experimental six-system evaluation, preserved failures and performance closeout; mixed quality evidence, with public defaults remaining V1.
- [Release Checklist](docs/RELEASE_CHECKLIST.md) — v0.1.1 technical, legal, hosted, and explicitly authorized release gates.
- [V0.1.1 Release Notes](docs/RELEASE_NOTES_V0.1.1.md) — scoped-package correction, V0.1 behavior, evidence, trust model, and limitations.
- [V0.1.0 Release Notes](docs/RELEASE_NOTES_V0.1.md) — historical tagged-candidate record; public npm publication did not complete.
- [Security Policy](SECURITY.md) and [Contributing Guide](CONTRIBUTING.md) — reporting and contribution boundaries.
- [Agent Instructions](AGENTS.md) — durable rules for coding agents working in this repository.
- [Original Master Specification](CONTEXTFORGE_MASTER_SPEC.md) — preserved source material.

Phase 8 technical hardening is implemented. No merge, tag, GitHub Release, or npm publication is implied; public release remains blocked until the explicit license and version decisions in the release checklist are resolved.
