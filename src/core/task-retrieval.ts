import type { AnalyzedSymbol } from "./language-analysis.js";
import type { FileCategory } from "./repository-map.js";
import type { QuerySignal, TaskQuery } from "./task-query.js";

export const SEARCH_SCHEMA_VERSION = "1.0";
export const RANKING_STRATEGY = "contextforge-structural-v1";

export type CandidateOrigin = "DIRECT" | "EXPANDED" | "DIRECT_AND_EXPANDED";
export type EvidenceFamily = "IDENTITY" | "LEXICAL" | "STRUCTURAL" | "GIT";
export type CandidateEvidenceKind =
  | "EXACT_QUALIFIED_SYMBOL"
  | "EXACT_SYMBOL"
  | "SYMBOL_COMPONENT"
  | "EXACT_PATH"
  | "EXACT_BASENAME"
  | "PATH_COMPONENT"
  | "IMPORT_MODULE"
  | "SOURCE_LEXICAL"
  | "FILE_IMPORTS_FILE"
  | "FILE_IMPORTED_BY"
  | "TEST_RELATION"
  | "DOCUMENT_RELATION"
  | "GIT_DIRTY"
  | "GIT_RECENCY";

export interface CandidateEvidence {
  readonly kind: CandidateEvidenceKind;
  readonly family: EvidenceFamily;
  readonly querySignal: string | null;
  readonly target: string;
  /** Proposed additive points before the documented evidence-family cap. */
  readonly weight: number;
  readonly graphDistance: number;
  readonly sourceCandidate: string | null;
  readonly detail: string;
}

export interface ScoreContribution {
  readonly kind: CandidateEvidenceKind;
  readonly family: EvidenceFamily;
  readonly value: number;
  readonly reason: string;
}

export interface RelevantSymbol {
  readonly identity: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: AnalyzedSymbol["kind"];
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly evidence: readonly CandidateEvidence[];
}

export interface RankedFileCandidate {
  readonly identity: string;
  readonly relativePath: string;
  readonly category: FileCategory;
  readonly language: string | null;
  readonly origin: CandidateOrigin;
  readonly directEvidence: readonly CandidateEvidence[];
  readonly expansionEvidence: readonly CandidateEvidence[];
  readonly scoreContributions: readonly ScoreContribution[];
  /** Relative relevance points, not a probability. */
  readonly score: number;
  /** Equal to score in v1; retained to make additive reconstruction explicit. */
  readonly rawScore: number;
  readonly graphDistance: number | null;
  readonly rankingStrategy: typeof RANKING_STRATEGY;
  readonly generation: number;
  readonly relevantSymbols: readonly RelevantSymbol[];
}

export interface SearchIndexStatus {
  readonly status: "FRESH" | "STALE" | "PARTIAL";
  readonly changedFiles: number;
  readonly addedFiles: number;
  readonly deletedFiles: number;
  readonly lexicalSkippedFiles: number;
  readonly stalePaths: readonly string[];
}

export interface SearchResult {
  readonly schemaVersion: typeof SEARCH_SCHEMA_VERSION;
  readonly task: string;
  readonly repository: { readonly name: string; readonly root: "." };
  readonly generation: number;
  readonly rankingStrategy: typeof RANKING_STRATEGY;
  readonly indexStatus: SearchIndexStatus;
  readonly normalizedQuery: {
    readonly schemaVersion: TaskQuery["schemaVersion"];
    readonly queryVersion: TaskQuery["queryVersion"];
    readonly byteLength: number;
    readonly signals: readonly QuerySignal[];
    readonly diagnostics: TaskQuery["diagnostics"];
  };
  readonly candidates: readonly RankedFileCandidate[];
  readonly diagnostics: readonly string[];
  readonly counts: {
    readonly directCandidates: number;
    readonly expandedCandidates: number;
    readonly finalCandidates: number;
    readonly lexicalFilesScanned: number;
    readonly lexicalBytesScanned: number;
  };
}

export interface SearchPerformance {
  readonly normalizationMs: number;
  readonly retrievalMs: number;
  readonly lexicalMs: number;
  readonly expansionMs: number;
  readonly rankingMs: number;
  readonly totalMs: number;
}

export interface SearchExecution {
  readonly result: SearchResult;
  /** Measurements are deliberately outside SearchResult so stable JSON is byte-deterministic. */
  readonly performance: SearchPerformance;
}
