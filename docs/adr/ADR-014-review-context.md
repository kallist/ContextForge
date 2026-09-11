# ADR-014: Change-seeded Review Context

Status: implementation under validation; publication is a separate gate.

## Decision

Review is a separate local compiler proposal, seeded by a Git change set rather
than lexical task retrieval. CLI and Studio call the same application function.
The frozen public composition, ranking, estimator, database schema and historical
benchmark remain unchanged. Normal pack/search retain the public V1 default.

The supported input is a resolved base commit compared with the tracked working
tree, including staged and unstaged changes. Default base is HEAD. New files must
be staged. This is not merge-base PR semantics, a staged-only view, a historical
checkout or arbitrary patch ingestion. Git uses argument arrays, literal pathspecs,
no shell, no external diff/textconv, a 10-second per-command timeout and bounded
output. Only resolved commit hashes reach diff/blob commands.
Configured clean/process filters are enumerated by key only and disabled through
argument-array overrides; required filters are disabled too. Malformed or excessive
filter configuration fails closed. No credential values are read or surfaced.

Safe current sources must match one index generation. Changed ranges intersect
parser-backed symbols; historical parsing of approved current files distinguishes
added/modified/removed declarations. These are syntax changes, not behavioral
proofs. Deleted files are metadata only: current discovery cannot authorize their
historical bytes. Unsupported/excluded current files contribute exclusion counts.

The proposal follows one graph hop from changed files. Existing transient parser
relationships identify supported direct references, test references and TypeScript
implementations. Exact structural facts and naming/path heuristics retain distinct
classification. Limits are 64 changed files, 100 source candidates, 1,024 recorded
relationships, 2,048 ranges per file and 16 MiB of verified current source. Limits
either reject input or emit explicit diagnostics; no transitive completeness claim.

The existing Pack V1 consumes this independent ordered proposal through its existing
injected search interface. Changed files lead, then deterministic path order. No
task ranking or experimental V2 strategy is promoted. The change summary is inside
the payload and its hard budget. Source verification, controls, instruction policy,
representation selection and final serialization retain the established rules.

## Capsule and lifecycle

Ordinary compilations retain byte-compatible v1 Capsule hashing. Review emits
`contextforge-capsule-v2`, with a versioned, source-light Review extension inside
the hashed deterministic core. New readers accept both formats; old readers reject
v2 explicitly. There is no silent v1 schema extension. SQLite history continues to
store compressed, immutable, content-addressed Capsules and lazy summaries without
a schema migration or source archive.

Replay routes Review Capsules back through the recorded base and current tracked
working tree. Current source changes, missing commits and changed identities cannot
yield an exact match. Recompile checks the original change identity, source hashes,
index generation, controls and final budget; a child retains its parent hash.
Semantic Diff adds change/symbol/relationship transitions to existing context
selection transitions. Coverage denominators refer only to captured entities.

## Integration correction

The original optional Git signal reader presents a rename destination but leaves
the old approved path clean. The unchanged persistence invariant correctly rejects
a missing clean file. Lifecycle/Review indexing injects `status --no-renames`, so
the old path is represented as deleted. Review analysis itself still detects
renames. Optional signals for removed untracked or newly ignored paths are omitted,
since they have neither a current safe file node nor a Git deletion record. Frozen
source files and persistence checks are not weakened.

## Validation and scope

Real temporary Git repositories test add/modify/delete/rename, caller/test/interface
facts, privacy, ref rejection, immutable controls and replay. Chromium exercises
the application-backed Review UI, budget loss, PIN, Diff, Replay, stored metadata
and source XSS, and desktop viewports. Installed-package checks use the same UI
journey. A separate frozen small scenario evaluation reports recall, precision,
retention, determinism and timings, including misses. Historical 720-case equality
is an independent regression gate.

No GitHub bot, cloud service, external model, MCP schema change, runtime safety
verdict, automatic code fix, global impact guarantee or agent-success claim.
