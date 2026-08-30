import { readFile } from "node:fs/promises";
import { isAbsolute, join, posix } from "node:path";

import { canonicalJson, hashDirectory, sha256 } from "./canonical.js";
import {
  BENCHMARK_VERSION,
  DATASET_VERSION,
  type BenchmarkDataset,
  type BenchmarkRepositoryDefinition,
  type BenchmarkTaskDefinition,
  type DatasetLock,
  type GoldFileDefinition,
} from "./types.js";

const IMPORTANCE = new Set(["REQUIRED", "SUPPORTING"]);
const DIFFICULTY = new Set(["EASY", "MEDIUM", "HARD"]);
const CATEGORY = new Set([
  "EXACT_SYMBOL", "BUG_FIX", "CROSS_FILE_BUG_FIX", "TEST_FAILURE", "CONCURRENCY", "CONFIGURATION",
  "API_INTEGRATION", "REFACTOR", "DOCUMENTATION_ARCHITECTURE", "AMBIGUOUS_NATURAL_LANGUAGE",
]);

function object(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Readonly<Record<string, unknown>>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function safeRelativePath(value: unknown, label: string): string {
  const path = text(value, label).replaceAll("\\", "/");
  const normalized = posix.normalize(path);
  if (isAbsolute(path) || /^[A-Za-z]:\//u.test(path) || normalized !== path || path === "." || path === ".." || path.startsWith("../")) {
    throw new Error(`${label} must be a canonical repository-relative path.`);
  }
  return path;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array.`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

function parseGoldFile(value: unknown, label: string): GoldFileDefinition {
  const item = object(value, label);
  const importance = text(item.importance, `${label}.importance`);
  if (!IMPORTANCE.has(importance)) throw new Error(`${label}.importance is invalid.`);
  return {
    path: safeRelativePath(item.path, `${label}.path`),
    importance: importance as GoldFileDefinition["importance"],
    rationale: text(item.rationale, `${label}.rationale`),
  };
}

function uniqueIdentities(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate identities.`);
}

function parseTask(value: unknown, index: number): BenchmarkTaskDefinition {
  const label = `tasks[${index}]`;
  const item = object(value, label);
  const difficulty = text(item.difficulty, `${label}.difficulty`);
  const taskCategory = text(item.taskCategory, `${label}.taskCategory`);
  if (!DIFFICULTY.has(difficulty)) throw new Error(`${label}.difficulty is invalid.`);
  if (!CATEGORY.has(taskCategory)) throw new Error(`${label}.taskCategory is invalid.`);
  if (!Array.isArray(item.goldFiles) || !Array.isArray(item.goldSymbols) || !Array.isArray(item.goldRanges)) {
    throw new Error(`${label} gold collections must be explicit arrays.`);
  }
  const goldFiles = item.goldFiles.map((gold, goldIndex) => parseGoldFile(gold, `${label}.goldFiles[${goldIndex}]`));
  const goldSymbols = item.goldSymbols.map((gold, goldIndex) => {
    const base = parseGoldFile(gold, `${label}.goldSymbols[${goldIndex}]`);
    return { ...base, qualifiedName: text(object(gold, "gold symbol").qualifiedName, `${label}.goldSymbols[${goldIndex}].qualifiedName`) };
  });
  const goldRanges = item.goldRanges.map((gold, goldIndex) => {
    const base = parseGoldFile(gold, `${label}.goldRanges[${goldIndex}]`);
    const record = object(gold, "gold range");
    const startLine = record.startLine;
    const endLine = record.endLine;
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || (startLine as number) < 1 || (endLine as number) < (startLine as number)) {
      throw new Error(`${label}.goldRanges[${goldIndex}] has an invalid one-based inclusive range.`);
    }
    return { ...base, startLine: startLine as number, endLine: endLine as number };
  });
  uniqueIdentities(goldFiles.map((gold) => `${gold.path}\0${gold.importance}`), `${label}.goldFiles`);
  uniqueIdentities(goldSymbols.map((gold) => `${gold.path}\0${gold.qualifiedName}\0${gold.importance}`), `${label}.goldSymbols`);
  uniqueIdentities(goldRanges.map((gold) => `${gold.path}\0${gold.startLine}\0${gold.endLine}\0${gold.importance}`), `${label}.goldRanges`);
  if (goldFiles.length === 0) throw new Error(`${label} must define at least one Gold file.`);
  return {
    taskId: text(item.taskId, `${label}.taskId`),
    repositoryId: text(item.repositoryId, `${label}.repositoryId`),
    repositoryRevision: text(item.repositoryRevision, `${label}.repositoryRevision`),
    taskText: text(item.taskText, `${label}.taskText`),
    taskCategory: taskCategory as BenchmarkTaskDefinition["taskCategory"],
    languageTags: stringArray(item.languageTags, `${label}.languageTags`),
    difficulty: difficulty as BenchmarkTaskDefinition["difficulty"],
    goldFiles,
    goldSymbols,
    goldRanges,
    notes: text(item.notes, `${label}.notes`),
  };
}

function parseRepository(value: unknown, index: number): BenchmarkRepositoryDefinition {
  const label = `repositories[${index}]`;
  const item = object(value, label);
  const kind = text(item.kind, `${label}.kind`);
  if (kind !== "PINNED_GIT" && kind !== "CURATED_FIXTURE") throw new Error(`${label}.kind is invalid.`);
  const relativePath = item.relativePath === undefined ? undefined : safeRelativePath(item.relativePath, `${label}.relativePath`);
  if ((kind === "CURATED_FIXTURE") !== (relativePath !== undefined)) throw new Error(`${label}.relativePath must be present only for curated fixtures.`);
  return {
    repositoryId: text(item.repositoryId, `${label}.repositoryId`),
    kind,
    repositoryRevision: text(item.repositoryRevision, `${label}.repositoryRevision`),
    ...(relativePath === undefined ? {} : { relativePath }),
  };
}

export function parseDataset(value: unknown): BenchmarkDataset {
  const root = object(value, "dataset");
  if (root.benchmarkVersion !== BENCHMARK_VERSION || root.datasetVersion !== DATASET_VERSION) throw new Error("Benchmark or dataset version is invalid.");
  if (!Array.isArray(root.repositories) || !Array.isArray(root.tasks)) throw new Error("Dataset repositories and tasks must be arrays.");
  const repositories = root.repositories.map(parseRepository);
  const tasks = root.tasks.map(parseTask);
  uniqueIdentities(repositories.map((item) => item.repositoryId), "repositories");
  uniqueIdentities(tasks.map((item) => item.taskId), "tasks");
  const byId = new Map(repositories.map((item) => [item.repositoryId, item]));
  for (const task of tasks) {
    const repository = byId.get(task.repositoryId);
    if (repository === undefined) throw new Error(`Task ${task.taskId} references an unknown repository.`);
    if (task.repositoryRevision !== repository.repositoryRevision) throw new Error(`Task ${task.taskId} repository revision does not match its corpus.`);
  }
  return { benchmarkVersion: BENCHMARK_VERSION, datasetVersion: DATASET_VERSION, repositories, tasks };
}

export async function loadDataset(workspaceRoot: string): Promise<BenchmarkDataset> {
  return parseDataset(JSON.parse(await readFile(join(workspaceRoot, "benchmarks", "dataset-v1.json"), "utf8")));
}

export async function loadDatasetLock(workspaceRoot: string): Promise<DatasetLock> {
  const value = object(JSON.parse(await readFile(join(workspaceRoot, "benchmarks", "dataset-v1.lock.json"), "utf8")), "dataset lock");
  if (
    value.benchmarkVersion !== BENCHMARK_VERSION || value.datasetVersion !== DATASET_VERSION ||
    value.goldReview !== "COMPLETED_BEFORE_FORMAL_RUN" || value.frozen !== true ||
    typeof value.datasetHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.datasetHash)
  ) throw new Error("Dataset lock is invalid or incomplete.");
  return value as unknown as DatasetLock;
}

export async function validateFixtureRevisions(dataset: BenchmarkDataset, workspaceRoot: string): Promise<void> {
  for (const repository of dataset.repositories) {
    if (repository.kind !== "CURATED_FIXTURE" || repository.relativePath === undefined) continue;
    const actual = `sha256:${await hashDirectory(join(workspaceRoot, ...repository.relativePath.split("/")))}`;
    if (actual !== repository.repositoryRevision) throw new Error(`Fixture revision mismatch for ${repository.repositoryId}: expected ${repository.repositoryRevision}, actual ${actual}.`);
  }
}

export function datasetHash(dataset: BenchmarkDataset): string {
  return sha256(canonicalJson(dataset));
}

export async function validateDatasetFreeze(dataset: BenchmarkDataset, workspaceRoot: string): Promise<DatasetLock> {
  await validateFixtureRevisions(dataset, workspaceRoot);
  const lock = await loadDatasetLock(workspaceRoot);
  const actual = datasetHash(dataset);
  if (lock.datasetHash !== actual) throw new Error(`Dataset freeze hash mismatch: expected ${lock.datasetHash}, actual ${actual}.`);
  return lock;
}
