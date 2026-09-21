# RepoBound Visual Launch Handoff

## Current branch

`feat/visual-launch-system`

## Current commit

`274076fcd00ec25097a03e84b3655e7e18e0024a` (visual work not committed yet)

## Completed

- Repository, architecture, public copy, Studio, Pages, and browser-test audit.
- Visual system and acceptance specifications frozen in `docs/visual/`.

## Remaining

- Studio 3.0 implementation and screenshots.
- Context Snapshot implementation, deterministic fixture, PNG validation.
- Three-case Proof Lab, Pages alignment, Hero demo, README refresh.
- Targeted validation, final review, logical commits, push, and one Draft PR.

## Files changed

- `docs/visual/DESIGN_SYSTEM.md`
- `docs/visual/STUDIO_3_SPEC.md`
- `docs/visual/SNAPSHOT_SPEC.md`
- `docs/visual/PROOF_LAB_SPEC.md`
- `docs/visual/VISUAL_ACCEPTANCE.md`
- `docs/visual/DEEPSEEK_HANDOFF.md`

## Design decisions frozen

- Warm-light neutral system with restrained dark amber `#a96818` emphasis.
- Native HTML/CSS/JS; Canvas snapshot; static Proof Lab.
- Context → Why workbench is the central Studio composition.
- Snapshot and Proof data must come from real deterministic RepoBound fixtures.

## Do not change

Follow `DESIGN_SYSTEM.md`. Do not choose a new palette. Do not use green. Do not add
gradients or glow. Do not migrate framework. Do not alter product semantics. Do not
fabricate metrics. Continue the frozen design. Do not change compiler, retrieval,
ranking, Pack, token estimator, Capsule, Explain, Coverage, Replay, Review, benchmark,
MCP, SQLite schema, or `.contextforge` state semantics.

## Exact next task

Refactor `src/adapters/studio/assets/index.html` and `studio.css` into the Studio 3.0
Context → Why workbench while retaining current element IDs and API-backed behavior.
Then adapt `studio.js` for inline inspection and contextual controls.

## Acceptance criteria

- Meets `STUDIO_3_SPEC.md` and `VISUAL_ACCEPTANCE.md`.
- Existing Studio API/browser tests stay behaviorally strong.
- 1512×982, 1280×800, and 1024×768 screenshots inspected with no overflow.

## Known issues

- Current public README and Pages contain stale “not public until release” copy.
- Current Studio uses a dark green-accent dashboard-like layout.
- Current launch asset script creates a manually styled dark social card.

## Validation commands

```sh
npm run lint
npm run typecheck
npm run build
npm run studio:e2e
npm run site:e2e
npm run launch:validate
```

## Visual references

- Product-presentation principles from Archify as described by the task; no copied
  assets, palette, layout, identity, or source.
- Frozen internal reference: `docs/visual/DESIGN_SYSTEM.md`.

## Last screenshots

- Baseline v0.5.1 assets: `docs/assets/repobound-hero.png`,
  `docs/assets/repobound-context.png`, `docs/assets/repobound-why.png`.
- Studio 3.0 screenshots: not captured yet.
