# V0.5 release-copy audit

Scope: documentation correction after candidate `aafd6007df279e6fb328c938251091934172c6e3`, based on main `3598256d6b0bf853c280d74c3a6203d5d130eebc`. This record describes candidate validation, not a public release. Only the two READMEs, landing-page text, Agent integration guide and this audit change. Product code, canonical Skill and references, package version and frozen evidence remain unchanged.

## Meaningful findings and classification

The case-insensitive full tracked-text search covered preview/unreleased wording, release/main status, reviewed/local checkout instructions, branch references and the Chinese equivalents. Binary parser assets are not public copy.

| Original match | Classification and disposition |
|---|---|
| README.md: branch prepares V0.5; previous Studio until release; branch-specific benchmark disclaimer | BLOCKING PUBLIC COPY: replaced with a stable-version query and timeless evidence links; added repository Skill installation. |
| README_ZH.md: 本分支准备 V0.5，尚未发布; branch-specific benchmark disclaimer | BLOCKING PUBLIC COPY: replaced with durable Chinese product instructions and evidence wording. |
| site/index.html: V0.5 preview; local installation and absent-from-main instructions | BLOCKING PUBLIC COPY: replaced with product labeling and the canonical public repository command. |
| AGENT_SKILL.md: placeholder checkout installation and absent-from-main assertion | BLOCKING PUBLIC COPY: replaced the primary instructions; separated Candidate validation, Public installation and Post-release verification. |
| CHANGELOG.md: prepared/unreleased entry and existing Unreleased heading | INTENTIONAL HISTORICAL/EVIDENCE TEXT: retained preparation/changelog entries outside this correction's allowed files; not used as current registry or installation evidence. |
| RELEASE_NOTES_V0.5.0.md: prepared validation and no publication performed here | INTENTIONAL HISTORICAL/EVIDENCE TEXT: preparation record, not the eventual public GitHub Release body. |
| ACCEPTANCE.md, COMMUNITY_LAUNCH.md: candidate deployment/publication observations | INTENTIONAL HISTORICAL/EVIDENCE TEXT: preserved the original acceptance and preparation observations. They do not establish current release status. |
| CORE_FREEZE_AUDIT.md: candidate branch and implementation commit | INTENTIONAL HISTORICAL/EVIDENCE TEXT: provenance, not an asset or installation URL. |
| benchmarks/analysis/v0.2/final/REVIEW.md: historical release-gate status | INTENTIONAL HISTORICAL/EVIDENCE TEXT: frozen earlier evaluation; untouched. |
| ENGINEERING_REFERENCE.md: generic absolute-path MCP example | SAFE: explicitly historical engineering reference with generic placeholders, not a real machine path or primary Skill installation instruction. |
| COMMUNITY_LAUNCH.md: social preview upload | SAFE: GitHub feature name and manual action, not a product preview label. |
| New audit/guide: quoted original findings and candidate installation observations | INTENTIONAL HISTORICAL/EVIDENCE TEXT: explicitly scoped to this validation snapshot. |
| Parser WASM binary search hit | TEST FIXTURE / INTERNAL: runtime binary, not documentation text; unchanged. |

The corrected public instructions have zero stale candidate-state assertions, zero feature-branch-dependent links and zero real machine-path leaks. Historical evidence and generic developer placeholders are not deleted to manufacture a zero-match repository search.

## Public installation syntax and candidate validation

Canonical user command:

```sh
npx skills@1.5.26 add kallist/ContextForge --skill contextforge --agent codex --copy
npx skills@1.5.26 list
```

Actual syntax probe: `npx skills@1.5.26 add kallist/ContextForge --list`. The installer resolved the public GitHub repository, cloned the default-branch snapshot at the base above, and returned No skills found (exit 1). This is an expected absent-Skill observation, not a successful public default-branch installation.

The isolated candidate test used the public GitHub source `https://github.com/kallist/ContextForge/tree/aafd6007df279e6fb328c938251091934172c6e3`, with `--skill contextforge --agent codex cursor claude-code --copy --yes`. Installation and list passed. Installed canonical Skill and both references matched the reviewed bytes; native Codex app-server skills/list discovered it as enabled. No local filesystem installation source or product installation was used. The temporary project was removed. Cursor/Claude host runtime and model execution remain NOT TESTED.

## Post-release verification

Final Release must verify the canonical command against the merged public default branch and exercise the public npm product. The candidate result above cannot substitute for that gate. This correction does not claim npm latest is 0.5.0, Pages is live or V0.5 has been published. Final Release must use the new reviewed PR head and its checks; the previous candidate approval is superseded.
