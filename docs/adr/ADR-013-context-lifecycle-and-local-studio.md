# ADR-013: Local context lifecycle and human control

Status: ACCEPTED (local technical gates passed; hosted/publication gates remain separate)

## Plan and boundaries

The existing TypeScript application composes safe discovery, generation-bound SQLite,
V1 Search/Pack, and opt-in Capsule observation. V2 remains internal/experimental.
CLI and local Studio will call shared application use cases. Pure Core contracts own
semantic Diff, captured-fact Coverage/Lint and bounded semantic control validation.

The public CLI/MCP composition is frozen byte-for-byte. A separate lifecycle
composition wraps it for the new adapter; no frozen-source exemption is added.

Use a separate local SQLite history database with compressed immutable Capsules,
content identity deduplication and indexed summaries. Do not persist payloads or raw
task inputs. History has its own format version, bounded queries, explicit deletion
and pruning; compiler index schema and transactions remain unchanged.

Replay inspection needs no repository. Verification recompiles against current safe
sources, checks raw task identity and recorded strategy, and distinguishes source,
generation/provenance and payload mismatches. It cannot restore historical bytes or
prove repository identity outside the recorded safe files. A redacted task needs the
original raw task supplied again; display text is never treated as raw identity.

Human controls are explicit opt-in constraints over the bounded machine candidate
set: PIN retains a useful representation; RANGE retains precisely one requested
range; EXCLUDE removes a candidate; PREFER orders allocation ahead of other eligible
candidates; FOCUS prefers candidates under a relative directory. Mandatory root
instructions cannot be excluded. None bypass source verification or final budget.
Each controlled result records parent identity and normalized controls. Uncontrolled
compilation bytes and all frozen benchmark definitions remain unchanged.

Studio binds IPv4 loopback to one startup repository, serves an explicit static asset
allowlist, uses a per-process bearer capability and same-origin checks, bounds request
bodies/concurrency and maps errors without raw filesystem paths. Source payloads are
ephemeral; reloading history requires verified recompilation to view exact context.

## Risk and validation

Test corruption, store concurrency/atomicity, symlink boundaries, malicious inputs,
privacy, immutable history, typed replay mismatches, semantic transitions, every lint
positive/negative, controls under insufficient budget and stale sources. Add real
browser E2E and installed-package Studio checks. Run the existing full OS/Node CI,
frozen 720-case regression and Capsule conformance after stabilization. No cloud,
agent runtime, retrieval tuning, default promotion, source archive or V0.4 work.
