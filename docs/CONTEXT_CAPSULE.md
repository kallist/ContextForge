# Context Capsule (V0.3 development)

`contextforge-capsule-v1` is a source-free, opt-in compilation provenance contract.
It records ContextForge's own observations. It does not explain a model's behavior,
prove that a host delivered the payload, or reconstruct source without the repository.
Public Pack remains V1 and the package version remains 0.2.0.

```text
contextforge pack "fix Ledger.saveValue" . --budget 8000 --capsule capsule.json
contextforge pack "fix Ledger.saveValue" . --budget 8000 --out context.md --capsule capsule.json
contextforge explain capsule.json
contextforge explain capsule.json --query WHY_SELECTED --subject src/ledger.ts --json
```

Both outputs refuse overwrite and use the existing exclusive atomic publisher.
Each file publication is atomic; the two destinations are not a filesystem transaction.
The Capsule is published first, so a later Context write failure can leave a complete
Capsule without a Context file. The command reports failure. A Capsule is evidence of
compilation, not confirmation of delivery. Export failure does not print a success payload.
No sidecar is generated unless requested. `--json` still selects the existing Pack
manifest; `payloadHash` always identifies Markdown, not that JSON audit manifest.
Failed compilations such as `BUDGET_TOO_SMALL` emit no Context and no Capsule.

## Contract

Top level: `schemaVersion`, `explainVersion`, `deterministic`, `runtime`, `capsuleHash`.
The deterministic section contains:

- `repository`: active/index generation, index schema, analysis version, generation-bound
  Git commit and dirty signals. `gitScope=INDEXED_SAFE_FILES` explicitly limits dirty
  interpretation. No Git means null commit/dirty. No fresh Git scan or repository digest.
- `task`: SHA-256 of **raw UTF-8 task text**, its representation identifier, task text,
  normalized signals and the V2 analysis strategy/action/mode/concepts/risks where run.
  Task text uses the sanitized display representation described below. If it changes,
  normalized/task-match strings are omitted, preventing derived username/path components
  from leaking. `representation=RAW_UTF8` describes taskHash input, not display text.
  The raw task hash remains unchanged by redaction.
- `strategies`: actual retrieval/ranking, relationship, packing planner, pack, policy,
  estimator/version, retrieval ablation and plan variant. V1 planner and relationship
  stage are null. The existing V1 file graph still contributes ranking evidence.
- `files`, `symbols`, `ranges`: normalized relative paths and indexed source hashes,
  original symbol IDs/parent identities, sanitized names, selected line ranges/reasons.
  Symbol parent IDs are upstream index identities; parents need not themselves be
  relevant symbols. Symbol coordinates use the index's one-based lines and UTF-8 byte
  columns. Selected ranges use one-based inclusive lines. Symbols are recorded relevant
  symbols, not a claim to enumerate every symbol incidentally present in a whole file.
- `candidates`: bounded file envelopes plus mandatory root instructions, stable ID,
  original rank/score/origin/distance, evidence/relationship/range/symbol references,
  V2 roles/facet/directness, final disposition and decision references.
- `evidence`: structured retrieval and actual ranking contributions. V2 retains
  task signal and source candidate identities, location, confidence, derivation and
  relationship reference. Upstream task/source identities are labels, not dereferenced
  Capsule entity links. V1 unclassified evidence remains `RECORDED`, never a new claim
  of structural certainty. Free-form lexical source snippets and explanation traces
  are not copied. Existing relationship derivation labels are retained separately
  from stable type/classification codes.
- `relationships`: referenced generation graph edges and bounded V2 relationship
  observations, preserving actual endpoints, classifications, confidence and provenance.
- `decisions`, `selected`, `dropped`, `excluded`: actual Pack decision codes and final
  disposition. The selected order follows Markdown section order then existing order
  within each section. A ranked AGENTS.md envelope and mandatory instruction are distinct
  identities; a duplicate retrieval envelope can be dropped while instructions are selected.
- `budget`: complete payload estimate, requested/unused budget, utilization, summed item
  contributions and the remainder for the envelope/other sections (including Git context).
  Per-item estimates do not sum to the complete serialized estimate by themselves.
- `plan`, `packingEvents`: actual V2 plan and recorded selection phases/compact costs,
  including cumulative budget observations. V1 has null plan and no V2 events.
- `coverage`: selected relevance-chain and dropped-disposition completeness, plus existing
  V2 role counts. Multi-role token contributions overlap. This is **not Gold coverage**.
- `diagnostics`: bounded compiler codes and existing aggregate scan exclusion counts.
  Ignored directory descendants are not enumerated or guessed.
- `overrides`: empty reserved array. No override behavior.
- `payloadHash`: SHA-256 of exact final Markdown UTF-8 bytes, without reformatting.

Existing reasons remain unchanged: V1 includes `SECTION_LIMIT`, `BUDGET_EXHAUSTED`,
`DUPLICATE`; V2 includes `GLOBAL_BUDGET`, `SAFETY_LIMIT`, `REDUNDANT_RANGE`.
`STALE_SOURCE`, `UNSUPPORTED_CONTENT` and source verification limits are exclusions.
V2 uses `SAFETY_LIMIT` for both source-read limits and the selected-file cap; recorded
source-read provenance distinguishes exclusion from an eligible packing drop.

## Canonical identity

`capsuleHash` hashes canonical JSON of `{schemaVersion, explainVersion, deterministic}`.
Object keys sort by JavaScript ordinal UTF-16 order; arrays preserve their documented
semantic order. Null and booleans use JSON literals, finite numbers use ECMAScript JSON
serialization (`-0` becomes `0`); undefined and non-finite numbers are rejected. UTF-8 is
the hash encoding. Keys never rely on insertion order. There is no Unicode normalization.

Entity IDs use 96-bit SHA-256 prefixes of semantic identity, never rank alone. Runtime
validation rejects duplicate IDs and inconsistent references. Files hash their normalized
relative path; candidates hash path plus FILE/INSTRUCTION kind; ranges hash path, source
hash and coordinates; evidence/decisions hash structured observations. Original symbol
and relationship IDs are reused. Ranking observations also retain original contribution
occurrence order so identical numerical weights cannot collapse distinct contributions.
Their sum is validated against the candidate score. Entity tables sort by ID. Candidates follow retrieval
rank, then mandatory instruction observations. Decisions follow that bounded candidate
order, and drop/exclusion lists follow candidate order. Final selections follow emitted
section order. No sorting mutates compiler arrays.

`runtime` contains creation time and assembly/hash timings; optional OS/Node labels are
also outside identity. Repository display names, absolute checkout paths, index completion
timestamps, mtimes, PIDs and runtime durations are not copied into the deterministic core.
Identical compilation inputs and generation produce identical core/hash. The payload still
has its established repository display name; different emitted bytes produce a different
payload hash, even when other logical identities match. Hashes detect identity/corruption,
not authenticity or a signature from a trusted producer.

## Privacy, limits and future work

### V0.3-01R path privacy correction

Finalization of the first implementation reproduced a leak from `path=` followed by
an absolute POSIX path in task text. The READY claim was withdrawn and the PR remained
Draft. The correction is at the Capsule/Explain representation boundary; raw task input
still drives TaskAnalysis, retrieval, ranking and packing. There is no schema/version,
database, public-default or compiler-algorithm change.

`src/core/capsule-privacy.ts` defines the single deterministic policy. A linear lexical
scan replaces **every recognized absolute path** with `<ABSOLUTE_PATH>`, without retaining
the username, basename, raw backup or a list of path hashes. It recognizes POSIX `/...`,
Windows drive paths using either slash, UNC paths and local `file:` URLs on every OS.
Start-of-text and punctuation boundaries include whitespace, `=`, `:`, parentheses,
brackets, braces, quotes and commas; detection is not whitespace-only. Quoted paths
include spaces up to the matching quote. Unquoted paths end at a text delimiter.
If repeated short paths would expand a sanitized field beyond its existing maximum,
the entire display field becomes one placeholder; compiler input and its hash remain
unchanged. This avoids a new output/schema failure for a previously valid task.
All slash-prefixed path-shaped lexemes at those boundaries are treated conservatively
as paths; this does not infer intent from arbitrary prose or resolve filesystem paths.
It does not decode obfuscated text. HTTP(S) URL tokens are opaque web addresses and
remain unchanged, as do `src/foo.ts`, `../relative/path`, `./local/path`, `a/b`, `a / b`
and existing placeholders. Machine-specific data deliberately embedded in a web URL
is not classified as filesystem syntax by this lexical policy.

The producer sanitizes human-readable text; the validator **rejects**, rather than
silently repairs, externally supplied privacy violations, even with a recomputed hash.
Its error identifies a privacy violation without printing the offending input. All
existing 8 MiB input, string, shape and reference bounds remain. A recognized path in
task display changes deterministic metadata/capsuleHash legitimately; taskHash still
hashes the exact raw task, and payloadHash still hashes the unchanged compiled Markdown.

| String family | Classification and treatment |
|---|---|
| Task display, normalized signals, evidence query text | Free-form: central redaction; omit derived signals if the raw task was redacted |
| Symbol names/qualified names, relationship derivation | Source-derived text: central redaction; original hashed IDs remain |
| `files.path`, evidence `sourceCandidate` | Structured repository-relative paths: preserved, checked by repository path policy |
| Entity/reference IDs, source/task/payload hashes | Generated identities: preserved; schema/central privacy validation rejects invalid external strings |
| Strategy/version, enums, reason/diagnostic/limitation codes | Bounded compiler codes; no raw error details or source snippets copied; slash-bearing invalid codes rejected |
| Analysis version, runtime creation text | Generated labels/timestamp; protected text validation also rejects external path injection |
| Runtime OS/Node labels | Bounded codes outside identity; no cwd, hostname, PID or username field |
| Explain query/subject echo | Same redactor for output; original subject is used only for in-memory lookup |
| Repository display labels, arbitrary logs/errors/details | Not copied into Capsule; privacy errors contain no raw task/path |

Explain cannot recover redacted text from taskHash or source hashes. Metadata remains
private even after path redaction: task prose, relative filenames and symbol names may
be sensitive. This is not a general secret detector or anonymizer.

Export can contain user task text, relative paths, symbol names and compilation metadata.
It contains no file contents, selected source strings, complete Markdown, arbitrary logs,
stack traces, Git branch/username, or machine filesystem paths. Task input itself is private;
review exports before sharing. No upload, model call, network request or automatic persistence.

The application consumes existing indexed hashes and decisions without extra source reads.
V1 drop observations are collected before its presentation cap; V2 used relationships are
retained before its presentation cap. Both collectors are opt-in and bounded by compiler
candidate/evidence limits. Explain accepts at most 8 MiB of UTF-8 JSON, with strict objects,
bounded strings/arrays, duplicate/ref/range/order checks and canonical-hash verification.
Before schema validation, a depth/node/array preflight rejects shape explosions and
prototype-sensitive keys. Nonblocking file open avoids waiting for a FIFO producer;
only regular files are read.
Unknown versions fail with `UNSUPPORTED_SCHEMA`; invalid data uses `INVALID_CAPSULE`.

MCP Capsule exposure is **DEFERRED**; the four public tools and default responses are unchanged.
Replay, history/store, Diff, Context Coverage, Workbench, Human Override and V0.4 are
**NOT IMPLEMENTED**. This phase prepares identity/provenance for later contracts only.

## Compact example (excerpt, not a complete valid Capsule)

```json
{
  "schemaVersion": "contextforge-capsule-v1",
  "explainVersion": "contextforge-explain-v1",
  "deterministic": {
    "task": { "text": "fix Ledger.saveValue", "representation": "RAW_UTF8", "taskHash": "<sha256>" },
    "strategies": { "pack": "contextforge-pack-v1", "planner": null },
    "candidates": [{ "id": "candidate_<hash>", "rank": 1, "evidenceRefs": ["evidence_<hash>"], "disposition": "SELECTED" }],
    "evidence": [{ "id": "evidence_<hash>", "stage": "RETRIEVAL", "code": "EXACT_QUALIFIED_SYMBOL" }],
    "ranges": [{ "id": "range_<hash>", "startLine": 2, "endLine": 5 }],
    "selected": [{ "candidateRef": "candidate_<hash>", "finalOrder": 0, "rangeRefs": ["range_<hash>"] }],
    "decisions": [{ "reason": "SECTION_LIMIT", "disposition": "DROPPED", "decisionSource": "COMPILER" }],
    "payloadHash": "<sha256 of exact Markdown>"
  },
  "capsuleHash": "<sha256 of canonical deterministic envelope>"
}
```

See [Explain contract](EXPLAIN_CONTRACT.md) and [ADR-012](adr/ADR-012-context-capsule-and-explain.md).
