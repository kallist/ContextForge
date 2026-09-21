# UI UX Pro Max - Usage and Recommendation Audit

Recorded for RepoBound Visual Polish V2. This file documents **what the design engine was
actually asked, what it returned, and what was accepted or rejected**. It keeps only
dispositions, not raw engine output.

## Installation

| Item | Value |
|---|---|
| Package | `ui-ux-pro-max-cli` (the official package; a stale alternate CLI package was **not** used) |
| Version | **2.15.0** |
| Install command | `npm install -g ui-ux-pro-max-cli@latest` |
| CLI on PATH | `uipro` (npm global bin on this host) |
| Skill install command | `uipro init --ai universal --global` |
| Skill install path | `~/.agents/skills/ui-ux-pro-max/` (verified on this host under the user profile; the exact absolute path is intentionally not repeated here) |
| Verified contents | `SKILL.md`, `scripts/search.py`, `data/` - all present |
| Python for the engine | Python 3.10.6 via `py -3`. On this Windows host `python3` and `python` are **not** on PATH; no Python installation was performed. |

### DeepSeek Harness integration

- **Native skill discovery: YES.** `ui-ux-pro-max` appeared in the live session skill catalog
  immediately after install and was loaded through the normal skill mechanism, which returned
  the full `SKILL.md` instructions plus the resolved base directory.
- **Manual fallback: NOT USED.** `SKILL.md` was genuinely read and `scripts/search.py` was
  genuinely executed, so the fallback path was never needed.

### Notes and non-blockers

- `uipro versions` failed with `GitHub API rate limit exceeded` (unauthenticated API). This is
  informational only and does not affect the installed version or the search engine.
- This CLI version has **no `--dry-run`** flag, so the "inspect before install" step was
  satisfied by reading the installer template (`templates/platforms/universal.json`) before
  running the real install instead.
- No UI UX Pro Max file was committed to RepoBound. The install is global and lives outside
  the repository; nothing was added to the worktree, so no `.gitignore` change was required.

## Searches actually executed

One design-system run plus 16 domain searches, all against the bundled local database.

| # | Domain | Query | Outcome |
|---|---|---|---|
| 1 | `--design-system` | `developer tool IDE coding agent repository context compiler evidence inspector context workbench premium open source tool` (dials: variance 3, motion 2, density 8) | Returned a full system; pattern match was wrong (see below) |
| 2 | style | `premium developer tool technical minimalism` | Minimalism & Swiss Style |
| 3 | style | `swiss style editorial interface grid` | Editorial Grid / Magazine |
| 4 | style | `IDE workbench high information density calm` | Data-Dense Dashboard, E-Ink/Paper, Fluent 2 |
| 5 | style | `precision tooling industrial interface` | **no database match** |
| 6 | style | `modern minimal monochrome light` | Minimalism & Swiss Style |
| 7 | style | `technical documentation reference tool` | HUD/Sci-Fi FUI, Interactive Cursor |
| 8 | style | `split pane master detail workspace` | **off-topic** (3D & Hyperrealism) |
| 9 | typography | `developer tool typography code interface` | Developer Mono (JetBrains Mono + IBM Plex Sans) |
| 10 | typography | `technical editorial premium software` | Classic Elegant, Modern Dark Cinema, Premium Sans |
| 11 | color | `developer tool coding` | Developer Tool / IDE (dark slate + a bright success hue) |
| 12 | color | `premium technical interface evidence` | Quantum Computing, Luxury/Premium, Automotive |
| 13 | ux | `inspector panel evidence hierarchy` | Breadcrumbs, Heading Hierarchy |
| 14 | ux | `information hierarchy progressive disclosure` | Colour Only, Breadcrumbs |
| 15 | ux | `dense data table row actions` | **Bulk Actions**, Table Handling |
| 16 | ux | `long file path truncation ellipsis` | Truncation, Line Length |
| 17 | ux | `keyboard navigation focus visible` | Keyboard Navigation, Focus States |
| 18 | ux | `select dropdown control overload` | Auto-Rotating Content, Cancellable State Transitions |
| 19 | ux | `empty state first use guidance` | Empty States, Mobile First |
| 20 | ux | `reduced motion animation preference` | Reduced Motion, Excessive Motion |
| 21 | ux | `text scaling browser zoom overflow` | **Text Reflow and Spacing (Critical)**, Overflow Hidden |
| 22 | ux | `table header sticky alignment` | Table Handling, Sticky Navigation |
| 23 | ux | `selection state indicator row` | Focus States, Active State |
| 24 | landing | `developer tool landing hero proof` | **no database match** |

Searches that returned no match or off-topic results are recorded as such rather than being
replaced with plausible-looking defaults.

## Recommendations accepted

| Recommendation | Source | Applied as |
|---|---|---|
| Minimalism & Swiss Style: grid-based, high contrast, **no gradients, no shadow, single accent**, low complexity | searches 2, 6 | The whole V2 system; shadow is restricted to overlays, one accent only |
| Developer Mono typography - JetBrains Mono for code/data, IBM Plex Sans for UI | search 9 | Bundled latin subsets; mono confined to paths, identifiers, and figures |
| **Bulk Actions: "repeated actions per row" is the anti-pattern; fix with selection + action bar** | search 15 | The per-row `<select>` column was removed and replaced by click-to-select plus a contextual action bar. This is the engine's single most valuable contribution to this task. |
| Focus States / Keyboard Navigation (severity High) | search 17 | `:focus-visible` on every control, full keyboard operation for rows, tabs, segmented controls, and the action bar |
| Colour Only (severity High) | search 14 | Every state carries a word plus a shape/fill cue |
| Truncation: truncate **with an expand option** | search 16 | Paths wrap with `overflow-wrap: anywhere`, plus full-path disclosure |
| Reduced Motion / Excessive Motion (severity High) | search 20 | Transitions gated on `prefers-reduced-motion`; at most one animated element per change |
| **Text Reflow and Spacing (severity Critical)** | search 21 | Fluid `clamp()` type, unitless line-height, content-driven heights, no fixed-size text containers |
| Empty States: show helpful message and an action | search 19 | Composer empty state keeps one sentence, one example, one action |
| Active State: current location must be visually indicated | search 23 | Active destination and active row each carry a redundant cue |
| Heading Hierarchy (severity Medium) | search 13 | Sequential headings, no skipped levels |
| Sticky Navigation must not obscure content | search 22 | Topbar reserves its own space; nothing scrolls under it |

## Recommendations rejected

| Rejected recommendation | Source | Why |
|---|---|---|
| **Dark slate plus bright success-hue palette** (background `#0F172A`, accent `#22C55E`, "Code dark + run green") | searches 1, 11, 12 | Two independent reasons. (a) That success hue is explicitly forbidden for success/selection/active/brand in this product. (b) It is the default palette of this entire product category, so it actively reduces brand uniqueness. Direction C was designed to test it honestly and scored lowest on uniqueness (7/20). |
| **"Avoid: Light mode default"** anti-pattern | search 1 | RepoBound's calm warm-light surface is a deliberate instrument choice for reading technical evidence; the anti-pattern is written for landing pages, not for an inspection surface. |
| Pattern **"FAQ/Documentation Landing"** (sections: *Hero with search bar to Popular categories to FAQ accordion to Contact CTA*) | search 1 | Genuine mismatch. RepoBound is a workbench application, not a support site. Discarded. |
| **Data-Dense Dashboard** - KPI cards row, chart widgets, 8px padding, 12px type | search 4 | RepoBound has no metrics to chart, and adopting KPI cards would manufacture the dashboard look the brief explicitly forbids. Its density insight was kept; its card composition was not. |
| **Tailwind / shadcn / Radix framework guidance** (present in the skill's own styling references) | skill references | Architecture is frozen at vanilla HTML/CSS/JS. Tailwind was not introduced. Guidance was translated into plain CSS. |
| **Remote Google Fonts `@import`** | searches 9, 10 | RepoBound is local-first; a CDN font would break offline use. The *families* were adopted, the *remote delivery* was replaced with bundled latin subsets. |
| Google Fonts URLs as a **runtime** font dependency | searches 9, 10 | Not used at runtime. The URLs were used once, build-time only, to obtain the woff2 files that are now vendored under their OFL licences. |
| HUD / Sci-Fi FUI, 3D & Hyperrealism, Interactive Cursor | searches 7, 8 | High accessibility risk, high complexity, decorative, and unrelated to evidence inspection. |
| Editorial Grid / Magazine and Classic Elegant (Playfair Display) | searches 3, 10 | Evaluated as Direction B (Technical Broadsheet). Rejected in the rubric: weak at 50% scale, and a document metaphor makes the tool feel slower than it is. |
| Automotive / Quantum Computing / Coding Bootcamp / Coding Challenge palettes | searches 11, 12 | Wrong product semantics entirely. |

## Influence on the outcome, honestly stated

The engine's `--design-system` result was **not** used as the visual answer. Its pattern match
was wrong, its palette is the generic category default, and its typography recommendation was
partly unusable as delivered (it suggested remote font delivery in a local-first product). The
engine's real contribution was:

1. confirming **Minimalism & Swiss Style** as the correct family, which validated the
   restrained direction rather than the decorative one;
2. the **Bulk Actions** guideline, which converted a vague "per-row controls are noisy"
   observation into a concrete, prescribed fix (selection plus action bar);
3. the **Critical** text-reflow requirement, which was not previously captured anywhere in the
   project's visual documentation and directly changed how V2 handles type sizing;
4. a set of High-severity accessibility rules (focus, colour-only meaning, reduced motion)
   that became explicit acceptance criteria.

Direction selection was made by the weighted rubric in `DIRECTION_EXPLORATION_V2.md`, not by
the engine.
