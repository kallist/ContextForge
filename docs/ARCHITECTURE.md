# ContextForge V1 Architecture

## Status

**APPROVED V1 DESIGN — PHASES 0–5 IMPLEMENTED**

This document defines the approved V1 component boundaries, technology baseline, core data, algorithms, consistency model, and implementation phases. Phase 0 and Phase 1 provide the Safe Repository Map; Phase 2 provides packaged structural parsers and a durable generation-based SQLite index; Phase 3 provides the generation-bound Repository Graph and structural signals; Phase 4 provides task normalization, retrieval, bounded graph expansion, and explainable ranking; Phase 5 provides hard-budget semantic Context Packing. Phase 6 and later product modules remain planned, not implemented.

The product behavior remains authoritative in `PRODUCT_SPEC.md`. Benchmark definitions remain authoritative in `BENCHMARK.md`. Significant technology choices are recorded in `docs/adr/`.

## Repository Audit

Audit dates: 2026-08-29 (initial) and 2026-08-30 (Phases 2–5).

### Current State

- This directory is the designated ContextForge project root.
- At the start of this architecture task it was not a Git repository and contained no hidden configuration. Git is initialized during this task on branch `main`, with no commit or remote.
- The initial audit described the pre-implementation repository. The current repository contains the TypeScript CLI, application/core boundaries, filesystem/Tree-sitter/SQLite adapters, packaged WASM assets, fixtures/tests, npm configuration, and hosted workflow.
- As of 2026-08-30, Phase 0–5 are implemented and locally exercised on Windows. Benchmark fixtures/results, MCP, remote providers, and release artifacts remain absent.

### Existing Assets

- `AGENTS.md`: durable engineering rules.
- `docs/PRODUCT_SPEC.md`: product behavior and V1 acceptance criteria.
- `docs/BENCHMARK.md`: metrics, integrity rules, and `NOT RUN / NOT TESTED` status.
- `CONTEXTFORGE_MASTER_SPEC.md`: preserved reference source.
- `README.md`: truthful project entry point.

### Audited Environment

The host environment remains Windows x64 (`Microsoft Windows 10.0.26200`) with PowerShell 7.6.4 and Git 2.40.1. Its default Node is 24.10.0, below the accepted SQLite gate. Phase 2 validation uses an official portable Node 24.20.0 archive after verifying the published SHA-256; no engine requirement is weakened. Python is available only through the Windows launcher (3.10.6). Rust/Cargo, a standalone SQLite CLI, Clang, CMake, and Make are not required.

This environment demonstrates why consumer-side native compilation must not be required. Commands run with the default Node 24.10 remain outside the accepted storage baseline; Phase 2 SQLite evidence is valid only for the verified Node 24.20.0 runs.

### Hard Constraints

- Local-first, offline core; no source upload, telemetry, analytics, or mandatory external API.
- Cross-platform Windows/macOS/Linux CLI installation.
- Repository boundary and secret protection before relevance scoring.
- Real parsing for TypeScript, JavaScript, and Python with per-file graceful degradation.
- Explainable, deterministic-where-practical retrieval and ranking; no default LLM, embedding, or ML ranking.
- Token budget is a first-class hard constraint under the declared estimator.
- Atomic active-index publication and safe `index + index` / `index + pack` behavior.
- Production-path tests and honest, reproducible offline benchmarks.
- MCP is a deferred adapter and cannot own core behavior.

### Remaining Foundations

- hosted execution evidence for the committed Ubuntu/Windows/macOS CI workflow;
- macOS package and filesystem validation;
- benchmark fixtures and harness.

### Principal Risks

- Tree-sitter WASM runtime/grammar ABI mismatch, asset path resolution, package size, and slower parsing than native bindings.
- Node's synchronous, release-candidate built-in SQLite API changing or blocking excessively if transaction work is not bounded.
- WAL is not suitable for network filesystems and permits only one writer.
- Windows path case, drive letters, junctions/symlinks, file locking, reserved names, and executable shims.
- npm packages accidentally omitting WASM assets or relying on Unix postinstall commands.
- Generic token estimates diverging from a specific model tokenizer.
- MCP protocol/SDK evolution before the deferred integration phase.
- Benchmark fixtures that are too easy, circularly labeled, or not redistributable.

## Technology Baseline

| Concern | V1 decision | Rationale |
|---|---|---|
| Runtime | Node.js 24.15+ LTS (`<25`) | Supported production LTS; SQLite is release-candidate from 24.15; cross-platform npm distribution |
| Primary language | Strict TypeScript, ESM | Strong domain contracts and fit with CLI/MCP ecosystem; one runtime |
| Package manager | npm with committed lockfile | Ships with Node; no monorepo/bootstrap requirement |
| CLI | `node:util.parseArgs` plus thin command router | Expected commands do not yet justify a framework dependency |
| Parser | `web-tree-sitter` with packaged, pinned WASM grammars | Real ASTs without consumer native compilation |
| Languages | JavaScript/JSX, TypeScript/TSX, and Python grammar adapters; structured text fallback | Matches V1 product scope |
| Storage | Built-in `node:sqlite`, WAL, index generations | Transactions, local indexed lookup, atomic activation, no addon |
| Token estimation | `TokenEstimator` port; built-in `contextforge-generic-v1`; model-specific plugins deferred | Transparent and model-agnostic with no heavy tokenizer dependency |
| Testing | `node:test` on compiled JS; subprocess CLI E2E | Stable built-in runner, minimal toolchain |
| Build/typecheck | `tsc`; package compiled JS, declarations, WASM assets | Ordinary auditable npm package |
| Lint | ESLint with TypeScript rules | Explicit static quality gate |
| MCP | Deferred stdio adapter using the stable official TypeScript SDK at implementation time | Keeps protocol churn and transport out of core |

See ADR-001 through ADR-004 for alternatives and consequences.

## Dependency Direction

```text
CLI Adapter (MAP/INDEX/INSPECT/GRAPH)          MCP Adapter (DEFERRED)
          \                                        /
           └──────── Application Use Cases ───────┘
                              │
        ┌─────────────────────┼────────────────────────┐
        │                     │                        │
   Discovery/Index        Search/Explain          Build Pack
        │                     │                        │
        └─────────────────────┼────────────────────────┘
                              ▼
Core Domain + Policies
  ├── Task/query normalization
  ├── Candidate retrieval and explainable ranking
  ├── Bounded repository-graph expansion
  ├── Symbol/file-range selection
  ├── Token budgeting and section allocation
  └── Context packing and manifest construction
                              │ ports
        ┌───────────────┬─────┴─────────┬────────────────┐
        ▼               ▼               ▼                ▼
 Repository Access  Parser Adapters  Index Storage   Token Estimator
        │               │               │
  Filesystem/Git    Tree-sitter WASM  node:sqlite
```

The Core and Application layers must not import CLI, MCP, UI, `node:sqlite`, Tree-sitter, or concrete filesystem/Git implementations. Adapters implement inward-facing ports. CLI and future MCP code may translate input/output and errors but may not duplicate retrieval, ranking, budgeting, or security policy.

## Proposed Source Layout

The Phase 0–5 subset now exists; benchmark and MCP adapters remain planned:

```text
src/
  cli/
  application/
  core/
  adapters/
    filesystem/
    git/
    parser/
    sqlite/
    token/
test/
  unit/
  integration/
  security/
  e2e/
    parser/assets/
benchmarks/
```

Use folders to enforce meaningful dependency boundaries, not to create one-file interfaces or a large class hierarchy.

## Application Use Cases

- `MapRepository`: safely discover and summarize eligible repository content.
- `BuildIndex`: create and atomically activate one repository index generation.
- `InspectRepositoryGraph`: query one active generation's forward/reverse imports, containment, tests, documentation, import statuses, and Git signals without ranking.
- `SearchRepository`: retrieve explainable candidates without packing.
- `BuildContextPack`: run the full task-aware selection and hard-budget pipeline.
- `ExplainContext`: expose scores, reasons, exclusions, and budget decisions from a manifest.
- `RunOfflineBenchmark`: invoke production use cases for versioned benchmark cases.

CLI commands are adapters over these use cases. MCP later maps tools onto the same use cases.

## Core Domain Contracts

These are conceptual records and invariants, not a required one-class-per-row design.

| Concept | Essential data | Invariants |
|---|---|---|
| `RepositoryFile` | canonical relative path, language/kind, size, hash, timestamps, safety state | Path is normalized relative to one validated root; unsafe content never becomes selectable |
| `Symbol` | stable generation-local ID, name, kind, file, byte/line range, parent, export state, language | Range is valid for the hashed file; fallback text never fabricates a symbol |
| `GraphEdge` | from/to node, relation, evidence, confidence | Both nodes belong to the same generation; relation set is bounded and typed |
| `RepositoryIndex` | repository identity, generation, status, file/symbol/edge sets, diagnostics | Only a completed generation may be active |
| `TaskQuery` | original task, normalized terms, paths, identifiers, error fragments | Original text is preserved; normalization is deterministic and inspectable |
| `ContextCandidate` | file/symbol/range identity and gathered signals | Candidate is safe and belongs to the selected generation |
| `SelectionReason` | signal kind, evidence, contribution, source candidate | Contribution is reproducible and sufficient to explain the score |
| `RankedCandidate` | candidate, base/final score, reasons, graph distance | Stable tie-break is canonical path, then range/symbol ID |
| `TokenBudget` | requested units, estimator ID/version, reserved overhead | Non-negative; final payloads cannot exceed it under that estimator |
| `ContextSection` | section kind, selected non-overlapping excerpts, estimated cost | Required minimum and category policy are explicit; duplicate source ranges are merged |
| `ContextPack` | task, repository overview/instructions, primary/dependency/test/doc/Git sections | Human and JSON outputs describe the same selected context |
| `ContextManifest` | repository/generation identity, budget usage, selections, reasons, bounded exclusions, versions | Contains enough evidence to inspect and reproduce the decision without leaking secrets |

## Core Context-Selection Pipeline

### 1. Query Normalization

- **Input:** raw task text and optional explicit paths/symbols.
- **Output:** `TaskQuery` with normalized words, casing variants, path fragments, symbol-like tokens, and error fragments.
- **Signals:** exact forms retain greater weight; derived forms record their origin.
- **Failure:** empty or unusable task is a validation error; secret-like task fragments are redacted from diagnostics.
- **Complexity:** linear in bounded task length.
- **V1 limitation:** no LLM intent planner, semantic embedding, or learned synonym expansion.

### 2. Candidate Retrieval

- **Input:** `TaskQuery` and one active `RepositoryIndex` generation.
- **Output:** a bounded superset of `ContextCandidate` records.
- **Signals:** exact/normalized-component symbol, canonical path/segment, lexical content, instructions/docs, tests, and bounded Git relevance.
- **Failure:** missing active index is explicit; a degraded file can still match text but exposes no invented structural facts.
- **Complexity:** one generation-bound metadata read builds exact lookup maps, then uses capped result lists per signal; graph traversal starts only from bounded seeds and never performs per-term full-symbol scans.
- **V1 limitation:** transparent lexical/structural retrieval only.

Phase 4 implements source lexical retrieval as a bounded generation-verified working-tree scan. The application first loads one complete active generation, then reads only its currently safe text files. It hashes the actual bytes used for matching and accepts evidence only when the hash equals the indexed file hash. Changed bytes are excluded and reported as stale; search never auto-indexes. At most 10,000 files and 64 MiB are scanned, with direct metadata candidates first and remaining paths in stable order. Reaching the bound reports partial verification. No source or source-derived lexical terms are stored in SQLite, so schema version 2 remains unchanged. See ADR-005.

### 3. Primary Candidate Ranking

- **Input:** retrieved candidates and direct evidence.
- **Output:** deterministically ordered primary `RankedCandidate` records with `score` and `reasons[]`.
- **Signals:** the scoring model below; each contribution is capped by signal family.
- **Failure:** a candidate without supported evidence is excluded rather than assigned an unexplained score.
- **Complexity:** linear in the bounded candidate set plus deterministic sort.
- **V1 limitation:** fixed configurable weights, not machine-learned ranking.

### 4. Bounded Graph Expansion

- **Input:** top primary candidates and the repository graph.
- **Output:** related imports, reverse dependencies, definitions, tests, and docs with origin/distance evidence.
- **Signals:** edge relation, source score, graph distance, edge confidence.
- **Failure:** malformed/dangling edges are diagnosed and skipped. Reaching any work bound returns a recorded truncation, not silent explosion.
- **Complexity:** bounded by `seed_count × max_neighbors × max_depth` and a global visited/work cap.
- **V1 limitation:** default depth 2; no compiler-complete call graph.

### 5. Candidate Re-ranking

- **Input:** primary and expanded candidates.
- **Output:** one deduplicated ordered set with direct and inherited reasons.
- **Signals:** direct score plus the best bounded graph inheritance; multiple paths add explanation but do not accumulate without cap.
- **Failure:** candidates that became stale or unsafe are removed and recorded.
- **Complexity:** linear merge plus deterministic sort.
- **V1 limitation:** fixed relationship bonuses and decay.

### 6. Symbol/File Range Selection

- **Input:** ranked candidates and current safe source content.
- **Output:** useful full-file or symbol/range units with imports/signatures/surrounding lines as needed.
- **Signals:** file size, symbol boundary, score density, shared imports, overlap, and category.
- **Failure:** hash mismatch produces stale-index handling; invalid ranges or unsafe decoding exclude the unit with a diagnostic.
- **Complexity:** linear in selected file content with capped candidates and file size.
- **V1 limitation:** syntactic ranges and bounded context, not program slicing.

### 7. Section-aware Budget Allocation

- **Input:** selection units, required overhead, section policies, and `TokenBudget`.
- **Output:** a feasible section plan or explicit `BUDGET_TOO_SMALL`.
- **Signals:** required status, rank, marginal value per estimated token, section minimums/caps, and redundancy.
- **Failure:** if task/instructions/manifest skeleton plus one minimum useful primary unit cannot fit, emit no misleading partial pack.
- **Complexity:** bounded greedy allocation within sections plus limited redistribution; no unbounded knapsack search.
- **V1 limitation:** deterministic heuristics rather than an optimal global solver.

### 8. Context Packing and Manifest

- **Input:** section plan and selected current source units.
- **Output:** budgeted Markdown plus an alternative source-free JSON manifest.
- **Signals:** stable section order, source attribution, scores/reasons, exclusions, and estimator output.
- **Failure:** final over-budget serialization triggers deterministic eviction and rerender; serialization or safety failure emits no completed pack.
- **Complexity:** linear in final payload size with bounded rerender iterations.
- **V1 limitation:** static Markdown context delivery; JSON describes the decision but does not duplicate selected source.

## Implemented Explainable Ranking

Phase 4 versions the additive strategy as `contextforge-structural-v1`. These are implementation constants and regression-tested ordering semantics, not benchmark results:

| Direct signal | Proposed points |
|---|---:|
| Exact qualified symbol | 120 |
| Exact canonical path | 110 |
| Exact symbol | 100 |
| Exact basename | 82 |
| Exact technical source literal | 58 |
| Symbol component | 42 |
| Import/module metadata | 34 |
| Path component | 30 |
| Source lexical occurrence 1 / 2 / 3 | 28 / 8 / 4 |

Identity, lexical, structural, and Git families are capped at 150, 120, 65, and 5 points. One lexical query signal contributes at most 50 points. Git contributes only to an already direct/expanded candidate: dirty state is 2 points and bounded recency is at most 3.

Expansion uses at most 24 primary seeds, depth 2, 24 neighbors per node, 128 new files, and 256 final internal candidates. An inherited proposal is `seed score × 0.32 × distance decay × relation factor × edge confidence × hub damping`. Depth decay is 0.58 then 0.34; relation factors are import 0.72, reverse import 0.52, test 0.78, and documentation 0.38. Hub damping is `min(1, log2(3) / log2(2 + degree))`.

Rules:

- Exact evidence outranks weak lexical, structural, or Git signals.
- Per-term and family caps prevent repeated keywords, multiple graph paths, or high graph degree from dominating.
- One file envelope merges all evidence and retains up to 32 relevant symbols, avoiding file/symbol double counting.
- Unsafe, sensitive, binary, excluded generated/dependency state, or outside-root candidates are absent before scoring.
- Stable ordering uses final score descending, origin priority, file-category priority, then raw canonical path.
- Every accepted numeric contribution has a structured reason. `rawScore` is the additive sum within ordinary floating-point tolerance and is a relative relevance score, not a probability.
- Fuzzy matching, embeddings, LLM reranking, and learned weights are not implemented.

## Token Estimation and Hard-Budget Contract

`TokenEstimator` is a core port with `id`, `version`, and `estimate(serializedText)`.

V1's built-in `contextforge-generic-v1` estimator has no third-party tokenizer. After normalizing CRLF/CR to LF, it uses a documented conservative formula over UTF-8 content:

```text
ceil(non-newline ASCII bytes / 3)
+ ceil(non-ASCII UTF-8 bytes / 2)
+ logical line break count
+ one non-empty-input boundary marker
```

This is deterministic and intentionally conservative for code and multilingual text. It is not claimed to equal every model tokenizer. The hard-budget guarantee is exact **relative to the estimator named in the manifest**. Model-specific estimators are deferred plugins and must use the same port.

The complete rendered Markdown is the agent payload and is independently checked against the requested budget. The alternative JSON output is a deterministic, source-free manifest whose metadata size is outside that payload budget. Its exclusion list is bounded with aggregate counts so audit output cannot grow without limit. Neither artifact contains a timestamp.

Hard-budget enforcement:

1. reserve format/manifest overhead using an empty final render;
2. allocate semantic units using estimator costs;
3. render the complete Markdown payload;
4. estimate that serialized output;
5. if it exceeds the budget, evict the lowest marginal-value non-required unit, merge/shorten only at valid semantic line boundaries, and rerender;
6. stop after a bounded number of units; never byte-truncate JSON or source mid-line;
7. if required skeleton plus one useful primary unit cannot fit, return `BUDGET_TOO_SMALL` and no completed pack.

Benchmark token reduction must use the same estimator for baseline and ContextForge output.

## Section-aware Packing Policy

Safety filters and required repository instructions precede all allocation. Initial flexible shares of the remaining budget are:

| Section | Initial share | Policy |
|---|---:|---|
| Required task/repository context | fixed minimum, up to 10% | Task, applicable instructions, provenance, and minimum manifest overhead |
| High-value primary code | 45% | Highest-value symbols/ranges; protect at least one useful primary unit |
| Dependencies | 15% | Direct definitions/imports before reverse dependencies |
| Related tests | 15% | First-class evidence, not leftover filler |
| Architecture/documentation | 10% | Task-aware excerpts only |
| Configuration | 10% | Task-relevant configuration as code-adjacent context |
| Git context/headroom | remaining, up to 5% | Omit first when unavailable or weak |

Unused shares flow in priority order to primary code, tests, dependencies, then documentation. Shares are configurable and versioned but cannot bypass safety or the hard budget.

- Include a whole file only when small, strongly relevant, and cost-effective.
- Otherwise select complete symbols or valid line ranges plus minimal imports/signatures/surrounding context.
- Define a minimum useful unit per language adapter; do not include fragments that omit the matched construct.
- Merge overlapping/adjacent ranges and shared imports once per file.
- Deduplicate identical source ranges across relationship categories while retaining all reasons.
- Mark semantic shortening and omitted neighbors in the manifest.
- Do not use raw character truncation as normal packing behavior.

## Index Consistency and Incremental Model

### Generation Lifecycle

```text
active generation N remains readable
              │
BEGIN IMMEDIATE (single bounded writer)
              │
discover + hash current eligible files
              │
reuse unchanged records; parse changed files; omit deleted files
              │
resolve imports + derive bounded graph/docs/tests/Git signals
              │
validate generation N+1 graph, identities, foreign keys, and diagnostics
              │
mark N+1 COMPLETE + set active_generation_id = N+1
              │
COMMIT atomically
              │
bounded checkpoint and old-generation cleanup
```

- Database: `.contextforge/index.sqlite` on a local filesystem.
- Connection policy enables defensive mode and foreign keys, disables extension loading, sets bounded SQLite resource limits, and uses `journal_mode=WAL` plus a documented busy timeout.
- Only one writer is allowed. `BEGIN IMMEDIATE` either obtains the writer slot or fails after the timeout as `INDEX_BUSY`.
- Readers start a read transaction, capture `active_generation_id`, and see one historical snapshot throughout the use case.
- Any handled write failure explicitly rolls back. Process death before commit lets SQLite roll back and leaves generation N active.
- Hash every eligible file for correctness; reuse language analysis only on identical hash and compatible parser/index version. Rebuild derived Graph metadata from normalized generation records without reparsing unchanged files.
- Parser failure is recorded per file. Safe lexical fallback may be indexed; the generation can complete with a declared degraded-file count.
- Before output, rehash selected files. Changed/deleted files cause an explicit stale error or bounded refresh; stale ranges are never paired with new content.
- Cleanup keeps the active generation and one previous completed generation by default. Cleanup failure is diagnostic, not activation failure.

The first implementation may hold the generation transaction for the whole bounded index operation because it is the simplest crash-safe model. If measurements show unacceptable WAL size or writer duration, staged generations may be proposed in a new ADR; they are not prebuilt now.

## Repository and Security Boundary

- Resolve the root once; represent internal paths as normalized forward-slash relative paths while using Node path/file APIs for host access.
- Compare canonical/real paths using platform-aware rules. On Windows, handle drive letters, case-insensitive defaults, junctions, reserved names, and reparse points.
- Do not follow directory symlinks by default. A file symlink is eligible only if its resolved target remains inside the root and passes all filters; otherwise exclude it with a reason.
- Apply `.gitignore`, `.contextforgeignore`, built-in generated/dependency exclusions, sensitive-name rules, binary detection, encoding validation, and file/work limits before reading for parsing.
- Recheck path containment and file identity around reads to reduce race-time replacement risk.
- Never place source secrets in logs, diagnostics, manifests, benchmark artifacts, or SQLite. Diagnostics identify safe relative paths/reason codes without content excerpts.
- Treat repository instructions and source comments as data, never as commands executed by ContextForge.

## Cross-platform and Packaging Strategy

- Use Node `path`, `fs`, URL, and subprocess APIs; no shell-script dependency or path concatenation with `/` or `\`.
- Store canonical repository identities with `/`, converting only at the filesystem adapter.
- Package compiled ESM and declarations plus `web-tree-sitter.wasm` and four language WASM assets. Package-content tests install the produced tarball into clean temporary directories.
- Resolve assets through `import.meta.url`; never through process CWD.
- Do not run compiler/download scripts during `npm install` or `postinstall`.
- npm's `bin` entry supplies Unix shebang behavior and Windows command shims; CLI subprocess tests use platform-appropriate invocation.
- CI quality gates run on Linux; CLI/package/parser/storage smoke tests run on Windows, macOS, and Linux.
- Symlink tests detect platform capability and separately test path-policy logic so a platform permission limitation cannot silently remove boundary coverage.
- Use no Unix-only commands in npm scripts or CI steps.

## MCP Boundary and Timing

MCP remains `DEFERRED` until the CLI use cases, Context Pack schema, and explanation contract are stable and production-path E2E tests pass. Phase 7 adds a separate adapter, initially local stdio, mapping `repo_map`, `search_repository`, `build_context_pack`, and `explain_context` to application use cases.

At that phase, re-check the stable MCP specification and [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk). As of this architecture review, the official TypeScript SDK is Tier 1 and its V2 line uses split server/client packages; no SDK dependency is added now. MCP transport and schema types must remain outside Core.

## Minimal Hosted CI Design

Phase 0 creates workflow configuration but cannot claim a hosted pass until pushed to a host.

Quality job on Ubuntu with the latest Node 24 patch (minimum 24.15):

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke
npm pack --dry-run
```

The Phase 0 workflow runs the full lint, typecheck, test, build, CLI smoke, and package-install smoke gates on `ubuntu-latest` and `windows-latest` with Node 24.20.0. macOS and later parser/SQLite asset checks remain Phase 2/8 additions. All tests are offline by default. Paid-model or real-agent benchmarks are never merge gates.

## Implementation Phases

### Phase 0 — Project Foundation

Create the single npm package, Node/TypeScript engine policy, strict configs, source/test layout, build/lint/typecheck/test scripts, npm `bin`, local smoke command, package-content check, and minimal hosted workflow. No domain feature is considered complete here.

### Phase 1 — Safe Repository Map

Implement root resolution, safe walking, ignore policy, secret/binary/size/encoding classification, symlink/junction boundary defense, deterministic repository summary, and the `map` CLI. This is First Vertical Slice #1.

### Phase 2 — Language Analysis and Durable Index

**IMPLEMENTED.** Package and checksum-validate compatible Tree-sitter WASM assets; implement JavaScript/JSX, TypeScript/TSX, and Python normalized adapters; define the minimal SQLite schema; build generation-based cold/incremental indexing with content-hash reuse, atomic activation, parser diagnostics, and read-only inspection. Required parser-asset failure is explicit; per-file malformed source degrades without invented AST records.

The implemented symbol ID hashes repository-relative path, kind, qualified name, and same-name occurrence. Source range is deliberately excluded, so unrelated line insertions do not churn identity; inserting an earlier duplicate declaration with the same kind and qualified name can still renumber that duplicate set. Lines are one-based. Columns are one-based UTF-8 byte positions and the end column is exclusive, matching Tree-sitter's UTF-8 contract after conversion.

The implemented SQLite transaction holds one bounded generation build under `BEGIN IMMEDIATE`. This maximizes crash consistency and reader simplicity at the cost of one writer lock for the entire synchronous write. Real tests prove WAL activation, rollback at three injected boundaries, an old reader snapshot during activation, and a bounded `INDEX_BUSY` result for a second writer. Network/UNC WAL placement is rejected where detectable; mapped or otherwise opaque network filesystems remain a documented limitation.

### Phase 3 — Repository Graph and Signals

**IMPLEMENTED.** Resolve every raw import to `resolved_internal`, `external`, `unresolved`, `ambiguous`, or `unsafe`; persist unique internal import edges; derive explainable test and task-independent documentation relationships; and collect optional bounded, read-only Git signals. The Graph uses repository-relative stable identities and shares the Phase 2 generation/transaction/activation boundary.

File nodes are existing `indexed_file` rows and symbol nodes are existing `symbol` rows. File containment and symbol parentage remain normalized rather than duplicated as edges. Persisted file edges are limited to `FILE_IMPORTS_FILE`, `TEST_RELATES_TO_FILE`, and `DOCUMENT_RELATES_TO_FILE`; reverse dependencies are indexed queries over forward edges. Structural facts and heuristic relationships remain explicitly distinct through derivation, confidence, and evidence.

JavaScript/TypeScript resolution covers repository-relative literal imports/re-exports/require/dynamic imports, common source extensions, directory indexes, and unique NodeNext compiled-extension mappings. Python covers ordinary repository-root packages with `__init__.py` and explicit relative imports. Alias/compiler-complete resolution, advanced Python import machinery, and non-literal dynamic imports remain out of scope and become unresolved/external rather than guessed.

Graph derivation intentionally performs a full metadata rebuild per generation while Phase 2 parsing remains incremental. Documentation input is bounded to 2,000 approved files or 16 MiB, individual reference/module heuristics are capped, and Git history is bounded to 100 commits by default. `contextforge graph` remains inspection only; Phase 4 consumes this graph through the separate Search use case. See ADR-004.

### Phase 4 — Task Retrieval and Explainable Ranking

**IMPLEMENTED.** Normalize bounded untrusted tasks into exact and decomposed coding signals; retrieve file envelopes from path, basename, symbol, import/module, and generation-hash-verified source evidence; rank direct candidates; expand bounded imports, reverse imports, tests, and documentation with distance decay and hub damping; weakly rescore existing candidates with generation-bound Git data; and return deterministic text/JSON through `contextforge search`.

The implementation preserves symbol-level evidence and ranges inside one file result, uses additive reconstructible score contributions and versioned `contextforge-structural-v1` constants, reports stale/partial lexical verification, and never mutates the index. The source-free Phase 5 manifest now carries pack decisions, but a separate `contextforge explain` command remains deferred. Fuzzy retrieval is deliberately not implemented. See ADR-005.

### Phase 5 — Token Budget and Context Packs

**IMPLEMENTED.** `BuildContextPack` invokes Phase 4 Search and consumes its exact active snapshot; assigns instruction, primary, dependency, test, documentation, and configuration roles; builds progressively richer whole-file or semantic-range representations; allocates by versioned section policy; and verifies the complete Markdown render with `contextforge-generic-v1`. Exact over-budget output triggers bounded deterministic reduction, while an unusably small budget returns `BUDGET_TOO_SMALL` with no artifact.

Pack reads, hashes, and slices each candidate from the same source string. Hash mismatch, unsafe current-map state, or verification limits exclude content and make the manifest honestly partial. Root `AGENTS.md` is whole-file when small and fence-aware heading-selected when large. Output uses LF, terminal-safe control escaping, and a backtick fence longer than the longest run in source. `contextforge pack` supports Markdown stdout, source-free manifest JSON, and atomic exclusive `--out`; it never mutates the index or overwrites output. See ADR-006.

### Phase 6 — Offline Benchmark

Create licensed/versioned TypeScript, Python, and mixed-language cases with independently reviewed Gold Context. Run production paths and report recall, precision, token reduction, selected files, index/pack duration, and failures without fabricating targets.

### Phase 7 — MCP and Coding-Agent Integration

After core contracts stabilize, add the official stable TypeScript MCP SDK and a thin local-stdio adapter. Add transport/schema tests and coding-agent integration documentation; keep paid agent comparisons optional.

### Phase 8 — Hardening and Release Readiness

Run security/failure/concurrency E2E, package-install tests, performance measurement, Windows/macOS/Linux hosted matrix, documentation verification, independent review, and production CLI acceptance. Release work still requires explicit authorization.

## First Vertical Slice #1: Safe Repository Map

### Goal

Deliver the first real product loop:

```text
install/build local package
        ↓
contextforge map <repository>
        ↓
safe deterministic repository map (text or JSON)
```

This slice proves that the chosen package can run as a CLI and safely understand repository boundaries before parsers, storage, or ranking increase the attack surface.

### Scope

- Phase 0 package/build/test/lint/typecheck foundation and `contextforge` bin.
- `map [repository] [--json]` command using one application use case.
- Explicit directory input; Git root discovery when available; non-Git directory fallback.
- `.gitignore`, `.contextforgeignore`, built-in dependency/build exclusions, generated-file classification, and sensitive-name exclusions.
- Safe handling of binary, malformed encoding, oversized files, file changes, symlinks/junctions, and outside-root targets.
- Deterministic file list and aggregate counts by kind/language, with safe exclusion reason counts and no source content.
- Bounded limits and clear exit codes/errors.

### Non-goals

- `init`, parser/symbol extraction, SQLite, incremental index, graph, Git ranking, task query, search/ranking, token packing, Context Packs, benchmark implementation, MCP, remote providers, or product release.

### Likely Files/Modules

```text
package.json
package-lock.json
tsconfig.json
tsconfig.build.json
eslint.config.js
.github/workflows/ci.yml
src/cli/*
src/application/map-repository.ts
src/core/repository-map.ts
src/adapters/filesystem/*
test/unit/*
test/integration/*
test/security/*
test/e2e/*
```

Names may adjust during implementation, but dependency direction must remain.

### Required Tests

- unit: path normalization, ignore precedence, sensitive patterns, binary/encoding/size classification, deterministic ordering;
- security: traversal, outside-root symlink/junction, symlink loop, race-time replacement where reproducible, secret filenames;
- integration: Git and non-Git roots, `.gitignore` plus `.contextforgeignore`, deleted/changed file handling;
- CLI E2E: text/JSON outputs, invalid root, bounded errors, exit codes, paths containing spaces and Unicode;
- package smoke: pack/install tarball in a clean temporary directory and invoke the npm binary on Windows-compatible paths.

### Acceptance Criteria

- `npm ci`, lint, typecheck, tests, build, and local CLI smoke pass on a supported Node 24.15+ environment. The currently audited Node 24.10 installation requires a patch upgrade before this final gate.
- The built package executes `contextforge map` against a real temporary repository and produces stable text and JSON maps.
- No excluded secret, binary, outside-root, or oversized content is read into output.
- A non-Git directory works; invalid/outside roots fail safely.
- Output order and JSON schema are deterministic for identical input.
- No source upload, external API, runtime download, parser, database, or MCP dependency is introduced.
- Hosted CI remains separately reported; local success alone is not enough to call hosted CI passed.

### Risks

- Windows junction/symlink creation may require privileges; policy logic and capable-environment E2E both remain necessary.
- `.gitignore` semantics are subtle; use a maintained pure-JavaScript matcher rather than inventing partial glob behavior if the built-in platform lacks it.
- TOCTOU cannot be eliminated entirely; containment must be revalidated around file access and changes surfaced.
- A map can leak sensitive filenames even without content; sensitive entries should be counted by reason, not named in ordinary output.

## Independent Architecture Review

The design was challenged against the requested review questions.

- **Over-engineering:** The first slice excludes parser, SQLite, graph, ranking, and packing. Ports exist only at real I/O boundaries; no service mesh, plugin framework, worker pool, or polyglot runtime was added.
- **Not just code RAG:** The differentiator is safe repository structure, typed graph relations, tests/docs/Git signals, explainable scores, semantic ranges, and section-aware hard-budget packing—not split/search/top-k.
- **Structural retrieval:** Phase 3 supplies direct/reverse imports, containment, test/documentation relationships, and Git signals. Phase 4 now consumes them through bounded distance-aware, hub-damped expansion and keeps direct versus expanded origin explicit.
- **Explainability:** Every score contribution has a reason and evidence; caps and deterministic ties prevent opaque ranking.
- **Token budget:** The final Markdown agent payload is measured after rendering, with explicit failure when no useful pack fits; the source-free manifest is audit metadata outside that budget.
- **Benchmarkability:** Ranking versions, estimator versions, manifests, deterministic ordering, and production-path benchmark use make results reproducible.
- **Native installation pain:** Consumer-side native addons were removed by choosing packaged WASM grammars and Node's bundled SQLite. The remaining WASM ABI/asset risk is addressed with pinned versions and package smoke tests.
- **Windows:** Paths, npm shims, WASM asset resolution, junctions, Unicode/spaces, no shell scripts, and hosted matrix coverage are explicit.
- **Crash recovery:** One SQLite generation transaction plus atomic active-generation update leaves the prior generation visible after interruption.
- **MCP isolation:** MCP enters only after core/CLI stability and imports inward-facing use cases.
- **V2 contamination:** Embeddings, LLM ranking, learned context, dynamic delivery, native acceleration, and remote providers remain deferred.

Review-driven corrections: an earlier possibility of building WASM during consumer install was rejected. Grammar compilation is now a controlled maintainer/CI step, and published assets must be checksum/ABI validated. The hard-token claim was narrowed honestly to the estimator declared in each manifest; no generic estimator is presented as exact for every model. Finally, the Node baseline was raised from generic Node 24 to Node 24.15+ after the audited 24.10 runtime emitted an SQLite ExperimentalWarning and current Node 24 documentation showed release-candidate status beginning at 24.15.

## Implementation Status

| Area | Status |
|---|---|
| Architecture decisions and phase plan | IMPLEMENTED (documentation) |
| Package, TypeScript, quality gates, and npm bin | IMPLEMENTED / LOCALLY TESTED |
| Git repository and `.gitignore` | IMPLEMENTED |
| Repository discovery/product CLI | IMPLEMENTED / LOCALLY TESTED ON WINDOWS |
| Boundary, sensitive-file, binary, size, encoding, symlink/junction policies | IMPLEMENTED / LOCALLY TESTED ON WINDOWS |
| Parser and language adapters | IMPLEMENTED / LOCALLY TESTED ON WINDOWS |
| SQLite index and concurrency | IMPLEMENTED / LOCALLY TESTED ON WINDOWS WITH NODE 24.20.0 |
| Repository Graph, import resolution, tests/docs/Git signals, and graph CLI | IMPLEMENTED / LOCALLY TESTED ON WINDOWS WITH NODE 24.20.0 |
| Task retrieval, ranking, and bounded graph expansion | IMPLEMENTED / LOCALLY TESTED ON WINDOWS WITH NODE 24.20.0 |
| Token estimator and Context Pack | IMPLEMENTED / LOCALLY TESTED ON WINDOWS WITH NODE 24.20.0 |
| Benchmark harness/results | NOT IMPLEMENTED / NOT RUN |
| MCP adapter | NOT IMPLEMENTED / DEFERRED |
| Hosted CI workflow | IMPLEMENTED (Ubuntu/Windows/macOS matrix) / NOT RUN |
