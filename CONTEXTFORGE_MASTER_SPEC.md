\# ContextForge — Product Specification



\## 1. Product



ContextForge is a local-first context compiler for coding agents.



It answers a fundamental question in AI-assisted software development:



> For this specific coding task, what repository context should the coding agent actually receive?



Input:



```text

Repository

\+

Coding Task

\+

Token Budget

```



Output:



```text

Task-aware Context Pack

```



The Context Pack should contain the smallest useful subset of repository information required for a coding agent to understand and complete the task.



\---



\# 2. Goal



Given:



```text

repository + coding task + token budget

```



ContextForge should:



1\. understand the structure of the repository,

2\. identify candidate files and symbols related to the task,

3\. expand relevant structural dependencies,

4\. discover related tests and architecture documentation,

5\. rank candidate context,

6\. pack the most valuable context within the token budget,

7\. explain why each important context item was selected.



Primary product objectives:



\* reduce unnecessary context,

\* reduce token usage,

\* preserve required task context,

\* improve repository understanding,

\* provide explainable selection.



\---



\# 3. Core Product Questions



Every major feature should contribute to at least one of these questions:



1\. Did ContextForge select the right context?

2\. Did ContextForge use fewer tokens?

3\. Can ContextForge explain why the context was selected?



Features that do not materially improve these goals should normally remain outside V1.



\---



\# 4. Target Users



Primary users:



\* Codex users,

\* Claude Code users,

\* Cursor users,

\* Gemini CLI users,

\* OpenCode users,

\* coding-agent developers,

\* AI-assisted software engineers,

\* developers working with medium or large repositories.



\---



\# 5. Product Principles



ContextForge V1 should be:



\* local-first,

\* privacy-first,

\* model-agnostic,

\* CLI-first,

\* explainable,

\* benchmarkable,

\* deterministic where practical,

\* cross-platform,

\* open-source friendly.



The core workflow must work without requiring an external LLM API.



\---



\# 6. Non-goals



V1 is not:



\* a coding agent,

\* an IDE,

\* a Cursor replacement,

\* a cloud code hosting platform,

\* a SaaS collaboration system,

\* an autonomous coding system,

\* an automatic PR generator,

\* an automatic code modification tool.



V1 does not require:



\* vector databases,

\* external embedding APIs,

\* OpenAI,

\* Anthropic,

\* Gemini,

\* cloud infrastructure,

\* Redis,

\* Postgres,

\* Elasticsearch,

\* Kafka,

\* complex multi-agent systems.



LLM-based reranking and embedding retrieval may be explored later as optional enhancements.



\---



\# 7. Core Workflow



The primary product flow is:



```text

Coding Task

&#x20;       ↓

Repository Discovery

&#x20;       ↓

Repository Index

&#x20;       ↓

Task Understanding

&#x20;       ↓

Candidate Retrieval

&#x20;       ↓

Structural Expansion

&#x20;       ↓

Ranking

&#x20;       ↓

Token Budgeting

&#x20;       ↓

Context Packing

&#x20;       ↓

Context Pack

```



\---



\# 8. Repository Discovery



ContextForge must discover the repository safely.



It should detect where practical:



\* repository root,

\* Git repository,

\* languages,

\* source directories,

\* tests,

\* documentation,

\* configuration,

\* package managers,

\* frameworks.



ContextForge should respect:



\* `.gitignore`,

\* `.contextforgeignore`.



It should exclude common generated or dependency directories such as:



```text

.git

node\_modules

dist

build

.next

coverage

vendor

target

\_\_pycache\_\_

.venv

venv

```



\---



\# 9. File Safety



Repository files must be treated as untrusted input.



ContextForge must safely handle:



\* symlink loops,

\* symlink escape,

\* path traversal,

\* huge files,

\* binary files,

\* malformed encoding,

\* generated code,

\* minified code,

\* deleted files,

\* files changing during indexing.



Files outside the repository root must not be read by default.



\---



\# 10. Sensitive Files



Sensitive files must be excluded from generated Context Packs by default.



Examples include:



```text

.env

.env.\*

\*.pem

\*.key

id\_rsa

credentials\*

secrets\*

```



Sensitive content must not leak through logs or generated diagnostic output.



\---



\# 11. Initial Language Support



V1 should prioritize:



\* TypeScript,

\* JavaScript,

\* Python.



Primary extensions:



```text

.ts

.tsx

.js

.jsx

.py

```



Markdown, JSON, YAML, and similar files may use structured text analysis.



The architecture must allow additional language adapters later.



\---



\# 12. Symbol Extraction



For supported programming languages, ContextForge should identify useful program structure.



At minimum where the language permits:



\* functions,

\* classes,

\* methods,

\* interfaces,

\* types,

\* imports,

\* exports,

\* constants.



Useful symbol metadata includes:



```text

name

kind

file

line range

parent

export state

language

```



Parser failure for one file must not fail the entire repository index.



Fallback textual indexing should remain possible.



\---



\# 13. Repository Graph



ContextForge should construct a lightweight structural graph.



V1 should support useful relationships such as:



```text

File → imports → File



File → contains → Symbol



Symbol → defined in → File



Test → relates to → Source

```



Symbol reference relationships may be added where they can be derived reliably.



The objective is not to construct a perfect compiler-level call graph.



The objective is:



> useful structural context for coding tasks.



\---



\# 14. Test Discovery



Tests are first-class context.



When source code is selected, ContextForge should attempt to discover related tests using:



\* naming conventions,

\* imports,

\* references,

\* directory relationships.



Examples:



```text

memory\_service.py

→ test\_memory\_service.py



memory.ts

→ memory.test.ts

→ memory.spec.ts

```



Related tests should receive additional ranking weight.



\---



\# 15. Repository Instructions and Architecture Documentation



ContextForge should recognize high-value repository documentation such as:



```text

AGENTS.md

README.md

ARCHITECTURE.md

DESIGN.md

\*\_DESIGN.md

ADR/

docs/

CONTRIBUTING.md

```



Selection must remain task-aware.



ContextForge must not blindly include the entire documentation directory.



\---



\# 16. Git Signals



When Git is available, ContextForge may use:



\* current branch,

\* HEAD,

\* recent commits,

\* recently modified files,

\* relevant commit messages,



as ranking signals.



Git information must not become the sole basis for context relevance.



ContextForge must continue working when Git is unavailable.



\---



\# 17. Task Understanding



Given:



```bash

contextforge pack "Fix memory disable race condition"

```



ContextForge should derive useful query signals.



It should understand forms such as:



```text

memory

memory\_enabled

MemoryService

run.completed

SELECT FOR UPDATE

```



Task processing should recognize:



\* ordinary words,

\* paths,

\* symbol-like names,

\* snake\_case,

\* camelCase,

\* PascalCase,

\* kebab-case,

\* error messages.



The V1 core does not require an LLM task planner.



\---



\# 18. Candidate Retrieval



Candidate context should be produced from multiple signals.



V1 should include at least:



\* lexical matching,

\* path matching,

\* symbol matching,

\* dependency relationships,

\* test relationships,

\* documentation relationships,

\* limited Git signals.



Candidate retrieval should produce more context than will ultimately fit into the output budget.



Ranking and packing determine what is finally included.



\---



\# 19. Explainable Ranking



Each candidate must have:



```text

score

reasons

```



Example:



```json

{

&#x20; "path": "backend/services/memory.py",

&#x20; "score": 0.94,

&#x20; "reasons": \[

&#x20;   "task keyword match",

&#x20;   "MemoryService symbol match",

&#x20;   "related to run finalization",

&#x20;   "related tests discovered"

&#x20; ]

}

```



Ranking should prefer transparent structural signals over opaque machine-learning ranking in V1.



Ranking weights should be configurable where practical.



\---



\# 20. Structural Expansion



After discovering primary candidates, ContextForge should perform bounded graph expansion.



Example:



```text

MemoryService

↓

MemoryRepository

↓

RunFinalizer

↓

related tests

```



Expansion must prevent dependency explosion.



Useful controls include:



```text

max\_depth

max\_neighbors

score\_decay

```



\---



\# 21. Symbol-level Context



ContextForge should not assume:



```text

relevant file = include entire file

```



Where practical, context should be extracted at symbol or line-range granularity.



Example:



```text

backend/services/memory.py

lines 81–143

MemoryService.finalize\_run()

```



Necessary imports or surrounding code may also be included.



Small relevant files may be included in full.



\---



\# 22. Token Budget



Token budget is a first-class product constraint.



Example:



```bash

contextforge pack \\

&#x20; "Fix memory disable race condition" \\

&#x20; --budget 16000

```



Generated output must remain within the requested budget.



Token estimation must be abstracted so model-specific tokenizers can be added later.



If the budget is too small to produce useful context, ContextForge must report that explicitly instead of silently producing broken output.



\---



\# 23. Budget Allocation



Packing should consider different types of context.



Possible categories include:



\* task and repository instructions,

\* repository overview,

\* primary source code,

\* dependency context,

\* tests,

\* architecture documentation,

\* Git signals.



V1 should avoid a naive strategy that simply sorts every candidate by score and appends text until the budget is exhausted.



Allocation may vary according to task type.



\---



\# 24. Context Pack



Primary human-readable output:



```text

context.md

```



Machine-readable output:



```text

context.json

```



A Context Pack should include:



```text

Task



Repository Overview



Repository Instructions



Primary Context



Dependencies



Tests



Architecture / Documentation



Relevant Git Signals



Token Usage



Selection Reasons

```



\---



\# 25. Context Manifest



Machine-readable output should include enough metadata to reproduce and inspect a context build.



Useful fields include:



```text

task

repository

head\_sha

created\_at

budget

estimated\_tokens

selected\_files

selected\_symbols

line\_ranges

scores

selection\_reasons

excluded\_candidates

language\_stats

index\_version

```



Identical repository state, task, configuration, and ContextForge version should produce stable output where practical.



\---



\# 26. CLI



V1 should provide a focused CLI.



Expected commands:



```bash

contextforge init



contextforge index



contextforge map



contextforge search "MemoryService"



contextforge pack "Fix memory disable race condition"



contextforge explain



contextforge benchmark



contextforge doctor

```



CLI contracts may evolve during implementation, but changes should remain documented.



\---



\# 27. Incremental Indexing



The first indexing operation may scan the full repository.



Subsequent indexing should avoid unnecessary reparsing.



Incremental detection may use:



\* file metadata,

\* hashes where required,

\* Git state where available.



Index state must not become partially active after an interrupted write.



\---



\# 28. Local Persistence



ContextForge may use lightweight local persistence for:



\* file metadata,

\* hashes,

\* symbols,

\* graph relationships,

\* index metadata.



The system should avoid unnecessarily duplicating entire repository source files into persistent storage.



Generated Context Packs should normally read current source content from the working tree.



\---



\# 29. Concurrency and Failure Handling



ContextForge must safely handle cases such as:



```text

index + index

index + pack

```



Index writes must not expose corrupted or half-completed active state.



Failures to consider include:



\* parser failure,

\* database failure,

\* interrupted indexing,

\* Git unavailable,

\* file deleted during indexing,

\* file changed after indexing,

\* malformed configuration,

\* missing parser.



Individual file failures should degrade gracefully where possible.



\---



\# 30. Privacy



Default behavior:



```text

NO source upload

NO telemetry

NO analytics

NO mandatory external APIs

```



Future external providers must be explicit and optional.



\---



\# 31. MCP Integration



MCP is an integration layer, not part of the ContextForge core.



Once CLI/core behavior is stable, ContextForge should expose capabilities such as:



```text

repo\_map

search\_repository

build\_context\_pack

explain\_context

```



The implementation should use the current stable MCP specification and SDK available at implementation time.



MCP-specific code must not own core retrieval or ranking logic.



\---



\# 32. Benchmark



ContextForge must include an offline benchmark suite.



Benchmark cases should contain:



```text

Repository / fixture



Task



Gold Files



Gold Symbols



Optional Gold Documentation



Token Budget

```



Initial benchmark coverage should include:



\* TypeScript,

\* Python,

\* mixed-language repositories.



\---



\# 33. Benchmark Metrics



At minimum report:



```text

File Recall@Budget



Symbol Recall@Budget



Precision



Token Count



Token Reduction



Selected File Count



Index Duration



Pack Duration

```



Optional real Coding Agent benchmarks may later compare:



```text

Agent without ContextForge



vs



Agent with ContextForge

```



Paid model benchmarks must never be mandatory CI requirements.



\---



\# 34. Desired V1 Benchmark Targets



These are engineering targets, not guaranteed results.



Aim for:



```text

Gold File Recall@Budget >= 90%



Gold Symbol Recall@Budget >= 85%



Token Reduction >= 60%

```



Actual benchmark results must always be reported honestly.



Failure cases should be documented.



\---



\# 35. Testing



V1 should include:



\* unit tests,

\* integration tests,

\* failure-path tests,

\* security tests,

\* CLI end-to-end tests.



Important behaviors to prove include:



\* relevant context selection,

\* irrelevant context exclusion,

\* budget enforcement,

\* secret exclusion,

\* line-range accuracy,

\* safe incremental indexing,

\* repository boundary enforcement.



\---



\# 36. Performance



ContextForge should measure:



\* cold index time,

\* incremental index time,

\* context-pack latency.



Avoid obviously unbounded repository graph operations.



Use limits for:



\* file size,

\* graph expansion,

\* neighbors,

\* parsing work.



No performance claim should be made without measurement.



\---



\# 37. V1 Deliverable



ContextForge V1 is complete only when a user can:



```text

install ContextForge

↓

enter a real repository

↓

index it

↓

provide a coding task

↓

provide a token budget

↓

generate context.md + context.json

↓

understand why the content was selected

↓

run benchmark metrics

```



\---



\# 38. Acceptance Criteria



V1 must demonstrate:



\* real repository indexing,

\* TypeScript / JavaScript / Python support,

\* basic symbol extraction,

\* lightweight dependency graph,

\* related test detection,

\* task-aware candidate retrieval,

\* explainable ranking,

\* bounded graph expansion,

\* symbol-level context extraction,

\* token-budget enforcement,

\* Markdown and JSON Context Packs,

\* incremental indexing,

\* secret protection,

\* repository boundary protection,

\* graceful parser degradation,

\* offline benchmark suite,

\* unit/integration/E2E coverage,

\* runnable production CLI,

\* complete README,

\* independent engineering review.



\---



\# 39. Deferred Roadmap



Not part of V1 implementation:



\## Smart Retrieval



\* embeddings,

\* semantic retrieval,

\* LLM reranking.



\## Coding Agent Memory



\* historical task memory,

\* architecture decision memory,

\* bug history.



\## Dynamic Context



\* just-in-time context delivery,

\* context eviction,

\* active agent feedback.



\## Context Learning



Learn from:



\* files ultimately modified,

\* tests actually used,

\* context ignored by agents,

\* task completion results.



These capabilities should not complicate the V1 implementation prematurely.



\---



\# 40. Product Positioning



ContextForge is not:



> another code RAG application.



ContextForge is:



> a task-aware context compiler for coding agents.



The central product promise is:



> Coding agents should not need your whole repository. They need the right context.
