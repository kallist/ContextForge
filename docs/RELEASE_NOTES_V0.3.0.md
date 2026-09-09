# ContextForge v0.3.0

**Compile what your coding agent sees. Explain it. Control it. Replay it.**

V0.3 turns a context compilation into a local, inspectable lifecycle. Context
Capsules record selected and dropped candidates, source identities, evidence,
strategies and exact payload hashes. Compressed local history lets you revisit them
without silently turning your repository into a source archive.

Start `contextforge studio --repository ./repo` to inspect a proposal in the local
browser UI. Semantic controls let you PIN, EXCLUDE, PREFER, FOCUS or request a RANGE.
Recompilation creates a new Capsule and immediately compares before/after decisions,
ranges, evidence, roles and token contributions. Hard budgets and source safety remain
compiler invariants; impossible or stale controls fail explicitly.

Replay clearly separates offline recorded inspection from actual reproduction
verification. The product cannot restore old source bytes from source-light history.
Coverage and deterministic lint describe captured facts and tradeoffs; they do not
invent a context-completeness score or infer benchmark Gold.

The CLI exposes history, replay, diff, coverage and recompile alongside existing
pack/explain commands. The four MCP tools and public `contextforge-v1` compiler
default remain unchanged. V2 remains internal/experimental with mixed measured
evidence. No cloud backend, account, telemetry, new agent runtime or V0.4 Review
product was added. **AGENT SUCCESS NOT MEASURED.**

Requires Node `>=24.15 <25`. Frontend assets and the five WASM parser assets ship
inside the existing `@kallist/contextforge` package. See the
[product guide](V0.3_PRODUCT_GUIDE.md) for exact contracts and limitations, and
[validation evidence](V0.3_VALIDATION.md) for measured gates. A normal public release
requires green post-merge main CI, immutable annotated tag, successful npm publish,
public-registry fresh install/product smoke and only then GitHub Release creation.
