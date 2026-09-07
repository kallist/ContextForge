import { validateCapsule } from "./context-capsule.js";

export interface ContextLint {
  code: "AVAILABLE_ROLE_NOT_SELECTED" | "TOP_CANDIDATE_BUDGET_LOSS" | "SOURCE_UNAVAILABLE";
  severity: "WARNING" | "INFO";
  entities: string[];
  evidence: { code: string; refs: string[] };
  explanation: string;
}
export function contextCoverage(input: unknown) {
  const capsule = validateCapsule(input), c = capsule.deterministic;
  const lints: ContextLint[] = [];
  const roles = c.plan === null ? [] : c.coverage.planRoles.map((r) => ({ role: r.role, available: r.available, selected: r.selected }));
  for (const role of roles) if (role.available > 0 && role.selected === 0) {
    const entities = c.candidates.filter((item) => item.planRoles.includes(role.role)).map((item) => item.id);
    lints.push({ code: "AVAILABLE_ROLE_NOT_SELECTED", severity: "INFO", entities, evidence: { code: role.role, refs: entities }, explanation: `The recorded plan had ${role.available} opportunities for ${role.role}; none was retained. This is a plan tradeoff, not proof of missing necessary context.` });
  }
  const budgetLoss = c.decisions.filter((d) => ["BUDGET_EXHAUSTED", "GLOBAL_BUDGET"].includes(d.reason));
  const top = c.candidates.filter((item) => item.rank === 1 && budgetLoss.some((d) => d.candidateRef === item.id));
  if (top.length > 0) lints.push({ code: "TOP_CANDIDATE_BUDGET_LOSS", severity: "WARNING", entities: top.map((i) => i.id), evidence: { code: "RANK_1_BUDGET_DROP", refs: budgetLoss.filter((d) => top.some((i) => i.id === d.candidateRef)).map((d) => d.id) }, explanation: "The highest ranked candidate was dropped with a recorded budget reason." });
  if (c.excluded.length > 0) lints.push({ code: "SOURCE_UNAVAILABLE", severity: "WARNING", entities: c.excluded, evidence: { code: "SAFETY_EXCLUSION", refs: c.decisions.filter((d) => d.stage === "SAFETY").map((d) => d.id) }, explanation: "Recorded source safety exclusions limited this compilation. Reindexing may resolve stale sources; controls cannot bypass them." });
  const selectedEvidence = new Set(c.selected.flatMap((s) => s.evidenceRefs));
  return { schemaVersion: "contextforge-coverage-v1" as const, capsuleHash: capsule.capsuleHash,
    candidates: { available: c.candidates.length, selected: c.selected.length, dropped: c.dropped.length, excluded: c.excluded.length },
    evidence: { captured: c.evidence.length, referencedBySelection: selectedEvidence.size },
    roles, planner: c.plan === null ? "NOT_RUN" : "RECORDED", budgetLoss: budgetLoss.map((d) => d.candidateRef),
    budget: c.budget, lints, limitations: ["NOT_CONTEXT_COMPLETENESS", "NO_BENCHMARK_GOLD", "ABSENT_EVIDENCE_DOES_NOT_PROVE_ABSENT_TESTS", "REPLAY_NOT_VERIFIED"] };
}
