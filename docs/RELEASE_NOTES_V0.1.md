# ContextForge V0.1 Draft Release Notes

These are prerelease notes for the intended V0.1 line. They do not declare that version `0.1.0` has been finalized or released. The current package remains `0.1.0-dev.0`, private, and unlicensed pending explicit owner decisions.

## What ContextForge does

ContextForge is a local-first context compiler for coding agents. It safely maps a repository, parses JavaScript/TypeScript/TSX/Python with packaged WASM grammars, publishes complete SQLite index generations atomically, derives bounded structural signals, retrieves explainable task candidates, and builds deterministic Markdown under a hard ContextForge estimator budget. A local stdio MCP server exposes repository-bound status, index, search, and pack tools through the same application use cases as the CLI.

The production strategies are `contextforge-structural-v1`, `contextforge-pack-v1`, and `contextforge-generic-v1` version `1.0`. V0.1 does not include embeddings, vector search, LLM reranking or compression, HTTP/remote MCP, OAuth, multi-root MCP, file watching, auto-indexing, agent outcome learning, or a Web UI.

## Supported environment and distribution

The declared runtime is Node `>=24.15 <25`. Release-candidate CI is designed to validate Node 24.15 on Ubuntu and Node 24.20 on Ubuntu, Windows, and macOS. The package uses Node's built-in SQLite and packaged WebAssembly assets; it has no native compilation or install/postinstall script.

No registry package has been published. Until an explicit release, use a source checkout or a locally generated tarball as documented in the README. SQLite WAL state must remain on a local filesystem; UNC/network filesystems are unsupported.

## Benchmark evidence

The frozen `contextforge-benchmark-v1` uses 24 tasks, three systems, five budgets, and dataset hash `75685087e8392840b4bb61ae19cef9ccb92df66844e79e0e87a0b7c6437a0002`.

On benchmark-v1 at 8K, `contextforge-v1` measured 0.917 required-file recall, 0.864 required-symbol recall, and 0.193 Gold-range precision. At matched required-symbol recall on paired tasks, macro mean token reduction was 1.5% versus `lexical-full-file-v1` and 7.8% versus `structural-full-file-v1`.

The desired 60% token-reduction target was not met. Structural ranking did not show an aggregate advantage over lexical ranking on benchmark-v1, and no general “better than grep,” broad token-savings, coding-agent-success, or large-repository claim is supported. This finite self/curated benchmark has no external-human Gold review.

## Security and trust model

ContextForge runs with the invoking user's filesystem permissions and returns selected repository content to the local requesting CLI user or MCP host. Repository content can contain malicious instructions. ContextForge does not execute repository source, expose shell or arbitrary-file MCP tools, upload repository data, start a network listener, or collect telemetry. Sensitive-path exclusion is not a universal inline-secret detector; users must review generated context before forwarding it outside their trust boundary.

Index generations are activated in one SQLite transaction. Competing writers are bounded, readers retain complete snapshots, and release hardening exercises forced process termination before activation, integrity checks, recovery reindexing, corrupt databases, and unsupported future schemas.

## Upgrade and migration

Schema version 1 indexes are migrated to version 2 when a new generation is built. Unknown future schemas fail closed without mutation. A corrupt index is recoverable local derived state: remove `.contextforge/index.sqlite` and run `contextforge index` again. Repository source is not stored in the database.

## Known product limitations

- Generic token estimates are not model-tokenizer counts.
- Pure synonyms, semantic paraphrases, spelling variation, and cross-language task-to-code mapping are weak.
- TypeScript path aliases/package exports and advanced Python import behavior are incomplete.
- One MCP process binds to one repository; there is no auto-index or remote transport.
- Inline secrets inside otherwise eligible source are not guaranteed to be detected.
- Large external production repositories, real Codex/Claude Code/Cursor host setup, network filesystems, model-specific tokenizers, agent task success, and patch quality remain untested.
