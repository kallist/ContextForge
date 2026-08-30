import type { ContextRange } from "../../src/core/context-pack.js";

export const BENCHMARK_VERSION = "contextforge-benchmark-v1";
export const DATASET_VERSION = "contextforge-dataset-v1";
export const SYSTEM_IDS = ["lexical-full-file-v1", "structural-full-file-v1", "contextforge-v1"] as const;
export const QUALITY_BUDGETS = [2_000, 4_000, 8_000, 16_000, 32_000] as const;
export const RETRIEVAL_CUTOFFS = [1, 3, 5, 10, 20] as const;
export const MATCHED_RECALL_TARGETS = [0.8, 0.9, 1] as const;

export type SystemId = (typeof SYSTEM_IDS)[number];
export type GoldImportance = "REQUIRED" | "SUPPORTING";
export type TaskDifficulty = "EASY" | "MEDIUM" | "HARD";
export type TaskCategory =
  | "EXACT_SYMBOL"
  | "BUG_FIX"
  | "CROSS_FILE_BUG_FIX"
  | "TEST_FAILURE"
  | "CONCURRENCY"
  | "CONFIGURATION"
  | "API_INTEGRATION"
  | "REFACTOR"
  | "DOCUMENTATION_ARCHITECTURE"
  | "AMBIGUOUS_NATURAL_LANGUAGE";

export interface BenchmarkRepositoryDefinition {
  readonly repositoryId: string;
  readonly kind: "PINNED_GIT" | "CURATED_FIXTURE";
  readonly repositoryRevision: string;
  readonly relativePath?: string;
}

export interface GoldFileDefinition {
  readonly path: string;
  readonly importance: GoldImportance;
  readonly rationale: string;
}

export interface GoldSymbolDefinition extends GoldFileDefinition {
  readonly qualifiedName: string;
}

export interface GoldRangeDefinition extends GoldFileDefinition {
  readonly startLine: number;
  readonly endLine: number;
}

export interface BenchmarkTaskDefinition {
  readonly taskId: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly taskText: string;
  readonly taskCategory: TaskCategory;
  readonly languageTags: readonly string[];
  readonly difficulty: TaskDifficulty;
  readonly goldFiles: readonly GoldFileDefinition[];
  readonly goldSymbols: readonly GoldSymbolDefinition[];
  readonly goldRanges: readonly GoldRangeDefinition[];
  readonly notes: string;
}

export interface BenchmarkDataset {
  readonly benchmarkVersion: typeof BENCHMARK_VERSION;
  readonly datasetVersion: typeof DATASET_VERSION;
  readonly repositories: readonly BenchmarkRepositoryDefinition[];
  readonly tasks: readonly BenchmarkTaskDefinition[];
}

export interface DatasetLock {
  readonly benchmarkVersion: typeof BENCHMARK_VERSION;
  readonly datasetVersion: typeof DATASET_VERSION;
  readonly datasetHash: string;
  readonly goldReview: "COMPLETED_BEFORE_FORMAL_RUN";
  readonly frozen: true;
}

export interface RetrievalSymbol {
  readonly path: string;
  readonly qualifiedName: string;
}

export interface RetrievalCandidate {
  readonly path: string;
  readonly relevantSymbols: readonly RetrievalSymbol[];
}

export interface SelectedRange {
  readonly path: string;
  readonly ranges: readonly ContextRange[];
}

export interface SystemSelection {
  readonly systemId: SystemId;
  readonly rankingStrategy: string;
  readonly packingStrategy: string;
  readonly tokenEstimator: string;
  readonly tokenEstimatorVersion: string;
  readonly budget: number;
  readonly payloadTokens: number;
  readonly retrievalCandidates: readonly RetrievalCandidate[];
  readonly selectedRanges: readonly SelectedRange[];
  readonly status: "COMPLETE" | "PARTIAL" | "NO_CONTEXT";
  readonly diagnostics: readonly string[];
  readonly performance: {
    readonly retrievalMs: number;
    readonly packingMs: number;
    readonly totalMs: number;
  };
}

export interface RetrievalMetric {
  readonly requiredFileRecall: number | null;
  readonly fileRecall: number | null;
  readonly requiredSymbolRecall: number | null;
  readonly symbolRecall: number | null;
}

export interface QualityCaseResult {
  readonly benchmarkVersion: typeof BENCHMARK_VERSION;
  readonly datasetVersion: typeof DATASET_VERSION;
  readonly datasetHash: string;
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly taskId: string;
  readonly taskText: string;
  readonly taskCategory: TaskCategory;
  readonly languageTags: readonly string[];
  readonly difficulty: TaskDifficulty;
  readonly systemId: SystemId;
  readonly rankingStrategy: string;
  readonly packingStrategy: string;
  readonly tokenEstimator: string;
  readonly tokenEstimatorVersion: string;
  readonly budget: number;
  readonly payloadTokens: number;
  readonly repositoryContentTokens: number;
  readonly serializationOverheadTokens: number;
  readonly retrieval: Readonly<Record<string, RetrievalMetric>>;
  readonly requiredFileRecall: number | null;
  readonly fileRecall: number | null;
  readonly requiredSymbolRecall: number | null;
  readonly symbolRecall: number | null;
  readonly overallGoldRecall: number | null;
  readonly goldRangePrecision: number | null;
  readonly noiseRatio: number | null;
  readonly selectedFiles: readonly string[];
  readonly selectedRanges: readonly SelectedRange[];
  readonly missedRequiredFiles: readonly string[];
  readonly missedRequiredSymbols: readonly string[];
  readonly failureAttribution: readonly string[];
  readonly status: SystemSelection["status"];
  readonly diagnostics: readonly string[];
}

export interface QualityRun {
  readonly manifest: {
    readonly benchmarkVersion: typeof BENCHMARK_VERSION;
    readonly datasetVersion: typeof DATASET_VERSION;
    readonly datasetHash: string;
    readonly contextforgeCommit: string;
    readonly rankingStrategy: "contextforge-structural-v1";
    readonly packingStrategy: "contextforge-pack-v1";
    readonly tokenEstimator: "contextforge-generic-v1";
    readonly tokenEstimatorVersion: "1.0";
    readonly baselineVersions: readonly ["lexical-full-file-v1", "structural-full-file-v1"];
    readonly budgets: readonly number[];
    readonly systems: readonly SystemId[];
    readonly taskCount: number;
    readonly repositoryCount: number;
    readonly runMode: "SMOKE" | "FULL";
  };
  readonly cases: readonly QualityCaseResult[];
}

export interface PerformanceSample {
  readonly repositoryId: string;
  readonly repositoryRevision: string;
  readonly taskId: string;
  readonly budget: number;
  readonly systemId: SystemId;
  readonly repetition: number;
  readonly indexMs: number | null;
  readonly retrievalMs: number;
  readonly packingMs: number;
  readonly totalMs: number;
}
