# ADR-008: Local MCP stdio Integration

## Status

Accepted for Phase 07.

## Context

ContextForge already has production Index, Search, and hard-budget Pack application use cases with repository safety, active-generation consistency, and compact public contracts. Coding-agent hosts need a standards-compatible process boundary, but a new transport must not duplicate ranking/packing, weaken repository binding, introduce a network service, or mix protocol bytes with human output.

The stable official TypeScript SDK V2 uses split server/client packages. Its `2026-07-28` lifecycle adds discovery-based protocol negotiation while retaining an SDK-managed legacy initialization path. Stdio is the smallest local transport and lets the host own process launch and repository authorization.

## Decision

- Use exact production dependencies `@modelcontextprotocol/server` 2.0.0 and Zod 4.5.4. Use `@modelcontextprotocol/client` 2.0.0 only for tests and package smoke.
- Implement transport with the official `serveStdio` helper. Do not hand-write JSON-RPC, framing, lifecycle, or legacy shims.
- Add `contextforge mcp --repository <path>`, defaulting to the current directory. Resolve one canonical repository root at startup; normal tool inputs contain no repository path.
- Register only `status`, `index`, `search`, and `pack`. Do not add Resources, Prompts, HTTP, remote MCP, multi-root state, watchers, command execution, or arbitrary file access.
- Put filesystem/parser/Git/SQLite construction in one shared composition root so CLI and MCP call the same application use cases.
- Keep MCP SDK/schema types in the adapter. Core and application contracts stay transport-independent.
- Reserve stdout for protocol traffic. Successful operation is silent on stderr; mapped production errors are bounded and redact the canonical root, and unexpected errors are generic.
- Return Pack Markdown exactly once in text content. Structured content contains only bounded source-free metadata. The budget applies to the Markdown payload under the declared ContextForge estimator, not MCP wire framing.
- Preserve existing concurrency: each Search/Pack keeps one generation snapshot, a later request sees a newly activated generation, and competing Index calls retain bounded `INDEX_BUSY` behavior. Do not add a global MCP mutex or cache active generations/results.
- Do not auto-index. `index` is an explicit mutation of `.contextforge` runtime state only; the other tools are read-only.

## Consequences

An MCP-compatible host can launch ContextForge locally and use the production context compiler without a network listener or model/provider dependency. The host process inherits the local user's filesystem permissions; stdio is not authentication or an OS sandbox. One process serves one repository, so multi-root hosts launch separate processes.

The official client tests both pinned `2026-07-28` negotiation and legacy initialization. Real stdio crosses a process boundary, and package smoke installs a tarball before running the complete MCP flow. Actual Codex, Claude Code, Cursor, cancellation propagation into long-running application work, remote transports, and dedicated memory profiling remain unimplemented or untested and must not be claimed.

## Alternatives Rejected

- **Hand-written JSON-RPC/stdio framing:** unnecessary protocol and compatibility risk.
- **Old monolithic SDK:** conflicts with the current stable split-package architecture.
- **HTTP or remote MCP:** expands authentication, networking, and deployment scope without a Phase 07 requirement.
- **Repository argument on every tool:** permits scope redirection and complicates the trust boundary.
- **MCP-specific ranking/packing or CLI subprocess composition:** duplicates production logic and weakens typed application boundaries.
- **Hidden auto-index or global serialization mutex:** changes product semantics and masks existing SQLite concurrency behavior.

## References

- [Official TypeScript SDK package layout](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/packages.md)
- [Official stdio server guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md)
- [Official 2026-07-28 support notes](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)
