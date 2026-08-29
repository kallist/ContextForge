import type { FileAnalysis } from "./language-analysis.js";
import type { ContentStatus, FileCategory } from "./repository-map.js";

export const INDEX_SCHEMA_VERSION = 1;

export interface IndexedFile {
  readonly relativePath: string;
  readonly category: FileCategory;
  readonly contentStatus: ContentStatus;
  readonly size: number | null;
  readonly mtimeMs: number | null;
  readonly contentHash: string | null;
  readonly analysis: FileAnalysis;
}

export interface RepositoryIndexSnapshot {
  readonly generation: number;
  readonly analysisVersion: string;
  readonly completedAt: string;
  readonly files: readonly IndexedFile[];
}

export interface NewIndexGeneration {
  readonly analysisVersion: string;
  readonly files: readonly IndexedFile[];
}

export interface GenerationActivationResult {
  readonly generation: number;
  readonly sqliteWriteMs: number;
  readonly cleanupWarning: string | null;
}

export interface IndexRepository {
  loadActive(): Promise<RepositoryIndexSnapshot | null>;
  buildAndActivate(
    analysisVersion: string,
    builder: (previous: RepositoryIndexSnapshot | null) => Promise<NewIndexGeneration>,
  ): Promise<GenerationActivationResult>;
  journalMode(): Promise<string>;
}

export type IndexRepositoryFactory = (rootRealPath: string) => IndexRepository;

export interface IndexSummary {
  readonly schemaVersion: "1.0";
  readonly repository: { readonly name: string; readonly root: "." };
  readonly generation: number;
  readonly files: {
    readonly indexed: number;
    readonly unsupported: number;
    readonly degraded: number;
    readonly failed: number;
    readonly reused: number;
    readonly parsed: number;
  };
  readonly symbols: number;
  readonly imports: number;
  readonly performance: {
    readonly totalMs: number;
    readonly grammarInitializationMs: number;
    readonly parsingMs: number;
    readonly sqliteWriteMs: number;
    readonly filesPerSecond: number;
  };
  readonly diagnostics: readonly string[];
}

export interface IndexedFileInspection {
  readonly schemaVersion: "1.0";
  readonly generation: number;
  readonly file: IndexedFile;
}
