import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { hashDirectory, sha256 } from "./canonical.js";
import { evaluateSelection, validateGoldAgainstRepository } from "./metrics.js";
import { validateFailureMatrix } from "./failure-matrix.js";
import {
  assertCorpusUnchanged,
  createBenchmarkTemporaryRoot,
  materializeRepository,
  removeBenchmarkTemporaryRoot,
} from "./materialize.js";
import {
  RETRIEVAL_ANALYSIS_BUDGET,
  RETRIEVAL_ANALYSIS_VERSION,
  V0_1_1_BASE,
  assertEightKReferenceAlignment,
  summarizeTaskDiagnostics,
} from "./retrieval-analysis.js";
import { createRepositoryRuntime, diagnoseBenchmarkTask, diagnoseBenchmarkTaskV2, runBenchmarkSystem, type BenchmarkRepositoryRuntime } from "./systems.js";
import {
  BENCHMARK_VERSION,
  DATASET_VERSION,
  QUALITY_BUDGETS,
  SYSTEM_IDS,
  V0_2_02_EVALUATION_VERSION,
  type BenchmarkDataset,
  type BenchmarkRepositoryDefinition,
  type PerformanceSample,
  type QualityCaseResult,
  type QualityRun,
} from "./types.js";
import type { RetrievalV2Ablation } from "../../src/core/task-retrieval-v2.js";

const execFileAsync = promisify(execFile);
const V1_SYSTEM_IDS = ["lexical-full-file-v1", "structural-full-file-v1", "contextforge-v1"] as const;

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
    if (mode === "FULL") await assertV1ReferenceAlignment(workspaceRoot, results);
    return {
      manifest: {
        benchmarkVersion: BENCHMARK_VERSION,
        evaluationVersion: V0_2_02_EVALUATION_VERSION,
        datasetVersion: DATASET_VERSION,
        datasetHash: lock.datasetHash,
        contextforgeCommit: await gitHead(workspaceRoot),
        rankingStrategy: RANKING_STRATEGY,
        rankingStrategies: [RANKING_STRATEGY, "contextforge-retrieval-v2"],
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

async function assertV1ReferenceAlignment(workspaceRoot: string, results: readonly QualityCaseResult[]): Promise<void> {
  const referencePath = join(workspaceRoot, "benchmarks", "reference", "contextforge-benchmark-v1", "quality-results.json");
  const reference = JSON.parse(await readFile(referencePath, "utf8")) as QualityRun;
  const expected = reference.cases.filter((item) => V1_SYSTEM_IDS.includes(item.systemId as (typeof V1_SYSTEM_IDS)[number]));
  const actual = results.filter((item) => V1_SYSTEM_IDS.includes(item.systemId as (typeof V1_SYSTEM_IDS)[number]));
  if (actual.length !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("V1_REFERENCE_CHANGED: regenerated V1 quality cases differ from the frozen reference.");
  }
}

export async function runV1RetrievalDiagnostics(workspaceRoot: string): Promise<unknown> {
  const dataset = await loadDataset(workspaceRoot);
  const lock = await validateDatasetFreeze(dataset, workspaceRoot);
  const referenceRoot = join(workspaceRoot, "benchmarks", "reference", "contextforge-benchmark-v1");
  const referenceFiles = ["quality-results.json", "aggregate-results.json", "benchmark-report.md", "performance-results.json"] as const;
  const referenceBytes = new Map<string, Uint8Array>();
  for (const name of referenceFiles) referenceBytes.set(name, await readFile(join(referenceRoot, name)));
  const qualityBytes = referenceBytes.get("quality-results.json");
  if (qualityBytes === undefined) throw new Error("Frozen quality reference is unavailable.");
  const reference = JSON.parse(Buffer.from(qualityBytes).toString("utf8")) as QualityRun;
  if (
    reference.manifest.benchmarkVersion !== BENCHMARK_VERSION ||
    reference.manifest.datasetVersion !== DATASET_VERSION ||
    reference.manifest.datasetHash !== lock.datasetHash ||
    reference.manifest.taskCount !== dataset.tasks.length ||
    reference.cases.length !== dataset.tasks.length * V1_SYSTEM_IDS.length * QUALITY_BUDGETS.length
  ) throw new Error("Frozen quality reference identity or case count is inconsistent with the dataset lock.");

  const temporaryRoot = await createBenchmarkTemporaryRoot();
  try {
    const prepared = await prepareAll(dataset, workspaceRoot, temporaryRoot);
    const tasks: unknown[] = [];
    for (const repository of prepared) {
      const repositoryTasks = dataset.tasks.filter((task) => task.repositoryId === repository.definition.repositoryId);
      await validateGoldAgainstRepository(repository.runtime, repositoryTasks);
      for (const task of repositoryTasks) {
        const diagnostics = await diagnoseBenchmarkTask(repository.runtime, task.taskText, RETRIEVAL_ANALYSIS_BUDGET);
        assertEightKReferenceAlignment(task, diagnostics, reference.cases);
        tasks.push(summarizeTaskDiagnostics(task, diagnostics, reference.cases));
      }
      await assertCorpusUnchanged(repository.materialized);
    }
    return {
      analysisVersion: RETRIEVAL_ANALYSIS_VERSION,
      productionSourceBase: V0_1_1_BASE,
      benchmarkVersion: BENCHMARK_VERSION,
      datasetVersion: DATASET_VERSION,
      datasetHash: lock.datasetHash,
      analysisBudget: RETRIEVAL_ANALYSIS_BUDGET,
      systems: V1_SYSTEM_IDS,
      rankingStrategy: RANKING_STRATEGY,
      packingStrategy: PACKING_STRATEGY,
      tokenEstimator: GENERIC_TOKEN_ESTIMATOR_ID,
      tokenEstimatorVersion: GENERIC_TOKEN_ESTIMATOR_VERSION,
      taskCount: dataset.tasks.length,
      repositoryCount: dataset.repositories.length,
      referenceArtifactHashes: Object.fromEntries(referenceFiles.map((name) => [name, sha256(referenceBytes.get(name) ?? new Uint8Array())])),
      constraints: {
        goldBlindSystemDiagnostics: true,
        sourceBodiesPersisted: false,
        networkUsed: false,
        corpusSourceExecuted: false,
        productionRankingChanged: false,
      },
      tasks,
    };
  } finally {
    await removeBenchmarkTemporaryRoot(temporaryRoot);
  }
}

function requiredRanks(
  task: BenchmarkDataset["tasks"][number],
  candidates: readonly { readonly path: string; readonly relevantSymbols: readonly string[] }[],
): { readonly fileRanks: readonly number[]; readonly symbolRanks: readonly number[] } {
  const fileRanks = task.goldFiles
    .filter((item) => item.importance === "REQUIRED")
    .map((item) => candidates.findIndex((candidate) => candidate.path === item.path) + 1)
    .filter((rank) => rank > 0);
  const symbolRanks = task.goldSymbols
    .filter((item) => item.importance === "REQUIRED")
    .map((item) => candidates.findIndex((candidate) => candidate.path === item.path && candidate.relevantSymbols.includes(item.qualifiedName)) + 1)
    .filter((rank) => rank > 0);
  return { fileRanks, symbolRanks };
}

export async function runV2RetrievalDiagnostics(workspaceRoot: string): Promise<unknown> {
  const dataset = await loadDataset(workspaceRoot);
  const lock = await validateDatasetFreeze(dataset, workspaceRoot);
  const referenceRoot = join(workspaceRoot, "benchmarks", "reference", "contextforge-benchmark-v1");
  const referenceNames = ["quality-results.json", "aggregate-results.json", "benchmark-report.md", "performance-results.json"] as const;
  const referenceBytes = new Map<string, Uint8Array>();
  for (const name of referenceNames) referenceBytes.set(name, await readFile(join(referenceRoot, name)));
  await validateFailureMatrix(workspaceRoot, dataset);
  const failureMatrix = JSON.parse(await readFile(join(workspaceRoot, "benchmarks", "analysis", "v0.2", "failure-matrix.json"), "utf8")) as {
    readonly classifications: readonly { readonly taskId: string; readonly outcome: "SUCCESS" | "WEAKNESS" | "FAILURE" }[];
  };
  const v1Successes = new Set(failureMatrix.classifications.filter((item) => item.outcome === "SUCCESS").map((item) => item.taskId));
  const ablations: readonly RetrievalV2Ablation[] = [
    "IDENTITY_LEXICAL",
    "IDENTITY_LEXICAL_STRUCTURAL",
    "IDENTITY_LEXICAL_STRUCTURAL_AMBIGUITY",
    "FULL",
  ];
  const temporaryRoot = await createBenchmarkTemporaryRoot();
  try {
    const prepared = await prepareAll(dataset, workspaceRoot, temporaryRoot);
    const tasks: unknown[] = [];
    let v1SuccessRegressions = 0;
    for (const repository of prepared) {
      const repositoryTasks = dataset.tasks.filter((task) => task.repositoryId === repository.definition.repositoryId);
      await validateGoldAgainstRepository(repository.runtime, repositoryTasks);
      for (const task of repositoryTasks) {
        const variants: unknown[] = [];
        for (const ablation of ablations) {
          const executed = await diagnoseBenchmarkTaskV2(repository.runtime, task.taskText, 8_000, ablation);
          const metrics = await evaluateSelection(repository.runtime, task, lock.datasetHash, executed.selection);
          const ranks = requiredRanks(task, executed.diagnostic.candidates);
          const retrievalSymbols = new Set(executed.diagnostic.candidates.flatMap((candidate) => candidate.relevantSymbols.map((symbol) => `${candidate.path}\u0000${symbol}`)));
          const requiredSymbolsBeforePack = task.goldSymbols.filter((item) => item.importance === "REQUIRED" && retrievalSymbols.has(`${item.path}\u0000${item.qualifiedName}`));
          const requiredSymbolLossDuringPacking = requiredSymbolsBeforePack.filter((item) => metrics.missedRequiredSymbols.includes(`${item.path}#${item.qualifiedName}`)).length;
          const identityOnly = executed.diagnostic.candidates.filter((candidate) => candidate.sourceFamilies.length === 1 && candidate.sourceFamilies[0] === "IDENTITY").length;
          const lexicalOnly = executed.diagnostic.candidates.filter((candidate) => candidate.sourceFamilies.every((family) => family === "LEXICAL" || family === "SYMBOL") && candidate.sourceFamilies.includes("LEXICAL")).length;
          const structuralOnly = executed.diagnostic.candidates.filter((candidate) => candidate.sourceFamilies.length === 1 && candidate.sourceFamilies[0] === "STRUCTURAL").length;
          variants.push({
            ablation,
            taskAnalysis: ablation === "FULL" ? executed.diagnostic.taskAnalysis : undefined,
            contextPlan: ablation === "FULL" ? executed.diagnostic.contextPlan : undefined,
            candidates: executed.diagnostic.candidates,
            counts: executed.diagnostic.counts,
            pack: executed.diagnostic.pack,
            retrieval: {
              firstRequiredFileRank: ranks.fileRanks.length === 0 ? null : Math.min(...ranks.fileRanks),
              firstRequiredSymbolRank: ranks.symbolRanks.length === 0 ? null : Math.min(...ranks.symbolRanks),
              requiredFileRanks: ranks.fileRanks,
              requiredSymbolRanks: ranks.symbolRanks,
              identityOnlyDiscoveries: identityOnly,
              lexicalOnlyDiscoveries: lexicalOnly,
              structuralOnlyDiscoveries: structuralOnly,
              graphPromotionEvents: executed.diagnostic.candidates.filter((candidate) => candidate.graphDistance !== null && candidate.origin === "DIRECT_AND_EXPANDED").length,
              requiredSymbolsBeforePack: requiredSymbolsBeforePack.length,
              requiredSymbolLossDuringPacking,
            },
            quality: {
              requiredFileRecall: metrics.requiredFileRecall,
              requiredSymbolRecall: metrics.requiredSymbolRecall,
              overallGoldRecall: metrics.overallGoldRecall,
              goldRangePrecision: metrics.goldRangePrecision,
              noiseRatio: metrics.noiseRatio,
              payloadTokens: metrics.payloadTokens,
              missedRequiredFiles: metrics.missedRequiredFiles,
              missedRequiredSymbols: metrics.missedRequiredSymbols,
            },
          });
          if (ablation === "FULL" && v1Successes.has(task.taskId) && (metrics.missedRequiredFiles.length > 0 || metrics.missedRequiredSymbols.length > 0)) v1SuccessRegressions += 1;
        }
        tasks.push({ taskId: task.taskId, repositoryId: task.repositoryId, variants });
      }
      await assertCorpusUnchanged(repository.materialized);
    }
    return {
      diagnosticsVersion: "contextforge-retrieval-v2-diagnostics-v1",
      evaluationVersion: V0_2_02_EVALUATION_VERSION,
      benchmarkVersion: BENCHMARK_VERSION,
      datasetVersion: DATASET_VERSION,
      datasetHash: lock.datasetHash,
      analysisBudget: 8_000,
      ablations,
      taskCount: dataset.tasks.length,
      repositoryCount: dataset.repositories.length,
      v1SuccessTasks: v1Successes.size,
      v1SuccessRegressions,
      referenceArtifactHashes: Object.fromEntries(referenceNames.map((name) => [name, sha256(referenceBytes.get(name) ?? new Uint8Array())])),
      constraints: {
        goldBlindSystemBoundary: true,
        sourceBodiesPersisted: false,
        timingExcludedFromDeterministicDiagnostics: true,
        networkUsed: false,
        modelUsed: false,
      },
      tasks,
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
          repositoryRevision: pinned.repositoryRevision,
          taskId: task.taskId,
          budget: 8_000,
          systemId,
          repetition,
          indexMs: prepared.indexMs,
          retrievalMs: selection.performance.retrievalMs,
          packingMs: selection.performance.packingMs,
          totalMs: selection.performance.totalMs,
          ...(selection.performance.stages === undefined ? {} : { stages: selection.performance.stages }),
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
          repositoryRevision: `sha256:${materialized.sourceHash}`,
          taskId: "medium-synthetic-service-420",
          budget: 8_000,
          systemId,
          repetition,
          indexMs: summary.performance.totalMs,
          retrievalMs: selection.performance.retrievalMs,
          packingMs: selection.performance.packingMs,
          totalMs: selection.performance.totalMs,
          ...(selection.performance.stages === undefined ? {} : { stages: selection.performance.stages }),
        });
      }
      await assertCorpusUnchanged(materialized);
    }
  } finally {
    await removeBenchmarkTemporaryRoot(temporaryRoot);
  }
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    evaluationVersion: V0_2_02_EVALUATION_VERSION,
    datasetVersion: DATASET_VERSION,
    datasetHash: datasetHash(dataset),
    contextforgeCommit: await gitHead(workspaceRoot),
    rankingStrategy: RANKING_STRATEGY,
    rankingStrategies: [RANKING_STRATEGY, "contextforge-retrieval-v2"],
    packingStrategy: PACKING_STRATEGY,
    tokenEstimator: GENERIC_TOKEN_ESTIMATOR_ID,
    tokenEstimatorVersion: GENERIC_TOKEN_ESTIMATOR_VERSION,
    baselineVersions: ["lexical-full-file-v1", "structural-full-file-v1"],
    environment: { os: platform(), osRelease: release(), architecture: arch(), node: process.version },
    repetitions: 3,
    note: "Environment-specific medians; not an SLA.",
    medians: [pinned.repositoryId, "medium-synthetic-1000"].flatMap((repositoryId) => SYSTEM_IDS.map((systemId) => {
      const selected = samples.filter((sample) => sample.repositoryId === repositoryId && sample.systemId === systemId);
      return {
        repositoryId,
        repositoryRevision: selected[0]?.repositoryRevision ?? "unknown",
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
