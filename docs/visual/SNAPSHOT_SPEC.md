# RepoBound Context Snapshot Specification

## Purpose and boundary

A Context Snapshot is a deterministic, shareable rendering of the currently opened
RepoBound Capsule. It is evidence, not an outcome claim. It never states that coding
quality, accuracy, productivity, review accuracy, or token savings improved.

## Output

- PNG, exactly 1200×630 at 1× pixels.
- Generated locally in the Studio browser with Canvas; no upload, remote renderer,
  analytics, network font, or screenshot service.
- Filename is deterministic enough to identify the opened Capsule, for example
  `repobound-context-7ac31f40.png`.

## Data

Use only current Capsule/API values: task display text, requested and estimated
estimator tokens, selected/dropped counts, up to five selected files, the active
inspected file and its recorded evidence when loaded, latest semantic transition
when available, replay status when explicitly run, generation/hash identity, and
the factual product boundary “Local-first · Hard declared budget”. Missing optional
data is omitted or labeled `Not recorded`; it is never invented.

## Composition

Warm neutral canvas with the same tokens as Studio. Header: RepoBound / CONTEXT
SNAPSHOT and short Capsule identity. Main left: wrapped task, selection counts,
budget bar, key files. Main right: recorded evidence/relationship or a factual
selection note. Footer: local-first, declared estimator budget, source-free Capsule
identity. Amber highlights only active facts.

## Text handling

- Task wraps to at most three lines and ellipsizes deterministically.
- Paths use middle ellipsis where required and remain distinguishable.
- Optional evidence may disappear before primary task/count/budget information.
- Rendered text must remain readable when the PNG is displayed around 600px wide.

## Validation

Use the deterministic session fixture. Assert PNG signature and 1200×630 IHDR,
render normal and long-text variants, exercise missing optional evidence, and visually
inspect the real output. Snapshot data must match the opened Capsule.

