import type { TaskAnalysis, TaskMode } from "./task-analysis-v2.js";

export const CONTEXT_PLAN_SCHEMA_VERSION = "1.0";
export const CONTEXT_PLAN_STRATEGY = "contextforge-context-plan-v2";

export type PlannedContextRole =
  | "PRIMARY_IMPLEMENTATION"
  | "STATE_OWNER"
  | "CALLER_OR_DEPENDENT"
  | "TEST"
  | "CONFIGURATION"
  | "DOCUMENTATION"
  | "REPOSITORY_INSTRUCTION";

export type CandidateSourceId =
  | "IDENTITY"
  | "VERIFIED_LEXICAL"
  | "SYMBOL_OWNERSHIP"
  | "FILE_STRUCTURAL"
  | "TEST_DOCUMENTATION"
  | "GIT";

export interface PlannedSection {
  readonly role: PlannedContextRole;
  readonly priority: "REQUIRED" | "PREFERRED" | "OPTIONAL";
  readonly minimumItems: 0 | 1 | 2;
  readonly maximumItems: number;
  readonly acceptedEvidenceSources: readonly CandidateSourceId[];
  readonly rationale: string;
}

export interface ContextPlan {
  readonly schemaVersion: typeof CONTEXT_PLAN_SCHEMA_VERSION;
  readonly strategy: typeof CONTEXT_PLAN_STRATEGY;
  readonly mode: TaskMode;
  readonly primaryContextRole: PlannedContextRole;
  readonly sections: readonly PlannedSection[];
  readonly focusSignalIds: readonly string[];
  readonly relevantConcepts: TaskAnalysis["concepts"];
  readonly diagnostics: readonly string[];
}

const DIRECT = ["IDENTITY", "VERIFIED_LEXICAL", "SYMBOL_OWNERSHIP"] as const;
const STRUCTURAL = ["FILE_STRUCTURAL", "TEST_DOCUMENTATION"] as const;

function section(
  role: PlannedContextRole,
  priority: PlannedSection["priority"],
  minimumItems: PlannedSection["minimumItems"],
  maximumItems: number,
  acceptedEvidenceSources: readonly CandidateSourceId[],
  rationale: string,
): PlannedSection {
  return { role, priority, minimumItems, maximumItems, acceptedEvidenceSources, rationale };
}

function sectionsFor(mode: TaskMode): PlannedSection[] {
  const instructions = section("REPOSITORY_INSTRUCTION", "PREFERRED", 0, 1, DIRECT, "Preserve repository-provided constraints when safely available.");
  switch (mode) {
    case "CONCURRENCY": return [
      section("PRIMARY_IMPLEMENTATION", "REQUIRED", 1, 6, DIRECT, "Start with direct implementation evidence."),
      section("STATE_OWNER", "REQUIRED", 1, 4, [...DIRECT, "FILE_STRUCTURAL"], "Include the mutation, transaction, or lock boundary."),
      section("CALLER_OR_DEPENDENT", "PREFERRED", 0, 4, STRUCTURAL, "Inspect bounded callers and dependents of the mutation boundary."),
      section("TEST", "PREFERRED", 0, 4, ["TEST_DOCUMENTATION", "FILE_STRUCTURAL"], "Prefer concurrency and regression tests."),
      instructions,
    ];
    case "TEST_FAILURE": return [
      section("TEST", "REQUIRED", 1, 4, [...DIRECT, "TEST_DOCUMENTATION"], "Retain the failing test evidence."),
      section("PRIMARY_IMPLEMENTATION", "REQUIRED", 1, 6, [...DIRECT, "FILE_STRUCTURAL"], "Retain the implementation exercised by the test."),
      section("STATE_OWNER", "PREFERRED", 0, 4, ["FILE_STRUCTURAL", "SYMBOL_OWNERSHIP"], "Include state owners when structurally supported."),
      instructions,
    ];
    case "CONFIGURATION": return [
      section("CONFIGURATION", "REQUIRED", 1, 4, [...DIRECT, "FILE_STRUCTURAL"], "Retain configuration, schema, manifest, or defaults."),
      section("PRIMARY_IMPLEMENTATION", "REQUIRED", 1, 6, [...DIRECT, "FILE_STRUCTURAL"], "Retain validators and consumers."),
      section("TEST", "PREFERRED", 0, 4, ["TEST_DOCUMENTATION", "FILE_STRUCTURAL"], "Prefer configuration behavior tests."),
      section("DOCUMENTATION", "OPTIONAL", 0, 2, ["VERIFIED_LEXICAL", "TEST_DOCUMENTATION"], "Add documentation only when evidence supports it."),
      instructions,
    ];
    case "ARCHITECTURE": return [
      section("DOCUMENTATION", "REQUIRED", 1, 4, [...DIRECT, "TEST_DOCUMENTATION"], "Retain the requested decision or architecture document."),
      section("PRIMARY_IMPLEMENTATION", "PREFERRED", 0, 6, [...DIRECT, "FILE_STRUCTURAL"], "Relate the decision to concrete implementation evidence."),
      section("TEST", "OPTIONAL", 0, 2, ["TEST_DOCUMENTATION", "FILE_STRUCTURAL"], "Tests are secondary unless directly evidenced."),
      instructions,
    ];
    case "EXACT_TARGET": return [
      section("PRIMARY_IMPLEMENTATION", "REQUIRED", 1, 6, DIRECT, "Retain the explicit target."),
      section("CALLER_OR_DEPENDENT", "PREFERRED", 0, 4, STRUCTURAL, "Add direct structural context around the target."),
      section("TEST", "PREFERRED", 0, 4, ["TEST_DOCUMENTATION", "FILE_STRUCTURAL"], "Add related tests when available."),
      instructions,
    ];
    case "BEHAVIORAL":
    case "GENERAL": return [
      section("PRIMARY_IMPLEMENTATION", "REQUIRED", 1, 6, DIRECT, "Prefer the strongest direct task evidence."),
      section("STATE_OWNER", "PREFERRED", 0, 4, [...DIRECT, "FILE_STRUCTURAL"], "Add state ownership when supported."),
      section("CALLER_OR_DEPENDENT", "PREFERRED", 0, 4, STRUCTURAL, "Add bounded related implementation context."),
      section("TEST", "PREFERRED", 0, 4, ["TEST_DOCUMENTATION", "FILE_STRUCTURAL"], "Add related tests when available."),
      section("DOCUMENTATION", "OPTIONAL", 0, 2, ["VERIFIED_LEXICAL", "TEST_DOCUMENTATION"], "Documentation remains optional without direct evidence."),
      instructions,
    ];
  }
}

export function buildContextPlan(analysis: TaskAnalysis): ContextPlan {
  const focusSignalIds = analysis.signals
    .filter((signal) => !signal.lowValue && (signal.specificity !== "GENERAL" || signal.ambiguity !== "COLLIDING"))
    .slice(0, 32)
    .map((signal) => signal.id);
  const sections = sectionsFor(analysis.mode);
  return {
    schemaVersion: CONTEXT_PLAN_SCHEMA_VERSION,
    strategy: CONTEXT_PLAN_STRATEGY,
    mode: analysis.mode,
    primaryContextRole: sections[0]?.role ?? "PRIMARY_IMPLEMENTATION",
    sections,
    focusSignalIds,
    relevantConcepts: analysis.concepts,
    diagnostics: focusSignalIds.length === 0 ? ["CONTEXT_PLAN_NO_FOCUS_SIGNAL"] : [],
  };
}
