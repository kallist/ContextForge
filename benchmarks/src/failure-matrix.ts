import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { BenchmarkDataset } from "./types.js";

export const FAILURE_MATRIX_VERSION = "contextforge-v0.2-failure-matrix-v1";
const FROZEN_DATASET_HASH = "75685087e8392840b4bb61ae19cef9ccb92df66844e79e0e87a0b7c6437a0002";

export const FAILURE_CAUSES = [
  "TASK_ANALYSIS_MISS",
  "IDENTITY_MISS",
  "LEXICAL_MISS",
  "SYMBOL_RETRIEVAL_MISS",
  "RELATIONSHIP_MISS",
  "GRAPH_EXPANSION_MISS",
  "FALSE_STRUCTURAL_BOOST",
  "TEST_LINK_MISS",
  "CONFIG_CONTEXT_MISS",
  "GIT_SIGNAL_MISUSE",
  "PACKING_DROP",
  "RANGE_SELECTION_MISS",
  "BUDGET_ALLOCATION_MISS",
  "PRECISION_NOISE",
  "STALE_SOURCE_BOUNDARY",
  "GOLD_OR_METHOD_LIMITATION",
  "NO_PRIMARY_FAILURE",
] as const;

export type FailureCause = (typeof FAILURE_CAUSES)[number];

export interface FailureMatrixSummary {
  readonly classifications: number;
  readonly countsByPrimaryCause: Readonly<Record<string, number>>;
  readonly countsByOutcome: Readonly<Record<string, number>>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function object(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Readonly<Record<string, unknown>>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function safeResearchText(value: unknown, label: string): string {
  const result = text(value, label);
  if (/[A-Za-z]:[\\/]|\\\\|(?:^|\s)\/(?:Users|home)\//u.test(result)) throw new Error(`${label} contains a private absolute path.`);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|token|password)\s*[:=]\s*\S+/iu.test(result)) {
    throw new Error(`${label} appears to contain secret material.`);
  }
  return result;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

export async function validateFailureMatrix(workspaceRoot: string, dataset: BenchmarkDataset): Promise<FailureMatrixSummary> {
  const path = join(workspaceRoot, "benchmarks", "analysis", "v0.2", "failure-matrix.json");
  const serialized = await readFile(path, "utf8");
  const root = object(JSON.parse(serialized), "failure matrix");
  if (root.analysisVersion !== FAILURE_MATRIX_VERSION) throw new Error("Failure matrix analysis version is invalid.");
  if (root.benchmarkVersion !== dataset.benchmarkVersion || root.datasetVersion !== dataset.datasetVersion) {
    throw new Error("Failure matrix benchmark or dataset version is invalid.");
  }
  if (root.datasetHash !== FROZEN_DATASET_HASH || root.analysisBudget !== 8_000) {
    throw new Error("Failure matrix dataset hash or analysis budget is invalid.");
  }
  const taxonomy = root.taxonomy;
  const classifications = root.classifications;
  if (!Array.isArray(taxonomy) || !Array.isArray(classifications)) throw new Error("Failure matrix taxonomy and classifications must be arrays.");

  const taxonomyCodes = new Set<string>();
  for (const [index, value] of taxonomy.entries()) {
    const item = object(value, `taxonomy[${index}]`);
    const code = text(item.code, `taxonomy[${index}].code`);
    if (!FAILURE_CAUSES.includes(code as FailureCause)) throw new Error(`Unknown taxonomy code: ${code}`);
    if (taxonomyCodes.has(code)) throw new Error(`Duplicate taxonomy code: ${code}`);
    taxonomyCodes.add(code);
    safeResearchText(item.definition, `taxonomy[${index}].definition`);
  }
  for (const cause of FAILURE_CAUSES) {
    if (!taxonomyCodes.has(cause)) throw new Error(`Failure matrix taxonomy omits ${cause}.`);
  }

  const datasetTaskIds = new Set(dataset.tasks.map((task) => task.taskId));
  const classifiedTaskIds = new Set<string>();
  const countsByPrimaryCause = new Map<string, number>();
  const countsByOutcome = new Map<string, number>();
  for (const [index, value] of classifications.entries()) {
    const item = object(value, `classifications[${index}]`);
    const taskId = text(item.taskId, `classifications[${index}].taskId`);
    if (!datasetTaskIds.has(taskId)) throw new Error(`Failure matrix contains unknown task ${taskId}.`);
    if (classifiedTaskIds.has(taskId)) throw new Error(`Failure matrix contains duplicate task ${taskId}.`);
    classifiedTaskIds.add(taskId);
    const outcome = text(item.outcome, `classifications[${index}].outcome`);
    if (!["SUCCESS", "WEAKNESS", "FAILURE"].includes(outcome)) throw new Error(`Failure matrix outcome is invalid for ${taskId}.`);
    const primaryCause = text(item.primaryCause, `classifications[${index}].primaryCause`);
    if (!FAILURE_CAUSES.includes(primaryCause as FailureCause)) throw new Error(`Failure matrix primary cause is invalid for ${taskId}.`);
    if ((outcome === "SUCCESS") !== (primaryCause === "NO_PRIMARY_FAILURE")) {
      throw new Error(`Failure matrix success/cause pairing is inconsistent for ${taskId}.`);
    }
    const secondaryCauses = stringArray(item.secondaryCauses, `classifications[${index}].secondaryCauses`);
    if (new Set(secondaryCauses).size !== secondaryCauses.length || secondaryCauses.includes(primaryCause)) {
      throw new Error(`Failure matrix secondary causes are duplicated for ${taskId}.`);
    }
    for (const cause of secondaryCauses) {
      if (!FAILURE_CAUSES.includes(cause as FailureCause) || cause === "NO_PRIMARY_FAILURE") {
        throw new Error(`Failure matrix secondary cause is invalid for ${taskId}: ${cause}`);
      }
    }
    const confidence = text(item.confidence, `classifications[${index}].confidence`);
    if (!["HIGH", "MEDIUM", "LOW"].includes(confidence)) throw new Error(`Failure matrix confidence is invalid for ${taskId}.`);
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) throw new Error(`Failure matrix evidence is missing for ${taskId}.`);
    for (const [evidenceIndex, evidenceValue] of item.evidence.entries()) {
      const evidence = object(evidenceValue, `classifications[${index}].evidence[${evidenceIndex}]`);
      const kind = text(evidence.kind, `classifications[${index}].evidence[${evidenceIndex}].kind`);
      if (kind !== "FACT" && kind !== "INFERENCE") throw new Error(`Failure matrix evidence kind is invalid for ${taskId}.`);
      safeResearchText(evidence.statement, `classifications[${index}].evidence[${evidenceIndex}].statement`);
    }
    countsByPrimaryCause.set(primaryCause, (countsByPrimaryCause.get(primaryCause) ?? 0) + 1);
    countsByOutcome.set(outcome, (countsByOutcome.get(outcome) ?? 0) + 1);
  }
  if (classifications.length !== dataset.tasks.length || classifiedTaskIds.size !== dataset.tasks.length) {
    throw new Error(`Failure matrix must classify all ${dataset.tasks.length} frozen tasks exactly once.`);
  }
  return {
    classifications: classifications.length,
    countsByPrimaryCause: Object.fromEntries([...countsByPrimaryCause].sort(([left], [right]) => compareText(left, right))),
    countsByOutcome: Object.fromEntries([...countsByOutcome].sort(([left], [right]) => compareText(left, right))),
  };
}
