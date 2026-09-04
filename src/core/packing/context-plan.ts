import type { TaskAnalysis } from "../task-analysis-v2.js";
import type { CandidateEvidenceV2, RankedFileCandidateV2 } from "../task-retrieval-v2.js";

export const PACK_PLAN_STRATEGY = "contextforge-pack-plan-v1";
export const PLAN_ROLES = ["PRIMARY", "IMPACT", "VALIDATION", "SUPPORT"] as const;
export type PlanRole = (typeof PLAN_ROLES)[number];
export type PlanPriority = "REQUIRED" | "HIGH" | "NORMAL";
export interface PackContextPlan {
  readonly strategy: typeof PACK_PLAN_STRATEGY;
  readonly mode: TaskAnalysis["mode"];
  readonly action: TaskAnalysis["action"];
  readonly variant: "TASK_AWARE" | "NEUTRAL";
  readonly roles: readonly { readonly role: PlanRole; readonly priority: PlanPriority; readonly opportunity: 0 | 1 }[];
}

/** Deliberately consumes only existing task semantics, never paths or candidate identities. */
export function buildPackContextPlan(analysis: TaskAnalysis, variant: PackContextPlan["variant"] = "TASK_AWARE"): PackContextPlan {
  const priorities: Record<PlanRole, PlanPriority> = { PRIMARY: "REQUIRED", IMPACT: "HIGH", VALIDATION: "HIGH", SUPPORT: "NORMAL" };
  if (variant === "NEUTRAL") {
    priorities.IMPACT = priorities.VALIDATION = priorities.SUPPORT = "NORMAL";
  } else if (analysis.action === "REFACTOR" || analysis.mode === "CONCURRENCY") {
    priorities.IMPACT = "REQUIRED";
  } else if (analysis.action === "TEST" || analysis.mode === "TEST_FAILURE") {
    priorities.VALIDATION = "REQUIRED";
  } else if (analysis.action === "UNDERSTAND" || analysis.action === "REVIEW" || analysis.mode === "ARCHITECTURE") {
    priorities.SUPPORT = "HIGH";
    priorities.VALIDATION = "NORMAL";
  }
  return {
    strategy: PACK_PLAN_STRATEGY, mode: analysis.mode, action: analysis.action, variant,
    roles: PLAN_ROLES.map((role) => ({ role, priority: priorities[role], opportunity: priorities[role] === "NORMAL" ? 0 : 1 })),
  };
}

export interface CandidateRoles {
  readonly roles: readonly PlanRole[];
  readonly strongPrimary: boolean;
  readonly facet: "IMPLEMENTATION" | "VALIDATION" | "CONFIGURATION" | "DOCUMENTATION" | "OTHER";
  readonly directness: "IDENTITY" | "OWNED_SYMBOL" | "VERIFIED_LEXICAL" | "INDIRECT";
  readonly reasons: readonly { readonly role: PlanRole; readonly evidenceIds: readonly string[]; readonly reason: string }[];
}

const IMPACT = new Set(["CALLER", "SYMBOL_REFERENCE", "INTERFACE", "IMPLEMENTATION", "BOUNDED_DEPENDENT", "FILE_IMPORTED_BY", "FILE_IMPORTS_FILE"]);
const VALIDATION = new Set(["TEST_REFERENCE", "TEST_IMPORT", "TEST_ASSOCIATION", "TEST_RELATION"]);
export function isDirectPackEvidence(evidence: CandidateEvidenceV2): boolean {
  return evidence.sourceCandidate === null && evidence.ambiguity !== "COLLIDING" && (
    evidence.family === "IDENTITY" || evidence.kind === "LEXICAL_SYMBOL_OWNERSHIP" ||
    (evidence.kind === "VERIFIED_LEXICAL" && evidence.derivation === "VERIFIED_SOURCE")
  );
}

export function classifyPackCandidate(candidate: RankedFileCandidateV2): CandidateRoles {
  const evidence = [...candidate.directEvidence, ...candidate.expansionEvidence];
  const direct = evidence.filter(isDirectPackEvidence);
  const reasons: CandidateRoles["reasons"][number][] = [];
  const add = (role: PlanRole, matches: readonly CandidateEvidenceV2[], reason: string): void => {
    reasons.push({ role, evidenceIds: [...new Set(matches.map((item) => item.id))].sort(), reason });
  };
  if (direct.length > 0) add("PRIMARY", direct, "Direct task identity or generation-verified owning source.");
  const impact = evidence.filter((item) => IMPACT.has(item.kind));
  if (impact.length > 0) add("IMPACT", impact, "Existing bounded dependency, caller, reference, or implementation evidence.");
  const validation = evidence.filter((item) => VALIDATION.has(item.kind));
  if (candidate.category === "test" || validation.length > 0) add("VALIDATION", validation, "Safe test category or existing test relationship evidence.");
  if (candidate.category === "documentation" || candidate.category === "configuration" || reasons.length === 0) {
    add("SUPPORT", evidence.filter((item) => item.kind === "DOCUMENT_RELATION" || item.family === "STRUCTURAL"), "Secondary repository structure, documentation, or configuration.");
  }
  const facet: CandidateRoles["facet"] = candidate.category === "test" ? "VALIDATION"
    : candidate.category === "documentation" ? "DOCUMENTATION"
    : candidate.category === "configuration" ? "CONFIGURATION"
    : candidate.category === "source" && (candidate.language !== null || candidate.relevantSymbols.length > 0) ? "IMPLEMENTATION" : "OTHER";
  const directness: CandidateRoles["directness"] = direct.some((item) => item.family === "IDENTITY") ? "IDENTITY"
    : direct.some((item) => item.kind === "LEXICAL_SYMBOL_OWNERSHIP") ? "OWNED_SYMBOL"
    : direct.length > 0 ? "VERIFIED_LEXICAL" : "INDIRECT";
  return { roles: PLAN_ROLES.filter((role) => reasons.some((item) => item.role === role)), strongPrimary: direct.length > 0, facet, directness, reasons };
}

/** Target type is independent of PRIMARY role coverage, and contains no paths. */
export function targetFacetFor(plan: PackContextPlan): CandidateRoles["facet"] | null {
  if (plan.variant === "NEUTRAL") return null;
  if (plan.mode === "TEST_FAILURE" || plan.action === "TEST") return "VALIDATION";
  if (plan.mode === "CONFIGURATION") return "CONFIGURATION";
  if (plan.mode === "ARCHITECTURE" || plan.action === "UNDERSTAND" || plan.action === "REVIEW") return "DOCUMENTATION";
  if (plan.mode === "GENERAL" && plan.action === "CHANGE") return null;
  if (plan.action === "FIX" || plan.action === "CHANGE" || plan.action === "REFACTOR") return "IMPLEMENTATION";
  return null;
}

export function priorityOrder(plan: PackContextPlan): readonly PlanRole[] {
  const order: Record<PlanPriority, number> = { REQUIRED: 0, HIGH: 1, NORMAL: 2 };
  return [...plan.roles].sort((a, b) => order[a.priority] - order[b.priority] || PLAN_ROLES.indexOf(a.role) - PLAN_ROLES.indexOf(b.role)).map((item) => item.role);
}
