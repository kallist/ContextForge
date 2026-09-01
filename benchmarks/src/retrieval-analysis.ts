import type { BenchmarkCandidateDiagnostic, BenchmarkTaskDiagnostics } from "./systems.js";
import type { BenchmarkTaskDefinition, QualityCaseResult, SystemId } from "./types.js";

export const RETRIEVAL_ANALYSIS_VERSION = "contextforge-v0.2-retrieval-analysis-v1";
export const RETRIEVAL_ANALYSIS_BUDGET = 8_000;
export const V0_1_1_BASE = "13f7f1c8f83efcfdca9f88904532fcfff717dfbe";

const TOP_CANDIDATE_LIMIT = 5;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function caseFor(
  cases: readonly QualityCaseResult[],
  taskId: string,
  systemId: SystemId,
  budget: number,
): QualityCaseResult {
  const result = cases.find((item) => item.taskId === taskId && item.systemId === systemId && item.budget === budget);
  if (result === undefined) throw new Error(`Missing frozen reference case: ${taskId}/${systemId}/${budget}`);
  return result;
}

function candidateFor(
  candidates: readonly BenchmarkCandidateDiagnostic[],
  path: string,
): BenchmarkCandidateDiagnostic | null {
  return candidates.find((candidate) => candidate.path === path) ?? null;
}

function compactCandidates(
  candidates: readonly BenchmarkCandidateDiagnostic[],
  task: BenchmarkTaskDefinition,
): readonly unknown[] {
  const requiredPaths = new Set(task.goldFiles.filter((item) => item.importance === "REQUIRED").map((item) => item.path));
  const requiredSymbols = new Set(task.goldSymbols.filter((item) => item.importance === "REQUIRED").map((item) => `${item.path}\0${item.qualifiedName}`));
  const selected = new Map<number, BenchmarkCandidateDiagnostic>();
  for (const candidate of candidates.slice(0, TOP_CANDIDATE_LIMIT)) selected.set(candidate.rank, candidate);
  for (const candidate of candidates) {
    if (
      requiredPaths.has(candidate.path) ||
      candidate.relevantSymbols.some((symbol) => requiredSymbols.has(`${candidate.path}\0${symbol}`))
    ) selected.set(candidate.rank, candidate);
  }
  return [...selected.values()].sort((left, right) => left.rank - right.rank).map((candidate) => ({
    rank: candidate.rank,
    path: candidate.path,
    score: candidate.score,
    category: candidate.category,
    origin: candidate.origin,
    requiredSymbolsMatched: candidate.relevantSymbols.filter((symbol) => requiredSymbols.has(`${candidate.path}\0${symbol}`)),
    evidenceKinds: candidate.evidenceKinds,
    evidenceFamilies: candidate.evidenceFamilies,
    reasons: candidate.reasons.slice(0, 3),
  }));
}

function selectedRangeProjection(selectedRanges: QualityCaseResult["selectedRanges"]): readonly unknown[] {
  return selectedRanges
    .map((item) => ({
      path: item.path,
      ranges: item.ranges
        .map((range) => ({
          startLine: range.startLine,
          endLine: range.endLine,
          reasons: [...range.reasons].sort(compareText),
        }))
        .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine),
    }))
    .sort((left, right) => compareText(left.path, right.path));
}

export function assertEightKReferenceAlignment(
  task: BenchmarkTaskDefinition,
  diagnostics: BenchmarkTaskDiagnostics,
  referenceCases: readonly QualityCaseResult[],
): void {
  const actualBySystem = new Map<SystemId, QualityCaseResult["selectedRanges"]>([
    ["lexical-full-file-v1", diagnostics.lexical.selectedRanges],
    ["structural-full-file-v1", diagnostics.structural.selectedRanges],
    ["contextforge-v1", diagnostics.contextforge.selectedItems.map((item) => ({ path: item.path, ranges: item.selectedRanges }))],
  ]);
  for (const systemId of actualBySystem.keys()) {
    const expected = selectedRangeProjection(caseFor(referenceCases, task.taskId, systemId, RETRIEVAL_ANALYSIS_BUDGET).selectedRanges);
    const actual = selectedRangeProjection(actualBySystem.get(systemId) ?? []);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`V1 reference alignment failed for ${task.taskId}/${systemId}: selected ranges differ.`);
    }
  }
}

export function summarizeTaskDiagnostics(
  task: BenchmarkTaskDefinition,
  diagnostics: BenchmarkTaskDiagnostics,
  referenceCases: readonly QualityCaseResult[],
): unknown {
  const lexicalAt8K = caseFor(referenceCases, task.taskId, "lexical-full-file-v1", RETRIEVAL_ANALYSIS_BUDGET);
  const structuralAt8K = caseFor(referenceCases, task.taskId, "structural-full-file-v1", RETRIEVAL_ANALYSIS_BUDGET);
  const contextforgeAt8K = caseFor(referenceCases, task.taskId, "contextforge-v1", RETRIEVAL_ANALYSIS_BUDGET);
  const packedItems = new Map(diagnostics.contextforge.selectedItems.map((item) => [item.path, item]));
  const droppedItems = new Map(diagnostics.contextforge.droppedCandidates.map((item) => [item.path, item]));
  const missedFiles = new Set(contextforgeAt8K.missedRequiredFiles);
  const missedSymbols = new Set(contextforgeAt8K.missedRequiredSymbols);

  const requiredFiles = task.goldFiles.filter((item) => item.importance === "REQUIRED").map((gold) => {
    const lexical = candidateFor(diagnostics.lexical.candidates, gold.path);
    const structural = candidateFor(diagnostics.structural.candidates, gold.path);
    const packed = packedItems.get(gold.path);
    const dropped = droppedItems.get(gold.path);
    const covered = !missedFiles.has(gold.path);
    return {
      path: gold.path,
      rationale: gold.rationale,
      lexicalRank: lexical?.rank ?? null,
      structuralRank: structural?.rank ?? null,
      structuralScore: structural?.score ?? null,
      structuralEvidenceKinds: structural?.evidenceKinds ?? [],
      packed: covered,
      selectedRole: packed?.role ?? null,
      dropReason: dropped?.reason ?? null,
      firstLostStage: covered
        ? null
        : structural === null
          ? "NOT_IN_PACK_INPUT_TOP_64"
          : dropped !== undefined
            ? "PACK_PLANNING"
            : "PACK_SELECTION",
      lastPresentStage: covered ? "SERIALIZED_CONTEXT" : structural === null ? "TASK_QUERY" : "RANKED_FILE",
    };
  });

  const requiredSymbols = task.goldSymbols.filter((item) => item.importance === "REQUIRED").map((gold) => {
    const identity = `${gold.path}#${gold.qualifiedName}`;
    const lexical = candidateFor(diagnostics.lexical.candidates, gold.path);
    const structural = candidateFor(diagnostics.structural.candidates, gold.path);
    const lexicalRelevant = lexical?.relevantSymbols.includes(gold.qualifiedName) ?? false;
    const structuralRelevant = structural?.relevantSymbols.includes(gold.qualifiedName) ?? false;
    const packed = packedItems.get(gold.path);
    const dropped = droppedItems.get(gold.path);
    const covered = !missedSymbols.has(identity);
    const firstLostStage = covered
      ? null
      : structural === null
        ? "NOT_IN_PACK_INPUT_TOP_64"
        : !structuralRelevant
          ? "SYMBOL_DISCOVERY"
          : packed === undefined
            ? "PACK_PLANNING"
            : "RANGE_SELECTION";
    const lastPresentStage = covered
      ? "SERIALIZED_CONTEXT"
      : structural === null
        ? "TASK_QUERY"
        : structuralRelevant
          ? packed === undefined ? "RANKED_SYMBOL" : "PACKED_FILE"
          : "RANKED_FILE";
    return {
      identity,
      rationale: gold.rationale,
      lexicalFileRank: lexical?.rank ?? null,
      lexicalRelevantSymbol: lexicalRelevant,
      structuralFileRank: structural?.rank ?? null,
      structuralRelevantSymbol: structuralRelevant,
      structuralEvidenceKinds: structural?.evidenceKinds ?? [],
      packed: covered,
      selectedRole: packed?.role ?? null,
      dropReason: dropped?.reason ?? null,
      firstLostStage,
      lastPresentStage,
    };
  });

  const metrics = (result: QualityCaseResult): unknown => ({
    requiredFileRecall: result.requiredFileRecall,
    requiredSymbolRecall: result.requiredSymbolRecall,
    goldRangePrecision: result.goldRangePrecision,
    noiseRatio: result.noiseRatio,
    payloadTokens: result.payloadTokens,
    selectedFiles: result.selectedFiles,
    failureAttribution: result.failureAttribution,
  });

  return {
    taskId: task.taskId,
    repositoryId: task.repositoryId,
    repositoryRevision: task.repositoryRevision,
    taskText: task.taskText,
    taskCategory: task.taskCategory,
    languageTags: task.languageTags,
    difficulty: task.difficulty,
    gold: {
      requiredFiles: task.goldFiles.filter((item) => item.importance === "REQUIRED"),
      supportingFiles: task.goldFiles.filter((item) => item.importance === "SUPPORTING"),
      requiredSymbols: task.goldSymbols.filter((item) => item.importance === "REQUIRED"),
      supportingSymbols: task.goldSymbols.filter((item) => item.importance === "SUPPORTING"),
      requiredRanges: task.goldRanges.filter((item) => item.importance === "REQUIRED"),
      supportingRanges: task.goldRanges.filter((item) => item.importance === "SUPPORTING"),
    },
    normalizedSignals: diagnostics.normalizedQuery.signals.map((signal) => ({
      kind: signal.kind,
      normalized: signal.normalized,
      source: signal.source,
      lowValue: signal.lowValue,
    })),
    indexStatus: diagnostics.indexStatus,
    topAndRequiredCandidates: {
      lexical: compactCandidates(diagnostics.lexical.candidates, task),
      structural: compactCandidates(diagnostics.structural.candidates, task),
    },
    requiredFiles,
    requiredSymbols,
    selectedAt8K: {
      lexical: metrics(lexicalAt8K),
      structural: metrics(structuralAt8K),
      contextforge: metrics(contextforgeAt8K),
    },
    contextforgePacking: {
      status: diagnostics.contextforge.status,
      requiredSelectedItems: diagnostics.contextforge.selectedItems.filter((item) =>
        requiredFiles.some((required) => required.path === item.path) || requiredSymbols.some((required) => required.identity.startsWith(`${item.path}#`)),
      ),
      requiredCandidateDrops: diagnostics.contextforge.droppedCandidates.filter((item) =>
        requiredFiles.some((required) => required.path === item.path) || requiredSymbols.some((required) => required.identity.startsWith(`${item.path}#`)),
      ),
      diagnostics: diagnostics.contextforge.diagnostics,
    },
    contextforgeBudgetTrace: referenceCases
      .filter((item) => item.taskId === task.taskId && item.systemId === "contextforge-v1")
      .sort((left, right) => left.budget - right.budget)
      .map((item) => ({
        budget: item.budget,
        requiredFileRecall: item.requiredFileRecall,
        requiredSymbolRecall: item.requiredSymbolRecall,
        goldRangePrecision: item.goldRangePrecision,
        payloadTokens: item.payloadTokens,
        failureAttribution: item.failureAttribution,
      })),
  };
}
