# V0.5 local acceptance evidence

Environment: Windows, Node 24.20.0, Chromium 153.0.8010.12. Base: 3598256d6b0bf853c280d74c3a6203d5d130eebc, verified origin/main and v0.4.1 target. npm latest independently returned 0.4.1. This document records local evidence; hosted CI is recorded separately on the Draft PR.

## Engineering gates

| Gate | Actual result |
|---|---|
| npm ci | PASS, 103 installed packages, zero audit vulnerabilities |
| lint / typecheck / build | PASS |
| npm test | 214 passed, 0 failed, 0 skipped |
| npm run release:check | technicalValidation PASS, releaseReady true, releaseBlockers empty; no publication |
| package:smoke | Fresh local tarball, CLI, 5 WASM assets, official MCP client, Studio, Review, leakage checks PASS |
| release:hardening | PASS; 1000 soak requests, same initial/final handle count 207, orphan processes 0; process recovery/integrity and failure paths passed |
| benchmark | 720 historical case objects unchanged, release-evidence-check PASS |
| Capsule conformance | 240/240 PASS |
| Studio browser | Retained Task and Review journeys plus public CLI-launched Task/Review, all five controls, four required viewports, reload/restart PASS |
| Skill | Actual skills 1.5.26 discovery/install/use and native Codex discovery PASS; explicit Codex task workflow PASS |
| Static page | Build, local links/assets and real Chromium at 390/1024/1280/1512/1920 PASS |
| Review scenario benchmark | All six records completed; observed low-budget retention remains bounded; no Gold/score changes |

Frozen dataset SHA-256: `75685087e8392840b4bb61ae19cef9ccb92df66844e79e0e87a0b7c6437a0002`.

Capsule aggregate SHA-256: `bc0429b0c9a583e202c762935a5d8ab35619e05374fa58a24c988abef760602f`.

## Public 0.4.1 versus candidate package

`npm run v05:parity` installs public @kallist/contextforge@0.4.1 and the freshly packed 0.5.0 tarball into separate clean directories with separate caches. Both use identical Git fixtures and public CLI commands: index, search, pack, review, explain and coverage. No installed product imports or checkout fallback are used by this parity gate.

Candidate ordering, decisions, selected source, drop reasons, deterministic Capsule contents, Review change detection and Coverage/Lint were identical. Exact Markdown hashes were identical:

- Task: `ac251f7df3119b44264fe345a4c11c93568ccc299ffd804282eef0b5f6d59ca3`
- Review: `d70e0e3da3978ec7ce1f525a2896f03ce6215d9f437858b961f23f53c5398bb7`

The complete normalization allowlist is index.performance, index.repositoryRoot, index.indexedAt, search.performance, search.repositoryRoot, task.runtime and review.runtime. Only timing, machine-root and runtime observations are excluded. No candidate, score, decision, source, reason, strategy or payload normalization is applied. No version/provenance normalization of deterministic Capsule data was needed.

## User journeys and security

The public CLI-launched browser gate starts the installed executable in a fresh fixture, rather than importing the Studio server. Task mode covers missing context → build → selected/dropped → Exact Context → Why → Include → immutable child/Diff → Exclude/Prefer/Focus/Range → History/Replay → reload/restart. A fresh Git fixture covers Current Git Change → changed files/symbols/impact → Why → Include/rebuild → Coverage → Diff/Replay. Retained tests additionally cover metadata/source XSS, malicious refs, delete Review and source-light durability.

All observed product browser requests remained on their local Studio origin, with zero page errors. The static site likewise used only local runtime requests. The unchanged security suite exercised repository boundaries, symlink/junction escape, source verification, hard budgets, absolute-path privacy, Git/ref input, loopback, capability and CSP. No telemetry or external product service was introduced. Browser source and metadata sentinels did not execute.

One local CLI-launched session observed about 111 ms first load and 877 ms fixture build. These are single-machine sanity observations, not speed claims. See [visual review](STUDIO_VISUAL_REVIEW.md) and [Skill acceptance](AGENT_SKILL.md) for exact boundaries.

## Independent review and corrections

A separate Codex reviewer inspected the actual diff and untracked files, starting with the README before internal docs. BLOCKING 0, IMPORTANT 0, MINOR 1. The minor finding was missing Chromium installation in screenshot-reproduction instructions, demonstrated with an empty browser cache. Both READMEs now include it. An additional keyboard-focus observation led to explicit focus transfer into the visible Why evidence; the browser gate checks Enter activation and the resulting focused element. This is an independent agent review, not an external human audit.

Claim review covered both READMEs, the Skill, landing page, social card and launch copy. Scope consistently refers to repository context, not hidden model context. No improved coding accuracy, universal token saving, complete impact analysis or safe-merge claim is made. Existing engineering detail was preserved in a clearly historical reference. Relative launch links and assets are checked by launch:validate; the npm/release/Discussions destinations were inspected live.

## Failed attempts and evidence limits

Initial full tests failed only old title/version assertions (212/214); requirements were updated and the full suite passed 214/214. Initial demo input selected the intended dropped test; the synthetic demo budget was adjusted before capturing the required real transition. No benchmark fixture or Gold was changed.

A Review benchmark attempted during a concurrent dist rebuild encountered a missing parser asset. It was rerun sequentially after the build and passed; this was validation orchestration, not an engine modification. A temporary Skill setup via npm exec selected Node 26 and was correctly rejected by the unchanged engine gate; setup was rerun directly with verified Node 24.20. Sandbox process denials and an approval-service quota rejection were resolved before counting the associated checks as passed.

Docker, screen-reader certification, non-Chromium browsers, autonomous coding/model performance, Cursor runtime and Claude Code runtime: NOT TESTED. Pages deployment is prepared for main only, not deployed by this branch. Social preview upload remains manual. No merge, tag, npm publication or GitHub Release occurred.
