import type { SearchIndexStatus } from "./task-retrieval.js";
import type { ContextCapsuleV1 } from "./context-capsule.js";

export const CONTEXT_PACK_SCHEMA_VERSION = "1.0";
export const PACKING_STRATEGY = "contextforge-pack-v1";

export type ContextRole =
  | "REPOSITORY_INSTRUCTION"
  | "PRIMARY_CODE"
  | "TEST"
  | "DEPENDENCY"
  | "DOCUMENTATION"
  | "CONFIGURATION"
  | "GIT_CONTEXT";

export type RangeReason =
  | "HUMAN_RANGE"
  | "SYMBOL_RANGE"
  | "PARENT_CONTEXT"
  | "SURROUNDING_CONTEXT"
  | "IMPORT_BLOCK"
  | "MARKDOWN_SECTION"
  | "WHOLE_FILE"
  | "CONFIGURATION_FILE"
  | "LEXICAL_RANGE"
  | "BOUNDED_FILE_PREFIX";

export interface ContextRange {
  readonly startLine: number;
  readonly endLine: number;
  readonly reasons: readonly RangeReason[];
}

export interface ContextSelectionReason {
  readonly kind: string;
  readonly detail: string;
  readonly contribution: number;
}

export interface ContextRelevantSymbol {
  readonly identity: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface SelectedContextItem {
  readonly identity: string;
  readonly relativePath: string;
  readonly role: Exclude<ContextRole, "GIT_CONTEXT">;
  readonly secondaryRoles: readonly ContextRole[];
  readonly candidateRank: number | null;
  readonly candidateScore: number | null;
  readonly candidateOrigin: string | null;
  readonly graphDistance: number | null;
  readonly selectionReasons: readonly ContextSelectionReason[];
  readonly relevantSymbols: readonly ContextRelevantSymbol[];
  readonly selectedRanges: readonly ContextRange[];
  readonly wholeFile: boolean;
  readonly estimatedTokens: number;
  readonly contentStatus: "VERIFIED_GENERATION" | "PARTIAL";
}

export type DropReason =
  | "BUDGET_EXHAUSTED"
  | "LOWER_PRIORITY"
  | "DUPLICATE"
  | "STALE_SOURCE"
  | "SECTION_LIMIT"
  | "UNSUPPORTED_CONTENT"
  | "NO_USEFUL_RANGE"
  | "SOURCE_VERIFICATION_LIMIT";

export interface DroppedCandidate {
  readonly relativePath: string;
  readonly candidateRank: number | null;
  readonly score: number | null;
  readonly dropReason: DropReason;
}

export interface ContextSectionSummary {
  readonly role: ContextRole;
  readonly selectedItems: number;
  readonly estimatedTokens: number;
}

export interface ContextPackManifest {
  readonly schemaVersion: typeof CONTEXT_PACK_SCHEMA_VERSION;
  readonly task: string;
  readonly repository: { readonly name: string; readonly root: "." };
  readonly generation: number;
  readonly indexStatus: SearchIndexStatus;
  readonly packStatus: "COMPLETE" | "PARTIAL";
  readonly rankingStrategy: string;
  readonly packingStrategy: typeof PACKING_STRATEGY;
  readonly tokenEstimator: string;
  readonly tokenEstimatorVersion: string;
  readonly requestedBudget: number;
  readonly estimatedPayloadTokens: number;
  readonly unusedBudget: number;
  readonly utilization: number;
  readonly unusedBudgetReason: "NO_MORE_USEFUL_CONTEXT" | "STALE_HIGH_VALUE_CONTEXT" | "SECTION_POLICY_LIMIT" | null;
  readonly sections: readonly ContextSectionSummary[];
  readonly selectedItems: readonly SelectedContextItem[];
  readonly droppedCandidates: readonly DroppedCandidate[];
  readonly droppedSummary: Readonly<Record<DropReason, number>>;
  readonly diagnostics: readonly string[];
}

export interface ContextPackPerformance {
  readonly searchMs: number;
  readonly planningMs: number;
  readonly roleAssignmentMs: number;
  readonly sourceVerificationMs: number;
  readonly rangeSelectionMs: number;
  readonly rangeMergingMs: number;
  readonly tokenEstimationMs: number;
  readonly serializationMs: number;
  readonly finalVerificationMs: number;
  readonly reductionMs: number;
  readonly reductionIterations: number;
  readonly totalMs: number;
  readonly verifiedFiles: number;
  readonly verifiedBytes: number;
}

export interface ContextPackExecution {
  readonly capsule?: ContextCapsuleV1;
  readonly markdown: string;
  readonly manifest: ContextPackManifest;
  /** Measurements stay outside deterministic pack artifacts. */
  readonly performance: ContextPackPerformance;
}
