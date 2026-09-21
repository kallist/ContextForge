# RepoBound Visual Launch Handoff

## Current branch

`feat/visual-launch-system`

## Current commit

`25f155a5507d1d9c43e53b321c86d1999d6d01f6` (latest implementation commit before this handoff refresh)

## Completed

- Studio 3.0 warm-light Context → Why workbench and responsive layout.
- Contextual controls, preserved deep views, keyboard focus, and no-green state system.
- Local Canvas Context Snapshot with 1200×630 PNG download.
- Deterministic task/review/debugging fixture evidence and proof manifest.
- Three-case static Proof Lab at `/proof/`.
- 12–20 second WebM Hero, Pages redesign, README/README_ZH visual-first refresh.
- Stale public pre-release copy removed from README and Pages surfaces.
- Real Chromium screenshots reviewed at required Studio, Pages, Proof, and mobile sizes.

## Remaining

- Commit this README/handoff refresh.
- Push the branch and create one Draft PR; do not merge.
- Hosted CI and Pages preview remain pending until the Draft PR is created.

## Files changed

- `src/adapters/studio/assets/{index.html,studio.css,studio.js}`
- `scripts/{studio-e2e,launch-assets,build-site,site-e2e,launch-validate,brand-audit}.mjs`
- `site/index.html`, `site/site.css`, `site/proof/**`
- `docs/assets/{repobound-hero.png,repobound-context.png,repobound-why.png,context-snapshot.png,repobound-hero.webm,social-card.png,repobound-flow.svg}`
- `docs/visual/**`, `README.md`, `README_ZH.md`

## Design decisions frozen

- Warm-light neutral system with restrained dark amber `#a96818` emphasis.
- Native HTML/CSS/JS; Canvas snapshot; static Proof Lab.
- Context → Why workbench is the central Studio composition.
- Snapshot and Proof data come from real deterministic RepoBound fixtures.
- Public evidence says what RepoBound produced, never what a coding model achieved.

## Do not change

Follow `DESIGN_SYSTEM.md`. Do not choose a new palette. Do not use green. Do not add
gradients or glow. Do not migrate framework. Do not alter product semantics. Do not
fabricate metrics. Continue the frozen design. Do not change compiler, retrieval,
ranking, Pack, token estimator, Capsule, Explain, Coverage, Replay, Review, benchmark,
MCP, SQLite schema, or `.contextforge` state semantics.

## Exact next task

Commit the documentation refresh, push `feat/visual-launch-system`, and create one
Draft PR titled `feat: introduce RepoBound visual launch system`. Then observe the
required hosted checks without merging.

## Acceptance criteria

- `npm run lint`, `typecheck`, `test`, `build`, `studio:e2e`, `site:e2e`, and
  `launch:validate` pass in the final recorded run.
- Diff contains no compiler/retrieval/ranking/Pack/database/MCP semantic change.
- Draft PR includes screenshots, Snapshot, Hero, design summary, claim boundary,
  and actual validation results. It remains unmerged.

## Known issues

- Hosted CI: not run yet for this branch.
- Published Pages `/proof/`: not deployed until merge to `main`; local static build is tested.
- Hero is WebM plus a static poster; no large GIF is produced.
- The legacy `brand:core-freeze` gate rejects all intended `src/adapters/studio/assets/**`
  changes because it was designed for the earlier rename-only migration. It was not
  weakened. An exact frozen-engine path diff against `origin/main` passed instead.

## Validation commands

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run studio:e2e
npm run site:e2e
npm run launch:validate
npm run brand:audit
```

Final local evidence: lint PASS; typecheck PASS; production/test builds PASS;
`npm test` 216 passed / 0 failed; Studio Chromium PASS; five-route Pages Chromium
PASS at 390/1024/1512; launch validation PASS; brand audit PASS; `git diff --check`
PASS; frozen compiler/application/composition/SQLite/MCP/filesystem/parser/Git/
benchmark path diff PASS.

## Visual references

- Product-presentation principles from Archify as described by the task; no copied
  assets, palette, layout, identity, or source.
- Frozen internal reference: `docs/visual/DESIGN_SYSTEM.md`.

## Last screenshots

- Studio: `.studio-output/studio-launch-{1024,1280,1512}.png`
- Snapshot: `docs/assets/context-snapshot.png` (1200×630)
- Proof Lab: `.studio-output/proof-lab-{desktop,mobile}.png`
- Pages: `.studio-output/site-home-{desktop,mobile}.png`
- Hero: `docs/assets/repobound-hero.webm`
