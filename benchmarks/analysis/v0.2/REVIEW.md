# V0.2-01 Independent Review

Date: 2026-09-01

Scope: retrieval research, failure classification, benchmark-only diagnostics, and proposed V2 architecture

Production V2 implementation: **NOT STARTED**

## Review Basis

- base commit and peeled `v0.1.1` commit: `13f7f1c8f83efcfdca9f88904532fcfff717dfbe`
- frozen dataset: `contextforge-dataset-v1`, hash `75685087e8392840b4bb61ae19cef9ccb92df66844e79e0e87a0b7c6437a0002`
- task/repository count: 24 / 4
- Gold counts: 44 required files, 30 supporting files, 44 required symbols, 15 supporting symbols, 1 required range
- final diagnostic replay: all 24 tasks at 8K, all three systems, exact selected-file and selected-range alignment with the frozen reference
- deterministic diagnostic SHA-256 across two consecutive final-format runs: `c77305ee60305dcd5b6c5c63caeb4e3aa20f28b04a743e3188b57514c54b8db7`

## A. Benchmark Integrity

**PASS.** Dataset, lock, Gold, metric implementation, and all four reference artifacts have no diff. The reference hashes remain:

- quality: `175ec7327dba2880324dad56d8d055fba2f09992a957bfe754607c6d9c1394a6`
- aggregate: `a3cd681db283fd7a34522f7254247ffd4320abefb54ab6cae5ee4918bf4915a3`
- report: `e6283faeb037f39151351b0b1abdbf054385dbeccf46fce9a41afa3f1f070023`
- performance: `f8933cda8eb48077b74cb65ee30ba8bd155ff92cc51bbb3aeac824098aec858d`

All 24 tasks are classified exactly once. Diagnostics are Gold-blind at the system boundary: the system adapters receive only runtime, task, and budget; Gold is joined in the analysis layer. No failed task was removed and no V1 result was regenerated into the reference directory.

## B. Root-cause Quality

**PASS with stated limitations.** The matrix contains 19 successes, 1 precision weakness, and 4 failures. It distinguishes file retrieval, symbol discovery, Pack planning, range selection, and serialized-context stages. The four required-context failures split into one primarily packing failure, one primarily retrieval failure, two combined failures, and zero cases classified as insufficient evidence. The clean frozen stale-source task is explicitly not presented as runtime mutation evidence.

The review checked unfavorable cases and preserved successes. It found no use of `GOLD_OR_METHOD_LIMITATION` as a substitute for a product cause; it is secondary only where the frozen method cannot exercise actual source mutation.

## C. Architecture

**PASS.** The proposal keeps a single Core/Application retrieval pipeline for CLI and MCP, preserves one startup-bound repository, retains the hard-budget serializer and generation/source verification, and introduces no dependency. Task analysis, context planning, candidate-source generation, fusion, ranking, and packing have separate proposed contracts and strategy identities. The ADR is `PROPOSED`, not accepted or measured.

## D. Overfitting

**PASS.** Conclusions use all 24 tasks, not only the five deep dives. Lexical and structural each have preserved wins. The future protocol keeps the frozen lexical and V1 systems, uses all five budgets for the final comparison, limits 8K-only ablations to research, and separates targeted regressions from the quality benchmark. No final V2 weights are selected in this phase.

## E. Product Scope and Claims

**PASS.** There is no V0.3 Workbench, embeddings, provider, cloud, multi-repository, UI, agent-runtime, or production V2 implementation. Documents separate `FACT`, `INFERENCE`, and `HYPOTHESIS`; proposed gates are labeled `DESIGN TARGETS — NOT YET MEASURED`. No public claim says V2 already improves retrieval.

## F. Security

**PASS.** The diagnostic artifact contains no source bodies or private absolute paths, runs no repository source, uses no network, and is ignored rather than published as a large generated artifact. The design keeps sensitive/generated/dependency exclusions, repository boundaries, snapshot validation, bounded lexical reads, and fail-closed stale/corrupt-index behavior.

## Findings and Resolution

### BLOCKING

None.

### IMPORTANT

1. **Resolved — reference alignment was initially file-only.** The final check now canonicalizes and compares every selected path, line range, and reason for all three 8K systems and all 24 tasks.
2. **Resolved — locale-dependent classification summary ordering.** The validator now uses repository-standard ordinal text comparison.
3. **Resolved — supporting Gold was not projected into the detailed diagnostic.** The final output includes required/supporting file, symbol, and range Gold after the Gold-blind system boundary.
4. **Resolved — a rank comparison omitted its denominator.** The research and ADR now state that 23/13/7 compares the 43 required files found by both rankers and separately identifies the one structural-only file.

### MINOR

1. **Accepted — generated detailed diagnostics are intentionally ignored.** They are about 24-task evidence, not a new reference result. The command and deterministic hash make them reproducible without committing a large duplicate artifact.
2. **Accepted — the full 360-case quality benchmark was not rerun locally.** Dataset/reference bytes and metric code are unchanged, the 72 8K selected-range cases align exactly, benchmark validation/smoke pass, and the formal hosted benchmark job remains the required cross-check.

## Targeted Re-review

After the IMPORTANT fixes, lint, typecheck, the 106-test suite, production build, benchmark validation, benchmark smoke, package smoke, and two deterministic diagnostic runs passed. `git diff --check` and Hosted CI are final delivery gates and must still be recorded after the review artifact is added.

Final review status: **BLOCKING 0; IMPORTANT 0 unresolved; MINOR 2 accepted with explicit evidence boundaries.**
