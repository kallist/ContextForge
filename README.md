[English](README.md) · [简体中文](README_ZH.md)

# ContextForge

**See and control the repository context your coding agent works with.**

ContextForge finds task-relevant code, builds a bounded context pack, explains why files were selected or dropped, and lets you change or replay that context before handing it to a coding agent.

![Real Studio: task, selected files and context budget](docs/assets/contextforge-hero.png)

[![npm](https://img.shields.io/npm/v/@kallist/contextforge)](https://www.npmjs.com/package/@kallist/contextforge) [![CI](https://github.com/kallist/ContextForge/actions/workflows/ci.yml/badge.svg)](https://github.com/kallist/ContextForge/actions/workflows/ci.yml) [![MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

With Node.js **>=24.15 <25**, run in your repository:


```sh
npm install -g @kallist/contextforge
contextforge studio
```

Agent user? Start with the [Agent integration guide](docs/v0.5/AGENT_SKILL.md). Studio is the quickest way to see the product; the CLI exposes the full workflow.

## A 30-second tour

1. Enter **Fix session race condition** and build task context.
2. Inspect selected and dropped files, the budget, and **Exact context**.
3. Include a dropped test, rebuild, inspect **Dropped → Selected**, and replay.

The images come from a real local Studio running a synthetic session fixture. They demonstrate context selection, not a model fixing a bug. Reproduce from a checkout with `npm ci`, `npx playwright install chromium`, `npm run build` and `node scripts/launch-assets.mjs` (Linux may require `npx playwright install --with-deps chromium`). The demo uses 800 estimator tokens to expose budget pressure; ordinary tasks default to 8,000 in Studio 2.0.

## Why ContextForge?

A coding task needs a useful slice of repository evidence. ContextForge makes that slice inspectable: what was included, what was dropped, why, and what changes when you apply a control. It produces repository context; your coding agent performs the coding task.

## How it works

![Repository plus task or Git change passes through ContextForge; selected repository context and Explain, Control, Replay go to a coding agent](docs/assets/contextforge-flow.svg)

Compile what your coding agent sees. Explain it. Control it. Replay it.

This refers to repository context supplied by ContextForge. System instructions, conversation history, host tools and hidden model context are outside its visibility.

## Use with coding agents

| Interface | Use it for |
|---|---|
| [Agent Skill](docs/v0.5/AGENT_SKILL.md) | Guidance on when to compile, inspect or replay context |
| [MCP](docs/ENGINEERING_REFERENCE.md#mcp-integration) | Structured `status`, `index`, `search` and `pack` in compatible hosts |
| CLI | Full scripting, Review and lifecycle workflows |
| Studio | Visual inspection and human context controls |

The Skill guides the agent; MCP or the CLI executes ContextForge. Review uses the CLI. Compatibility with a Skill format does not imply every agent host was tested; see the acceptance table in the integration guide.

## Context workflow


```sh
contextforge index .
contextforge pack "Fix session race condition" . --budget 8000 --capsule task.json --out task.md
contextforge explain task.json --query WHY_SELECTED --subject src/session.ts
contextforge coverage task.json
contextforge replay task.json --verify --repository .
```

**Explain** reads recorded selection evidence. **Include / Exclude / Prefer** shape the existing safe candidate proposal. **Rebuild** creates a new immutable Capsule. **Diff** compares recorded changes. **Replay** verifies against current sources. [Control and lifecycle semantics](docs/V0.3_PRODUCT_GUIDE.md).

For a tracked Git change:


```sh
contextforge review . --base HEAD --budget 8000 --refresh-index --capsule review.json --out review.md
```

Review traces bounded structural evidence, not complete runtime impact. Stage new files first. Deleted source is metadata only. [Review guide](docs/V0.4_PRODUCT_GUIDE.md).

## See the repository context

![Exact repository context in the real Studio](docs/assets/contextforge-context.png)
![Recorded evidence for a dropped candidate](docs/assets/contextforge-why.png)

## Measured evidence

The frozen offline benchmark measures context selection, not coding-agent success. Results are mixed; no general token-saving or accuracy claim follows. The historical matrix contains 720 cases and the Capsule conformance matrix contains 240. These are matrix sizes, not a claim that this branch has passed: [V0.2 evidence and limitations](docs/V0.2_FINAL_EVALUATION.md), [benchmark protocol](docs/BENCHMARK.md).

## Local-first and security

No model API, source upload, telemetry or account is required. Studio binds loopback with a private capability and CSP. History stores compressed metadata, not a source archive. Review packs before forwarding code across your trust boundary. [Security policy](SECURITY.md).

## Current limitations

- Public compiler remains V1. Experimental V2 is internal; V0.5 does not change compiler or ranking behavior.
- Heuristic selection and one-hop Review relationships can miss relevant code. Coverage is not a completeness score.
- Budgets use a declared estimator, not a model-specific tokenizer.
- Replay cannot restore deleted historical source. Remote Studio/MCP and cloud services are not implemented.
- Agent task success and review accuracy are not measured.

## Install and documentation

The public package is [@kallist/contextforge](https://www.npmjs.com/package/@kallist/contextforge); [stable releases](https://github.com/kallist/ContextForge/releases). This branch prepares V0.5; it does not publish it. The public package may show the previous Studio until release.

[Agent setup](docs/v0.5/AGENT_SKILL.md) · [Lifecycle guide](docs/V0.3_PRODUCT_GUIDE.md) · [Review guide](docs/V0.4_PRODUCT_GUIDE.md) · [Architecture](docs/ARCHITECTURE.md) · [Engineering reference](docs/ENGINEERING_REFERENCE.md) · [Product specification](docs/PRODUCT_SPEC.md) · [Launch notes](docs/v0.5/LAUNCH.md)

## Contributing

Read [CONTRIBUTING](CONTRIBUTING.md) for development and validation, and [SECURITY](SECURITY.md) for private vulnerability reporting. Discuss ideas in [Discussions](https://github.com/kallist/ContextForge/discussions). [MIT licensed](LICENSE).
