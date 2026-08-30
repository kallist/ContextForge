import type { ContextRange } from "../../src/core/context-pack.js";
import { logicalLines, mergeContextRanges, rangeContains, sliceContextRange } from "../../src/core/packing/ranges.js";
import { GenericTokenEstimator } from "../../src/core/token-estimation.js";
import type { BenchmarkRepositoryRuntime } from "./systems.js";
import type {
  BenchmarkTaskDefinition,
  GoldFileDefinition,
  GoldRangeDefinition,
  GoldSymbolDefinition,
  QualityCaseResult,
  RetrievalMetric,
  SelectedRange,
  SystemSelection,
} from "./types.js";
import { BENCHMARK_VERSION, DATASET_VERSION, RETRIEVAL_CUTOFFS } from "./types.js";

const estimator = new GenericTokenEstimator();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function recallRatio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1_000_000) / 1_000_000;
}

export function precisionFromTokens(relevantTokens: number, selectedTokens: number): number | null {
  if (relevantTokens < 0 || selectedTokens < 0 || relevantTokens > selectedTokens) throw new Error("Precision token counts are invalid.");
  return recallRatio(relevantTokens, selectedTokens);
}

export function minimumActualTokensAtRecall(
  points: readonly { readonly recall: number | null; readonly payloadTokens: number }[],
  target: number,
): number | null {
  const reached = points.filter((point) => point.recall !== null && point.recall >= target).map((point) => point.payloadTokens);
  return reached.length === 0 ? null : Math.min(...reached);
}

function importanceFilter<T extends GoldFileDefinition>(items: readonly T[], requiredOnly: boolean): T[] {
  return items.filter((item) => !requiredOnly || item.importance === "REQUIRED");
}

function goldSymbolKey(symbol: Pick<GoldSymbolDefinition, "path" | "qualifiedName">): string {
  return `${symbol.path}\0${symbol.qualifiedName}`;
}

function selectedRangeMap(selected: readonly SelectedRange[]): Map<string, readonly ContextRange[]> {
  return new Map(selected.map((item) => [item.path, mergeContextRanges(item.ranges, 0)]));
}

function fileRecall(gold: readonly GoldFileDefinition[], selected: ReadonlyMap<string, readonly ContextRange[]>, requiredOnly: boolean): number | null {
  const considered = importanceFilter(gold, requiredOnly);
  return recallRatio(considered.filter((item) => (selected.get(item.path)?.length ?? 0) > 0).length, considered.length);
}

function symbolRanges(runtime: BenchmarkRepositoryRuntime, gold: readonly GoldSymbolDefinition[]): Map<string, ContextRange> {
  const ranges = new Map<string, ContextRange>();
  for (const item of gold) {
    const file = runtime.snapshot.files.find((candidate) => candidate.relativePath === item.path);
    const symbol = file?.analysis.symbols.find((candidate) => candidate.qualifiedName === item.qualifiedName);
    if (symbol !== undefined) ranges.set(goldSymbolKey(item), { startLine: symbol.startLine, endLine: symbol.endLine, reasons: ["SYMBOL_RANGE"] });
  }
  return ranges;
}

function symbolRecall(
  gold: readonly GoldSymbolDefinition[],
  ranges: ReadonlyMap<string, ContextRange>,
  selected: ReadonlyMap<string, readonly ContextRange[]>,
  requiredOnly: boolean,
): number | null {
  const considered = importanceFilter(gold, requiredOnly);
  const covered = considered.filter((item) => {
    const core = ranges.get(goldSymbolKey(item));
    return core !== undefined && (selected.get(item.path)?.some((range) => rangeContains(range, core.startLine, core.endLine)) ?? false);
  });
  return recallRatio(covered.length, considered.length);
}

function rangeRecall(gold: readonly GoldRangeDefinition[], selected: ReadonlyMap<string, readonly ContextRange[]>): { coveredWeight: number; totalWeight: number } {
  let coveredWeight = 0;
  let totalWeight = 0;
  for (const item of gold) {
    const weight = item.importance === "REQUIRED" ? 2 : 1;
    totalWeight += weight;
    if (selected.get(item.path)?.some((range) => rangeContains(range, item.startLine, item.endLine)) === true) coveredWeight += weight;
  }
  return { coveredWeight, totalWeight };
}

function overallRecall(
  task: BenchmarkTaskDefinition,
  symbolCore: ReadonlyMap<string, ContextRange>,
  selected: ReadonlyMap<string, readonly ContextRange[]>,
): number | null {
  let coveredWeight = 0;
  let totalWeight = 0;
  for (const file of task.goldFiles) {
    const weight = file.importance === "REQUIRED" ? 2 : 1;
    totalWeight += weight;
    if ((selected.get(file.path)?.length ?? 0) > 0) coveredWeight += weight;
  }
  for (const symbol of task.goldSymbols) {
    const weight = symbol.importance === "REQUIRED" ? 2 : 1;
    totalWeight += weight;
    const core = symbolCore.get(goldSymbolKey(symbol));
    if (core !== undefined && selected.get(symbol.path)?.some((range) => rangeContains(range, core.startLine, core.endLine)) === true) coveredWeight += weight;
  }
  const range = rangeRecall(task.goldRanges, selected);
  return recallRatio(coveredWeight + range.coveredWeight, totalWeight + range.totalWeight);
}

function retrievalMetric(task: BenchmarkTaskDefinition, candidates: SystemSelection["retrievalCandidates"], cutoff: number): RetrievalMetric {
  const top = candidates.slice(0, cutoff);
  const paths = new Set(top.map((item) => item.path));
  const symbols = new Set(top.flatMap((item) => item.relevantSymbols.map((symbol) => `${symbol.path}\0${symbol.qualifiedName}`)));
  const requiredFiles = task.goldFiles.filter((item) => item.importance === "REQUIRED");
  const requiredSymbols = task.goldSymbols.filter((item) => item.importance === "REQUIRED");
  return {
    requiredFileRecall: recallRatio(requiredFiles.filter((item) => paths.has(item.path)).length, requiredFiles.length),
    fileRecall: recallRatio(task.goldFiles.filter((item) => paths.has(item.path)).length, task.goldFiles.length),
    requiredSymbolRecall: recallRatio(requiredSymbols.filter((item) => symbols.has(goldSymbolKey(item))).length, requiredSymbols.length),
    symbolRecall: recallRatio(task.goldSymbols.filter((item) => symbols.has(goldSymbolKey(item))).length, task.goldSymbols.length),
  };
}

async function readSource(runtime: BenchmarkRepositoryRuntime, path: string): Promise<readonly string[]> {
  const entry = runtime.scan.entries.find((item) => item.path === path);
  const indexed = runtime.snapshot.files.find((item) => item.relativePath === path);
  if (entry === undefined || indexed?.contentHash === null || indexed?.contentHash === undefined) throw new Error(`Selected benchmark path is unavailable: ${path}`);
  const read = await runtime.sourceReader.readTextFile(runtime.scan.rootRealPath, entry);
  if (read.status !== "read" || read.contentHash !== indexed.contentHash) throw new Error(`Selected benchmark source is stale: ${path}`);
  return logicalLines(read.source);
}

export function intersectRanges(left: ContextRange, right: ContextRange): ContextRange | null {
  const startLine = Math.max(left.startLine, right.startLine);
  const endLine = Math.min(left.endLine, right.endLine);
  return startLine > endLine ? null : { startLine, endLine, reasons: ["SYMBOL_RANGE"] };
}

async function precisionTokens(
  runtime: BenchmarkRepositoryRuntime,
  task: BenchmarkTaskDefinition,
  symbolCore: ReadonlyMap<string, ContextRange>,
  selected: ReadonlyMap<string, readonly ContextRange[]>,
): Promise<{ contentTokens: number; relevantTokens: number }> {
  let contentTokens = 0;
  let relevantTokens = 0;
  const goldPaths = new Set(task.goldFiles.map((item) => item.path));
  for (const [path, selectedRanges] of selected) {
    const lines = await readSource(runtime, path);
    for (const range of selectedRanges) contentTokens += estimator.estimate(sliceContextRange(lines, range));
    if (!goldPaths.has(path)) continue;
    const semanticGold = [
      ...task.goldSymbols.filter((item) => item.path === path).flatMap((item) => {
        const range = symbolCore.get(goldSymbolKey(item));
        return range === undefined ? [] : [range];
      }),
      ...task.goldRanges.filter((item) => item.path === path).map((item) => ({ startLine: item.startLine, endLine: item.endLine, reasons: ["SYMBOL_RANGE"] as const })),
    ];
    if (semanticGold.length === 0) {
      for (const range of selectedRanges) relevantTokens += estimator.estimate(sliceContextRange(lines, range));
      continue;
    }
    const overlaps = mergeContextRanges(selectedRanges.flatMap((selectedRange) => semanticGold.flatMap((goldRange) => {
      const overlap = intersectRanges(selectedRange, goldRange);
      return overlap === null ? [] : [overlap];
    })), 0);
    for (const overlap of overlaps) relevantTokens += estimator.estimate(sliceContextRange(lines, overlap));
  }
  return { contentTokens, relevantTokens };
}

function missedFiles(task: BenchmarkTaskDefinition, selected: ReadonlyMap<string, readonly ContextRange[]>): string[] {
  return task.goldFiles.filter((item) => item.importance === "REQUIRED" && (selected.get(item.path)?.length ?? 0) === 0).map((item) => item.path).sort(compareText);
}

function missedSymbols(
  task: BenchmarkTaskDefinition,
  symbolCore: ReadonlyMap<string, ContextRange>,
  selected: ReadonlyMap<string, readonly ContextRange[]>,
): string[] {
  return task.goldSymbols.filter((item) => {
    if (item.importance !== "REQUIRED") return false;
    const core = symbolCore.get(goldSymbolKey(item));
    return core === undefined || selected.get(item.path)?.some((range) => rangeContains(range, core.startLine, core.endLine)) !== true;
  }).map((item) => `${item.path}#${item.qualifiedName}`).sort(compareText);
}

function failureAttribution(task: BenchmarkTaskDefinition, selection: SystemSelection, missedRequiredFiles: readonly string[], missedRequiredSymbols: readonly string[]): string[] {
  if (missedRequiredFiles.length === 0 && missedRequiredSymbols.length === 0) return [];
  const topTwenty = selection.retrievalCandidates.slice(0, 20);
  const retrievedFiles = new Set(topTwenty.map((item) => item.path));
  const retrievedSymbols = new Set(topTwenty.flatMap((item) => item.relevantSymbols.map((symbol) => `${symbol.path}#${symbol.qualifiedName}`)));
  const attribution = new Set<string>();
  if (missedRequiredFiles.some((path) => !retrievedFiles.has(path)) || missedRequiredSymbols.some((identity) => !retrievedSymbols.has(identity))) attribution.add("RETRIEVAL_MISS");
  if (missedRequiredFiles.some((path) => retrievedFiles.has(path)) || missedRequiredSymbols.some((identity) => retrievedSymbols.has(identity))) attribution.add("PACKING_DROP");
  if (selection.status === "NO_CONTEXT" || selection.diagnostics.includes("WHOLE_FILE_DID_NOT_FIT")) attribution.add("BUDGET_LIMIT");
  if (task.languageTags.some((language) => !["typescript", "javascript", "tsx", "jsx", "python", "mixed"].includes(language))) attribution.add("UNSUPPORTED");
  return [...attribution].sort(compareText);
}

export async function validateGoldAgainstRepository(runtime: BenchmarkRepositoryRuntime, tasks: readonly BenchmarkTaskDefinition[]): Promise<void> {
  const files = new Map(runtime.snapshot.files.map((file) => [file.relativePath, file]));
  for (const task of tasks) {
    const fileImportance = new Map(task.goldFiles.map((file) => [file.path, file.importance]));
    for (const gold of task.goldFiles) {
      if (!files.has(gold.path)) throw new Error(`GOLD_INVALID: ${task.taskId} file does not exist: ${gold.path}`);
    }
    for (const gold of task.goldSymbols) {
      const file = files.get(gold.path);
      if (file?.analysis.symbols.some((symbol) => symbol.qualifiedName === gold.qualifiedName) !== true) {
        throw new Error(`GOLD_INVALID: ${task.taskId} symbol does not exist: ${gold.path}#${gold.qualifiedName}`);
      }
      if (!fileImportance.has(gold.path) || (gold.importance === "REQUIRED" && fileImportance.get(gold.path) !== "REQUIRED")) {
        throw new Error(`GOLD_INVALID: ${task.taskId} symbol/file importance is inconsistent: ${gold.path}#${gold.qualifiedName}`);
      }
    }
    for (const gold of task.goldRanges) {
      const lines = await readSource(runtime, gold.path);
      if (gold.endLine > lines.length) throw new Error(`GOLD_INVALID: ${task.taskId} range exceeds file: ${gold.path}`);
      if (!fileImportance.has(gold.path) || (gold.importance === "REQUIRED" && fileImportance.get(gold.path) !== "REQUIRED")) {
        throw new Error(`GOLD_INVALID: ${task.taskId} range/file importance is inconsistent: ${gold.path}`);
      }
    }
  }
}

export async function evaluateSelection(
  runtime: BenchmarkRepositoryRuntime,
  task: BenchmarkTaskDefinition,
  datasetHash: string,
  selection: SystemSelection,
): Promise<QualityCaseResult> {
  const selected = selectedRangeMap(selection.selectedRanges);
  const symbolCore = symbolRanges(runtime, task.goldSymbols);
  const precision = await precisionTokens(runtime, task, symbolCore, selected);
  const goldRangePrecision = precisionFromTokens(precision.relevantTokens, precision.contentTokens);
  const missedRequiredFiles = missedFiles(task, selected);
  const missedRequiredSymbols = missedSymbols(task, symbolCore, selected);
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    datasetVersion: DATASET_VERSION,
    datasetHash,
    repositoryId: task.repositoryId,
    repositoryRevision: task.repositoryRevision,
    taskId: task.taskId,
    taskText: task.taskText,
    taskCategory: task.taskCategory,
    languageTags: task.languageTags,
    difficulty: task.difficulty,
    systemId: selection.systemId,
    rankingStrategy: selection.rankingStrategy,
    packingStrategy: selection.packingStrategy,
    tokenEstimator: selection.tokenEstimator,
    tokenEstimatorVersion: selection.tokenEstimatorVersion,
    budget: selection.budget,
    payloadTokens: selection.payloadTokens,
    repositoryContentTokens: precision.contentTokens,
    serializationOverheadTokens: Math.max(0, selection.payloadTokens - precision.contentTokens),
    retrieval: Object.fromEntries(RETRIEVAL_CUTOFFS.map((cutoff) => [String(cutoff), retrievalMetric(task, selection.retrievalCandidates, cutoff)])),
    requiredFileRecall: fileRecall(task.goldFiles, selected, true),
    fileRecall: fileRecall(task.goldFiles, selected, false),
    requiredSymbolRecall: symbolRecall(task.goldSymbols, symbolCore, selected, true),
    symbolRecall: symbolRecall(task.goldSymbols, symbolCore, selected, false),
    overallGoldRecall: overallRecall(task, symbolCore, selected),
    goldRangePrecision,
    noiseRatio: goldRangePrecision === null ? null : Math.round((1 - goldRangePrecision) * 1_000_000) / 1_000_000,
    selectedFiles: [...selected.keys()].sort(compareText),
    selectedRanges: [...selection.selectedRanges].sort((left, right) => compareText(left.path, right.path)),
    missedRequiredFiles,
    missedRequiredSymbols,
    failureAttribution: failureAttribution(task, selection, missedRequiredFiles, missedRequiredSymbols),
    status: selection.status,
    diagnostics: [...selection.diagnostics].sort(compareText),
  };
}
