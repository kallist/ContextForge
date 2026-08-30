import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { promisify } from "node:util";

import { hashDirectory } from "./canonical.js";
import type { BenchmarkRepositoryDefinition } from "./types.js";

const execFileAsync = promisify(execFile);

function safeGitPath(value: string): string {
  const normalized = posix.normalize(value.replaceAll("\\", "/"));
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    throw new Error("Pinned Git snapshot contains an unsafe path.");
  }
  return value;
}

async function copyFixture(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Curated corpus contains a symbolic link: ${entry.name}`);
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) await copyFixture(sourcePath, destinationPath);
    else if (entry.isFile()) await writeFile(destinationPath, await readFile(sourcePath));
  }
}

async function materializeGitRevision(workspaceRoot: string, revision: string, destination: string): Promise<void> {
  await execFileAsync("git", ["cat-file", "-e", `${revision}^{commit}`], { cwd: workspaceRoot, windowsHide: true, timeout: 10_000 });
  const listing = await execFileAsync("git", ["ls-tree", "-r", "-z", "--name-only", revision], {
    cwd: workspaceRoot,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    timeout: 30_000,
  });
  const paths = listing.stdout.toString("utf8").split("\0").filter((item) => item.length > 0).map(safeGitPath).sort();
  for (const path of paths) {
    const target = join(destination, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    const blob = await execFileAsync("git", ["show", `${revision}:${path}`], {
      cwd: workspaceRoot,
      encoding: "buffer",
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      timeout: 30_000,
    });
    await writeFile(target, blob.stdout);
  }
}

export interface MaterializedRepository {
  readonly root: string;
  readonly sourceHash: string;
}

export async function createBenchmarkTemporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "contextforge-benchmark-"));
}

export async function materializeRepository(
  definition: BenchmarkRepositoryDefinition,
  workspaceRoot: string,
  temporaryRoot: string,
): Promise<MaterializedRepository> {
  const root = join(temporaryRoot, definition.repositoryId);
  await mkdir(root, { recursive: true });
  if (definition.kind === "PINNED_GIT") await materializeGitRevision(workspaceRoot, definition.repositoryRevision, root);
  else {
    if (definition.relativePath === undefined) throw new Error("Curated fixture path is missing.");
    await copyFixture(join(workspaceRoot, ...definition.relativePath.split("/")), root);
  }
  return { root, sourceHash: await hashDirectory(root, new Set([".contextforge"])) };
}

export async function assertCorpusUnchanged(materialized: MaterializedRepository): Promise<void> {
  const after = await hashDirectory(materialized.root, new Set([".contextforge"]));
  if (after !== materialized.sourceHash) throw new Error("BENCHMARK_SOURCE_MUTATED");
}

export async function removeBenchmarkTemporaryRoot(root: string): Promise<void> {
  await rm(root, { force: true, recursive: true });
}
