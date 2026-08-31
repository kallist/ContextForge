# ContextForge V0.1 Release Checklist

This checklist separates technical release-candidate validation from legal and publication authorization. `npm run release:check` is validation-only: it never pushes, tags, publishes, creates a release, or changes Git history.

## Candidate identity

- [ ] Candidate commit recorded and working tree clean.
- [ ] Candidate is based on current `origin/main` and contains the Phase 07 merge.
- [ ] Package version finalized consistently in package metadata, CLI output, MCP server metadata, release notes, tag, and release title.
- [ ] Explicit project license chosen, `LICENSE` added, and package `license` metadata matched.
- [ ] `private` removed only when npm publication is explicitly intended and authorized.

## Technical validation

- [ ] `npm ci`
- [ ] `npm run release:check`
- [ ] `npm run benchmark`
- [ ] `npm audit --json` reviewed, with all runtime high/critical findings resolved or explicitly blocking.
- [ ] `npm ls --all` has no missing or invalid dependencies.
- [ ] `npm pack --json` allowlist, tarball size, WASM assets, bin, source maps, install scripts, secrets, and absolute paths reviewed.
- [ ] `npm publish --dry-run` run only after package metadata is legally and technically eligible.
- [ ] Search JSON, Pack Markdown, Pack JSON, and benchmark quality determinism verified.
- [ ] Cross-process index/index, index/search, index/pack, forced-kill recovery, corrupt/future schema, multiple MCP servers, soak, and scale checks passed.

## Hosted evidence

- [ ] Latest Draft PR HEAD recorded.
- [ ] Ubuntu minimum Node 24.15 job passed.
- [ ] Ubuntu, Windows, and macOS Node 24.20 jobs passed.
- [ ] Fresh-install package and MCP smoke passed on every supported OS.
- [ ] Full frozen benchmark job passed without quality drift.
- [ ] Hosted run URL and exact commit recorded in the final readiness report.

## Documentation and review

- [ ] README quickstart and every documented command rechecked against the installed tarball.
- [ ] SECURITY, CONTRIBUTING, CHANGELOG, release notes, limitations, trust model, and benchmark claims reviewed.
- [ ] Release-surface, reliability, security, package, dependency, benchmark-claims, and documentation reviews have no unresolved blocking finding.
- [ ] No temporary outputs, logs, local databases, private paths, credentials, or generated junk are tracked.

## Explicit release execution

These remain unchecked until the user separately authorizes a release:

- [ ] Merge the release-readiness PR.
- [ ] Verify final `main` Hosted CI.
- [ ] Create an annotated immutable tag.
- [ ] Create a GitHub Release from reviewed notes.
- [ ] Publish to npm, if npm publication is part of the chosen distribution plan.
- [ ] Verify installation from the public artifact.
