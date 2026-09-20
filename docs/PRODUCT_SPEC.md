# RepoBound Product Specification

## Document Status and Authority

This document defines what RepoBound should do and why. It consolidates the product requirements from `CONTEXTFORGE_MASTER_SPEC.md` without claiming that they are implemented. Implementation status and design decisions belong in `ARCHITECTURE.md`; measurement procedures and results belong in `BENCHMARK.md`.

**Product status: V1 SPECIFIED — implementation status is tracked in `ARCHITECTURE.md`**

## Product Vision

V0.3 extends the compiler with an inspectable local control loop: Capsule history,
offline inspection and reproduction verification, semantic comparison, captured-fact
coverage/lint, localhost Studio, semantic human controls and immutable what-if
recompilation. All preserve source privacy, generation safety and the final declared
token-estimate budget. The [V0.3 product guide](V0.3_PRODUCT_GUIDE.md) defines current
operation semantics, boundaries and limits. This extension does not promote V2 or
promise coding-agent success. V0.4 adds the bounded, local change-aware
[Review Context product](V0.4_PRODUCT_GUIDE.md); its syntax/relationship evidence
does not establish runtime impact or review quality.

RepoBound is a local-first context compiler for coding agents. Given a repository, a coding task, and a token budget, it produces a task-aware Context Pack containing the smallest useful subset of repository information needed to understand and complete that task.

Its central promise is:

> Coding agents should not need your whole repository. They need the right context.

RepoBound is a task-aware context compiler, not merely another code-RAG application.

## Problem

Coding agents can be given too much repository content, consuming tokens and obscuring relevant facts, or too little, causing missed dependencies, tests, instructions, and design constraints. The useful subset varies by task and must fit a finite budget. Users also need to inspect why the product selected or excluded context rather than trusting an opaque retrieval result.

## Target Users

Primary users include:

- users of Codex, Claude Code, Cursor, Gemini CLI, and OpenCode;
- coding-agent developers and AI-assisted software engineers;
- developers working in medium or large repositories.

## Goals

For a supplied repository, task, and token budget, RepoBound should:

1. understand the repository structure;
2. identify task-relevant files and symbols;
3. expand bounded structural dependencies;
4. discover related tests and architecture documentation;
5. rank candidate context with inspectable reasons;
6. pack the most valuable context within the requested budget;
7. explain why important items were selected.

The primary objectives are to reduce unnecessary context and token use, preserve required task context, improve repository understanding, and make selection explainable.

## Success Definition

Every major V1 feature should materially help answer at least one of these questions:

1. Did RepoBound select the right context?
2. Did RepoBound use fewer tokens?
3. Can RepoBound explain why that context was selected?

Features that do not materially improve these outcomes should normally remain outside V1. Success is demonstrated through reproducible offline benchmarks and real product-path tests, not feature count or unsupported claims.

## Non-goals

V1 is not a coding agent, IDE, Cursor replacement, cloud code-hosting platform, SaaS collaboration system, autonomous coding system, automatic PR generator, or automatic code modification tool.

V1 does not require vector databases, external embedding APIs, OpenAI, Anthropic, Gemini, cloud infrastructure, Redis, Postgres, Elasticsearch, Kafka, or complex multi-agent systems. LLM-based reranking and embedding retrieval are deferred optional enhancements.

## Product Principles

V1 should be local-first, privacy-first, model-agnostic, CLI-first, explainable, benchmarkable, deterministic where practical, cross-platform, and open-source friendly. The core workflow must operate without an external LLM API.

## Core Workflow

```text
Coding Task
    ↓
Repository Discovery
    ↓
Repository Index
    ↓
Task Understanding
    ↓
Candidate Retrieval
    ↓
Bounded Structural Expansion
    ↓
Explainable Ranking
    ↓
Token Budgeting and Context Packing
    ↓
Context Pack
```

## Repository Discovery

RepoBound must discover repositories safely. Where practical, it should detect the repository root, Git repository, languages, source directories, tests, documentation, configuration, package managers, and frameworks.

Discovery must not require Git. When Git is unavailable, RepoBound must continue with reduced Git-derived signals.

## Repository Safety

All repository files and metadata are untrusted input. RepoBound must safely handle:

- symlink loops and symlink escape;
- path traversal and paths outside the repository root;
- huge, binary, generated, or minified files;
- malformed encodings;
- deleted files and files changing during indexing.

Files outside the repository root must not be read by default. Repository boundary enforcement must be testable.

## Ignore Rules

Discovery must respect `.gitignore` and `.contextforgeignore`. It should exclude common generated or dependency directories, including `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage`, `vendor`, `target`, `__pycache__`, `.venv`, and `venv`.

Ignore handling must coexist with the stricter sensitive-file exclusions described under Security.

## Language Support

V1 prioritizes TypeScript, JavaScript, and Python, including `.ts`, `.tsx`, `.js`, `.jsx`, and `.py`. Markdown, JSON, YAML, and similar files may receive structured text analysis. The product must allow future language adapters without making additional languages a V1 requirement.

## Symbol Extraction

For supported programming languages, RepoBound should extract useful structure where the language permits:

- functions, classes, and methods;
- interfaces and types;
- imports and exports;
- constants.

Useful symbol metadata includes name, kind, file, line range, parent, export state, and language. A parser failure in one file must not fail the repository index; fallback textual indexing should remain possible.

## Repository Graph

RepoBound should build a lightweight graph supporting useful relationships such as:

```text
File   → imports    → File
File   → contains   → Symbol
Symbol → defined in → File
Test   → relates to → Source
```

Symbol-reference relationships may be included only where they can be derived reliably. V1 does not aim to build a perfect compiler-level call graph; it aims to supply useful structural context for coding tasks.

## Test Discovery

Tests are first-class context. When source is selected, RepoBound should attempt to discover related tests through naming conventions, imports, references, and directory relationships. For example, `memory_service.py` may relate to `test_memory_service.py`, while `memory.ts` may relate to `memory.test.ts` or `memory.spec.ts`. Related tests should receive additional ranking weight.

## Documentation Discovery

RepoBound should recognize high-value repository instructions and architecture documents, including `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, `DESIGN.md`, `*_DESIGN.md`, ADR directories, `docs/`, and `CONTRIBUTING.md`. Selection must remain task-aware; the product must not blindly include an entire documentation tree.

## Git Intelligence

When Git is available, current branch, HEAD, recent commits, recently modified files, and relevant commit messages may inform ranking. Git data is an auxiliary signal, not the sole basis for relevance, and Git absence must not prevent the core workflow.

## Task Understanding

The task processor should derive retrieval signals from ordinary words, paths, symbol-like names, snake_case, camelCase, PascalCase, kebab-case, and error messages. For a task such as `Fix memory disable race condition`, signals might include `memory`, `memory_enabled`, `MemoryService`, `run.completed`, or `SELECT FOR UPDATE` when those forms are supported by repository evidence.

The V1 core does not require an LLM task planner.

## Candidate Retrieval

V1 candidate generation must combine at least lexical, path, symbol, dependency, test, documentation, and limited Git signals. Retrieval should intentionally produce a candidate set larger than the final budget; ranking and packing decide final inclusion.

## Explainable Ranking

Every candidate must have a score and human-inspectable selection reasons. Example reasons include a task keyword match, symbol match, structural relationship, or related test discovery. V1 should prefer transparent structural signals over opaque machine-learning ranking. Ranking weights should be configurable where practical.

Scores are comparative inputs to packing, not a substitute for budget allocation or safety rules.

## Graph Expansion

After primary candidates are found, RepoBound should perform bounded structural expansion to related definitions, dependencies, consumers, and tests. Expansion must prevent dependency explosion. Controls should include the equivalent of maximum depth, maximum neighbors, and score decay; their exact representation is an architecture decision.

## Symbol-level Context

Selecting a relevant file does not automatically require including the entire file. Where practical, RepoBound should extract symbols or line ranges and include necessary imports or surrounding code. Small relevant files may be included in full. Selected line ranges must be accurate and attributable to the source.

## Token Budget

The user-supplied token budget is a first-class, hard output constraint. Generated output must remain within it. Token estimation must be abstracted so model-specific tokenizers can be added later.

If a budget is too small to produce useful context, RepoBound must say so explicitly rather than silently emitting a broken or misleading pack.

## Budget Allocation

Packing should allocate space across task and repository instructions, repository overview, primary source, dependency context, tests, architecture documentation, and relevant Git signals. Allocation may vary by task type.

V1 must not rely only on a naive global score sort followed by appending content until the budget is exhausted. Safety exclusions and required repository instructions take precedence over ordinary ranking.

## Context Packing

Packing must choose the highest-value safe combination of full files, symbols, and line ranges within the budget. It should preserve enough surrounding structure to make excerpts understandable, avoid redundant content, and record material exclusions or truncation. Identical repository state, task, configuration, and RepoBound version should yield stable output where practical.

## Context Pack Format

The primary human-readable output is budgeted Markdown (commonly `context.md`); the machine-readable output is a source-free JSON manifest (commonly `context.json`).

A Context Pack should represent:

- the task and repository overview;
- repository instructions;
- primary context and dependencies;
- related tests;
- architecture or other relevant documentation;
- relevant Git signals;
- token usage;
- selection reasons.

The two formats must describe the same selection truth. Presentation differences must not conceal items or reasons.

## Context Manifest

The machine-readable output should contain enough metadata to inspect and reproduce a context build. The contract should cover:

- task and repository identity;
- active index generation and applicable Git context when available;
- requested budget and estimated tokens;
- selected files, symbols, and line ranges;
- scores and selection reasons;
- excluded candidates or material exclusions;
- active generation plus ranking, packing, and estimator identities.

The implemented Phase 5 manifest is deterministic and intentionally has no creation timestamp. It contains selection and exclusion metadata but no source content; its serialized size is therefore outside the Markdown agent-payload budget.

## CLI

V1 is CLI-first. Its expected capability surface includes:

```text
repobound init
repobound index
repobound map
repobound search "MemoryService"
repobound pack "Fix memory disable race condition"
repobound explain
repobound benchmark
repobound doctor
```

`map`, `index`, `inspect`, `graph`, `search`, `pack`, and the local `mcp` server command are implemented. The remaining commands are product expectations whose contracts may evolve during later phases.

## Incremental Indexing

The initial index may scan the full repository. Subsequent indexing should avoid unnecessary reparsing using file metadata, hashes where required, or Git state when available.

An interrupted write must not make a partial index active. The product must detect stale indexed data when files are deleted or changed and handle recovery without corrupting the prior usable state.

## Local Persistence

RepoBound may persist file metadata, hashes, symbols, graph relationships, and index metadata locally. It should not unnecessarily duplicate entire repository source files in persistent storage. Context Packs should normally read current source from the working tree, with stale-index cases handled explicitly.

The choice of persistence technology is not fixed by this product specification.

## Failure Handling

Expected failures include parser and database/storage failure, interrupted indexing, unavailable Git, deletion or modification during indexing, malformed configuration, and missing parsers. Individual-file failures should degrade gracefully where possible and remain observable. Unsafe or unusable results must fail explicitly rather than masquerade as complete output.

## Concurrency

RepoBound must safely handle concurrent `index + index` and `index + pack` activity. Index publication must be atomic from readers' perspective: no reader may observe a corrupted or half-completed active state. The implemented concurrency policy, retry behavior, and recovery boundary must be documented and tested.

## Privacy

Default behavior is:

```text
NO source upload
NO telemetry
NO analytics
NO mandatory external APIs
```

Any future external provider must be explicit, optional, and separated from the offline core.

## Security

Sensitive files must be excluded from Context Packs by default. Examples include `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`, `credentials*`, and `secrets*`. Sensitive content must not leak through Context Packs, persistent metadata beyond what is strictly necessary, logs, diagnostics, benchmark artifacts, or error output.

Security rules must be fail-safe and apply independently of relevance scores. V1 must prove secret exclusion and repository-boundary enforcement with security tests.

## MCP Integration

MCP is an integration layer, not part of the RepoBound core. The implemented local stdio adapter binds one repository at startup and exposes only `status`, explicit `index`, read-only `search`, and read-only `pack`. Tools cannot redirect repository scope, and Search/Pack do not auto-index.

The implementation uses the stable official split TypeScript SDK current at implementation time. MCP-specific code owns only runtime schemas, result/error translation, annotations, and transport lifecycle; it does not own discovery, retrieval, ranking, budgeting, packing, or SQLite behavior. Remote MCP/HTTP, multi-root operation, Resources, Prompts, and application-level cancellation propagation remain deferred.

## Coding Agent Integration

Coding agents should consume the same Context Pack and explanation contracts exposed by the core. Agent-specific adapters may translate transport or presentation, but must not silently change selected content, bypass security filters, exceed the budget, or create a mandatory dependency on a particular model vendor.

## Benchmark Requirements

V1 must include an offline benchmark suite with TypeScript, Python, and mixed-language coverage. Each case supplies a repository or fixture, task, gold files, gold symbols, optional gold documentation, and token budget. Required metric definitions and integrity rules are in `BENCHMARK.md`.

Paid or real-agent benchmarks may be useful later but must never be mandatory CI requirements.

## Testing Requirements

V1 should include unit, integration, failure-path, security, and CLI end-to-end tests. The suite must prove, at minimum:

- relevant context selection and irrelevant context exclusion;
- hard budget enforcement;
- secret exclusion and repository boundary enforcement;
- accurate line ranges;
- safe incremental indexing and atomic publication;
- graceful per-file parser degradation;
- runnable production CLI behavior.

Tests must assert behavior rather than echo implementation details. Relevant assertions and gates must not be weakened to hide failures.

## Performance Requirements

RepoBound must measure cold index duration, incremental index duration, and Context Pack latency. Repository graph and parsing work must be bounded using limits for file size, graph depth, neighbors, and parsing work. No performance claim may be made without a recorded measurement and environment.

No fixed latency target is specified for V1 in the source specification.

## V1 Acceptance Criteria

V1 is complete only when a user can install a production CLI, enter a real repository, index it, provide a task and token budget, generate budgeted Markdown plus a source-free JSON manifest, understand why content was selected, and run benchmark metrics.

The release must demonstrate:

- real repository indexing;
- TypeScript, JavaScript, and Python support;
- basic symbol extraction;
- a lightweight dependency graph;
- related-test detection;
- task-aware candidate retrieval and explainable ranking;
- bounded graph expansion;
- symbol-level context extraction;
- token-budget enforcement;
- budgeted Markdown Context Packs and source-free JSON manifests;
- incremental indexing;
- secret and repository-boundary protection;
- graceful parser degradation;
- an offline benchmark suite;
- unit, integration, security/failure-path, and CLI E2E coverage;
- a runnable production CLI and complete README;
- independent engineering review.

No criterion is satisfied merely by appearing in a design document.

## V1 Benchmark Targets

The desired engineering targets are:

- Gold File Recall@Budget ≥ 90%;
- Gold Symbol Recall@Budget ≥ 85%;
- Token Reduction ≥ 60%.

These remain targets, not guarantees. The first `contextforge-benchmark-v1` formal run measured 91.7% required-file recall and 86.4% required-symbol recall at 8K for `contextforge-v1`, while matched-recall paired macro token reduction was 1.5% versus lexical whole-file and 7.8% versus structural whole-file. The 60% token-reduction target was therefore **NOT MET** on this dataset. See `BENCHMARK.md` for definitions and `BENCHMARK_RESULTS_V1.md` for the evidence and limitations.

## Deferred Roadmap

The following are outside V1 and must not complicate its implementation prematurely:

- smart retrieval through embeddings, semantic retrieval, or LLM reranking;
- coding-agent memory for historical tasks, architecture decisions, or bugs;
- dynamic just-in-time context delivery, eviction, or active-agent feedback;
- learning from files ultimately modified, tests used, ignored context, or task results.

## Product Positioning

RepoBound is not a coding agent and not a generic code-RAG system. Its differentiated job is to compile a safe, explainable, task-aware subset of a repository into a hard token budget for use by coding agents.
