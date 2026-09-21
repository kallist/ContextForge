# RepoBound Visual Polish V2 — Change Specification

Scope: visual presentation only. Product semantics are frozen.
Direction: **Budget Ruler** (`DIRECTION_EXPLORATION_V2.md`). System: `DESIGN_SYSTEM_V2.md`.

---

## 1. Existing problems

Verified against the real markup at baseline `785c6811`, not assumed.

| ID | Problem | Evidence in the current source |
|---|---|---|
| P1 | **Navigation duplication.** "Why" is a top-level destination *and* a view tab; the tab list also re-exposes the whole workbench. | Top bar `Context / Why / History`; view tabs `Context & Why / Why / Exact context / Coverage / Changes / Replay` |
| P2 | **Dead vertical space before the result.** A visitor must pass hero copy, a mode switch, and the composer to reach anything meaningful. | `#start` stacks `.start-copy` + `.mode-switch` + `#task-composer` above `#workspace` |
| P3 | **Weak hierarchy.** The compiled task, the counts, and secondary metadata share nearly the same visual weight. | `.result-bar h2` and `.metrics small` use the same scale family; the metrics block is a three-cell strip that reads as KPI tiles |
| P4 | **Per-row control noise.** Every file row carries its own `<select>`. | `<th>Control</th>` with a per-row select in the `#candidates` table |
| P5 | **Native-looking controls.** Controls read as lightly styled browser chrome. | `Show` `<select>`, mode switch built from plain buttons, `Share` / `Exact Context` unstyled buttons |
| P6 | **Why reads like a log.** Raw provenance codes lead the inspector. | `#explain` renders evidence with codes such as `TEST_RELATION · STRUCTURAL` in the primary position |
| P7 | **Weak brand signature.** Nothing in the UI is uniquely RepoBound. | No element communicates the budget or the evidence relation graphically |
| P8 | **Text is not reflow/zoom safe.** Fixed `px` type with sizes that do not respond to zoom or narrow widths. | `studio.css` sets px type throughout with no fluid sizing |

## 2. Selected direction

**Budget Ruler.** The hard token budget becomes the primary visual anchor via a capacity
ruler, and recorded evidence becomes the second anchor via a persistent inspector. Rationale,
scoring, and the two rejected directions: `DIRECTION_EXPLORATION_V2.md`.

## 3. Intended information hierarchy

1. **What was asked** — the task statement, largest text in the workbench.
2. **Whether it fits** — the capacity ruler plus used/budget as an explicit figure.
3. **What is in** — selected files, filled rails.
4. **What is out** — dropped/considered files, hollow rails, full contrast.
5. **Why any of it** — the persistent inspector, human sentence first, raw codes behind a disclosure.
6. Everything else (capsule identity, generation, provenance) — quiet and secondary.

## 4. Surfaces to change

| Order | Surface | File |
|---|---|---|
| A | Global tokens and typography | `src/adapters/studio/assets/studio.css` |
| B | Navigation and global hierarchy | `studio.css`, `index.html` |
| C | Composer | `studio.css`, `index.html` |
| D | Context result + capacity ruler | `studio.css`, `index.html`, `studio.js` |
| E | Context rows | `studio.css`, `studio.js` |
| F | Controls (selection + action bar) | `studio.css`, `studio.js` |
| G | Why inspector | `studio.css`, `studio.js` |
| H | Evidence visualization | `studio.css`, `studio.js` |
| I | Context Snapshot | `studio.js` (canvas), `studio.css` |
| J | Proof Lab | `site/proof/*` |
| K | Hero / README assets | `site/index.html`, `site/site.css`, `README.md`, `docs/assets/*` |

## 5. Acceptance criteria

Each is verifiable; none is a matter of taste.

**Semantics preserved (hard gate)**

1. Compiler, retrieval, ranking, Pack, Explain, Coverage, Diff, Replay, Review, and SQLite
   semantics are byte-identical. `git diff` touches no `src/**` outside
   `src/adapters/studio/assets/**`.
2. MCP tool surface remains exactly `status`, `index`, `search`, `pack`.
3. No new runtime dependency; no framework; `package.json` dependencies unchanged.
4. Every existing capability remains reachable: Context, Changes, History, Exact context,
   Coverage, Replay, semantic diff, Import Capsule, Delete, Rebuild with controls.
5. Dropped files remain selectable, inspectable, and controllable.

**Visual gates**

6. The budget is visible as a bounded scale without scrolling at 1024×768 after a compile.
7. Reaching the context result costs at most one viewport of scrolling at 1024×768.
8. No element is added that is not driven by real recorded data.
9. Every state label is accompanied by a non-colour cue (shape or fill).
10. No per-row `<select>` remains; selection plus an action bar replaces it.
11. Raw provenance codes are behind a disclosure and never lead the inspector.

**Accessibility gates**

12. All text meets 4.5:1 and all meaningful non-text 3:1, measured, not estimated.
13. `:focus-visible` indicator present on every operable control.
14. Full keyboard operation of destinations, segmented controls, rows, and the action bar.
15. No horizontal page overflow at 390 / 768 / 1024 / 1280 / 1512.
16. Content survives 200% zoom with no clipped or lost text.
17. `prefers-reduced-motion: reduce` removes all non-essential motion.
18. Long paths wrap; the full path is always retrievable.

**Brand and shareability gates**

19. The capacity ruler appears in Studio, the Snapshot, and the Hero, driven by real values.
20. The Snapshot is 1200×630 and legible at 100%, 50%, and preview size.
21. Proof Lab still has exactly three cases and reads as curated evidence.
22. README first screen shows identity, one explanation, proof, and install before long prose.

## 6. Explicit non-goals

- No dark mode in V2 (the token layer is shaped so one can be added later).
- No new product feature, engine change, MCP tool, or benchmark change.
- No reproduction of Archify's UI, colours, typography, components, layout, or assets.
