# V0.5 core freeze audit

Base origin/main and v0.4.1: 3598256d6b0bf853c280d74c3a6203d5d130eebc

Candidate: feat/v0.5-agent-experience-launch. Implementation head: `f4d26e2cf3ffa19f50e29ed2133b7784ac08ea6a`. The following evidence-only commit adds this audit and ACCEPTANCE.md; use git diff from the base to the PR head to reproduce this inventory. The Draft PR records the final head and its hosted checks.

Production changes are exactly the three packaged Studio static assets. Every other src path and every benchmarks path is unchanged. scripts/v05-core-freeze.mjs enforces this boundary, including untracked source additions, and runs in CI.

Compiler: NO. Ranking: NO. Gold: NO. V2 promotion: NO. MCP expansion: NO. Database/API semantics: unchanged.

Changed paths in the candidate working tree before the evidence commit:

- .github/workflows/ci.yml
- .github/workflows/pages.yml
- CHANGELOG.md
- contextforge/references/trust-and-boundaries.md
- contextforge/references/workflows.md
- contextforge/SKILL.md
- docs/assets/contextforge-context.png
- docs/assets/contextforge-flow.svg
- docs/assets/contextforge-hero.png
- docs/assets/contextforge-why.png
- docs/assets/social-card.png
- docs/ENGINEERING_REFERENCE.md
- docs/RELEASE_NOTES_V0.5.0.md
- docs/v0.5/ACCEPTANCE.md
- docs/v0.5/AGENT_SKILL.md
- docs/v0.5/COMMUNITY_LAUNCH.md
- docs/v0.5/GITHUB_EXPERIENCE_AUDIT.md
- docs/v0.5/LAUNCH.md
- docs/v0.5/PRODUCT_POSITIONING.md
- docs/v0.5/STUDIO_VISUAL_REVIEW.md
- package-lock.json
- package.json
- README_ZH.md
- README.md
- scripts/build-site.mjs
- scripts/codex-skill-discovery.mjs
- scripts/launch-assets.mjs
- scripts/launch-validate.mjs
- scripts/package-smoke.mjs
- scripts/release-check.mjs
- scripts/release-hardening.mjs
- scripts/review-e2e.mjs
- scripts/site-e2e.mjs
- scripts/skill-validate.mjs
- scripts/studio-e2e.mjs
- scripts/studio-navigation.mjs
- scripts/v05-browser.mjs
- scripts/v05-core-freeze.mjs
- scripts/v05-parity.mjs
- site/index.html
- site/site.css
- src/adapters/studio/assets/index.html
- src/adapters/studio/assets/studio.css
- src/adapters/studio/assets/studio.js
- test/e2e/cli.test.ts
- test/integration/studio-api.test.ts
- docs/v0.5/CORE_FREEZE_AUDIT.md
