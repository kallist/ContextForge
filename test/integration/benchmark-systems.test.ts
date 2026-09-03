import assert from "node:assert/strict";
import test from "node:test";

import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildIndex } from "../../src/application/build-index.js";
import { evaluateSelection, validateGoldAgainstRepository } from "../../benchmarks/src/metrics.js";
import { renderBenchmarkReport } from "../../benchmarks/src/report.js";
import { createRepositoryRuntime, diagnoseBenchmarkTask, runBenchmarkSystem } from "../../benchmarks/src/systems.js";
import {
  BENCHMARK_VERSION,
  DATASET_VERSION,
  QUALITY_BUDGETS,
  SYSTEM_IDS,
  type BenchmarkTaskDefinition,
  type QualityRun,
  type SystemId,
  type SystemSelection,
} from "../../benchmarks/src/types.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

async function prepare(root: string): Promise<void> {
  await writeFixture(root, "AGENTS.md", "# Instructions\n\nPreserve widget state.\n");
  await writeFixture(root, "src/store.ts", "export class WidgetStore {\n  saveWidget(value: string) { return value; }\n}\n");
  await writeFixture(root, "src/service.ts", 'import { WidgetStore } from "./store.js";\nexport class WidgetService {\n  constructor(private store: WidgetStore) {}\n  updateWidget(value: string) { return this.store.saveWidget(value); }\n}\n');
  await writeFixture(root, "tests/service.test.ts", 'import { WidgetService } from "../src/service.js";\nexport const testWidget = WidgetService;\n');
  await writeFixture(root, "src/unrelated.ts", "export class BillingWidget {}\n");
  const scanner = new FileSystemRepositoryScanner();
  const reader = new FileSystemRepositorySourceReader();
  await buildIndex(scanner, reader, new TreeSitterLanguageAnalyzer(), (path) => new SqliteIndexRepository(path), { repositoryPath: root });
}

function task(rootRevision = "fixture-revision"): BenchmarkTaskDefinition {
  return {
    taskId: "widget-update",
    repositoryId: "fixture",
    repositoryRevision: rootRevision,
    taskText: "Fix widget updates that are not saved",
    taskCategory: "CROSS_FILE_BUG_FIX",
    languageTags: ["typescript"],
    difficulty: "MEDIUM",
    goldFiles: [
      { path: "src/service.ts", importance: "REQUIRED", rationale: "orchestrator" },
      { path: "src/store.ts", importance: "REQUIRED", rationale: "state owner" },
    ],
    goldSymbols: [
      { path: "src/service.ts", qualifiedName: "WidgetService.updateWidget", importance: "REQUIRED", rationale: "operation" },
      { path: "src/store.ts", qualifiedName: "WidgetStore.saveWidget", importance: "REQUIRED", rationale: "persistence" },
    ],
    goldRanges: [],
    notes: "integration fixture",
  };
}

function stableSelection(value: Awaited<ReturnType<typeof runBenchmarkSystem>>): unknown {
  return {
    systemId: value.systemId,
    rankingStrategy: value.rankingStrategy,
    packingStrategy: value.packingStrategy,
    budget: value.budget,
    payloadTokens: value.payloadTokens,
    retrievalCandidates: value.retrievalCandidates,
    selectedRanges: value.selectedRanges,
    status: value.status,
    diagnostics: value.diagnostics,
  };
}

test("five benchmark systems are deterministic, hard-budgeted, preserve the V1 boundary, and remain Gold-blind", async (context) => {
  const root = await createTemporaryDirectory("benchmark-systems");
  context.after(() => removeTemporaryDirectory(root));
  await prepare(root);
  const runtime = await createRepositoryRuntime(root);
  await validateGoldAgainstRepository(runtime, [task()]);

  const outputs = new Map<SystemId, SystemSelection>();
  for (const systemId of SYSTEM_IDS) {
    const first = await runBenchmarkSystem(systemId, runtime, task().taskText, 4_000);
    const second = await runBenchmarkSystem(systemId, runtime, task().taskText, 4_000);
    assert.deepEqual(stableSelection(first), stableSelection(second));
    assert.ok(first.payloadTokens <= first.budget);
    outputs.set(systemId, first);
  }
  const structural = outputs.get("structural-full-file-v1");
  const contextforge = outputs.get("contextforge-v1");
  const contextforgeV2 = outputs.get("contextforge-v2");
  const contextforgeV2Relations = outputs.get("contextforge-v2-relations");
  assert.ok(structural !== undefined && contextforge !== undefined && contextforgeV2 !== undefined && contextforgeV2Relations !== undefined);
  assert.deepEqual(structural.retrievalCandidates, contextforge.retrievalCandidates);
  assert.equal(contextforgeV2.rankingStrategy, "contextforge-retrieval-v2");
  assert.equal(contextforgeV2.packingStrategy, "contextforge-pack-v1");
  assert.ok(contextforgeV2.performance.stages !== undefined);
  assert.equal(contextforgeV2Relations.rankingStrategy, "contextforge-retrieval-v2-relations");
  assert.equal(contextforgeV2Relations.packingStrategy, "contextforge-pack-v1");
  assert.ok(contextforgeV2Relations.performance.stages?.relationshipDerivationMs !== undefined);

  const selection = outputs.get("contextforge-v1");
  assert.ok(selection !== undefined);
  const firstMetrics = await evaluateSelection(runtime, task(), "a".repeat(64), selection);
  const changedGold = { ...task(), goldFiles: [{ path: "never-selected.ts", importance: "REQUIRED" as const, rationale: "changed evaluator label" }], goldSymbols: [] };
  const secondMetrics = await evaluateSelection(runtime, changedGold, "a".repeat(64), selection);
  assert.deepEqual(stableSelection(selection), stableSelection(contextforge));
  assert.notEqual(firstMetrics.requiredFileRecall, secondMetrics.requiredFileRecall);
});

test("Gold validation fails fast and quality report serialization is deterministic", async (context) => {
  const root = await createTemporaryDirectory("benchmark-gold-invalid");
  context.after(() => removeTemporaryDirectory(root));
  await prepare(root);
  const runtime = await createRepositoryRuntime(root);
  await assert.rejects(validateGoldAgainstRepository(runtime, [{ ...task(), goldFiles: [{ path: "missing.ts", importance: "REQUIRED", rationale: "invalid" }], goldSymbols: [] }]), /GOLD_INVALID/u);

  const selection = await runBenchmarkSystem("contextforge-v1", runtime, task().taskText, 4_000);
  const result = await evaluateSelection(runtime, task(), "b".repeat(64), selection);
  const run: QualityRun = {
    manifest: {
      benchmarkVersion: BENCHMARK_VERSION,
      datasetVersion: DATASET_VERSION,
      datasetHash: "b".repeat(64),
      contextforgeCommit: "c".repeat(40),
      rankingStrategy: "contextforge-structural-v1",
      packingStrategy: "contextforge-pack-v1",
      tokenEstimator: "contextforge-generic-v1",
      tokenEstimatorVersion: "1.0",
      baselineVersions: ["lexical-full-file-v1", "structural-full-file-v1"],
      budgets: [...QUALITY_BUDGETS],
      systems: [...SYSTEM_IDS],
      taskCount: 1,
      repositoryCount: 1,
      runMode: "FULL",
    },
    cases: [result],
  };
  assert.equal(renderBenchmarkReport(run), renderBenchmarkReport(JSON.parse(JSON.stringify(run)) as QualityRun));
});

test("V1 retrieval diagnostics are deterministic, bounded, source-free, and preserve stage evidence", async (context) => {
  const root = await createTemporaryDirectory("benchmark-diagnostics");
  context.after(() => removeTemporaryDirectory(root));
  await prepare(root);
  const runtime = await createRepositoryRuntime(root);

  const first = await diagnoseBenchmarkTask(runtime, task().taskText, 4_000);
  const second = await diagnoseBenchmarkTask(runtime, task().taskText, 4_000);
  assert.deepEqual(first, second);
  assert.ok(first.structural.candidates.length <= 64);
  assert.ok(first.structural.candidates.every((candidate) => candidate.rank >= 1 && candidate.reasons.length <= 4));
  assert.ok(first.contextforge.selectedItems.every((item) => !item.path.includes("\\") && !item.path.startsWith("/")));
  const serialized = JSON.stringify(first);
  assert.ok(!serialized.includes(root));
  assert.ok(!serialized.includes("return this.store.saveWidget(value)"));
  assert.ok(first.normalizedQuery.signals.some((signal) => signal.normalized === "widget"));
  assert.ok(first.structural.candidates.some((candidate) => candidate.path === "src/service.ts"));
});
