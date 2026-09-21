# RepoBound Visual Polish V2 — Direction Exploration

Baseline: `785c6811` (Visual Launch V1 merged). Studio is vanilla HTML/CSS/JS; no framework
may be introduced. Product semantics are frozen.

---

## Inputs and constraints

**Product truth (frozen, must be respected visually only).** RepoBound is a local-first,
task-aware context *compiler*. It selects the smallest useful repository context that fits
a requested token budget, and it records why each file was selected, dropped, or excluded.
The central user question is: *what repository context will my coding agent receive?*

**Non-negotiable constraints carried into every direction**

- No green for success, selection, active state, replay, CTA, or brand.
- Never encode meaning in colour alone; every state carries a word or marker.
- Dropped means *considered but not selected* — never visually "irrelevant" or disabled.
- No invented metrics, savings, accuracy, or fake social proof.
- No React/Next/Vue/Svelte, no Tailwind, no remote UI dependency.
- Text must reflow under zoom and text-scaling (UX Pro Max rates this **Critical**): no
  fixed-width/fixed-height text boxes, unitless line-height, fluid type.

**Weaknesses carried in as hypotheses to solve** (verified against real markup)

| # | Hypothesis | Verdict from audit |
|---|---|---|
| A | Weak hierarchy — task/result/state/Why compete with metadata | Confirmed; composer and result bar share near-identical styling |
| B | Dead vertical space — result reached too slowly | Confirmed; `start` hero block stacks copy + mode switch + composer before any result |
| C | Navigation duplication | **Worse than stated** — `Context/Why/History` in nav *and* `Context & Why/Why/Exact context/Coverage/Changes/Replay` as tabs |
| D | Native-looking controls | Confirmed — `Show`, mode switch, `Share`, `Exact Context` are lightly styled native controls |
| E | Repeated per-row controls | Confirmed — a `Control` column with a `<select>` rendered on every row |
| F | Why reads like a log | Confirmed — raw provenance codes lead the inspector |
| G | Weak brand recognition | Confirmed — nothing in the UI is uniquely RepoBound |

---

## Direction A — "Budget Ruler"

**1. Name.** Budget Ruler — the instrument that measures what fits.

**2. Core personality.** A precision measuring instrument. Calm, warm-neutral, absolutely
literal. It looks like something a lab technician would trust: hairline rules, tabular
figures, one amber index mark, no decoration anywhere.

**3. Why it fits RepoBound.** RepoBound's single most distinctive fact is that a *hard
token budget* bounds the selection. That is the difference between a context compiler and a
file picker. No competing developer tool makes a budget the hero of its main view, so the
most truthful fact is also the most differentiating one.

**4. Light / dark / hybrid.** Warm light primary. A dark mode is explicitly *not* shipped in
V2 (see risk). The instrument metaphor is strongest as luminous paper with crisp ink.

**5. Main palette.** Warm neutral paper `#F8F6F1` → `#FDFCF9`, ink `#211F1B`, and a single
amber instrument accent `#A96818`. Muted brick `#A9503E` reserved for destructive/failed.
No green.

**6. Typography strategy.** IBM Plex Sans (400/500/600) for UI, JetBrains Mono (400/500) for
paths, identifiers, hashes, and every number. Numbers get `font-variant-numeric: tabular-nums`
so columns align into a measuring scale.

**7. Density.** High in the workbench, low in the composer. ~14px UI base, 13px mono data,
28px rows. Calm density, not a spreadsheet.

**8. Spacing philosophy.** Strict 4/8/12/16/24/32 rhythm; border-bottom rules instead of
nested cards; the page reads as ruled paper, not as floating boxes.

**9. Border / radius / shadow.** Radius 4–6px (tightened from 6–9–12). One hairline weight
`#E7E1D7`. Sharp shadow only for the Snapshot and floating menus.

**10. Primary navigation.** Three destinations only — **Context**, **Changes**, **History**.
`Why` is promoted out of navigation into a *persistent inspector pane* beside the context
list. This is the core IA fix for weakness C: Why stops being a product area and becomes a
property of whichever file is selected.

**11. Context list appearance.** A ruled list, not a table. Each row: a 3px state rail, the
path in mono with directory de-emphasised, token count right-aligned in tabular mono, and a
single quiet inline state word. Header row carries the ruler summary.

**12. Selected / Dropped representation.** Selected = **filled** amber rail plus the word
`Selected`. Dropped = **hollow** neutral rail plus `Dropped`, at full text contrast so it
never reads as disabled. Shape difference survives greyscale and colour blindness.

**13. Why inspector.** Leads with a single human sentence built strictly from recorded
facts, then a relationship list, then `Decision details` holding the raw codes
(`TEST_RELATION · STRUCTURAL`). Raw codes stay one disclosure away, never leading.

**14. Evidence visualization — the brand signature.** A **capacity ruler**: a vertical scale
at the top of the context pane showing the budget as a bounded column, with the used portion
filled in amber, the remaining portion hatched, and one tick per selected file positioned at
its cumulative token offset. Hovering/selecting a file moves the index mark. It is a real
measurement of real values, needs no library, and doubles as the Snapshot hero.

**15. Controls.** Buttons and a segmented control for modes; the per-row `<select>` is
**removed** and replaced by a selection model — select rows, then act from a contextual
action bar (Include / Prefer / Exclude / Focus / Range). Directly implements the UX Pro Max
`Bulk Actions` guideline, which names "repeated actions per row" as the anti-pattern.

**16. Status semantics.** State is always a word + shape + colour, in that order of
reliability. `Selected` / `Dropped` / `Excluded` / `Verified` / `Changed`.

**17. Motion.** 120–160ms colour/border transitions only, plus the ruler index mark sliding
to a new offset. `prefers-reduced-motion` removes the slide. Nothing else animates.

**18. Empty state.** One sentence, one realistic example task, one primary action — with the
empty ruler visible above it so the concept is legible before the first compile.

**19. Snapshot visual composition.** 1200×630: the capacity ruler as the dominant graphic on
the right, task and budget as a large left-aligned statement, selected and dropped counts as
figures, selected file paths in a short mono column. Factual only.

**20. Proof Lab style.** Evidence dossiers: numbered case, the exact task, the ruler, the
resulting list, and the recorded reason for one dropped item. No marketing cards.

**21. Hero appearance.** The compiler loop with the ruler present at each state, so the
budget constraint is visible from the first frame.

**22. Brand signature.** The capacity ruler / index mark. It appears in Studio, the
Snapshot, the Hero, and the favicon-scale mark.

**23. GitHub screenshot quality.** Excellent — the ruler is a large, legible, unusual shape
that reads even at 50%, and amber-on-paper is distinctive against the blue/green wall.

**24. Accessibility risks.** Ruler needs a text equivalent (`aria-label` with real numbers)
and must not be the only carrier of the budget value. Amber on warm paper needs measured
contrast; the rail shape difference is what makes it safe.

**25. Implementation complexity.** Moderate. Ruler is ~60 lines of CSS + ~80 lines of
positioning JS using already-fetched numbers. No new dependency.

**26. Long-term maintainability.** High — it is a re-skin plus one component with explicit
inputs. No build step change beyond a font copy.

**27. Main weakness / risk.** A ruler can slide into decoration if it is not driven by real
numbers, and vertical space above the list is scarce; it must be compact (~56px tall) or it
recreates weakness B.

---

## Direction B — "Technical Broadsheet"

**1. Name.** Technical Broadsheet.

**2. Core personality.** An engineering journal. Editorial, typographic, argumentative —
as if a compiler wrote a well-set report about your repository.

**3. Why it fits RepoBound.** RepoBound's output genuinely is an *explanation* with
provenance. Treating the result as a typeset document rather than a UI panel foregrounds
the recorded reasoning, which is the part that deserves trust.

**4. Light / dark / hybrid.** Paper light, with a true ink-dark reading mode for
long evidence sessions.

**5. Main palette.** Near-black ink `#14120F` on `#FBFAF7`, one deep teal-slate
`#1F4E5F` as the only accent, brick `#8C3B2E` for failure. No green.

**6. Typography strategy.** Serif display for the task and section headings (system serif
stack), Plex Sans for UI, mono for data. The task is set as a headline, not an input value.

**7. Density.** Lower — generous leading, wider margins, long measures. Comfortable rather
than compact.

**8. Spacing philosophy.** Print margins and a baseline grid; sections separated by rules
and space, never by containers.

**9. Border / radius / shadow.** Radius 0–3px. Rules are the primary structure. No shadow
except the Snapshot.

**10. Primary navigation.** Context / Changes / History, with Why as a full-width
*article* below the selected file rather than a side pane.

**11. Context list appearance.** A numbered contents list with leader-aligned token counts;
state as a short italic word.

**12. Selected / Dropped representation.** Selected = ink-filled numeral, `Selected`.
Dropped = hollow numeral, `Dropped`. Weight and fill differ, not hue.

**13. Why inspector.** Reads as a short article: claim sentence, supporting evidence
paragraphs with provenance as footnotes. The most human-readable Why of the three.

**14. Evidence visualization.** A **provenance marginalia** system — evidence codes set as
small-caps marginal notes aligned to the paragraph they support, with the relationship
expressed as `source → target` in the margin. Typographic rather than graphical.

**15. Controls.** Quiet text-weight buttons, almost no fills; a single primary action.

**16. Status semantics.** Words lead entirely; colour is a thin underline.

**17. Motion.** Near-zero. Instant transitions, section reveal only.

**18. Empty state.** An epigraph and one example task.

**19. Snapshot visual composition.** A masthead: task as headline, rule, then a two-column
fact block and a short evidence excerpt.

**20. Proof Lab style.** Genuinely excellent here — three case studies as short papers.

**21. Hero appearance.** A sequence of typeset states with rules between them.

**22. Brand signature.** The rule-and-marginalia system and the ink/paper contrast.

**23. GitHub screenshot quality.** Strong for README (reads like documentation), weaker as a
social card; low colour energy, and at 50% the marginalia turns to grey fuzz.

**24. Accessibility risks.** Long measures and low-contrast marginalia are the main risks;
serif at small sizes in a dense list is worse than sans.

**25. Implementation complexity.** High — this is a genuine layout-model change, and the
marginalia system requires restructuring the evidence DOM.

**26. Long-term maintainability.** Medium. Attractive but the most bespoke of the three.

**27. Main weakness / risk.** It can read as *a document about* a tool rather than a tool,
which weakens the "instrument I operate" feeling and makes the Studio feel slower to use
than it is. Also the largest diff against a frozen-architecture constraint.

---

## Direction C — "Dark Workbench"

**1. Name.** Dark Workbench.

**2. Core personality.** A terminal-adjacent instrument panel. Dense, quiet, keyboard-first,
built for people who live in a dark editor.

**3. Why it fits RepoBound.** Its audience already works in dark IDEs, and a dark surface
makes a dense list feel calmer next to a terminal.

**4. Light / dark / hybrid.** Dark primary, no light mode.

**5. Main palette.** The generic developer palette the engine recommended — background
`#0F172A`, primary `#1E293B`, border `#475569`, muted `#94A3B8` — with an amber accent
`#D9A05B` replacing the recommended green `#22C55E`.

**6. Typography strategy.** JetBrains Mono for nearly everything, Plex Sans only for prose.

**7. Density.** Highest of the three — 26px rows, 12–13px base.

**8. Spacing philosophy.** Tight and even; grouping by hairline separators on a dark field.

**9. Border / radius / shadow.** Radius 3–4px; borders at ~8% white; no shadow.

**10. Primary navigation.** Narrow icon+label rail; Why as a right-hand inspector.

**11. Context list appearance.** Monospace rows, state as a coloured leading glyph plus word.

**12. Selected / Dropped representation.** Selected = amber bar + `Selected`; Dropped =
dimmed bar + `Dropped`, with an explicit non-disabled hover affordance.

**13. Why inspector.** Monospace evidence table with a human sentence above it.

**14. Evidence visualization.** An **evidence rail**: vertical connector lines drawn from
each selected file down to the evidence that justifies it, rendered in a dedicated gutter.

**15. Controls.** Dark, borderless, hover-lit; segmented control for modes.

**16. Status semantics.** Glyph + word + colour.

**17. Motion.** Minimal; a brief rail-draw on inspector change.

**18. Empty state.** A dim grid and a prompt line.

**19. Snapshot visual composition.** Dark card with the rail and counts; high contrast.

**20. Proof Lab style.** Terminal-session styled.

**21. Hero appearance.** Dark UI frames in sequence.

**22. Brand signature.** The connector rail.

**23. GitHub screenshot quality.** Mixed. High contrast helps at 50%, but dark UI screenshots
on a white README are the most common developer-tool image on GitHub — the opposite of a
distinctive first impression.

**24. Accessibility risks.** Highest of the three. Dark surfaces make 4.5:1 harder for
secondary text; `#94A3B8` on `#0F172A` is only ~7:1 by luck of the palette, and any
"dimmed" dropped row would fail. Long paths in mono at 12px are the worst of the three.

**25. Implementation complexity.** Medium-high — an inverted token set touches every rule,
and dimming must be re-verified against contrast.

**26. Long-term maintainability.** Medium. Single theme is simpler, but every future colour
decision must be re-checked in dark.

**27. Main weakness / risk.** It is exactly the generic developer-tool look, so brand
uniqueness collapses; and it contradicts the light, calm, evidence-inspection character the
existing V1 system already committed to.

---

## Weighted rubric

`Premium credibility 20 · GitHub first impression 20 · Brand uniqueness 20 ·
Comprehension 15 · Screenshot/share 10 · UX clarity 10 · Maintainability 5`

| Criterion (max) | A — Budget Ruler | B — Broadsheet | C — Dark Workbench |
|---|---:|---:|---:|
| Premium developer-tool credibility (20) | 18 | 15 | 16 |
| GitHub first impression (20) | 17 | 13 | 13 |
| Brand uniqueness (20) | 18 | 16 | 7 |
| Product comprehension (15) | 14 | 11 | 11 |
| Screenshot / sharing (10) | 9 | 6 | 7 |
| UX clarity (10) | 9 | 7 | 8 |
| Maintainability (5) | 4 | 3 | 3 |
| **Total (100)** | **89** | **71** | **65** |

Meaningful tradeoffs only:

- **B loses on speed and shareability.** Its Why is the best of the three, but a low-contrast
  marginalia system degrades exactly where RepoBound is most often seen — a 1200×630 card
  and a README screenshot. It also carries the largest structural diff, which conflicts with
  a frozen architecture.
- **C loses on uniqueness and accessibility.** It scores well on familiarity, but familiarity
  is the problem: it is the default look for this product category, it discards V1's
  committed identity, and "Dropped" rows on dark are the hardest accessibility case here.
- **A wins on the two heaviest criteria at once.** The budget ruler makes the single most
  distinctive product fact visible in the first screen, which raises comprehension *and*
  uniqueness from the same move — it is not a palette choice dressed up as a concept.

## Selection

**Selected: Direction A — Budget Ruler (89/100).**

Chosen on judgement, not only arithmetic. The deciding factor is that RepoBound's real
difference from a file picker is the *hard budget*, and Direction A is the only direction
that makes that difference the visual anchor. It also fixes the confirmed weaknesses at
their root rather than decorating them: Why becomes an inspector instead of a destination
(nav duplication), the per-row `<select>` column becomes a selection + action bar (control
noise), the ruler carries the result hierarchy (weak hierarchy and dead space), and tabular
mono replaces log-like evidence leading.

Two deliberate departures from the engine's own recommendation are recorded in
`UIUX_PRO_MAX_AUDIT.md`: the recommended dark slate + green palette and its
"Avoid: light mode default" rule are rejected, because green is forbidden for state in this
product and the dark/green combination is the least distinctive option available.

**Risks accepted with the selection**

1. The ruler must be driven only by real recorded numbers; if it cannot be, it is removed
   rather than faked.
2. It must stay compact or it recreates weakness B.
3. A dark mode is out of scope for V2; the token layer will be shaped so a dark theme can be
   added later without re-deriving the palette.
