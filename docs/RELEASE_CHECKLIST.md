# ContextForge v0.1.1 Scoped-Package Release Checklist

This checklist separates validation, review, merge, and irreversible publication. `npm run release:check` is validation-only: it never pushes, tags, publishes, creates a release, or changes Git history.

## Release lineage and candidate identity

- [x] Immutable annotated `v0.1.0` tag remains unchanged at `d41ae8daa4cb04c772dad28866fa4d0fd2dee766`; its public npm publication did not complete.
- [x] npm rejected the unscoped `contextforge` package name under its package-name similarity policy; the authorized corrected identity is `@kallist/contextforge@0.1.1`.
- [x] Phase 08 release-readiness PR #2 merged.
- [x] The post-merge macOS contention-probe failure was diagnosed as `PROBE_SYNCHRONIZATION_BUG`.
- [x] Deterministic contention-probe fix PR #3 merged.
- [x] Post-fix main CI run `33372739458` passed Windows, Ubuntu, macOS, minimum Node, and the full frozen benchmark at `16dd0faa54e4332960ad53a3afd63e9a460800ff`.
- [ ] Release candidate descends from current `origin/main`.
- [ ] Exact candidate SHA and clean working-tree state recorded in the release PR and final report.

## Release metadata and documentation

- [ ] Package name is exactly `@kallist/contextforge` and version is exactly `0.1.1`.
- [ ] CLI executable remains exactly `contextforge` with bin target `dist/cli/main.js`.
- [ ] CLI and MCP server report the package version consistently.
- [ ] Standard MIT `LICENSE` is present and package metadata says `MIT`.
- [ ] Publication-blocking `private` metadata is absent.
- [ ] README installation and MCP instructions match the reviewed package.
- [ ] SECURITY, CONTRIBUTING, CHANGELOG, release notes, limitations, trust model, and benchmark claims reviewed.
- [ ] Release notes retain the frozen negative benchmark evidence.

## Local validation and package review

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run smoke`
- [ ] `npm run package:smoke`
- [ ] `npm run release:hardening`
- [ ] `npm run benchmark:validate`
- [ ] `npm run benchmark:smoke`
- [ ] `npm run benchmark`
- [ ] `npm run release:check`
- [ ] `npm audit --json` reviewed; unresolved runtime high/critical findings block release.
- [ ] `npm ls --all` has no missing or invalid dependencies.
- [ ] `git diff --check`
- [ ] `npm pack --json` file count, size, bin, README, LICENSE, WASM assets, source maps, install scripts, secrets, private paths, local indexes, and test helpers reviewed.
- [ ] npm authentication as `kallist` and permission to publish under `@kallist` verified.
- [ ] `@kallist/contextforge` registry state reviewed and distinguished from authentication, network, or permission failures.
- [ ] `npm publish --dry-run --access public` passed.
- [ ] Search JSON, Pack Markdown, Pack JSON, and benchmark quality determinism passed.
- [ ] Cross-process Index/Index, Index/Search, Index/Pack, forced-kill recovery, corrupt/future schema, multiple MCP servers, soak, and scale checks passed.

## Review and Hosted CI

- [ ] Independent release review has zero BLOCKING findings and no unjustified IMPORTANT findings.
- [ ] Release PR records base SHA, final HEAD, scoped-package correction, unchanged CLI, validation, benchmark integrity, security review, limitations, and post-merge sequence.
- [ ] Final PR HEAD recorded.
- [ ] Ubuntu minimum Node 24.15 job passed.
- [ ] Ubuntu, Windows, and macOS Node 24.20 jobs passed.
- [ ] Fresh-install package and official-client MCP smoke passed on every supported OS.
- [ ] Full frozen benchmark passed without Gold, metric, baseline, ranking, packing, or estimator drift.
- [ ] All required repository checks passed.

## Merge, main, and immutable tag

- [ ] Release PR merged using the established merge-commit strategy.
- [ ] Local `main == origin/main` and the working tree is clean.
- [ ] Post-merge main Windows, Ubuntu, macOS, minimum Node, and full benchmark jobs passed.
- [ ] Existing local and remote `v0.1.0` tag object and peeled commit reverified unchanged.
- [ ] Existing local and remote `v0.1.1` tag absence verified before creation.
- [ ] Annotated `v0.1.1` created from the exact reviewed green main commit.
- [ ] Remote v0.1.1 tag object and peeled commit verified; neither release tag was moved or force-pushed.

## Public publication and verification

- [ ] Exact reviewed `@kallist/contextforge@0.1.1` artifact published with public access.
- [ ] Registry metadata reports package `@kallist/contextforge`, version `0.1.1`, and MIT license.
- [ ] Fresh temporary consumer installation completed from the public npm registry, not a local tarball.
- [ ] Publicly installed CLI version, packaged WASM parsers, SQLite Index, Status, Search, and Pack passed.
- [ ] Official MCP client connected to the publicly installed package and exercised status, index, search, and pack.
- [ ] GitHub Release `ContextForge v0.1.1` created from immutable tag `v0.1.1` using reviewed notes.
- [ ] v0.1.0 remains historically accurate and is not described as a successful public npm publication.
- [ ] Final main/tag/npm/GitHub Release consistency and clean-worktree checks passed.
