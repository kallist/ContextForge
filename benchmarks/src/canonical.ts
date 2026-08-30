import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, posix, relative } from "node:path";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashDirectory(root: string, excludedTopLevel: ReadonlySet<string> = new Set()): Promise<string> {
  const records: { path: string; hash: string }[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (directory === root && excludedTopLevel.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new Error(`Benchmark corpus contains a symbolic link: ${entry.name}`);
      if (metadata.isDirectory()) await visit(absolute);
      else if (metadata.isFile()) {
        const normalized = posix.normalize(relative(root, absolute).replaceAll("\\", "/"));
        records.push({ path: normalized, hash: sha256(await readFile(absolute)) });
      }
    }
  };
  await visit(root);
  return sha256(canonicalJson(records));
}
