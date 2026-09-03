import { createHash } from "node:crypto";

import type { CandidateSourceId, ContextPlan } from "./context-plan-v2.js";
import type { AnalyzedSymbol, FileAnalysis, SourceRange } from "./language-analysis.js";
import type { FileCategory } from "./repository-map.js";
import type { SignalAmbiguity, TaskAnalysis } from "./task-analysis-v2.js";
import type { CandidateOrigin, SearchIndexStatus } from "./task-retrieval.js";
import type { RelationshipEvidenceV2 } from "./relationship-intelligence-v2.js";

export const RETRIEVAL_V2_SCHEMA_VERSION = "1.0";
export const RETRIEVAL_V2_STRATEGY = "contextforge-retrieval-v2";
export const RETRIEVAL_V2_RELATIONSHIPS_STRATEGY = "contextforge-retrieval-v2-relations";
export const RETRIEVAL_V2_DIAGNOSTICS_VERSION = "contextforge-retrieval-v2-diagnostics-v1";

export type CandidateEvidenceFamily = "IDENTITY" | "LEXICAL" | "SYMBOL" | "STRUCTURAL" | "RELATIONSHIP" | "GIT";
export type CandidateEvidenceDerivation = "STRUCTURAL" | "HEURISTIC" | "VERIFIED_SOURCE";
export type CandidateEvidenceKindV2 =
  | "EXACT_PATH"
  | "EXACT_BASENAME"
  | "EXACT_QUALIFIED_SYMBOL"
  | "EXACT_SYMBOL"
  | "AMBIGUOUS_SYMBOL"
  | "SYMBOL_COMPONENT"
  | "PATH_COMPONENT"
  | "IMPORT_MODULE"
  | "VERIFIED_LEXICAL"
  | "LEXICAL_SYMBOL_OWNERSHIP"
  | "FILE_IMPORTS_FILE"
  | "FILE_IMPORTED_BY"
  | "TEST_RELATION"
  | "DOCUMENT_RELATION"
  | "SYMBOL_REFERENCE"
  | "CALLER"
  | "INTERFACE"
  | "IMPLEMENTATION"
  | "TEST_REFERENCE"
  | "TEST_IMPORT"
  | "TEST_ASSOCIATION"
  | "BOUNDED_DEPENDENT"
  | "GIT_DIRTY"
  | "GIT_RECENCY";

export interface CandidateEvidenceLocation {
  readonly startLine: number;
  readonly endLine: number;
}

function validRange(range: SourceRange): boolean {
  if (![range.startLine, range.endLine, range.startColumn, range.endColumn].every(Number.isSafeInteger)) return false;
  if (range.startLine < 1 || range.endLine < 1 || range.startColumn < 1 || range.endColumn < 1) return false;
  return range.startLine < range.endLine || (range.startLine === range.endLine && range.startColumn <= range.endColumn);
}

function rangeContains(outer: SourceRange, inner: SourceRange): boolean {
  const startsBefore = outer.startLine < inner.startLine || (outer.startLine === inner.startLine && outer.startColumn <= inner.startColumn);
  const endsAfter = outer.endLine > inner.endLine || (outer.endLine === inner.endLine && outer.endColumn >= inner.endColumn);
  return startsBefore && endsAfter;
}

function sameRange(left: SourceRange, right: SourceRange): boolean {
  return left.startLine === right.startLine && left.endLine === right.endLine && left.startColumn === right.startColumn && left.endColumn === right.endColumn;
}

/** Returns a unique narrowest parsed owner, or null when ranges are missing, malformed, or overlap ambiguously. */
export function findNarrowestOwningSymbolV2(analysis: FileAnalysis, location: SourceRange): AnalyzedSymbol | null {
  if ((analysis.parserStatus !== "parsed" && analysis.parserStatus !== "degraded") || !validRange(location)) return null;
  const containing = analysis.symbols.filter((symbol) => validRange(symbol) && rangeContains(symbol, location)).sort((left, right) => {
    const lineSpan = (left.endLine - left.startLine) - (right.endLine - right.startLine);
    if (lineSpan !== 0) return lineSpan;
    if (left.startLine !== right.startLine) return right.startLine - left.startLine;
    if (left.startColumn !== right.startColumn) return right.startColumn - left.startColumn;
    if (left.endLine !== right.endLine) return left.endLine - right.endLine;
    if (left.endColumn !== right.endColumn) return left.endColumn - right.endColumn;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  const narrowest = containing[0];
  if (narrowest === undefined) return null;
  if (containing.slice(1).some((candidate) => sameRange(candidate, narrowest) || !rangeContains(candidate, narrowest))) return null;
  return narrowest;
}

export interface CandidateEvidenceV2 {
  readonly id: string;
  readonly source: CandidateSourceId;
  readonly family: CandidateEvidenceFamily;
  readonly target: { readonly file: string; readonly symbolId: string | null };
  readonly taskSignalId: string | null;
  readonly matchKind: CandidateEvidenceKindV2;
  readonly kind: CandidateEvidenceKindV2;
  readonly confidence: number;
  readonly derivation: CandidateEvidenceDerivation;
  readonly location: CandidateEvidenceLocation | null;
  readonly sourceCandidate: string | null;
  readonly relationshipId: string | null;
  readonly graphDistance: number;
  readonly ambiguity: SignalAmbiguity | "NOT_APPLICABLE";
  readonly rawFeature: number | string | boolean;
  readonly boundedContribution: number;
  /** Compatibility field consumed by Pack V1 explanations. */
  readonly weight: number;
  readonly explanation: string;
  /** Compatibility field consumed by Pack V1 explanations. */
  readonly detail: string;
}

export type CandidateEvidenceInputV2 = Omit<CandidateEvidenceV2, "id" | "kind" | "weight" | "detail">;

export interface ScoreContributionV2 {
  readonly evidenceId: string | null;
  readonly kind: CandidateEvidenceKindV2 | "DISTINCT_TASK_SIGNAL_COVERAGE" | "SOURCE_FAMILY_AGREEMENT";
  readonly family: CandidateEvidenceFamily | "FUSION";
  readonly value: number;
  readonly reason: string;
}

export interface RelevantSymbolV2 {
  readonly identity: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: AnalyzedSymbol["kind"];
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly evidence: readonly CandidateEvidenceV2[];
}

export interface RankedFileCandidateV2 {
  readonly identity: string;
  readonly relativePath: string;
  readonly category: FileCategory;
  readonly language: string | null;
  readonly origin: CandidateOrigin;
  readonly directEvidence: readonly CandidateEvidenceV2[];
  readonly expansionEvidence: readonly CandidateEvidenceV2[];
  readonly scoreContributions: readonly ScoreContributionV2[];
  readonly score: number;
  readonly rawScore: number;
  readonly priorityTier: number;
  readonly graphDistance: number | null;
  readonly rankingStrategy: typeof RETRIEVAL_V2_STRATEGY | typeof RETRIEVAL_V2_RELATIONSHIPS_STRATEGY;
  readonly generation: number;
  readonly relevantSymbols: readonly RelevantSymbolV2[];
  readonly sourceFamilies: readonly CandidateEvidenceFamily[];
  readonly taskSignalIds: readonly string[];
}

export type RetrievalV2Ablation =
  | "IDENTITY_LEXICAL"
  | "IDENTITY_LEXICAL_STRUCTURAL"
  | "IDENTITY_LEXICAL_STRUCTURAL_AMBIGUITY"
  | "FULL"
  | "RELATION_REFERENCES"
  | "RELATION_CALLERS"
  | "RELATION_IMPLEMENTATIONS"
  | "RELATION_TESTS"
  | "RELATION_FULL";

export interface SearchResultV2 {
  readonly schemaVersion: typeof RETRIEVAL_V2_SCHEMA_VERSION;
  readonly task: string;
  readonly repository: { readonly name: string; readonly root: "." };
  readonly generation: number;
  readonly rankingStrategy: typeof RETRIEVAL_V2_STRATEGY | typeof RETRIEVAL_V2_RELATIONSHIPS_STRATEGY;
  readonly ablation: RetrievalV2Ablation;
  readonly indexStatus: SearchIndexStatus;
  readonly taskAnalysis: TaskAnalysis;
  readonly contextPlan: ContextPlan;
  readonly relationships: readonly RelationshipEvidenceV2[];
  readonly normalizedQuery: {
    readonly schemaVersion: TaskAnalysis["schemaVersion"];
    readonly queryVersion: TaskAnalysis["strategy"];
    readonly byteLength: number;
    readonly signals: TaskAnalysis["signals"];
    readonly diagnostics: { readonly lowInformation: boolean; readonly controlCharacters: number };
  };
  readonly candidates: readonly RankedFileCandidateV2[];
  readonly diagnostics: readonly string[];
  readonly counts: {
    readonly identityEvidence: number;
    readonly lexicalEvidence: number;
    readonly ownershipEvidence: number;
    readonly structuralEvidence: number;
    readonly relationshipEvidence: number;
    readonly reportedRelationships: number;
    readonly structuralRelationshipFacts: number;
    readonly heuristicRelationships: number;
    readonly relationshipOnlyDiscoveries: number;
    readonly callerDiscoveries: number;
    readonly testDiscoveries: number;
    readonly implementationDiscoveries: number;
    readonly heuristicDiscoveries: number;
    readonly relationshipFanoutCapEvents: number;
    readonly relationshipHubSuppressions: number;
    readonly fusedCandidates: number;
    readonly expandedCandidates: number;
    readonly ambiguityDiscounts: number;
    readonly lexicalOwnershipSuccesses: number;
    readonly lexicalOwnershipFallbacks: number;
    readonly lexicalFilesScanned: number;
    readonly lexicalBytesScanned: number;
    readonly top5ScoreTies: number;
    readonly top10ScoreTies: number;
    readonly evidenceCapEvents: number;
  };
}

export interface SearchPerformanceV2 {
  readonly taskAnalysisMs: number;
  readonly contextPlanMs: number;
  readonly identityMs: number;
  readonly lexicalMs: number;
  readonly fusionMs: number;
  readonly graphExpansionMs: number;
  readonly relationshipDerivationMs: number;
  readonly relationshipExpansionMs: number;
  readonly rankingMs: number;
  readonly totalMs: number;
}

function stableFeature(value: CandidateEvidenceV2["rawFeature"]): string {
  return typeof value === "string" ? value : String(value);
}

export function createCandidateEvidenceV2(input: CandidateEvidenceInputV2): CandidateEvidenceV2 {
  const identity = [
    input.source,
    input.family,
    input.target.file,
    input.target.symbolId ?? "",
    input.taskSignalId ?? "",
    input.matchKind,
    input.derivation,
    input.location?.startLine ?? "",
    input.location?.endLine ?? "",
    input.sourceCandidate ?? "",
    input.relationshipId ?? "",
    input.graphDistance,
    input.ambiguity,
    stableFeature(input.rawFeature),
  ].join("\u0000");
  const id = `evidence_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
  return {
    ...input,
    id,
    kind: input.matchKind,
    weight: input.boundedContribution,
    detail: input.explanation,
  };
}
