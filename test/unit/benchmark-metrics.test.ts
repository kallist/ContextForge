import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, sha256 } from "../../benchmarks/src/canonical.js";
import { datasetHash, loadDataset, parseDataset } from "../../benchmarks/src/dataset.js";
import { validateFailureMatrix } from "../../benchmarks/src/failure-matrix.js";
import {
  intersectRanges,
  minimumActualTokensAtRecall,
  precisionFromTokens,
  recallRatio,
} from "../../benchmarks/src/metrics.js";
import { BENCHMARK_VERSION, DATASET_VERSION } from "../../benchmarks/src/types.js";

test("benchmark recall, precision, overlap, and matched-recall math use explicit denominators", () => {
  assert.equal(recallRatio(1, 2), 0.5);
  assert.equal(recallRatio(2, 3), 0.666667);
  assert.equal(recallRatio(0, 0), null);
  assert.equal(precisionFromTokens(60, 100), 0.6);
  assert.throws(() => precisionFromTokens(101, 100));
  assert.deepEqual(
    intersectRanges(
      { startLine: 2, endLine: 8, reasons: ["WHOLE_FILE"] },
      { startLine: 5, endLine: 10, reasons: ["SYMBOL_RANGE"] },
    ),
    { startLine: 5, endLine: 8, reasons: ["SYMBOL_RANGE"] },
  );
  assert.equal(intersectRanges(
    { startLine: 1, endLine: 2, reasons: ["WHOLE_FILE"] },
    { startLine: 3, endLine: 4, reasons: ["SYMBOL_RANGE"] },
  ), null);
  assert.equal(minimumActualTokensAtRecall([
    { recall: 0.5, payloadTokens: 1_900 },
    { recall: 0.8, payloadTokens: 3_500 },
    { recall: 1, payloadTokens: 7_100 },
  ], 0.8), 3_500);
  assert.equal(minimumActualTokensAtRecall([{ recall: 0.5, payloadTokens: 1_900 }], 0.8), null);
});

test("canonical JSON and dataset hash are key-order independent and content sensitive", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.notEqual(sha256(canonicalJson({ a: 1 })), sha256(canonicalJson({ a: 2 })));
  const dataset = parseDataset({
    benchmarkVersion: BENCHMARK_VERSION,
    datasetVersion: DATASET_VERSION,
    repositories: [{ repositoryId: "fixture", kind: "CURATED_FIXTURE", repositoryRevision: "sha256:x", relativePath: "benchmarks/corpus/x" }],
    tasks: [{
      taskId: "task",
      repositoryId: "fixture",
      repositoryRevision: "sha256:x",
      taskText: "Review Widget.run",
      taskCategory: "EXACT_SYMBOL",
      languageTags: ["typescript"],
      difficulty: "EASY",
      goldFiles: [{ path: "src/widget.ts", importance: "REQUIRED", rationale: "owner" }],
      goldSymbols: [],
      goldRanges: [],
      notes: "control",
    }],
  });
  assert.match(datasetHash(dataset), /^[a-f0-9]{64}$/u);
});

test("dataset parser fails closed for traversal, duplicate Gold, missing arrays, and revision mismatch", () => {
  const base = {
    benchmarkVersion: BENCHMARK_VERSION,
    datasetVersion: DATASET_VERSION,
    repositories: [{ repositoryId: "fixture", kind: "CURATED_FIXTURE", repositoryRevision: "rev", relativePath: "benchmarks/corpus/x" }],
    tasks: [{
      taskId: "task",
      repositoryId: "fixture",
      repositoryRevision: "rev",
      taskText: "review widget",
      taskCategory: "BUG_FIX",
      languageTags: ["typescript"],
      difficulty: "MEDIUM",
      goldFiles: [{ path: "src/widget.ts", importance: "REQUIRED", rationale: "owner" }],
      goldSymbols: [],
      goldRanges: [],
      notes: "case",
    }],
  };
  const baseTask = base.tasks[0];
  assert.ok(baseTask !== undefined);
  assert.throws(() => parseDataset({ ...base, tasks: [{ ...baseTask, goldFiles: [{ path: "../secret", importance: "REQUIRED", rationale: "bad" }] }] }), /repository-relative/u);
  assert.throws(() => parseDataset({ ...base, tasks: [{ ...baseTask, repositoryRevision: "other" }] }), /revision/u);
  assert.throws(() => parseDataset({ ...base, tasks: [{ ...baseTask, goldFiles: [...baseTask.goldFiles, ...baseTask.goldFiles] }] }), /duplicate/u);
  assert.throws(() => parseDataset({ ...base, tasks: [{ ...baseTask, goldSymbols: undefined }] }), /explicit arrays/u);
});

test("V0.2 failure matrix classifies every frozen task with a valid taxonomy and evidence", async () => {
  const workspaceRoot = process.cwd();
  const dataset = await loadDataset(workspaceRoot);
  const summary = await validateFailureMatrix(workspaceRoot, dataset);
  assert.equal(summary.classifications, 24);
  assert.deepEqual(summary.countsByOutcome, { FAILURE: 4, SUCCESS: 19, WEAKNESS: 1 });
  assert.deepEqual(summary.countsByPrimaryCause, {
    BUDGET_ALLOCATION_MISS: 1,
    FALSE_STRUCTURAL_BOOST: 1,
    NO_PRIMARY_FAILURE: 19,
    PRECISION_NOISE: 1,
    SYMBOL_RETRIEVAL_MISS: 2,
  });
});
