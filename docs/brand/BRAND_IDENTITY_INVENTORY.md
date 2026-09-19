# RepoBound brand identity inventory

Baseline: `origin/main` / `v0.5.0` at `edfb3ad7c0780b198bcec742e5f4126111d6e674`.

This inventory was created before broad brand edits. It classifies the complete
repository search for `ContextForge`, `contextforge`, `CONTEXTFORGE`,
`@kallist/contextforge`, `kallist/ContextForge`, and the old Pages path.

## Classification policy

| Category | Treatment |
|---|---|
| `PUBLIC_BRAND` | Rename current user-facing product copy to RepoBound. |
| `PUBLIC_COMMAND` | Make `repobound` canonical; keep `contextforge` only as the v0.5.1 compatibility alias. |
| `PUBLIC_PACKAGE` | Change the candidate to `@kallist/repobound@0.5.1`; retain the old package only in migration/history text. |
| `PUBLIC_URL` | Point release-candidate metadata and current docs at `kallist/RepoBound` or use relative links. |
| `STABLE_PROTOCOL_IDENTIFIER` | Preserve serialized Capsule, Explain, controls, diff, replay, review, strategy, estimator and MCP compatibility identifiers. |
| `PERSISTED_DATA_IDENTIFIER` | Preserve `.contextforge`, SQLite schema metadata, generation records and Studio capability storage keys. |
| `BENCHMARK_IDENTIFIER` | Preserve frozen dataset, benchmark, system, strategy and evidence identifiers. |
| `HISTORICAL_RECORD` | Preserve dated release/evaluation evidence and immutable tag/package references. |
| `TEST_FIXTURE` | Preserve fixture labels when identity is not public; update assertions only when they test a migrated public surface. |
| `COMPATIBILITY_ALIAS` | Retain the legacy CLI/bin and explicit old-package migration examples. |
| `INTERNAL_SYMBOL` | Keep `ContextForge*` TypeScript symbols and filenames where they are not public display/API contracts. |
| `GENERATED_ARTIFACT` | Do not edit ignored build, benchmark or runtime output; regenerate from the candidate. |

## Occurrence inventory

- `PUBLIC_BRAND`: `README.md`, `README_ZH.md`, `site/index.html`, Studio HTML,
  current product/specification and maintained architecture prose, current security
  and contribution copy, CLI human-readable headings/errors/help, current v0.5
  integration/launch documentation, and visible SVG/raster assets.
- `PUBLIC_COMMAND`: package `bin`, README/site/current docs/Skill examples, CLI help,
  package smoke, release hardening/check, Skill/Studio/browser/site validation and
  migrated CLI tests. Legacy `contextforge` remains only where the alias is exercised
  or migration behavior is documented.
- `PUBLIC_PACKAGE`: `package.json`, `package-lock.json`, README/site/current docs and
  candidate packaging/install assertions. `@kallist/contextforge` remains in historical
  release evidence and migration/compatibility tests.
- `PUBLIC_URL`: package repository/bugs/homepage metadata, badges, current docs,
  site metadata/navigation and future Skill install commands. Historical release URLs
  remain historical.
- `STABLE_PROTOCOL_IDENTIFIER`: all `contextforge-capsule-v1/v2`,
  `contextforge-explain-v1`, `contextforge-controls-v1`, `contextforge-coverage-v1`,
  `contextforge-diff-v1`, `contextforge-replay-v1`, `contextforge-review-v1`,
  `contextforge-structural-v1`, `contextforge-pack-v1/v2`,
  `contextforge-generic-v1`, V2 strategy/plan/relationship IDs and conformance schema
  IDs in `src/core/**`, `src/application/**`, tests and contracts.
- `PERSISTED_DATA_IDENTIFIER`: `.contextforge`, `.contextforgeignore`, SQLite schema
  versions/tables, on-disk history/index paths, deterministic generation metadata and
  the `contextforge-capability` browser-session key. These remain unchanged in v0.5.1.
- `BENCHMARK_IDENTIFIER`: `contextforge-benchmark-v1`, `contextforge-dataset-v1`,
  `contextforge-v1`, V2 benchmark system IDs, benchmark analysis schemas/results and
  frozen corpus/reference material under `benchmarks/**` and benchmark evidence docs.
- `HISTORICAL_RECORD`: `CHANGELOG.md`, `CONTEXTFORGE_MASTER_SPEC.md`, prior
  `docs/RELEASE_NOTES_V0.*`, `docs/V0.*`, `docs/v0.5/**` evidence whose claims are
  explicitly about the v0.5.0 launch, benchmark reference artifacts and old tags.
- `TEST_FIXTURE`: temporary directory prefixes, client names, fake Git identities,
  error-input names and internal schema fixtures in `test/**` and `scripts/**`. Public
  display/package/bin assertions will migrate; protocol/state fixtures will not.
- `COMPATIBILITY_ALIAS`: the second package bin entry, v0.5.1 CLI parity tests,
  migration guide, release notes and final rename runbook.
- `INTERNAL_SYMBOL`: `ContextForgeError`, `createContextForgeApplication`,
  `BoundContextForgeApplication`, `createContextForgeLifecycle`, MCP adapter module
  filenames/imports and other private composition types. They remain to avoid churn.
- `GENERATED_ARTIFACT`: `dist/**`, `.test-dist/**`, `.benchmark-dist/**`,
  `.benchmark-output/**`, `.studio-output/**`, tarballs, temporary npm caches, local
  SQLite state and regenerated screenshots/social cards.

## Stable-name decision

The brand migration changes distribution and display identities only. Any identifier
that participates in deterministic hashes, persisted state, benchmark Gold/reference
evidence or established machine-readable output remains byte-compatible unless a
specific compatibility test proves it is merely presentation. No database migration is
planned.
