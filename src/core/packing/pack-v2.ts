import type { ContextRange } from "../context-pack.js";
import { priorityOrder, targetFacetFor, type CandidateRoles, type PackContextPlan, type PlanRole } from "./context-plan.js";

export const PACK_V2_STRATEGY = "contextforge-pack-v2";
export const PACK_V2_POLICY = "direct-context-priority-v1";
export const PACK_V2 = {
  candidateLimit: 64, maximumVerifiedBytes: 32 * 1024 * 1024,
  // Same aggregate ordinary-file capacity as V1's 6+4+4+2+2, shared across roles.
  maximumFiles: 18, maximumRanges: 12, maximumSymbols: 6,
  wholeFileMaximumLines: 120, wholeFileMaximumTokens: 1200,
  instructionMaximumTokens: 1600, maximumInstructionSections: 4,
} as const;
export type PackDropReason = "GLOBAL_BUDGET" | "SAFETY_LIMIT" | "REDUNDANT_RANGE" | "STALE_SOURCE" | "UNSUPPORTED_CONTENT" | "NO_USEFUL_RANGE";
export interface PackRangeOption {
  readonly ranges: readonly ContextRange[];
  readonly wholeFile: boolean;
  readonly tokens: number;
}
export interface PreparedPackCandidate {
  readonly path: string;
  readonly rank: number;
  readonly classification: CandidateRoles;
  readonly options: readonly PackRangeOption[];
  /** Most complete compact symbol core; surrounding enrichment comes later. */
  readonly preferred: number;
}
export interface PackSelectionEvent {
  readonly path: string;
  readonly phase: "ANCHOR" | "TARGET_OPPORTUNITY" | "DIRECT_PRIORITY" | "OPPORTUNITY" | "GLOBAL" | "EXPANSION";
  readonly role: PlanRole | null;
  readonly facet: CandidateRoles["facet"];
  readonly directness: CandidateRoles["directness"];
  readonly rank: number;
  readonly compactOptionTokens: number;
  readonly marginalReason: string;
  readonly tokens: number;
  readonly cumulativeTokens: number;
}
export interface PackSelection {
  readonly levels: ReadonlyMap<string, number>;
  readonly anchor: string | null;
  readonly targetFacet: CandidateRoles["facet"] | null;
  readonly events: readonly PackSelectionEvent[];
  readonly drops: readonly { readonly path: string; readonly reason: PackDropReason }[];
}

/** Bounded greedy selection. exactCost includes the entire serialized envelope. */
export function selectPlanAwarePack(
  candidates: readonly PreparedPackCandidate[], plan: PackContextPlan, budget: number,
  exactCost: (levels: ReadonlyMap<string, number>) => number,
): PackSelection {
  const levels = new Map<string, number>();
  const events: PackSelectionEvent[] = [];
  const roles = priorityOrder(plan);
  const covered = new Set<PlanRole>();
  const targetFacet = targetFacetFor(plan);
  const stable = [...candidates].sort((a, b) => a.rank - b.rank || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const compactLevels = (candidate: PreparedPackCandidate): number[] => candidate.options
    .map((_, index) => index).filter((index) => index <= candidate.preferred)
    .sort((a, b) => (candidate.options[a]?.tokens ?? 0) - (candidate.options[b]?.tokens ?? 0) || a - b);
  const directnessOrder: Record<CandidateRoles["directness"], number> = { IDENTITY: 0, OWNED_SYMBOL: 1, VERIFIED_LEXICAL: 2, INDIRECT: 3 };
  const priority = (candidate: PreparedPackCandidate): number => Math.min(...candidate.classification.roles.map((role) => {
    const value = plan.roles.find((item) => item.role === role)?.priority;
    return value === "REQUIRED" ? 0 : value === "HIGH" ? 1 : 2;
  }));
  const importance = (a: PreparedPackCandidate, b: PreparedPackCandidate): number =>
    directnessOrder[a.classification.directness] - directnessOrder[b.classification.directness] || priority(a) - priority(b) || a.rank - b.rank;
  const compare = (a: PreparedPackCandidate, b: PreparedPackCandidate): number => {
    const novelty = (item: PreparedPackCandidate): number => item.classification.roles.some((role) => !covered.has(role)) ? 0 : 1;
    return importance(a, b) || novelty(a) - novelty(b) ||
      (a.options[compactLevels(a)[0] ?? 0]?.tokens ?? 0) - (b.options[compactLevels(b)[0] ?? 0]?.tokens ?? 0) ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  };
  const event = (candidate: PreparedPackCandidate, phase: PackSelectionEvent["phase"], role: PlanRole | null, tokens: number, cumulativeTokens: number): PackSelectionEvent => ({
    path: candidate.path, phase, role, facet: candidate.classification.facet, directness: candidate.classification.directness, rank: candidate.rank,
    compactOptionTokens: candidate.options[compactLevels(candidate)[0] ?? 0]?.tokens ?? 0,
    marginalReason: phase === "TARGET_OPPORTUNITY" ? "Task target facet remains uncovered independently of role coverage."
      : phase === "DIRECT_PRIORITY" ? "Stronger direct context precedes a secondary role opportunity."
      : phase === "EXPANSION" ? "Enrichment after compact candidate opportunities."
      : phase === "ANCHOR" ? "Strongest fitting direct target, using task facet only within its evidence tier."
      : phase === "OPPORTUNITY" ? "Uncovered important role after stronger direct candidates."
      : "Directness, plan priority and retrieval rank precede marginal role novelty.",
    tokens, cumulativeTokens,
  });
  const tryCandidate = (candidate: PreparedPackCandidate, phase: PackSelectionEvent["phase"], role: PlanRole | null): boolean => {
    if (levels.has(candidate.path) || levels.size >= PACK_V2.maximumFiles) return false;
    for (const level of compactLevels(candidate)) {
      const option = candidate.options[level];
      if (option === undefined) continue;
      levels.set(candidate.path, level);
      const cost = exactCost(levels);
      if (cost <= budget) {
        candidate.classification.roles.forEach((item) => covered.add(item));
        events.push(event(candidate, phase, role, option.tokens, cost));
        return true;
      }
      levels.delete(candidate.path);
    }
    return false;
  };
  const direct = stable.filter((item) => item.classification.strongPrimary);
  const anchors = [...direct].sort((a, b) => directnessOrder[a.classification.directness] - directnessOrder[b.classification.directness] ||
    Number(b.classification.facet === targetFacet) - Number(a.classification.facet === targetFacet) || importance(a, b) || compare(a, b));
  const anchor = anchors.find((item) => tryCandidate(item, "ANCHOR", "PRIMARY"))?.path ?? null;
  if (targetFacet !== null && !direct.some((item) => levels.has(item.path) && item.classification.facet === targetFacet)) {
    direct.filter((item) => item.classification.facet === targetFacet).sort(compare).some((item) => tryCandidate(item, "TARGET_OPPORTUNITY", "PRIMARY"));
  }
  for (const role of roles) {
    if (covered.has(role) || plan.roles.find((item) => item.role === role)?.opportunity !== 1) continue;
    for (const candidate of stable.filter((item) => item.classification.roles.includes(role)).sort(compare)) {
      // A secondary opportunity cannot jump over fitting, stronger direct context.
      direct.filter((item) => importance(item, candidate) < 0).sort(compare).forEach((item) => tryCandidate(item, "DIRECT_PRIORITY", null));
      if (covered.has(role) || tryCandidate(candidate, "OPPORTUNITY", role)) break;
    }
  }
  // Recompute only bounded marginal novelty as coverage changes; never reserve quotas.
  const remaining = [...stable];
  while (remaining.length > 0) {
    remaining.sort(compare);
    const next = remaining.shift();
    if (next !== undefined) tryCandidate(next, "GLOBAL", null);
  }
  // Enrichment cannot displace a compact core already selected.
  for (const candidate of stable) {
    const selected = levels.get(candidate.path);
    if (selected === undefined) continue;
    for (let level = selected + 1; level < candidate.options.length; level += 1) {
      const previous = levels.get(candidate.path) ?? selected;
      levels.set(candidate.path, level);
      const cost = exactCost(levels);
      if (cost > budget) { levels.set(candidate.path, previous); continue; }
      events.push(event(candidate, "EXPANSION", null, candidate.options[level]?.tokens ?? 0, cost));
    }
  }
  return {
    levels, anchor, targetFacet, events,
    drops: stable.filter((item) => !levels.has(item.path)).map((item) => ({ path: item.path, reason: levels.size >= PACK_V2.maximumFiles ? "SAFETY_LIMIT" : "GLOBAL_BUDGET" })),
  };
}
