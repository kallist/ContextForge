export const REPOSITORY_MAP_SCHEMA_VERSION = "1.0";

export const FILE_CATEGORIES = [
  "source",
  "test",
  "documentation",
  "configuration",
  "generated",
  "dependency",
  "binary_asset",
  "unknown",
] as const;

export type FileCategory = (typeof FILE_CATEGORIES)[number];
export type EntryType = "file" | "directory" | "symlink";
export type ContentStatus =
  | "not_applicable"
  | "text"
  | "binary"
  | "oversized"
  | "malformed"
  | "changed"
  | "unreadable";

export type SkipReason =
  | "symlink_directory"
  | "changed_during_scan"
  | "filesystem_error";

export type ExclusionReason =
  | "ignored_builtin"
  | "ignored_git"
  | "ignored_contextforge"
  | "sensitive"
  | "symlink_escape";

export interface RepositoryMapEntry {
  readonly path: string;
  readonly type: EntryType;
  readonly category: FileCategory;
  readonly language: string | null;
  readonly size: number | null;
  readonly content: ContentStatus;
  readonly skipReason?: SkipReason;
}

export interface RepositoryMapSummary {
  readonly entries: number;
  readonly files: number;
  readonly directories: number;
  readonly symlinks: number;
  readonly ignored: number;
  readonly safetyExcluded: number;
  readonly binary: number;
  readonly oversized: number;
  readonly malformedText: number;
  readonly changedDuringScan: number;
  readonly filesystemErrors: number;
  readonly byCategory: Record<FileCategory, number>;
  readonly byLanguage: Record<string, number>;
}

export interface ExclusionSummary {
  readonly reason: ExclusionReason;
  readonly count: number;
}

export interface RepositoryMap {
  readonly schemaVersion: typeof REPOSITORY_MAP_SCHEMA_VERSION;
  readonly tool: {
    readonly name: "contextforge";
    readonly version: string;
  };
  readonly repository: {
    readonly name: string;
    readonly root: ".";
    readonly kind: "git" | "directory";
  };
  readonly summary: RepositoryMapSummary;
  readonly entries: readonly RepositoryMapEntry[];
  readonly exclusions: readonly ExclusionSummary[];
}

export const EXCLUSION_REASONS: readonly ExclusionReason[] = [
  "ignored_builtin",
  "ignored_git",
  "ignored_contextforge",
  "sensitive",
  "symlink_escape",
];
