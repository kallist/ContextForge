import { basename } from "node:path";

import {
  EXCLUSION_REASONS,
  FILE_CATEGORIES,
  REPOSITORY_MAP_SCHEMA_VERSION,
  type ExclusionReason,
  type FileCategory,
  type RepositoryMap,
  type RepositoryMapEntry,
} from "../core/repository-map.js";
import { compareNormalizedPaths } from "../core/file-policies.js";

export interface ScanOptions {
  readonly maximumFileBytes?: number;
  readonly maximumEntries?: number;
  readonly maximumDepth?: number;
}

export interface ScanResult {
  readonly rootRealPath: string;
  readonly kind: "git" | "directory";
  readonly entries: readonly RepositoryMapEntry[];
  readonly exclusionCounts: ReadonlyMap<ExclusionReason, number>;
}

export interface RepositoryScanner {
  scan(inputPath: string, options?: ScanOptions): Promise<ScanResult>;
}

export interface MapRepositoryRequest extends ScanOptions {
  readonly repositoryPath: string;
}

function emptyCategoryCounts(): Record<FileCategory, number> {
  return Object.fromEntries(FILE_CATEGORIES.map((category) => [category, 0])) as Record<FileCategory, number>;
}

export async function mapRepository(
  scanner: RepositoryScanner,
  request: MapRepositoryRequest,
  version: string,
): Promise<RepositoryMap> {
  const scan = await scanner.scan(request.repositoryPath, request);
  const entries = [...scan.entries].sort((left, right) => compareNormalizedPaths(left.path, right.path));
  const byCategory = emptyCategoryCounts();
  const languageCounts = new Map<string, number>();

  let files = 0;
  let directories = 0;
  let symlinks = 0;
  let binary = 0;
  let oversized = 0;
  let malformedText = 0;
  let changedDuringScan = 0;
  let filesystemErrors = 0;

  for (const entry of entries) {
    byCategory[entry.category] += 1;
    if (entry.type === "file") files += 1;
    if (entry.type === "directory") directories += 1;
    if (entry.type === "symlink") symlinks += 1;
    if (entry.content === "binary") binary += 1;
    if (entry.content === "oversized") oversized += 1;
    if (entry.content === "malformed") malformedText += 1;
    if (entry.content === "changed") changedDuringScan += 1;
    if (entry.content === "unreadable") filesystemErrors += 1;
    if (entry.language !== null) languageCounts.set(entry.language, (languageCounts.get(entry.language) ?? 0) + 1);
  }

  const byLanguage = Object.fromEntries(
    [...languageCounts].sort(([left], [right]) => compareNormalizedPaths(left, right)),
  );
  const exclusions = EXCLUSION_REASONS.map((reason) => ({
    reason,
    count: scan.exclusionCounts.get(reason) ?? 0,
  })).filter(({ count }) => count > 0);
  const ignored = exclusions
    .filter(({ reason }) => reason.startsWith("ignored_"))
    .reduce((total, { count }) => total + count, 0);
  const safetyExcluded = exclusions
    .filter(({ reason }) => reason === "sensitive" || reason === "symlink_escape")
    .reduce((total, { count }) => total + count, 0);

  return {
    schemaVersion: REPOSITORY_MAP_SCHEMA_VERSION,
    tool: { name: "contextforge", version },
    repository: { name: basename(scan.rootRealPath), root: ".", kind: scan.kind },
    summary: {
      entries: entries.length,
      files,
      directories,
      symlinks,
      ignored,
      safetyExcluded,
      binary,
      oversized,
      malformedText,
      changedDuringScan,
      filesystemErrors,
      byCategory,
      byLanguage,
    },
    entries,
    exclusions,
  };
}
