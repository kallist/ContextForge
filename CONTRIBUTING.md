# Contributing to ContextForge

ContextForge is a local-first TypeScript CLI and MCP stdio server. Keep changes small, typed, offline-by-default, and inside the existing discovery, analysis, graph, retrieval, packing, persistence, CLI, and adapter boundaries.

## Development setup

Use Node `>=24.15 <25`; the repository and CI use Node 24.20.0 as the current validation runtime.

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke
npm run package:smoke
```

Before proposing a release-affecting change, also run `npm run release:check` and the full frozen benchmark with `npm run benchmark` when ranking, packing, estimator behavior, benchmark infrastructure, or release evidence could change.

## Pull requests

- Base feature work on current `main`; keep unrelated changes out of the branch.
- Add behavior-focused regression tests for defects, including failure and security paths.
- Never weaken or skip a relevant gate to make a change pass.
- Do not add secrets, private paths, real credentials, or proprietary repository content to fixtures or logs.
- Keep provider/network behavior out of the local-first core. MCP remains an adapter over application use cases.
- Do not expose SQLite, parser, ranking, or SDK types as an accidental public library API.

## Benchmark integrity

`contextforge-benchmark-v1` is frozen evidence, not an optimization target. Do not change Gold, delete unfavorable cases, tune production behavior after observing scores, or cherry-pick results. Changes to benchmark semantics require an explicit new version and regenerated traceable artifacts. Preserve the published negative evidence: the 60% token-reduction target was not met, and structural ranking did not show an aggregate advantage over the lexical baseline on benchmark-v1.

Commits, pushes, merges, tags, GitHub Releases, and npm publication are separate actions. Do not merge or publish without explicit authorization.
