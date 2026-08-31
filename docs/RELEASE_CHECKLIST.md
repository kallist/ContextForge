# ContextForge v0.1.0 Release Checklist

This checklist separates validation, review, merge, and irreversible publication. `npm run release:check` is validation-only: it never pushes, tags, publishes, creates a release, or changes Git history.

## Release lineage and candidate identity

- [x] Phase 08 release-readiness PR #2 merged.
- [x] The post-merge macOS contention-probe failure was diagnosed as `PROBE_SYNCHRONIZATION_BUG`.
- [x] Deterministic contention-probe fix PR #3 merged.
- [x] Post-fix main CI run `33372739458` passed Windows, Ubuntu, macOS, minimum Node, and the full frozen benchmark at `16dd0faa54e4332960ad53a3afd63e9a460800ff`.
- [ ] Release candidate descends from current `origin/main`.
- [ ] Exact candidate SHA and clean working-tree state recorded in the release PR and final report.

## Release metadata and documentation

- [ ] Package name is exactly `contextforge` and version is exactly `0.1.0`.
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
- [ ] npm authentication and `contextforge` availability/ownership verified.
- [ ] `npm publish --dry-run --access public` passed.
- [ ] Search JSON, Pack Markdown, Pack JSON, and benchmark quality determinism passed.
- [ ] Cross-process Index/Index, Index/Search, Index/Pack, forced-kill recovery, corrupt/future schema, multiple MCP servers, soak, and scale checks passed.

## Review and Hosted CI

- [ ] Independent release review has zero BLOCKING findings and no unjustified IMPORTANT findings.
- [ ] Draft release PR records base SHA, final HEAD, package intent, validation, benchmark integrity, security review, limitations, and post-merge sequence.
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
- [ ] Existing local and remote `v0.1.0` tag absence verified.
- [ ] Annotated `v0.1.0` created from the exact reviewed green main commit.
- [ ] Remote tag object and peeled commit verified; tag was not moved or force-pushed.

## Public publication and verification

- [ ] Exact reviewed `contextforge@0.1.0` artifact published with public access.
- [ ] Registry metadata reports package `contextforge`, version `0.1.0`, and MIT license.
- [ ] Fresh temporary consumer installation completed from the public npm registry, not a local tarball.
- [ ] Publicly installed CLI version, packaged WASM parsers, SQLite Index, Status, Search, and Pack passed.
- [ ] Official MCP client connected to the publicly installed package and exercised status, index, search, and pack.
- [ ] GitHub Release `ContextForge v0.1.0` created from immutable tag `v0.1.0` using reviewed notes.
- [ ] Final main/tag/npm/GitHub Release consistency and clean-worktree checks passed.
