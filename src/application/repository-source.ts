import type { RepositoryMapEntry } from "../core/repository-map.js";

export interface SourceFileSnapshot {
  readonly status: "read";
  readonly source: string;
  readonly contentHash: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface SourceFileUnavailable {
  readonly status: "unstable" | "unreadable";
  readonly diagnosticCode: "SOURCE_CHANGED_DURING_READ" | "SOURCE_UNREADABLE" | "SOURCE_NOT_UTF8";
}

export type SourceFileRead = SourceFileSnapshot | SourceFileUnavailable;

export interface RepositorySourceReader {
  readTextFile(rootRealPath: string, entry: RepositoryMapEntry): Promise<SourceFileRead>;
}
