# CLI workflow details

Run installed CLI help when arguments are uncertain. Use repository-relative paths for subjects and controls. Example artifact names must be unused; CLI refuses overwriting exact-context output.

## Inspect and explain

```sh
contextforge index ./repo
contextforge search "Fix session race condition" ./repo --json
contextforge pack "Fix session race condition" ./repo --budget 8000 --capsule task.json --out task.md
contextforge explain task.json --query WHY_SELECTED --subject src/session.ts
contextforge explain task.json --query WHY_DROPPED --subject test/session.test.ts
contextforge coverage task.json --json
contextforge history save task.json --store ./repo/.contextforge/history
contextforge history list --store ./repo/.contextforge/history
contextforge replay task.json --verify --repository ./repo
```

The actual selected/dropped paths determine Explain subjects; examples do not assert that those files exist. MCP pack returns its own structured contract and Markdown; do not assume an MCP response was automatically saved as a CLI Capsule. Use CLI pack with --capsule when lifecycle artifacts are needed.

## Human control and comparison

A controls.json array is a complete replacement set:

```json
[{ "kind": "PIN", "path": "test/session.test.ts" }]
```

PIN (Studio Include) reserves a useful eligible representation, not necessarily the full file. EXCLUDE removes a candidate from allocation; root instructions remain mandatory. PREFER prioritizes eligible allocation without changing machine rank. FOCUS applies preference to a bounded path. RANGE requires a verified inclusive interval. Controls do not discover arbitrary omitted files or bypass exclusions. Unsafe targets, stale sources, conflicts and insufficient budgets fail explicitly.

```sh
contextforge recompile task.json --repository ./repo --controls controls.json --budget 8000 --out child.md
contextforge history list --store ./repo/.contextforge/history
contextforge history show <child-hash> --store ./repo/.contextforge/history
contextforge diff task.json child.json
```

Recompile emits an envelope containing capsule, coverage and diff, and saves the child in history. Export the Capsule from history show into a new child.json before the diff example; do not pass the recompile envelope as a Capsule. The parent remains immutable. Request explicit user choice before deleting/pruning history.

## Replay

Offline replay inspects metadata. --verify compares current safe sources and compilation. EXACT_MATCH means payload and deterministic Capsule hashes match. SOURCE_CHANGED, TASK_REQUIRED, TASK_MISMATCH, STRATEGY_UNAVAILABLE and CANNOT_REPRODUCE are distinct failure states; report the actual status. Reindexing changes generation and can change output even with identical source. Verification does not refresh the index. History cannot restore missing historical bytes.
