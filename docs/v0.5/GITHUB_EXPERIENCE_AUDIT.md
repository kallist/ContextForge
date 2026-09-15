# First-visit audit

Baseline: 3598256d6b0bf853c280d74c3a6203d5d130eebc (v0.4.1). Read-only GitHub API audit, 2026-09-14.

| Visitor | Observed friction | Change |
|---|---|---|
| Trending visitor | First heading sells Review; task context is secondary | Lead with repository context and a real product image |
| Agent user | No canonical Skill or clear routing between agent tools and CLI | One Skill, bounded workflows, short interface selector |
| Hiring reviewer | Long technical README; install target says 0.4.0 despite npm 0.4.1 | Product story first; preserve engineering reference separately |

GitHub: description existed; topics empty; homepage empty; Discussions disabled; Issues enabled; administrator access available. Pages API returned 404 (no configured site). Existing real Review screenshots, CONTRIBUTING and SECURITY are present. No launch demo or social card in requested asset paths. npm latest independently returned 0.4.1.

Implementation boundary: static docs/site and packaged Studio assets; CLI/application/core, database schemas and MCP remain unchanged. Risks: misleading screenshots, stale install commands, broken moved links, UI lifecycle regressions. Validate real Chromium fixtures, local links, installer discovery, fresh package journeys, frozen compiler parity and hosted CI. P0 assets use the real baseline UI and are refreshed only after P2.
