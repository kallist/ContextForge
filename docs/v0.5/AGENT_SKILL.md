# Agent Skill installation and use

Historical canonical source: [`contextforge/SKILL.md` at `v0.5.0`](https://github.com/kallist/ContextForge/blob/v0.5.0/contextforge/SKILL.md), metadata version 0.5.0. One Skill routes coding tasks, local Git Review and context debugging. It executes through the installed product; it contains no retrieval logic.

## Public installation

ContextForge v0.5 includes one canonical Agent Skill. Run this from the project where the Skill is wanted to install it from the public GitHub repository:

```sh
npx skills@1.5.26 add kallist/ContextForge --skill contextforge --agent codex --copy
npx skills@1.5.26 list
```

Choose the matching installer target for your host: codex, cursor or claude-code. Codex and Cursor share .agents/skills/contextforge; Claude receives .claude/skills/contextforge. Installing the Skill does not install ContextForge. Installer-target validation does not establish host runtime compatibility; see the evidence below.

Optional product installation is a user choice:

```sh
npm install -g @kallist/contextforge
```

Requires Node >=24.15 <25. Check the current stable product version with `npm view @kallist/contextforge version`.

## Workflows

Coding task: MCP status → index if missing/stale → pack with explicit budget (default 8000). CLI fallback uses search --json to inspect indexStatus; there is no CLI status command. INDEX_REQUIRED means index first. Read the payload and recorded omissions.

Review: installed CLI review with base, budget and --refresh-index, then Explain/Coverage and optional controls. MCP has no Review tool.

Debug: Explain → Coverage/Lint → Diff or History/Replay as appropriate. Do not invent explanations for absent evidence. Skill and MCP cooperate: Skill guides; MCP or CLI executes.

## Candidate validation

Release-copy validation at candidate aafd6007df279e6fb328c938251091934172c6e3 used skills 1.5.26 with the public repository form kallist/ContextForge. It resolved and cloned GitHub's default branch; that snapshot contained no Skill. The same installer then installed from the public GitHub URL for the exact candidate commit, with no local installation source. Codex, Cursor and Claude installer targets, list, exact Skill/reference bytes and native Codex discovery passed. This proves the repository syntax and candidate layout, not installation from a released default branch. See [release-copy audit](RELEASE_COPY_AUDIT.md).

Windows/Node 24.20: skills 1.5.26 discovery, target installation, reference resolution and use-prompt generation PASS. Codex CLI 0.154.0-alpha.6.2 app-server skills/list independently discovered the installed Skill as enabled with the correct description and bytes. Set CONTEXTFORGE_CODEX_BINARY to a verified local executable to include this optional native-host check in skill:validate.

P3 also used a fresh tarball install, the real skills add/use flow, and this Codex task as the Skill runner. The runner read the installed Skill and its workflow reference, observed CLI INDEX_REQUIRED, indexed, packed at 8000, inspected source and Explain/Coverage, applied EXCLUDE, used History/Diff, and ran CLI Review and exact replay. A separate official-client stdio connection to the installed CLI exercised status MISSING → index → CURRENT → pack and confirmed exactly status/index/search/pack. This is explicit Skill use in a Codex task, not a claim that automatic triggering or an autonomous coding model was evaluated.

Cursor executable unavailable. Claude launcher reports missing git-bash configuration. Their installer targets were verified; Cursor and Claude Code runtime acceptance are NOT TESTED. Autonomous host model execution and coding success are NOT TESTED / NOT MEASURED. No silent product installation occurred; package installation was explicit acceptance setup.

Development / local validation only: `npm run skill:validate` installs from the checkout in a fresh temporary project and removes that project afterward. It does not edit personal agent configuration and is not the public-install acceptance gate.

## Post-release verification

Final Release must separately record default-branch public installation, the public npm package and the coding, Review and context-debug paths. Candidate validation does not establish these post-release results. This document does not claim that public V0.5 installation or all host runtimes have passed.

Conventions verified against [skills CLI documentation](https://github.com/vercel-labs/skills/blob/main/README.md) and [official Codex Skill documentation](https://learn.chatgpt.com/docs/build-skills), then exercised through the real installer. Format compatibility does not establish host runtime success.
