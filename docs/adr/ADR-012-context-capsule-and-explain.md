# ADR-012: Context Capsule and deterministic Explain

Status: PROPOSED

## Pre-merge privacy correction (V0.3-01R)

Finalization found an absolute POSIX task path after `=` surviving export in V1 and V2.
The initial READY claim was withdrawn. A central platform-independent lexical policy
now sanitizes persisted free-form task, symbol and evidence text with a fixed
`<ABSOLUTE_PATH>` placeholder; the validator rejects recognized external violations.
Normalized/query signals are omitted when the task was redacted, avoiding path-fragment
leakage. Explain sanitizes its own subject echo and never reconstructs raw input.
Structured repository-relative paths retain their established validation and identity.

Exact input identity remains SHA-256 of the original raw task. The compiler receives that
original task unchanged. Sanitized display metadata can change capsuleHash, but never
payloadHash or Context bytes. The policy is lexical, preserves ordinary relative paths
and HTTP(S) URL tokens, and is not a general secret detector. Its field audit and bounds
are recorded in the Capsule contract. This pre-release correction retains schema V1 and
this ADR's PROPOSED status; it does not add Replay, storage or other later-phase behavior.

## Decision

Add an opt-in, source-free compilation manifest at the application boundary.
The existing compiler runs once. Its final payload, ranking evidence, snapshot,
and packing decisions feed a separate assembler. Capture never participates in
selection. Core owns the versioned contract, canonical identity, validation and
offline Explain; filesystem adapters own bounded input and exclusive exports.
No database migration, history, replay, diff, override, model or network is added.

SHA-256 identifies the exact UTF-8 Markdown and the canonical deterministic core.
Runtime measurements are excluded. Entity IDs use semantic identity, never rank.
Existing symbol IDs and one-based source coordinates are retained. Evidence keeps
its actual derivation and confidence; absent stages remain null.

## Contract review

Future Replay can verify source and payload hashes but cannot reconstruct source
from this artifact alone. Diff can compare stable entities; Workbench can render
structured decisions. Overrides remain an empty reserved array. V1 fits without
inventing V2 stages. Existing drop codes retain their original meaning.

One correction identified before implementation: selectedItems in existing Pack
manifests are in preparation order, whereas Markdown groups them by section.
Capsule finalOrder must follow that serializer order without changing Pack output.
Repository display names and index timestamps are incidental and are not copied
as deterministic repository identity. Git data is explicitly generation-bound;
the filtered Git signals do not establish whole-working-tree cleanliness.

## Consequences

The capsule proves compiler observations, not model behavior or complete relevance.
Requested sidecar failures are explicit. Exported task metadata is private data;
source bodies and free-form trace strings are not copied. CLI Explain treats JSON
as untrusted, bounded data and never dereferences repository paths. MCP exposure
is deferred. Public strategy and package version remain unchanged.
