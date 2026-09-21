# RepoBound Visual Design System

## Philosophy

RepoBound is a precise developer instrument. Its visual language is quiet, technical,
premium, human, warm, and restrained. Product truth comes before decoration: task,
budget, selected and dropped context, recorded evidence, controls, and replay state.

Use typography, whitespace, alignment, and density to establish hierarchy. A surface
exists only when it clarifies structure. Accent color communicates state; it is never
wallpaper.

## Frozen tokens

```css
:root {
  --rb-bg: #f8f6f1;
  --rb-surface: #fdfcf9;
  --rb-surface-raised: #ffffff;
  --rb-text: #211f1b;
  --rb-text-secondary: #5f5a52;
  --rb-text-muted: #827a70;
  --rb-border: #e7e1d7;
  --rb-border-strong: #d4cbbd;
  --rb-accent: #a96818;
  --rb-accent-hover: #8d5512;
  --rb-accent-soft: #f2e2c6;
  --rb-accent-faint: #fbf4e8;
  --rb-success: #a96818;
  --rb-warning: #b87924;
  --rb-danger: #a9503e;
  --rb-danger-soft: #f3ddd7;
  --rb-focus: #9a5d14;
  --rb-shadow-subtle: 0 10px 35px rgba(52, 43, 31, 0.06);
  --rb-space-1: 4px;
  --rb-space-2: 8px;
  --rb-space-3: 12px;
  --rb-space-4: 16px;
  --rb-space-6: 24px;
  --rb-space-8: 32px;
  --rb-space-12: 48px;
  --rb-space-16: 64px;
  --rb-radius-sm: 6px;
  --rb-radius-md: 9px;
  --rb-radius-lg: 12px;
  --rb-motion-fast: 140ms;
  --rb-motion: 180ms;
  --rb-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Arial, sans-serif;
  --rb-font-code: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}
```

The darker amber values are intentional: they preserve accessible contrast on warm
light surfaces. The visual ratio is approximately 85% warm neutral, 10% grayscale
hierarchy, and 5% amber emphasis.

## Non-negotiable color rules

- No green for success, selection, active state, replay, indexed status, CTA, or brand.
- Amber marks primary action, active selection, a changed fact, or verified state.
- Danger is muted brick red and is reserved for destructive or failed states.
- Never rely on color alone. Pair color with a word, marker, icon, or position.
- Do not add gradients, glow, glass, blue-purple AI color, or decorative color charts.

## Typography

- UI uses the system sans stack. Only paths, hashes, code, tokens, and technical
  metadata use the monospace stack.
- Page title: 40–56px, 1.02–1.08 line height, restrained negative letter spacing.
- Task/context statement: 24–32px.
- Section heading: 18–24px.
- Body: 14–16px, 1.55–1.7 line height.
- Metadata and eyebrow: 11–12px; uppercase is allowed only for short labels.
- Never set the entire product in monospace.

## Spacing, radius, borders, and shadow

Use the 4/8/12/16/24/32/48/64 rhythm. Major layout gaps use 32–64px; rows use
12–16px. Prefer open whitespace over nested containers.

Most controls use 6px radius, composed surfaces 9px, and only the largest preview
surface 12px. Pills are limited to compact state labels. Borders are quiet and
structural. Shadow is allowed only for a floating menu or the Snapshot preview.

## States and controls

### Buttons

- Primary: amber background, near-black text or white text when contrast requires it.
- Secondary: transparent warm surface, strong border, dark text.
- Quiet: no fill until hover.
- Destructive: brick text/border; filled brick only at final confirmation.
- All controls receive a 2px amber focus outline with 3px offset.

### Contextual controls

When an item is selected, show Include, Prefer, and Exclude beside its inspector.
Focus and Range belong in a secondary advanced menu. Do not show five equal-weight
buttons on every file row.

### File rows and list items

- Selected: slim amber marker, stronger text, explicit `Selected` label.
- Dropped: neutral circular marker, medium emphasis, explicit `Dropped` label.
- Excluded: neutral strike/label only when the recorded state supports it.
- Active row: faint warm background plus border/marker, never color alone.
- Dropped never looks disabled; it remains inspectable and controllable.

### Evidence

Evidence uses a vertical rule, source/derivation label, and readable statement.
Structural relationships use `source → target` in monospace. Raw JSON is hidden in
disclosure details and never leads the inspector.

### Empty states

Lead with one sentence: “Build the repository context your agent should receive.”
Offer one realistic task example and the primary action. Do not use giant art,
illustrations, fake metrics, or a wall of helper copy.

## Layout

### Navigation

The quiet top bar contains RepoBound, repository/branch identity when recorded, and
the indexed state. Context, Changes, and History are secondary and never outweigh
the task composer.

### Context workbench

Desktop is a two-column composition: Context list (about 58%) and Why inspector
(about 42%). Exact Context, Coverage, Change, and Replay are deep-inspection views.
At widths below 1100px, Why stacks under Context. No horizontal page overflow.

### Inspector

The inspector begins with path, state, and recorded decision, followed by evidence,
relationships, ranges, and Exact Context access. Contextual controls sit close to
the selected item, not in a persistent global control wall.

## Responsive behavior

- 1512×982 and 1280×800 are primary presentation targets.
- 1024×768 remains fully usable; workbench stacks when necessary.
- Mobile static Proof pages use one column, preserve evidence order, and wrap paths.
- Tables may become labeled rows; the document itself must never overflow horizontally.

## Motion

Ordinary transitions are 140–180ms. Use motion for hover, inspector reveal, selection,
and Dropped → Selected. Respect `prefers-reduced-motion`. No bounce, pulsing, floating,
spring motion, cursor trails, or ornamental animation.

## DO / DON'T

| DO | DON'T |
| --- | --- |
| Use one amber marker for the active fact | Wash the page in yellow or orange |
| Let a real task and real file paths carry the story | Add fake analytics or decorative charts |
| Use two-column Context → Why hierarchy | Repeat identical rounded cards everywhere |
| Label Selected, Dropped, Verified, and Changed | Depend on color alone |
| Keep exact evidence inspectable | Describe compiler facts as model reasoning |
| Use native system fonts and local assets | Add remote fonts or frontend frameworks |
| Keep boundaries and limitations visible | Claim accuracy, savings, or agent success |

