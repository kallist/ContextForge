import type { RepositoryScanner } from "./map-repository.js";
import { ContextForgeError } from "../core/errors.js";
import { posix } from "node:path";
import type { IndexedFileInspection, IndexRepositoryFactory } from "../core/repository-index.js";

export async function inspectIndex(
  scanner: RepositoryScanner,
  repositoryFactory: IndexRepositoryFactory,
  repositoryPath: string,
  relativePath: string,
): Promise<IndexedFileInspection> {
  const slashPath = relativePath.replaceAll("\\", "/");
  const normalized = posix.normalize(slashPath);
  if (
    slashPath.length === 0 ||
    normalized !== slashPath ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized)
  ) {
    throw new ContextForgeError("PATH", "Inspect path must be a normalized repository-relative path.");
  }
  const scan = await scanner.scan(repositoryPath);
  const repository = repositoryFactory(scan.rootRealPath);
  const active = await repository.loadActive();
  if (active === null) throw new ContextForgeError("INDEX_NOT_FOUND", "No active ContextForge index exists for this repository.");
  const file = active.files.find((candidate) => candidate.relativePath === normalized) ?? null;
  if (file === null) throw new ContextForgeError("INDEX_NOT_FOUND", `The active index does not contain: ${normalized}`);
  return { schemaVersion: "1.0", generation: active.generation, file };
}
