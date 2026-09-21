# RepoBound Design System V2 — "Budget Ruler"

Status: **frozen source of truth for visual work.** Product semantics are out of scope.
Supersedes `docs/visual/DESIGN_SYSTEM.md` (V1), which remains readable for history.
Chosen direction and the rejected alternatives: `DIRECTION_EXPLORATION_V2.md`.
External design-engine evidence and dispositions: `UIUX_PRO_MAX_AUDIT.md`.

---

## 1. Philosophy

RepoBound is a **measuring instrument**, not a dashboard and not a chat surface. It answers
one question — *what repository context will my coding agent receive?* — and it answers it
with recorded facts.

The single fact that separates RepoBound from a file picker is that a **hard token budget
bounds the selection**, and that every inclusion and exclusion carries **recorded evidence**.
V2 therefore makes the budget and the evidence the two visual anchors. Everything else is
supporting structure.

Three rules govern every decision in this document:

1. **Measure, don't decorate.** Visual weight is spent on real numbers and real paths.
2. **Structure is typographic and ruled, not boxed.** Hierarchy comes from scale, weight,
   alignment, and one rule weight — not from cards, shadows, or fills.
3. **State is never carried by colour alone.** Every state carries a word, and a second
   redundant cue (shape or fill).

RepoBound compiles context. Agents act elsewhere. The interface must never imply that
RepoBound measured agent success.

---

## 2. Palette

Warm paper instrument. One accent. No green anywhere.

```css
:root {
  /* Surfaces */
  --rb-bg: #f7f5f0;
  --rb-surface: #ffffff;
  --rb-surface-sunken: #f1eee8;
  --rb-surface-hover: #f4f1eb;

  /* Ink */
  --rb-text: #1b1917;          /* 16.09:1 on bg */
  --rb-text-secondary: #55514b;/*  7.23:1 on bg */
  --rb-text-muted: #6f6a61;    /*  4.93:1 on bg — AA for normal text */

  /* Rules */
  --rb-border: #e0d9cd;        /* structural hairline */
  --rb-border-strong: #b8ac98; /* control boundaries, dividers that must read */

  /* Accent — amber instrument */
  --rb-accent: #8a5410;        /*  5.74:1 on bg — text-safe accent */
  --rb-accent-bright: #c98a2e; /* non-text fills/rails only; ink on it = 5.98:1 */
  --rb-accent-hover: #7a4a0e;
  --rb-accent-soft: #f0e2ca;
  --rb-accent-faint: #fbf6ec;

  /* Status */
  --rb-danger: #9c3f2c;        /*  6.10:1 on bg */
  --rb-danger-soft: #f5e2dc;
  --rb-warning: #8a5a18;       /*  5.42:1 on bg */
  --rb-focus: #8a5410;
}
```

**Measured contrast** (WCAG 2.1, on `--rb-bg`): ink 16.09:1, secondary 7.23:1, muted 4.93:1,
accent 5.74:1, danger 6.10:1. On `--rb-surface` white: ink 17.53:1, secondary 7.88:1,
muted 4.50:1, accent 6.26:1. White on accent 6.26:1; white on danger 6.64:1;
ink on accent-bright 5.98:1.

### Non-negotiable colour rules

- **No green** for success, selection, active, replay, indexed, CTA, or brand.
- `--rb-accent` is the *text-and-stroke* amber. `--rb-accent-bright` is a **fill only**
  (rails, ruler bar, marks) and must never carry small text on paper — it is 2.7:1 there.
- Amber marks exactly one of: the primary action, the active selection, a changed fact, or a
  verified state. It is never wallpaper and never a section background.
- Danger is muted brick and is reserved for destructive or failed states. It is never used to
  mean "dropped".
- No gradients, glow, glass, blur, neon, or blue-purple AI colour.
- Never encode meaning in colour alone.

---

## 3. Typography

Two bundled families, latin subset, served from the local server. **No CDN at runtime.**

- **IBM Plex Sans** (400 / 500 / 600) — all UI text.
- **JetBrains Mono** (400 / 500) — paths, identifiers, hashes, code, and **all figures**.

```css
--rb-font-ui: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
--rb-font-code: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
```

Both are SIL OFL 1.1; the licence texts ship beside the font files.

### Scale — fluid, reflow-safe

Every size is `rem`-based with `clamp()` where it scales. No fixed-height text boxes. All
line-heights are unitless. `font-variant-numeric: tabular-nums` on every figure column so
token counts align into a measuring scale.

| Role | Size | Weight | Notes |
|---|---|---|---|
| Page title | `clamp(28px, 3.4vw, 40px)` / 1.08 | 600 | −0.02em tracking |
| Task statement | `clamp(20px, 2.2vw, 26px)` / 1.25 | 500 | the compiled task, not an input |
| Section heading | `clamp(16px, 1.5vw, 19px)` / 1.3 | 600 | |
| Body / UI | `0.9375rem` (15px) / 1.55 | 400 | |
| Dense list row | `0.875rem` (14px) / 1.45 | 400–500 | paths in mono |
| Data / mono | `0.8125rem` (13px) / 1.5 | 400–500 | tabular figures |
| Metadata | `0.75rem` (12px) / 1.4 | 500 | |
| Eyebrow | `0.6875rem` (11px) / 1.4 | 600 | uppercase, +0.08em, max 3 words |

Uppercase is permitted **only** for eyebrows and short labels of three words or less. Never
set the whole product in monospace. Mono is for data, not for prose.

---

## 4. Spacing, radius, borders, shadow

```css
--rb-space-1: 4px;  --rb-space-2: 8px;  --rb-space-3: 12px; --rb-space-4: 16px;
--rb-space-5: 20px; --rb-space-6: 24px; --rb-space-8: 32px; --rb-space-12: 48px;
--rb-radius-sm: 4px; --rb-radius-md: 6px; --rb-radius-lg: 10px;
--rb-shadow-overlay: 0 18px 48px rgba(45, 38, 28, 0.14);
```

- Rhythm is strictly 4/8/12/16/24/32/48. No arbitrary values.
- **Radius is tight**: 4px controls, 6px composed surfaces, 10px only for the Snapshot and
  floating overlays. V1's softer 6/9/12 is retired — sharpness is part of the instrument.
- **One hairline weight** (`--rb-border`). Structure is expressed with rules, not containers.
- Shadow is permitted **only** for the Snapshot preview and floating menus. There is no card
  elevation anywhere in the workbench.

---

## 5. Layout and navigation

### Information architecture — the fix for nav duplication

V1 exposed `Context / Why / History` in the top bar **and** `Context & Why / Why / Exact
context / Coverage / Changes / Replay` as view tabs. "Why" existed at two levels and
"Context & Why" duplicated the entire workbench.

V2 has exactly **three destinations**, and Why is not one of them:

| Destination | Contains |
|---|---|
| **Context** | workbench: the ruler, the context result, the list, and the persistent Why inspector |
| **Changes** | semantic diff / change-and-impact |
| **History** | saved Capsules, replay, semantic diff across history, import |

`Why` is a **property of the selected file**, shown in a persistent inspector beside the
list. It is never a destination. Deep views (`Exact context`, `Coverage`) are reachable from
the inspector and from the result bar rather than occupying primary navigation. `Changes`
and `Replay` remain fully available — nothing is removed, only un-nested.

### Layout model

```
┌ topbar ─────────────────────────────────────────────────────────┐
│ RepoBound  ·  repository/branch  ·  Indexed     Context Changes History │
├─────────────────────────────────────────────────────────────────┤
│ composer  (task + budget + Build Context)                        │
├─────────────────────────────────────────────────────────────────┤
│ result bar: task · capsule · counts                              │
│ capacity ruler                                                   │
├──────────────────────────────┬──────────────────────────────────┤
│ context list  (~58%)         │ why inspector  (~42%)            │
└──────────────────────────────┴──────────────────────────────────┘
```

- Primary targets: 1512×982 and 1280×800. At **<1100px** the inspector stacks below the list.
- At **<820px** the topbar wraps and the destination nav becomes full-width.
- No horizontal page overflow at any width, including 390px.
- Long paths wrap with `overflow-wrap: anywhere`; they are never clipped.
- Content-driven heights only: nothing that contains text may set a fixed height.

### Vertical budget

The composer is the only thing allowed above the result, and it is capped: after the first
compile the hero copy collapses so the ruler is on screen without scrolling at 768px height.
Reaching the context result must cost at most one scroll at 1024×768.

---

## 6. Components

### 6.1 Capacity ruler — the brand signature

The product's signature. It encodes the hard budget as a bounded scale:

- A horizontal track spanning the content width, representing the **entire token budget**.
- The **used** portion filled in `--rb-accent-bright`.
- The **remaining** portion as a quiet hatched/tinted track inside the same boundary.
- One **tick per selected file**, positioned at the file's cumulative token offset.
- A single **index mark** at the current total, in `--rb-accent`.
- Marks for each dropped/considered file drawn below the track in muted ink.

Truthfulness rules: every number comes from the compiled Capsule. If the values are not
available, the ruler is **removed** — it is never rendered with invented or approximated
data. The ruler carries a text equivalent (`role="img"` + `aria-label` stating real used,
budget, and remaining values) and must never be the only carrier of the budget value; the
result bar states it in text too.

### 6.2 Context list

A ruled list, not a data grid. Each row:

| Element | Treatment |
|---|---|
| State rail | 3px left rail; **filled** amber = Selected, **hollow** neutral = Dropped, muted strike = Excluded |
| Path | mono, directory portion at `--rb-text-muted`, basename at `--rb-text` |
| Tokens | right-aligned, mono, tabular figures |
| State word | `Selected` / `Dropped` / `Excluded` as a short label — always present |

Rows are keyboard-selectable (`tabindex`, arrow keys, Enter). The active row gets a faint
warm background **plus** the rail, never colour alone. **Dropped rows are rendered at full
text contrast and remain fully operable** — dropped means considered and not selected, never
irrelevant and never disabled.

### 6.3 Controls

Native semantics, high-quality styling. No re-implemented listboxes.

- **Primary** — filled amber, white text (6.26:1). Exactly one per view.
- **Secondary** — transparent, `--rb-border-strong` border, ink text.
- **Quiet** — no fill or border until hover.
- **Destructive** — brick text/border; filled brick only at final confirmation.
- **Segmented control** — for mode and filter; real `<button>`s in a `role="group"` with
  `aria-pressed`, not a `<select>`.
- Every control: `:focus-visible` 2px accent outline, 2px offset, never removed.
- Minimum interactive box 32px (dense rows) / 40px (primary controls); touch targets ≥44px
  at coarse pointers via `@media (pointer: coarse)`.
- A `<select>` is used **only** where a native select is genuinely the right control
  (e.g. "Compare with"). It is never used as a per-row action menu.

### 6.4 Contextual actions — the fix for per-row control noise

V1 rendered a `<select>` on **every** row. UX Pro Max's `Bulk Actions` guideline names
"repeated actions per row" as the anti-pattern and prescribes a selection plus action bar.

V2 removes the per-row select entirely:

- Rows carry a **selection** affordance (click / Space / Enter), multi-select with Ctrl/Cmd
  and Shift.
- An **action bar** appears for the current selection with `Include`, `Prefer`, `Exclude`,
  and — behind an "Advanced" disclosure — `Focus` and `Range`.
- With nothing selected, the action bar is not rendered (no permanently reserved empty strip).
- The bar is a toolbar with `role="toolbar"`, reachable by keyboard, and announces its
  target count in text, e.g. `2 files selected`.
- Every action retains its existing recorded semantics. This is a presentation change only.

### 6.5 Why inspector

Order of presentation, most human first:

1. **Path, state, and the recorded decision** in one plain sentence built only from recorded
   fields (e.g. state, decision, and the primary reason's human label).
2. **Evidence** — a vertical rule, the human-readable reason, and the relationship as
   `source → target` in mono.
3. **Relationships** — relevant symbols, tests, imports, path evidence.
4. **`Decision details`** — a disclosure holding the raw provenance codes
   (`TEST_RELATION · STRUCTURAL`, `PATH_COMPONENT · LEXICAL`, `FILE_IMPORTED_BY · STRUCTURAL`)
   and the raw record.
5. **Contextual controls** for the inspected item, plus access to `Exact context`.

Rules: raw codes never lead. No human-readable meaning may be invented that the recorded
evidence does not support — where only a code exists, the code is shown with a neutral
label rather than a guess. The inspector never says "the model decided".

### 6.6 Evidence visualization

Beyond the ruler, evidence is expressed as a **stem**: each evidence item is a short vertical
rule from the item's state rail to the reason, so a reader sees which facts attach to the
selected file. Structural relationships are always `source → target` in mono. No graph
canvas, no force layout, no decorative node art.

### 6.7 States and status

| State | Word | Second cue | Colour |
|---|---|---|---|
| Selected | `Selected` | filled rail | accent |
| Dropped | `Dropped` | hollow rail | neutral ink, full contrast |
| Excluded | `Excluded` | strike + hollow rail | muted |
| Verified | `Verified` | check glyph | accent |
| Changed | `Changed` | rule + marker | accent |
| Failed | `Failed` | glyph | danger |

---

## 7. Motion

- Durations: `--rb-motion-fast: 110ms` (hover/colour), `--rb-motion: 160ms` (reveal,
  inspector change, ruler index mark).
- Motion is used only where it explains a change: selection, inspector change,
  Include/Exclude, Rebuild, and Dropped → Selected.
- One animated element per change, maximum.
- **No** bounce, spring, pulse, float, parallax, cursor trails, or ornamental animation.
- State must never depend on `animationend`/`transitionend` for correctness.
- `@media (prefers-reduced-motion: reduce)` removes all transitions and the ruler slide and
  renders final state immediately.

---

## 8. Accessibility requirements

- Body and secondary text ≥4.5:1; large text ≥3:1; meaningful non-text ≥3:1. Values above
  are pre-measured; any new colour must be measured before use.
- Visible `:focus-visible` indicator on every operable control, including inside overlays.
- Never colour alone: every state carries a word plus a shape or fill cue.
- Complete keyboard operation: tab order follows visual order; rows, tabs, segmented
  controls, and action bar all operable without a pointer; no keyboard trap.
- **Reflow and text scaling (Critical):** fluid type, unitless line-height, content-driven
  height, no clipped or fixed-size text container. Must hold at 200% zoom and at narrow
  widths down to 390px without loss of content or horizontal page overflow.
- Long paths: `overflow-wrap: anywhere` plus a full-path disclosure on the inspected item.
- Semantic HTML: real buttons, labelled inputs, sequential headings, live regions for
  status and compile progress, accessible names on icon-only controls.
- Overlays trap and restore focus; Escape closes; no obscured focus.

---

## 9. Context Snapshot

- Fixed **1200 × 630**.
- Must stay legible and recognisable at 100%, 50%, and GitHub/social preview size.
- Composition: task and budget as the large left statement; the **capacity ruler** as the
  dominant graphic; selected/dropped counts as figures; a short mono column of selected
  paths; Capsule identity; Replay status when recorded.
- Factual only. Allowed: task, budget, selected, dropped, real selected files, real recorded
  evidence, real relationships, real controls, Replay status. **Forbidden:** any claimed
  improvement, saving, accuracy, productivity, or quality metric.
- No invented repository evidence.

## 10. Proof Lab

- Exactly **three** cases: Task Context, Review Context, Context Debugging. No new cases.
- Must read as **curated technical evidence**, not a marketing card gallery.
- Each case: numbered, the verbatim task, the ruler, the resulting context list, and the
  recorded reason for at least one dropped file. Real fixture data only.

## 11. Hero and README

- Hero preserves the truthful loop: task → Build Context → Selected/Dropped → Why →
  Include → Rebuild → Dropped → Selected, with the ruler visible.
- README first screen: identity, one clear explanation, strong visual proof, install command,
  Proof Lab link — before any long technical prose. Not a marketing brochure.

---

## 12. DO / DON'T

| DO | DON'T |
|---|---|
| Let the budget and the paths carry the hierarchy | Build KPI tiles or card grids for counts |
| Use rules, scale, and alignment for structure | Nest rounded containers and add shadows |
| Keep one accent amber for the active fact | Wash surfaces in amber or add a second accent |
| Say `Selected` / `Dropped` in words | Depend on colour or on a tooltip |
| Keep dropped rows at full contrast and operable | Dim, disable, or hide dropped files |
| Lead the inspector with a plain sentence | Lead with `TEST_RELATION · STRUCTURAL` |
| Drive the ruler only from real compiled numbers | Render placeholder or invented values |
| Use native controls with strong styling | Re-implement a listbox or a custom select |
| Keep the layout reflow-safe and zoom-safe | Fix heights, clip text, or overflow the page |
| State only recorded facts | Claim accuracy, savings, or agent success |
