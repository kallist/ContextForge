import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { join, posix, relative, resolve } from "node:path";

import type { RepositorySourceReader, SourceFileRead } from "../../application/repository-source.js";
import { isSensitivePath, looksBinary } from "../../core/file-policies.js";
import { isWithinRoot, normalizeRelativePath } from "../../core/path-safety.js";
import type { RepositoryMapEntry } from "../../core/repository-map.js";

const DEFAULT_MAXIMUM_FILE_BYTES = 1024 * 1024;

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

async function readOnce(rootRealPath: string, entry: RepositoryMapEntry, maximumBytes: number): Promise<SourceFileRead> {
  const normalized = posix.normalize(normalizeRelativePath(entry.path));
  if (
    normalized !== entry.path ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized)
  ) {
    return { status: "unreadable", diagnosticCode: "SOURCE_UNREADABLE" };
  }
  const lexicalPath = resolve(join(rootRealPath, ...entry.path.split("/")));
  if (!isWithinRoot(rootRealPath, lexicalPath) || isSensitivePath(entry.path)) {
    return { status: "unreadable", diagnosticCode: "SOURCE_UNREADABLE" };
  }

  try {
    const resolvedPath = await realpath(lexicalPath);
    if (!isWithinRoot(rootRealPath, resolvedPath)) return { status: "unreadable", diagnosticCode: "SOURCE_UNREADABLE" };
    const resolvedRelative = normalizeRelativePath(relative(rootRealPath, resolvedPath));
    if (isSensitivePath(resolvedRelative)) return { status: "unreadable", diagnosticCode: "SOURCE_UNREADABLE" };

    const handle = await open(resolvedPath, constants.O_RDONLY);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > maximumBytes) {
        return { status: "unreadable", diagnosticCode: "SOURCE_UNREADABLE" };
      }
      if (entry.size !== null && before.size !== entry.size) {
        return { status: "unstable", diagnosticCode: "SOURCE_CHANGED_DURING_READ" };
      }
      const buffer = Buffer.alloc(Math.min(maximumBytes + 1, Number.MAX_SAFE_INTEGER));
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (offset > maximumBytes || !sameIdentity(before, after)) {
        return { status: "unstable", diagnosticCode: "SOURCE_CHANGED_DURING_READ" };
      }
      const bytes = buffer.subarray(0, offset);
      if (looksBinary(bytes)) return { status: "unreadable", diagnosticCode: "SOURCE_UNREADABLE" };
      let source: string;
      try {
        source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return { status: "unreadable", diagnosticCode: "SOURCE_NOT_UTF8" };
      }
      return {
        status: "read",
        source,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        size: before.size,
        mtimeMs: before.mtimeMs,
      };
    } finally {
      await handle.close();
    }
  } catch {
    return { status: "unreadable", diagnosticCode: "SOURCE_UNREADABLE" };
  }
}

export class FileSystemRepositorySourceReader implements RepositorySourceReader {
  readonly #maximumBytes: number;

  constructor(maximumBytes = DEFAULT_MAXIMUM_FILE_BYTES) {
    this.#maximumBytes = maximumBytes;
  }

  async readTextFile(rootRealPath: string, entry: RepositoryMapEntry): Promise<SourceFileRead> {
    const first = await readOnce(rootRealPath, entry, this.#maximumBytes);
    if (first.status !== "unstable") return first;
    return readOnce(rootRealPath, entry, this.#maximumBytes);
  }
}
