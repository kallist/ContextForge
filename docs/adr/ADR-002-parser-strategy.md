# ADR-002: Parser Strategy

## Status

Accepted for V1 on 2026-08-29. Implemented for Phase 2 on 2026-08-30 and locally tested on Windows with Node 24.20.0. Hosted cross-platform validation remains `NOT RUN`.

## Context

V1 requires real symbol and import extraction for TypeScript, JavaScript, and Python. Parser failure must degrade per file, and the npm package must install on Windows, macOS, and Linux without requiring a local compiler, Python/node-gyp setup, Rust, or a C/C++ toolchain.

Tree-sitter provides consistent concrete syntax trees and language grammars, but its native Node binding can make installation dependent on matching prebuilt binaries or compiling native addons. The official WebAssembly binding can load language-specific `.wasm` files in Node. It is slower than the native binding, and runtime/grammar ABI mismatches are a known packaging risk.

## Decision

- Use **Tree-sitter through `web-tree-sitter` WebAssembly** as the V1 structural parser.
- Support four packaged grammar assets: JavaScript, TypeScript, TSX, and Python. TypeScript and TSX may originate from the same upstream grammar repository but remain distinct language artifacts.
- Pin `web-tree-sitter`, grammar sources/packages, and the Tree-sitter CLI used to produce assets to compatible versions in `package-lock.json` and a checked-in grammar manifest containing source version, parser ABI, checksum, and license.
- Build grammar WASM files in a controlled maintainer/CI asset job, then include verified `.wasm` assets in the published npm package. **End users must not compile grammars during install or postinstall.**
- Load runtime and language assets relative to the installed ESM module location, not the current working directory.
- Validate all packaged grammars on Windows, macOS, and Linux using parse fixtures before publishing.
- Implement language adapters that convert syntax trees into common symbol/import records. Grammar-specific node names must not leak beyond an adapter.
- A missing, checksum-invalid, ABI-incompatible, or unloadable required packaged grammar is a system-level `PARSER_UNAVAILABLE` failure; the index command does not silently publish a structurally empty index. A malformed individual source file may retain partial AST structure as `degraded` with a bounded diagnostic. An individual parse failure records no invented symbols or imports and does not abort other files.
- Regex may assist task normalization, filenames, or textual fallback. It must not masquerade as an AST parser.

## Alternatives Considered

### Native `tree-sitter` Node binding

It is faster, but installation and ABI compatibility can depend on platform-specific prebuilds or a native compiler toolchain. This conflicts with the cross-platform installation objective. It may be reconsidered later as an optional accelerator behind the same parser contract after benchmarks justify it.

### Language-specific parsers

The TypeScript compiler API or Babel plus a separate Python parser could provide language-specific fidelity, but would create different error models and adapter complexity. V1 benefits more from one bounded parser runtime and explicit grammar adapters.

### Regex-only extraction

Rejected. It cannot reliably represent nested syntax, exports, decorators, multiline signatures, or imports and would create misleading symbol metadata.

### Runtime download of grammars

Rejected. It violates offline-by-default behavior, weakens reproducibility, and introduces supply-chain and availability failures into normal indexing.

## Consequences

- npm installation avoids project-specific native compilation.
- Parser performance may be lower than native Tree-sitter and must be measured on representative repositories.
- The package is larger because runtime and language WASM assets are included.
- ABI/version/checksum validation and package-content smoke tests become mandatory release gates.
- Parser adapters remain replaceable, so an optional native accelerator or specialized parser can be evaluated later without changing core domain contracts.
- Phase 2 uses `web-tree-sitter` 0.26.13 and byte-for-byte grammar assets from `tree-sitter-wasm` 1.1.6. `grammar-manifest.json` records the runtime/package versions, npm integrity, upstream grammar versions, ABI 15, SHA-256 values, filenames, and licenses. Each asset checksum is verified before initialization.
- JavaScript and JSX share the JavaScript grammar; TypeScript and TSX remain separate grammar assets. Parser instances are cached and concurrent work is serialized per grammar to avoid shared parser-state races.

## Sources

- [Official Web Tree-sitter binding and WASM language guidance](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md)
- [Tree-sitter parser concepts and official bindings](https://tree-sitter.github.io/tree-sitter/using-parsers/)
- [Documented WASM/runtime compatibility failure](https://github.com/tree-sitter/tree-sitter/issues/5171)
