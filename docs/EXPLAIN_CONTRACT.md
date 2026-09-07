# Deterministic Explain contract

`contextforge-explain-v1` answers from a validated Capsule. It does not scan, index,
read repository source, query a model, or access the network. The source repository
can be unavailable. `ExplainQueryV1` has `type` and an optional `subject` (required for
WHY queries). The CLI supports `--json`; human output derives from the same result.

V0.3-01R enforces the shared Capsule path privacy policy on persisted free-form facts.
An externally supplied Capsule with recognized absolute filesystem paths in protected
text is rejected with `INVALID_CAPSULE`; the reader does not silently redact it or
repair its identity. Explain uses only the persisted sanitized task/symbol/evidence
representation. It cannot recover original paths from hashes. Its query/subject echo
also uses the same `<ABSOLUTE_PATH>` redactor in structured JSON; the human renderer
uses the resulting safe facts. Lookup itself remains in memory over the original query.
See the field audit and lexical boundaries in [the Capsule contract](CONTEXT_CAPSULE.md).

| Query | Recorded answer |
|---|---|
| SUMMARY | Task, generation, hashes, strategies, candidate/disposition counts, budget, coverage |
| WHY_SELECTED | Candidate, rank, evidence, relationships, decision, final order, ranges, contribution |
| WHY_DROPPED | Captured evidence and exact Pack reason; no relevance or counterfactual invention |
| WHY_EXCLUDED | Recorded eligibility/source-safety reason; no source body |
| BUDGET | Requested/estimated/unused budget, item/envelope accounting, actual V2 phases and role counts |
| STRATEGY | Exact strategy IDs and configuration; null stages mean they did not run |

Subject lookup prefers candidate ID. Relative paths, original symbol IDs, names and
qualified names are also supported. Multiple matches yield `AMBIGUOUS` with candidate
IDs; a file path shared by an instruction and duplicate ranked envelope can be ambiguous.

Result fields are `schemaVersion`, `query`, `subject`, `status`, `facts`, `evidenceRefs`,
`decisionRefs`, and `limitations`. The stable status vocabulary is:

- `OK`: the Capsule records the requested disposition/evidence.
- `NOT_CONSIDERED`: absent from the bounded captured candidate set. The Capsule does not
  prove why it was absent. This does not mean low relevance or policy exclusion.
- `INSUFFICIENT_EVIDENCE`: the recorded disposition does not support the requested WHY
  question. For example, asking WHY_DROPPED about a selected candidate.
- `AMBIGUOUS`: use one of the reported candidate IDs.

Facts include structured observations with original reason codes, not generated causal
prose. `HEURISTIC_EVIDENCE_IS_NOT_STRUCTURAL_FACT` preserves uncertainty. V1 explicitly
reports `PLANNER_NOT_RUN` and `RELATIONSHIP_STAGE_NOT_RUN`, without erasing its existing
file-graph ranking signals. Role accounting can overlap; unused budget is not a defect.

Selected completeness means every delivered candidate has at least one non-ranking
relevance/policy evidence item and a valid selection decision. Dropped completeness means
every captured dropped candidate has a valid actual drop disposition. Neither measures
Gold coverage, task success, full repository relevance, or a model's reasoning.

The parser bounds input and validates schema, IDs, references, ranges, selected order,
accounting and canonical identity before answering. Unknown schema versions fail clearly.
Canonical hashes are not digital signatures: data from an untrusted author is not thereby
authenticated. The human renderer quotes untrusted values through JSON string encoding.

```text
contextforge explain capsule.json --query SUMMARY
contextforge explain capsule.json --query WHY_SELECTED --subject candidate_<hash>
contextforge explain capsule.json --query WHY_DROPPED --subject docs/design.md --json
contextforge explain capsule.json --query WHY_EXCLUDED --subject src/changed.ts
contextforge explain capsule.json --query BUDGET
contextforge explain capsule.json --query STRATEGY
```
