import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import type { RepositoryScanner, ScanOptions, ScanResult } from "../../application/map-repository.js";
import { ContextForgeError } from "../../core/errors.js";
import {
  classifyFile,
  compareNormalizedPaths,
  detectLanguage,
  isBuiltInIgnored,
  isKnownBinaryPath,
  isOversized,
  isSensitivePath,
  looksBinary,
} from "../../core/file-policies.js";
import { createIgnoreLayer, isIgnoredByLayers, type IgnoreLayer } from "../../core/ignore-rules.js";
import { isWithinRoot, normalizeRelativePath } from "../../core/path-safety.js";
import type { ExclusionReason, RepositoryMapEntry } from "../../core/repository-map.js";

const DEFAULT_MAXIMUM_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAXIMUM_ENTRIES = 100_000;
const DEFAULT_MAXIMUM_DEPTH = 64;
const MAXIMUM_IGNORE_FILE_BYTES = 256 * 1024;

interface MutableScanState {
  readonly rootRealPath: string;
  readonly entries: RepositoryMapEntry[];
  readonly exclusionCounts: Map<ExclusionReason, number>;
  readonly gitIgnoreLayers: IgnoreLayer[];
  readonly contextIgnoreLayers: IgnoreLayer[];
  readonly visitedDirectories: Set<string>;
  readonly maximumFileBytes: number;
  readonly maximumEntries: number;
  readonly maximumDepth: number;
  seenEntries: number;
}

interface BoundedReadResult {
  readonly bytes: Uint8Array;
  readonly overflow: boolean;
  readonly changed: boolean;
}

function incrementExclusion(state: MutableScanState, reason: ExclusionReason): void {
  state.exclusionCounts.set(reason, (state.exclusionCounts.get(reason) ?? 0) + 1);
}

function asSafeRootError(error: unknown, inputPath: string): ContextForgeError {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "ENOENT") return new ContextForgeError("PATH", `Repository path does not exist: ${inputPath}`);
  if (code === "EACCES" || code === "EPERM") {
    return new ContextForgeError("ACCESS", `Repository path is not accessible: ${inputPath}`);
  }
  return new ContextForgeError("PATH", `Cannot inspect repository path: ${inputPath}`, { cause: error });
}

async function isGitRoot(path: string): Promise<boolean> {
  try {
    await lstat(join(path, ".git"));
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function discoverRoot(inputPath: string): Promise<{ rootRealPath: string; kind: "git" | "directory" }> {
  const absoluteInput = resolve(inputPath);
  let inputMetadata;
  try {
    inputMetadata = await stat(absoluteInput);
  } catch (error) {
    throw asSafeRootError(error, inputPath);
  }
  if (!inputMetadata.isDirectory()) {
    throw new ContextForgeError("PATH", `Repository path is not a directory: ${inputPath}`);
  }

  let inputRealPath: string;
  try {
    inputRealPath = await realpath(absoluteInput);
  } catch (error) {
    throw asSafeRootError(error, inputPath);
  }

  let current = inputRealPath;
  while (true) {
    try {
      if (await isGitRoot(current)) {
        if (dirname(current) === current) {
          throw new ContextForgeError("UNSAFE_ROOT", "Refusing to scan an entire filesystem volume as a repository.");
        }
        return { rootRealPath: current, kind: "git" };
      }
    } catch (error) {
      throw asSafeRootError(error, inputPath);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  if (dirname(inputRealPath) === inputRealPath) {
    throw new ContextForgeError("UNSAFE_ROOT", "Refusing to scan an entire filesystem volume as a repository.");
  }
  return { rootRealPath: inputRealPath, kind: "directory" };
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

async function boundedRead(path: string, maximumBytes: number, expectedMetadata?: Stats): Promise<BoundedReadResult> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    const before = await handle.stat();
    if (expectedMetadata !== undefined && !sameFileIdentity(before, expectedMetadata)) {
      return { bytes: new Uint8Array(), overflow: false, changed: true };
    }
    const buffer = Buffer.alloc(Math.min(maximumBytes + 1, Number.MAX_SAFE_INTEGER));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    const changed =
      before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || before.dev !== after.dev;
    return { bytes: buffer.subarray(0, Math.min(offset, maximumBytes)), overflow: offset > maximumBytes, changed };
  } finally {
    await handle.close();
  }
}

async function loadIgnoreLayer(
  state: MutableScanState,
  directoryPath: string,
  relativeDirectory: string,
  fileName: ".gitignore" | ".contextforgeignore",
): Promise<void> {
  const absolutePath = join(directoryPath, fileName);
  try {
    const policyRealPath = await realpath(absolutePath);
    if (!isWithinRoot(state.rootRealPath, policyRealPath)) return;
    const policyRelativePath = normalizeRelativePath(relative(state.rootRealPath, policyRealPath));
    if (isSensitivePath(policyRelativePath)) return;
    const metadata = await stat(policyRealPath);
    if (!metadata.isFile() || metadata.size > MAXIMUM_IGNORE_FILE_BYTES) return;
    const confirmedRealPath = await realpath(absolutePath);
    if (confirmedRealPath !== policyRealPath || !isWithinRoot(state.rootRealPath, confirmedRealPath)) return;
    const read = await boundedRead(confirmedRealPath, MAXIMUM_IGNORE_FILE_BYTES, metadata);
    if (read.overflow || read.changed || looksBinary(read.bytes)) return;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes);
    } catch {
      return;
    }
    const layer = createIgnoreLayer(relativeDirectory, text);
    if (fileName === ".gitignore") state.gitIgnoreLayers.push(layer);
    else state.contextIgnoreLayers.push(layer);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
    // A local policy file failure cannot weaken built-in and sensitive deny rules.
  }
}

function ignoredReason(state: MutableScanState, path: string, directory: boolean): ExclusionReason | null {
  if (isBuiltInIgnored(path)) return "ignored_builtin";
  // The two files are an additive union. Negation can only undo a rule from its own file family.
  if (isIgnoredByLayers(state.contextIgnoreLayers, path, directory)) return "ignored_contextforge";
  if (isIgnoredByLayers(state.gitIgnoreLayers, path, directory)) return "ignored_git";
  return null;
}

function unreadableEntry(path: string, type: "file" | "symlink", size: number | null): RepositoryMapEntry {
  return {
    path,
    type,
    category: classifyFile(path),
    language: detectLanguage(path),
    size,
    content: "unreadable",
    skipReason: "filesystem_error",
  };
}

function markDirectoryUnreadable(state: MutableScanState, path: string): void {
  const index = state.entries.findIndex((entry) => entry.path === path && entry.type === "directory");
  const entry: RepositoryMapEntry = {
    path,
    type: "directory",
    category: "unknown",
    language: null,
    size: null,
    content: "unreadable",
    skipReason: "filesystem_error",
  };
  if (index === -1) state.entries.push(entry);
  else state.entries[index] = entry;
}

async function inspectFile(
  state: MutableScanState,
  lexicalPath: string,
  resolvedPath: string,
  relativePath: string,
  type: "file" | "symlink",
  initialMetadata: Stats,
): Promise<RepositoryMapEntry | null> {
  const category = classifyFile(relativePath);
  const language = detectLanguage(relativePath);
  if (isOversized(initialMetadata.size, state.maximumFileBytes)) {
    return { path: relativePath, type, category, language, size: initialMetadata.size, content: "oversized" };
  }
  if (isKnownBinaryPath(relativePath)) {
    return { path: relativePath, type, category, language, size: initialMetadata.size, content: "binary" };
  }

  try {
    const confirmedRealPath = await realpath(lexicalPath);
    if (confirmedRealPath !== resolvedPath || !isWithinRoot(state.rootRealPath, confirmedRealPath)) {
      incrementExclusion(state, "symlink_escape");
      return null;
    }
    const resolvedRelative = normalizeRelativePath(relative(state.rootRealPath, confirmedRealPath));
    if (isSensitivePath(resolvedRelative)) {
      incrementExclusion(state, "sensitive");
      return null;
    }
    const read = await boundedRead(confirmedRealPath, state.maximumFileBytes, initialMetadata);
    if (read.overflow) {
      return { path: relativePath, type, category, language, size: initialMetadata.size, content: "oversized" };
    }
    if (read.changed) {
      return {
        path: relativePath,
        type,
        category,
        language,
        size: initialMetadata.size,
        content: "changed",
        skipReason: "changed_during_scan",
      };
    }
    if (looksBinary(read.bytes)) {
      return {
        path: relativePath,
        type,
        category: "binary_asset",
        language: null,
        size: initialMetadata.size,
        content: "binary",
      };
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(read.bytes);
      return { path: relativePath, type, category, language, size: initialMetadata.size, content: "text" };
    } catch {
      return { path: relativePath, type, category, language, size: initialMetadata.size, content: "malformed" };
    }
  } catch {
    return unreadableEntry(relativePath, type, initialMetadata.size);
  }
}

async function walkDirectory(
  state: MutableScanState,
  absoluteDirectory: string,
  relativeDirectory: string,
  depth: number,
): Promise<void> {
  if (depth > state.maximumDepth) {
    throw new ContextForgeError("SCAN_LIMIT", `Repository traversal exceeded maximum depth (${state.maximumDepth}).`);
  }

  let directoryRealPath: string;
  try {
    directoryRealPath = await realpath(absoluteDirectory);
  } catch {
    if (relativeDirectory !== "") markDirectoryUnreadable(state, relativeDirectory);
    return;
  }
  if (!isWithinRoot(state.rootRealPath, directoryRealPath)) {
    incrementExclusion(state, "symlink_escape");
    return;
  }
  const canonicalKey = process.platform === "win32" ? directoryRealPath.toLowerCase() : directoryRealPath;
  if (state.visitedDirectories.has(canonicalKey)) return;
  state.visitedDirectories.add(canonicalKey);

  await loadIgnoreLayer(state, absoluteDirectory, relativeDirectory, ".gitignore");
  await loadIgnoreLayer(state, absoluteDirectory, relativeDirectory, ".contextforgeignore");

  let names: string[];
  try {
    names = await readdir(absoluteDirectory);
  } catch {
    if (relativeDirectory === "") {
      throw new ContextForgeError("ACCESS", "Repository root cannot be read.");
    }
    markDirectoryUnreadable(state, relativeDirectory);
    return;
  }
  names.sort(compareNormalizedPaths);

  for (const name of names) {
    state.seenEntries += 1;
    if (state.seenEntries > state.maximumEntries) {
      throw new ContextForgeError("SCAN_LIMIT", `Repository traversal exceeded maximum entries (${state.maximumEntries}).`);
    }
    const relativePath = relativeDirectory === "" ? name : `${relativeDirectory}/${name}`;
    const absolutePath = join(absoluteDirectory, name);
    if (isSensitivePath(relativePath)) {
      incrementExclusion(state, "sensitive");
      continue;
    }

    let metadata;
    try {
      metadata = await lstat(absolutePath);
    } catch {
      state.entries.push(unreadableEntry(relativePath, "file", null));
      continue;
    }
    const directory = metadata.isDirectory();
    const exclusion = ignoredReason(state, relativePath, directory);
    if (exclusion !== null) {
      incrementExclusion(state, exclusion);
      continue;
    }

    if (metadata.isSymbolicLink()) {
      let resolvedPath: string;
      try {
        resolvedPath = await realpath(absolutePath);
      } catch {
        state.entries.push(unreadableEntry(relativePath, "symlink", null));
        continue;
      }
      if (!isWithinRoot(state.rootRealPath, resolvedPath)) {
        incrementExclusion(state, "symlink_escape");
        continue;
      }
      const resolvedRelativePath = normalizeRelativePath(relative(state.rootRealPath, resolvedPath));
      if (isSensitivePath(resolvedRelativePath)) {
        incrementExclusion(state, "sensitive");
        continue;
      }
      let targetMetadata;
      try {
        targetMetadata = await stat(resolvedPath);
      } catch {
        state.entries.push(unreadableEntry(relativePath, "symlink", null));
        continue;
      }
      if (targetMetadata.isDirectory()) {
        state.entries.push({
          path: relativePath,
          type: "symlink",
          category: "unknown",
          language: null,
          size: null,
          content: "not_applicable",
          skipReason: "symlink_directory",
        });
      } else if (targetMetadata.isFile()) {
        const entry = await inspectFile(state, absolutePath, resolvedPath, relativePath, "symlink", targetMetadata);
        if (entry !== null) state.entries.push(entry);
      } else {
        state.entries.push(unreadableEntry(relativePath, "symlink", null));
      }
      continue;
    }

    if (metadata.isDirectory()) {
      state.entries.push({
        path: relativePath,
        type: "directory",
        category: "unknown",
        language: null,
        size: null,
        content: "not_applicable",
      });
      await walkDirectory(state, absolutePath, relativePath, depth + 1);
      continue;
    }
    if (metadata.isFile()) {
      let resolvedPath: string;
      try {
        resolvedPath = await realpath(absolutePath);
      } catch {
        state.entries.push(unreadableEntry(relativePath, "file", metadata.size));
        continue;
      }
      if (!isWithinRoot(state.rootRealPath, resolvedPath)) {
        incrementExclusion(state, "symlink_escape");
        continue;
      }
      const entry = await inspectFile(state, absolutePath, resolvedPath, relativePath, "file", metadata);
      if (entry !== null) state.entries.push(entry);
    }
  }
}

export class FileSystemRepositoryScanner implements RepositoryScanner {
  async scan(inputPath: string, options: ScanOptions = {}): Promise<ScanResult> {
    const discovered = await discoverRoot(inputPath);
    const state: MutableScanState = {
      rootRealPath: discovered.rootRealPath,
      entries: [],
      exclusionCounts: new Map(),
      gitIgnoreLayers: [],
      contextIgnoreLayers: [],
      visitedDirectories: new Set(),
      maximumFileBytes: options.maximumFileBytes ?? DEFAULT_MAXIMUM_FILE_BYTES,
      maximumEntries: options.maximumEntries ?? DEFAULT_MAXIMUM_ENTRIES,
      maximumDepth: options.maximumDepth ?? DEFAULT_MAXIMUM_DEPTH,
      seenEntries: 0,
    };
    if (state.maximumFileBytes < 1 || state.maximumEntries < 1 || state.maximumDepth < 1) {
      throw new ContextForgeError("USAGE", "Scan limits must be positive integers.");
    }
    await walkDirectory(state, discovered.rootRealPath, "", 0);
    return {
      rootRealPath: discovered.rootRealPath,
      kind: discovered.kind,
      entries: state.entries,
      exclusionCounts: state.exclusionCounts,
    };
  }
}
