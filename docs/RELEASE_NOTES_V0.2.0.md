# ContextForge v0.2.0

## What changed

- Deterministic TaskAnalysis, hybrid Retrieval V2 evidence fusion and lexical symbol ownership.
- Bounded transient caller, test and implementation relationship evidence.
- Experimental ContextPlan and plan-aware Pack V2, with exact final budget verification and bounded request-local fragment reuse.
- Final frozen six-system evaluation, failure taxonomy and release evidence checks.

## Stable default

V1 remains the public/default CLI and MCP Search/Pack behavior. Node.js support remains `>=24.15 <25`. Package identity is `@kallist/contextforge`; executable is `contextforge`.

## Experimental V2

The selected candidate is **contextforge-v2-plan-pack**, retained **INTERNAL_ONLY**. There is no public V2 flag or MCP strategy field. ADR-009/010/011 are accepted as maintained experimental architecture, not public-default promotion.

## Benchmark

The frozen 24-task/four-repository/five-budget comparison completed 720 cases with zero estimator-budget violations. All historical final case objects were reproduced. At 8K, required-symbol recall is 0.886364 versus V1's 0.863636, Overall Gold is 0.899802 versus 0.870866, and required-file recall is unchanged at 0.916667. All 19 V1 successes remain successful. Pack V2 retains 36/39 pre-Pack-present required symbols versus 35/39 for the relationship candidate with Pack V1.

The same-run Windows/Node 24.20 measurements give a fixed-corpus median total ratio of 1.478582x V1 (within the 1.5x guardrail, with limited headroom) and a synthetic 1,000-file ratio of 1.084919x. These are environment-specific measurements, not an SLA.

## Important limitations

Cross-budget evidence remains mixed: weaker 2K symbol recall, weaker 16K/32K file recall than the V2 Pack V1 alternatives, and weaker precision outside 8K versus the relationship alternative. Task-aware planning is **not proven stably superior**. The strict .917 file and .900 symbol design thresholds are **not met**. No universal superiority or general token-savings claim is made.

## Not measured

**Coding-agent success was not measured.** Docker, third-party agent-host integration, and external very-large repository generalization were not tested. V0.3 was not started.

See [final evaluation](V0.2_FINAL_EVALUATION.md) and [release report](V0.2_RELEASE_REPORT.md) for evidence, provenance and release gates.
