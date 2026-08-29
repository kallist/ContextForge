# ADR-001: Runtime and Primary Language

## Status

Accepted for V1 on 2026-08-29. Product implementation remains `NOT IMPLEMENTED`.

## Context

ContextForge is a cross-platform, CLI-first developer tool that must analyze TypeScript, JavaScript, and Python repositories, persist a local index, and later expose an MCP adapter. V1 should use one runtime, install without a compiler toolchain on Windows/macOS/Linux, remain maintainable for open-source contributors, and avoid framework or monorepo overhead.

The audited Windows environment already provides Node 24.10, npm, and Git but no Rust toolchain, C/C++ build tools, or standalone SQLite CLI. Node 24 is an LTS line, and Node ships both a stable test runner and built-in SQLite support. Official Node guidance recommends production use of an LTS release. Node's SQLite API reached release-candidate status in Node 24.15, so the audited 24.10 patch is adequate for foundation work but is not the accepted storage/release baseline.

## Decision

- Use **TypeScript on Node.js 24.15 or newer within the Node 24 LTS line** as the single V1 runtime and primary language.
- Use strict TypeScript, ECMAScript modules, and Node's `nodenext` module rules. Do not use TypeScript syntax that requires runtime transformation in source executed directly by Node.
- Publish compiled JavaScript, declarations, required WASM assets, and a `contextforge` npm `bin` entry. Do not publish raw TypeScript as the executable package surface.
- Use **npm** with a committed `package-lock.json`; keep one package and no workspaces/monorepo.
- Use Node's built-in `util.parseArgs` with a small command router. Reconsider a CLI framework only if implemented command semantics make the built-in parser materially harder to maintain.
- Use `tsc` for type checking and production builds, ESLint for static rules, and the stable `node:test` runner against compiled test JavaScript.
- Declare `node >=24.15 <25` for V1 and test the latest available Node 24 patch in CI. Re-evaluate the supported major at release maintenance boundaries.

## Alternatives Considered

### Python

Python has strong parsing and SQLite libraries, but reliable end-user CLI distribution would either require users to manage Python environments or require a separate bundling strategy. The future MCP adapter and target coding-agent ecosystem also fit TypeScript well. Python remains an analyzed repository language, not a ContextForge runtime.

### Rust

Rust could produce fast static binaries and has strong Tree-sitter/SQLite support. It would raise the initial implementation and cross-compilation cost, and the audited environment has no Rust toolchain. V1 does not yet have performance evidence that justifies this cost.

### Polyglot runtime

A Node core plus Python or Rust parser service would complicate installation, process lifecycle, packaging, errors, and cross-platform testing. It is rejected for V1.

### pnpm or Yarn

Both are capable, but npm ships with Node and needs no bootstrap step. A monorepo is not justified, so pnpm's workspace advantages are not required. Yarn was not present in the audited environment.

### Commander or Yargs

They offer polished command ergonomics, but the expected V1 command surface can be implemented with Node's built-in parser behind one CLI adapter. Avoiding a runtime dependency is the simpler starting point.

### Vitest or Jest

They provide richer test ergonomics, but V1 can cover unit, integration, failure, security, and CLI subprocess tests with `node:test`. A framework can be adopted later if concrete test limitations appear.

## Consequences

- Contributors and users need Node 24.15+ LTS; the currently audited Node 24.10 installation must be patch-upgraded before the complete Phase 0/SQLite gates can pass.
- Production packages remain ordinary npm packages and gain Windows `.cmd` shims through npm's `bin` behavior.
- Runtime dependencies stay small; development still requires TypeScript and lint tooling.
- The design uses Node APIs rather than shell scripts, path-string concatenation, or Unix-only executable assumptions.
- A future Node-major upgrade is an explicit compatibility task, especially for built-in SQLite and native TypeScript behavior.

## Sources

- [Node.js release policy and current LTS lines](https://nodejs.org/en/about/previous-releases)
- [Node.js TypeScript support](https://nodejs.org/download/release/latest-v24.x/docs/api/typescript.html)
- [Node.js test runner](https://nodejs.org/download/release/latest-v24.x/docs/api/test.html)
- [npm `bin` package contract](https://docs.npmjs.com/cli/configuring-npm/package-json#bin)
