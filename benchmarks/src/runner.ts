import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildIndex } from "../../src/application/build-index.js";
import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { PACKING_STRATEGY } from "../../src/core/context-pack.js";
import { RANKING_STRATEGY } from "../../src/core/task-retrieval.js";
import { GENERIC_TOKEN_ESTIMATOR_ID, GENERIC_TOKEN_ESTIMATOR_VERSION } from "../../src/core/token-estimation.js";
import { datasetHash, loadDataset, validateDatasetFreeze, validateFixtureRevisions } from "./dataset.js";
import { hashDirectory } from "./canonical.js";
import { evaluateSelection, validateGoldAgainstRepository } from "./metrics.js";
import {
  assertCorpusUnchanged,
  createBenchmarkTemporaryRoot,
  materializeRepository,
  removeBenchmarkTemporaryRoot,
} from "./materialize.js";
import { createRepositoryRuntime, runBenchmarkSystem, type BenchmarkRepositoryRuntime } from "./systems.js";
import {
  BENCHMARK_VERSION,
  DATASET_VERSION,
  QUALITY_BUDGETS,
  SYSTEM_IDS,
  type BenchmarkDataset,
  type BenchmarkRepositoryDefinition,
  type PerformanceSample,
  type QualityCaseResult,
  type QualityRun,
} from "./types.js";

const execFileAsync = promisify(execFile);

interface PreparedRepository {
  readonly definition: BenchmarkRepositoryDefinition;
  readonly runtime: BenchmarkRepositoryRuntime;
  readonly materialized: Awaited<ReturnType<typeof materializeRepository>>;
  readonly indexMs: number;
}

async function gitHead(workspaceRoot: string): Promise<string> {
  const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return result.stdout.trim();
}

async function prepareRepository(
  definition: BenchmarkRepositoryDefinition,
  workspaceRoot: string,
  temporaryRoot: string,
): Promise<PreparedRepository> {
  const materialized = await materializeRepository(definition, workspaceRoot, temporaryRoot);
  const scanner = new FileSystemRepositoryScanner();
  const sourceReader = new FileSystemRepositorySourceReader();
  const summary = await buildIndex(
    scanner,
    sourceReader,
    new TreeSitterLanguageAnalyzer(),
    (rootRealPath) => new SqliteIndexRepository(rootRealPath),
    { repositoryPath: materialized.root },
  );
  return {
    definition,
    runtime: await createRepositoryRuntime(materialized.root),
    materialized,
    indexMs: summary.performance.totalMs,
  };
}

async function prepareAll(dataset: BenchmarkDataset, workspaceRoot: string, temporaryRoot: string): Promise<PreparedRepository[]> {
  const prepared: PreparedRepository[] = [];
  for (const definition of dataset.repositories) prepared.push(await prepareRepository(definition, workspaceRoot, temporaryRoot));
  return prepared;
}

export async function validateFormalDataset(workspaceRoot: string): Promise<{ dataset: BenchmarkDataset; hash: string }> {
  const dataset = await loadDataset(workspaceRoot);
  const lock = await validateDatasetFreeze(dataset, workspaceRoot);
  const temporaryRoot = await createBenchmarkTemporaryRoot();
  try {
    const prepared = await prepareAll(dataset, workspaceRoot, temporaryRoot);
    for (const repository of prepared) {
      const tasks = dataset.tasks.filter((task) => task.repositoryId === repository.definition.repositoryId);
      await validateGoldAgainstRepository(repository.runtime, tasks);
      await assertCorpusUnchanged(repository.materialized);
    }
  } finally {
    await removeBenchmarkTemporaryRoot(temporaryRoot);
  }
  return { dataset, hash: lock.datasetHash };
}

export async function validateDraftDataset(workspaceRoot: string): Promise<{ dataset: BenchmarkDataset; hash: string }> {
  const dataset = await loadDataset(workspaceRoot);
  await validateFixtureRevisions(dataset, workspaceRoot);
  const temporaryRoot = await createBenchmarkTemporaryRoot();
  try {
    const prepared = await prepareAll(dataset, workspaceRoot, temporaryRoot);
    for (const repository of prepared) {
      await validateGoldAgainstRepository(
        repository.runtime,
        dataset.tasks.filter((task) => task.repositoryId === repository.definition.repositoryId),
      );
      await assertCorpusUnchanged(repository.materialized);
    }
  } finally {
    await removeBenchmarkTemporaryRoot(temporaryRoot);
  }
  return { dataset, hash: datasetHash(dataset) };
}

export async function runQualityBenchmark(workspaceRoot: string, mode: "SMOKE" | "FULL"): Promise<QualityRun> {
  const dataset = await loadDataset(workspaceRoot);
  const lock = await validateDatasetFreeze(dataset, workspaceRoot);
  const temporaryRoot = await createBenchmarkTemporaryRoot();
  try {
    const prepared = await prepareAll(dataset, workspaceRoot, temporaryRoot);
    const results: QualityCaseResult[] = [];
    for (const repository of prepared) {
      const allTasks = dataset.tasks.filter((task) => task.repositoryId === repository.definition.repositoryId);
      await validateGoldAgainstRepository(repository.runtime, allTasks);
      const tasks = mode === "SMOKE" ? allTasks.slice(0, 1) : allTasks;
      const budgets: readonly number[] = mode === "SMOKE" ? [4_000] : QUALITY_BUDGETS;
      for (const task of tasks) {
        for (const systemId of SYSTEM_IDS) {
          for (const budget of budgets) {
            const selection = await runBenchmarkSystem(systemId, repository.runtime, task.taskText, budget);
            if (selection.payloadTokens > budget) throw new Error(`BENCHMARK_BUDGET_VIOLATION: ${task.taskId}/${systemId}/${budget}`);
            results.push(await evaluateSelection(repository.runtime, task, lock.datasetHash, selection));
          }
        }
      }
      await assertCorpusUnchanged(repository.materialized);
    }
    return {
      manifest: {
        benchmarkVersion: BENCHMARK_VERSION,
        datasetVersion: DATASET_VERSION,
        datasetHash: lock.datasetHash,
        contextforgeCommit: await gitHead(workspaceRoot),
        rankingStrategy: RANKING_STRATEGY,
        packingStrategy: PACKING_STRATEGY,
        tokenEstimator: GENERIC_TOKEN_ESTIMATOR_ID,
        tokenEstimatorVersion: GENERIC_TOKEN_ESTIMATOR_VERSION,
        baselineVersions: ["lexical-full-file-v1", "structural-full-file-v1"],
        budgets: [...budgetsForMode(mode)],
        systems: [...SYSTEM_IDS],
        taskCount: mode === "SMOKE" ? dataset.repositories.length : dataset.tasks.length,
        repositoryCount: dataset.repositories.length,
        runMode: mode,
      },
      cases: results,
    };
  } finally {
    await removeBenchmarkTemporaryRoot(temporaryRoot);
  }
}

function budgetsForMode(mode: "SMOKE" | "FULL"): readonly number[] {
  return mode === "SMOKE" ? [4_000] : QUALITY_BUDGETS;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const value = ordered[middle];
  if (value === undefined) return 0;
  if (ordered.length % 2 === 1) return value;
  return ((ordered[middle - 1] ?? value) + value) / 2;
}

export async function runPerformanceBenchmark(workspaceRoot: string): Promise<unknown> {
  const dataset = await loadDataset(workspaceRoot);
  await validateDatasetFreeze(dataset, workspaceRoot);
  const pinned = dataset.repositories.find((item) => item.kind === "PINNED_GIT");
  if (pinned === undefined) throw new Error("Pinned ContextForge performance corpus is missing.");
  const task = dataset.tasks.find((item) => item.repositoryId === pinned.repositoryId);
  if (task === undefined) throw new Error("Pinned ContextForge performance task is missing.");
  const temporaryRoot = await createBenchmarkTemporaryRoot();
  const samples: PerformanceSample[] = [];
  try {
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      const prepared = await prepareRepository({ ...pinned, repositoryId: `${pinned.repositoryId}-perf-${repetition}` }, workspaceRoot, temporaryRoot);
      for (const systemId of SYSTEM_IDS) {
        const selection = await runBenchmarkSystem(systemId, prepared.runtime, task.taskText, 8_000);
        samples.push({
          repositoryId: pinned.repositoryId,
          taskId: task.taskId,
          budget: 8_000,
          systemId,
          repetition,
          indexMs: prepared.indexMs,
          retrievalMs: selection.performance.retrievalMs,
          packingMs: selection.performance.packingMs,
          totalMs: selection.performance.totalMs,
        });
      }
      await assertCorpusUnchanged(prepared.materialized);
    }
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      const root = join(temporaryRoot, `medium-synthetic-${repetition}`);
      await createMediumSyntheticRepository(root);
      const materialized = { root, sourceHash: await hashDirectory(root, new Set([".contextforge"])) };
      const scanner = new FileSystemRepositoryScanner();
      const sourceReader = new FileSystemRepositorySourceReader();
      const summary = await buildIndex(
        scanner,
        sourceReader,
        new TreeSitterLanguageAnalyzer(),
        (rootRealPath) => new SqliteIndexRepository(rootRealPath),
        { repositoryPath: root },
      );
      const runtime = await createRepositoryRuntime(root);
      for (const systemId of SYSTEM_IDS) {
        const selection = await runBenchmarkSystem(systemId, runtime, "repair Service420.runService420 dependency behavior", 8_000);
        samples.push({
          repositoryId: "medium-synthetic-1000",
          taskId: "medium-synthetic-service-420",
          budget: 8_000,
          systemId,
          repetition,
          indexMs: summary.performance.totalMs,
          retrievalMs: selection.performance.retrievalMs,
          packingMs: selection.performance.packingMs,
          totalMs: selection.performance.totalMs,
        });
      }
      await assertCorpusUnchanged(materialized);
    }
  } finally {
    await removeBenchmarkTemporaryRoot(temporaryRoot);
  }
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    datasetVersion: DATASET_VERSION,
    datasetHash: datasetHash(dataset),
    environment: { os: platform(), osRelease: release(), architecture: arch(), node: process.version },
    repetitions: 3,
    note: "Environment-specific medians; not an SLA.",
    medians: [pinned.repositoryId, "medium-synthetic-1000"].flatMap((repositoryId) => SYSTEM_IDS.map((systemId) => {
      const selected = samples.filter((sample) => sample.repositoryId === repositoryId && sample.systemId === systemId);
      return {
        repositoryId,
        systemId,
        indexMs: median(selected.flatMap((sample) => sample.indexMs === null ? [] : [sample.indexMs])),
        retrievalMs: median(selected.map((sample) => sample.retrievalMs)),
        packingMs: median(selected.map((sample) => sample.packingMs)),
        totalMs: median(selected.map((sample) => sample.totalMs)),
      };
    })),
    samples,
  };
}

async function createMediumSyntheticRepository(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "AGENTS.md"), "# Synthetic instructions\n\nKeep service dependencies deterministic.\n", "utf8");
  for (let index = 0; index < 899; index += 1) {
    const padded = index.toString().padStart(4, "0");
    const previous = Math.max(0, index - 1).toString().padStart(4, "0");
    const source = [
      ...(index === 0 ? [] : [`import { Service${index - 1} } from "./service-${previous}.js";`]),
      `export class Service${index} {`,
      `  runService${index}(): number { return ${index === 0 ? "0" : `new Service${index - 1}().runService${index - 1}() + 1`}; }`,
      "}",
      "",
    ].join("\n");
    const directory = join(root, "src", "services");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `service-${padded}.ts`), source, "utf8");
  }
  for (let index = 0; index < 100; index += 1) {
    const service = (index * 8).toString().padStart(4, "0");
    const directory = join(root, "tests");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, `service-${service}.test.ts`),
      `import { Service${index * 8} } from "../src/services/service-${service}.js";\nexport const expected${index} = new Service${index * 8}().runService${index * 8}();\n`,
      "utf8",
    );
  }
}

export async function writeJsonOutput(workspaceRoot: string, name: string, value: unknown): Promise<string> {
  const outputRoot = join(workspaceRoot, ".benchmark-output");
  await mkdir(outputRoot, { recursive: true });
  const path = join(outputRoot, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}
