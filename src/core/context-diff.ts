import { canonicalSerialize, validateCapsule, type CapsuleCore } from "./context-capsule.js";
import { reviewCoverage } from "./review-coverage.js";

const equal = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
type Candidate = CapsuleCore["candidates"][number];
function facts(c: CapsuleCore, item: Candidate) {
  const selected = c.selected.find((s) => s.candidateRef === item.id);
  return {
    rank: item.rank, score: item.score, disposition: item.disposition,
    roles: selected === undefined ? item.planRoles : [selected.role, ...selected.secondaryRoles],
    evidence: c.evidence.filter((e) => item.evidenceRefs.includes(e.id)),
    relationships: c.relationships.filter((r) => item.relationshipRefs.includes(r.id)),
    symbols: c.symbols.filter((s) => item.symbolRefs.includes(s.id)),
    ranges: c.ranges.filter((r) => selected?.rangeRefs.includes(r.id)),
    tokens: selected?.estimatedTokens ?? 0,
    reasons: c.decisions.filter((d) => item.decisionRefs.includes(d.id)).map((d) => d.reason),
    sourceHash: c.files.find((f) => f.id === item.fileRef)?.sourceHash ?? null,
  };
}
export function diffContexts(left: unknown, right: unknown) {
  const a = validateCapsule(left), b = validateCapsule(right);
  const ac = a.deterministic, bc = b.deterministic;
  const dimensions = ["task", "repository", "strategies", "budget", "overrides", "plan", "coverage", "diagnostics", "payloadHash"] as const;
  const compilation = dimensions.filter((key) => !equal(ac[key], bc[key])).map((key) => ({ dimension: key, before: ac[key], after: bc[key] }));
  const am = new Map(ac.candidates.map((c) => [c.id, c])), bm = new Map(bc.candidates.map((c) => [c.id, c]));
  const candidates = [...new Set([...am.keys(), ...bm.keys()])].sort().flatMap((id) => {
    const ai = am.get(id), bi = bm.get(id);
    const before = ai === undefined ? null : facts(ac, ai), after = bi === undefined ? null : facts(bc, bi);
    if (equal(before, after)) return [];
    const changes = before === null ? ["ADDED"] : after === null ? ["REMOVED"] : (Object.keys(before) as (keyof typeof before)[]).filter((key) => !equal(before[key], after[key]));
    return [{ id, path: (bi === undefined ? ac : bc).files.find((f) => f.id === (bi ?? ai)?.fileRef)?.path ?? "", changes, before, after }];
  });
  const review = ac.review === undefined && bc.review === undefined ? null : {
    changeSetChanged: !equal(ac.review?.changeHash ?? null, bc.review?.changeHash ?? null),
    symbolsChanged: !equal(ac.review?.changes.flatMap((f) => f.symbols) ?? [], bc.review?.changes.flatMap((f) => f.symbols) ?? []),
    relationshipsAdded: (bc.review?.impact ?? []).filter((r) => !ac.review?.impact.some((old) => old.id === r.id)),
    relationshipsRemoved: (ac.review?.impact ?? []).filter((r) => !bc.review?.impact.some((next) => next.id === r.id)),
    coverageBefore: reviewCoverage(ac), coverageAfter: reviewCoverage(bc),
  };
  return { schemaVersion: "contextforge-diff-v1" as const, before: a.capsuleHash, after: b.capsuleHash, identical: a.capsuleHash === b.capsuleHash, compilation, candidates, review, limitations: ["RECORDED_CANDIDATES_ONLY", "CORRELATION_IS_NOT_CAUSATION"] };
}
export type ContextDiff = ReturnType<typeof diffContexts>;
export function renderContextDiff(diff: ContextDiff): string {
  return [`Context Diff: ${diff.identical ? "IDENTICAL" : "CHANGED"}`, ...(diff.review === null ? [] : [`Review: change set ${diff.review.changeSetChanged ? "CHANGED" : "SAME"}; symbols ${diff.review.symbolsChanged ? "CHANGED" : "SAME"}; relationships +${diff.review.relationshipsAdded.length} -${diff.review.relationshipsRemoved.length}`]), ...diff.compilation.map((c) => `Compilation: ${c.dimension} changed`), ...diff.candidates.map((c) => `${JSON.stringify(c.path)}: ${c.before?.disposition ?? "ABSENT"} -> ${c.after?.disposition ?? "ABSENT"}; ${c.changes.join(", ")}`)].join("\n") + "\n";
}
