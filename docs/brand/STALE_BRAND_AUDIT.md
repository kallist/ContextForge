# RepoBound stale-brand audit

Checked: 2026-09-20  
Candidate: `@kallist/repobound@0.5.1`  
Base: `edfb3ad7c0780b198bcec742e5f4126111d6e674`

The repository-wide audit is enforced by `npm run brand:audit`. It scans tracked
and candidate-added text files for `ContextForge`, `contextforge`,
`CONTEXTFORGE`, `@kallist/contextforge`, `kallist/ContextForge`, and
`/ContextForge/`. Every match must route to one of the allowed categories below;
an unclassified match fails the command.

| Allowed category | Deliberate remaining surfaces |
|---|---|
| A. HISTORICAL | Frozen v0.5 evidence, older release/evaluation reports, ADR history, the master source specification, changelog entries, and unreferenced historical `contextforge-*` assets. |
| B. PROTOCOL / SERIALIZED COMPATIBILITY | `.contextforge` state, `contextforge-*` schema/strategy/dataset/estimator/Capsule identifiers, the hash-covered `# ContextForge Context Pack` heading, MCP server compatibility name, existing environment variables, and low-risk internal TypeScript symbol/module names. |
| C. LEGACY PACKAGE EXECUTABLE | The historical `@kallist/contextforge` package owns `contextforge`; the RepoBound package owns only `repobound`. Coexistence and uninstall ownership are tested. |
| D. OLD PACKAGE MIGRATION DOCUMENTATION | README EN/ZH, site candidate caveat, migration guide, Pages plan, ADR, release notes, and final rename runbook identify the still-public `@kallist/contextforge@0.5.0` package and historical URLs explicitly. |
| E. TEST OF BACKWARD COMPATIBILITY | Package/state/parity tests deliberately install or invoke the old package, CLI, state root, serialized IDs, fixtures, and internal compatibility entry points. |

Current public surfaces use `RepoBound`, `@kallist/repobound`, `repobound`,
`kallist/RepoBound`, and `/RepoBound/`. The old skill directory is absent, so
candidate discovery exposes only `repobound`. The old SVG/PNG assets are not
referenced by the candidate README or site; they remain only as historical
release evidence.

Result: **unexpected public stale branding: 0**.

The compatibility-claim audit also searches for `compatibility alias`, `legacy
alias`, `silent alias`, duplicate-bin assertions, and claims that RepoBound alone
provides `contextforge`. Result: **unexpected stale compatibility claims: 0**.

The same audit checks public documentation, Skill, and site text for real local
Windows/macOS/Linux home paths, private Codex directories, and worktree roots. The fresh-package
smoke additionally inspects the actual tarball. Result: **machine path leaks: 0**.
