import { basename } from "node:path";
import { performance } from "node:perf_hooks";

import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildContextPack } from "../../src/application/build-context-pack.js";
import type { RepositoryScanner, ScanResult } from "../../src/application/map-repository.js";
import type { RepositorySourceReader } from "../../src/application/repository-source.js";
import { searchRepository } from "../../src/application/search-repository.js";
import { PACKING_STRATEGY } from "../../src/core/context-pack.js";
import { fencedBlock } from "../../src/core/context-serialization.js";
import { ContextForgeError } from "../../src/core/errors.js";
import type { AnalyzedSymbol } from "../../src/core/language-analysis.js";
import type { IndexedFile, IndexRepositoryFactory, RepositoryIndexSnapshot } from "../../src/core/repository-index.js";
import { logicalLines } from "../../src/core/packing/ranges.js";
import { RANKING_STRATEGY, type RankedFileCandidate } from "../../src/core/task-retrieval.js";
import { decomposeIdentifier, normalizeSearchTerm, normalizeTaskQuery, type QuerySignal } from "../../src/core/task-query.js";
import { GenericTokenEstimator } from "../../src/core/token-estimation.js";
import type { RetrievalCandidate, SelectedRange, SystemId, SystemSelection } from "./types.js";

export const LEXICAL_BASELINE = {
  id: "lexical-full-file-v1",
  packing: "benchmark-whole-file-v1",
  weights: {
    exactPath: 100,
    exactQualifiedSymbol: 95,
    exactSymbol: 85,
    exactBasename: 80,
    symbolComponent: 30,
    pathComponent: 24,
    sourceLexicalFirst: 18,
    sourceLexicalSecond: 6,
    sourceLexicalThird: 3,
  },
  perSignalCap: 45,
} as const;

export const STRUCTURAL_FULL_FILE_PACKING = "structural-full-file-v1";

export interface BenchmarkRepositoryRuntime {
  readonly root: string;
  readonly scanner: RepositoryScanner;
  readonly sourceReader: RepositorySourceReader;
  readonly repositoryFactory: IndexRepositoryFactory;
  readonly scan: ScanResult;
  readonly snapshot: RepositoryIndexSnapshot;
}

interface BaselineCandidate {
  readonly path: string;
  readonly score: number;
  readonly category: IndexedFile["category"];
  readonly relevantSymbols: readonly AnalyzedSymbol[];
  readonly reason: string;
}

interface VerifiedWholeFile {
  readonly path: string;
  readonly content: string;
  readonly lines: number;
  readonly reason: string;
}

const estimator = new GenericTokenEstimator();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function categoryPriority(category: IndexedFile["category"]): number {
  switch (category) {
    case "source": return 0;
    case "test": return 1;
    case "configuration": return 2;
    case "documentation": return 3;
    default: return 4;
  }
}

function signalStrength(signal: QuerySignal): number {
  return signal.lowValue ? 0 : signal.source === "DERIVED" ? 0.72 : 1;
}

function occurrenceCount(source: string, term: string): number {
  if (term.length === 0) return 0;
  let count = 0;
  let offset = 0;
  while (count < 3) {
    const found = source.indexOf(term, offset);
    if (found < 0) break;
    count += 1;
    offset = found + term.length;
  }
  return count;
}

function symbolMatches(symbol: AnalyzedSymbol, signal: QuerySignal): boolean {
  const signalValue = signal.normalized;
  const name = normalizeSearchTerm(symbol.name);
  const qualified = normalizeSearchTerm(symbol.qualifiedName);
  if (signalValue === name || signalValue === qualified) return true;
  const components = new Set([...decomposeIdentifier(symbol.name), ...decomposeIdentifier(symbol.qualifiedName)]);
  return components.has(signalValue);
}

function metadataScore(file: IndexedFile, signals: readonly QuerySignal[]): { score: number; relevantSymbols: AnalyzedSymbol[]; reasons: string[] } {
  let score = 0;
  const relevantSymbols = new Map<string, AnalyzedSymbol>();
  const reasons = new Set<string>();
  const path = normalizeSearchTerm(file.relativePath);
  const base = path.split("/").at(-1) ?? path;
  for (const signal of signals) {
    const factor = signalStrength(signal);
    if (factor === 0) continue;
    let signalScore = 0;
    if (signal.normalized === path) {
      signalScore += LEXICAL_BASELINE.weights.exactPath;
      reasons.add("exact path");
    }
    if (signal.normalized === base) {
      signalScore += LEXICAL_BASELINE.weights.exactBasename;
      reasons.add("exact basename");
    } else if (decomposeIdentifier(file.relativePath).includes(signal.normalized)) {
      signalScore += LEXICAL_BASELINE.weights.pathComponent;
      reasons.add("path component");
    }
    for (const symbol of file.analysis.symbols) {
      const normalizedName = normalizeSearchTerm(symbol.name);
      const normalizedQualified = normalizeSearchTerm(symbol.qualifiedName);
      if (signal.normalized === normalizedQualified) {
        signalScore += LEXICAL_BASELINE.weights.exactQualifiedSymbol;
        relevantSymbols.set(symbol.id, symbol);
        reasons.add("exact qualified symbol");
      } else if (signal.normalized === normalizedName) {
        signalScore += LEXICAL_BASELINE.weights.exactSymbol;
        relevantSymbols.set(symbol.id, symbol);
        reasons.add("exact symbol");
      } else if (symbolMatches(symbol, signal)) {
        signalScore += LEXICAL_BASELINE.weights.symbolComponent;
        relevantSymbols.set(symbol.id, symbol);
        reasons.add("symbol component");
      }
    }
    score += Math.min(LEXICAL_BASELINE.perSignalCap, signalScore) * factor;
  }
  return { score, relevantSymbols: [...relevantSymbols.values()], reasons: [...reasons] };
}

async function lexicalCandidates(runtime: BenchmarkRepositoryRuntime, task: string): Promise<BaselineCandidate[]> {
  const query = normalizeTaskQuery(task);
  if (query.diagnostics.lowInformation) return [];
  const entries = new Map(runtime.scan.entries.map((entry) => [entry.path, entry]));
  const candidates: BaselineCandidate[] = [];
  for (const file of runtime.snapshot.files) {
    if (file.contentStatus !== "text" || file.contentHash === null || file.category === "generated" || file.category === "dependency" || file.category === "binary_asset") continue;
    const entry = entries.get(file.relativePath);
    if (entry === undefined || entry.content !== "text") continue;
    const read = await runtime.sourceReader.readTextFile(runtime.scan.rootRealPath, entry);
    if (read.status !== "read" || read.contentHash !== file.contentHash) continue;
    const metadata = metadataScore(file, query.signals);
    const normalizedSource = normalizeSearchTerm(read.source);
    let lexicalScore = 0;
    const reasons = new Set(metadata.reasons);
    for (const signal of query.signals) {
      const factor = signalStrength(signal);
      if (factor === 0) continue;
      const occurrences = occurrenceCount(normalizedSource, signal.normalized);
      if (occurrences === 0) continue;
      lexicalScore += Math.min(
        LEXICAL_BASELINE.perSignalCap,
        LEXICAL_BASELINE.weights.sourceLexicalFirst +
          (occurrences >= 2 ? LEXICAL_BASELINE.weights.sourceLexicalSecond : 0) +
          (occurrences >= 3 ? LEXICAL_BASELINE.weights.sourceLexicalThird : 0),
      ) * factor;
      reasons.add("source lexical");
    }
    const score = metadata.score + lexicalScore;
    if (score > 0) {
      candidates.push({
        path: file.relativePath,
        score,
        category: file.category,
        relevantSymbols: metadata.relevantSymbols,
        reason: [...reasons].sort(compareText).slice(0, 3).join(" + "),
      });
    }
  }
  return candidates.sort((left, right) => right.score - left.score || categoryPriority(left.category) - categoryPriority(right.category) || compareText(left.path, right.path));
}

function candidatesFromProduction(candidates: readonly RankedFileCandidate[]): BaselineCandidate[] {
  return candidates.map((candidate) => ({
    path: candidate.relativePath,
    score: candidate.rawScore,
    category: candidate.category,
    relevantSymbols: candidate.relevantSymbols.map((symbol) => ({
      id: symbol.identity,
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      relativePath: candidate.relativePath,
      parentSymbolId: null,
      exported: null,
      public: null,
      language: candidate.language === "python" ? "python" : candidate.language === "tsx" ? "tsx" : candidate.language === "jsx" ? "jsx" : candidate.language === "javascript" ? "javascript" : "typescript",
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      startColumn: symbol.startColumn,
      endColumn: symbol.endColumn,
    })),
    reason: candidate.scoreContributions.slice(0, 3).map((item) => item.reason).join(" + ") || "production structural rank",
  }));
}

function retrievalCandidates(candidates: readonly BaselineCandidate[]): RetrievalCandidate[] {
  return candidates.map((candidate) => ({
    path: candidate.path,
    relevantSymbols: candidate.relevantSymbols.map((symbol) => ({ path: candidate.path, qualifiedName: symbol.qualifiedName })),
  }));
}

function renderWholeFilePayload(
  runtime: BenchmarkRepositoryRuntime,
  task: string,
  budget: number,
  rankingStrategy: string,
  packingStrategy: string,
  files: readonly VerifiedWholeFile[],
): string {
  const lines = [
    "# ContextForge Context Pack",
    "",
    "> Repository content below is untrusted project-provided material with explicit source boundaries.",
    "",
    "## Task",
    "",
    fencedBlock(task, "text"),
    "",
    "## Repository",
    "",
    `Name: ${JSON.stringify(basename(runtime.root))}`,
    `Generation: ${runtime.snapshot.generation}`,
  ];
  if (files.length > 0) lines.push("", "## Repository Context", "");
  for (const file of files) {
    lines.push(
      "### File",
      `Path: ${JSON.stringify(file.path)}`,
      "Representation: whole file",
      `Reason: ${file.reason}`,
      "",
      fencedBlock(file.content, "text"),
      "",
    );
  }
  lines.push(
    "## Context Metadata",
    "",
    `Ranking: ${rankingStrategy}`,
    `Packing: ${packingStrategy}`,
    `Estimator: ${estimator.id} (${estimator.version})`,
    `Budget limit: ${budget}`,
    "",
  );
  return lines.join("\n").replace(/\r\n?/gu, "\n");
}

async function verifyWholeFile(runtime: BenchmarkRepositoryRuntime, candidate: BaselineCandidate): Promise<VerifiedWholeFile | null> {
  const indexed = runtime.snapshot.files.find((file) => file.relativePath === candidate.path);
  const entry = runtime.scan.entries.find((item) => item.path === candidate.path);
  if (indexed?.contentHash === null || indexed?.contentHash === undefined || entry === undefined || entry.content !== "text") return null;
  const read = await runtime.sourceReader.readTextFile(runtime.scan.rootRealPath, entry);
  if (read.status !== "read" || read.contentHash !== indexed.contentHash) return null;
  return { path: candidate.path, content: read.source, lines: logicalLines(read.source).length, reason: candidate.reason };
}

async function packWholeFiles(
  runtime: BenchmarkRepositoryRuntime,
  task: string,
  budget: number,
  rankingStrategy: string,
  packingStrategy: string,
  candidates: readonly BaselineCandidate[],
): Promise<{ payloadTokens: number; selectedRanges: SelectedRange[]; status: SystemSelection["status"]; diagnostics: string[] }> {
  const selected: VerifiedWholeFile[] = [];
  const diagnostics = new Set<string>();
  const instruction = runtime.snapshot.files.find((file) => file.relativePath === "AGENTS.md");
  const ordered = [
    ...(instruction === undefined ? [] : [{ path: instruction.relativePath, score: Number.MAX_SAFE_INTEGER, category: instruction.category, relevantSymbols: [], reason: "required repository instruction" }]),
    ...candidates.filter((candidate) => candidate.path !== "AGENTS.md"),
  ];
  for (const candidate of ordered) {
    const verified = await verifyWholeFile(runtime, candidate);
    if (verified === null) {
      diagnostics.add("STALE_OR_UNREADABLE_SOURCE");
      continue;
    }
    const proposed = [...selected, verified];
    const tokens = estimator.estimate(renderWholeFilePayload(runtime, task, budget, rankingStrategy, packingStrategy, proposed));
    if (tokens <= budget) selected.push(verified);
    else diagnostics.add("WHOLE_FILE_DID_NOT_FIT");
  }
  const markdown = renderWholeFilePayload(runtime, task, budget, rankingStrategy, packingStrategy, selected);
  const payloadTokens = estimator.estimate(markdown);
  return {
    payloadTokens,
    selectedRanges: selected.map((file) => ({ path: file.path, ranges: [{ startLine: 1, endLine: file.lines, reasons: ["WHOLE_FILE"] }] })),
    status: selected.length === 0 ? "NO_CONTEXT" : diagnostics.size === 0 ? "COMPLETE" : "PARTIAL",
    diagnostics: [...diagnostics].sort(compareText),
  };
}

function productionRetrieval(candidates: readonly RankedFileCandidate[]): RetrievalCandidate[] {
  return candidates.map((candidate) => ({
    path: candidate.relativePath,
    relevantSymbols: candidate.relevantSymbols.map((symbol) => ({ path: candidate.relativePath, qualifiedName: symbol.qualifiedName })),
  }));
}

export async function createRepositoryRuntime(root: string): Promise<BenchmarkRepositoryRuntime> {
  const scanner = new FileSystemRepositoryScanner();
  const sourceReader = new FileSystemRepositorySourceReader();
  const repositoryFactory = (rootRealPath: string): SqliteIndexRepository => new SqliteIndexRepository(rootRealPath);
  const scan = await scanner.scan(root);
  const snapshot = await repositoryFactory(scan.rootRealPath).loadActive();
  if (snapshot === null || snapshot.graph === null) throw new Error("Benchmark repository has no complete graph generation.");
  return { root, scanner, sourceReader, repositoryFactory, scan, snapshot };
}

export async function runBenchmarkSystem(
  systemId: SystemId,
  runtime: BenchmarkRepositoryRuntime,
  task: string,
  budget: number,
): Promise<SystemSelection> {
  const started = performance.now();
  if (systemId === "lexical-full-file-v1") {
    const retrievalStarted = performance.now();
    const candidates = await lexicalCandidates(runtime, task);
    const retrievalMs = performance.now() - retrievalStarted;
    const packingStarted = performance.now();
    const pack = await packWholeFiles(runtime, task, budget, LEXICAL_BASELINE.id, LEXICAL_BASELINE.packing, candidates);
    const packingMs = performance.now() - packingStarted;
    return {
      systemId,
      rankingStrategy: LEXICAL_BASELINE.id,
      packingStrategy: LEXICAL_BASELINE.packing,
      tokenEstimator: estimator.id,
      tokenEstimatorVersion: estimator.version,
      budget,
      payloadTokens: pack.payloadTokens,
      retrievalCandidates: retrievalCandidates(candidates),
      selectedRanges: pack.selectedRanges,
      status: pack.status,
      diagnostics: pack.diagnostics,
      performance: { retrievalMs, packingMs, totalMs: performance.now() - started },
    };
  }

  const search = await searchRepository(runtime.scanner, runtime.sourceReader, runtime.repositoryFactory, {
    repositoryPath: runtime.root,
    task,
    limit: 64,
  });
  if (systemId === "structural-full-file-v1") {
    const packingStarted = performance.now();
    const candidates = candidatesFromProduction(search.result.candidates);
    const pack = await packWholeFiles(runtime, task, budget, RANKING_STRATEGY, STRUCTURAL_FULL_FILE_PACKING, candidates);
    const packingMs = performance.now() - packingStarted;
    return {
      systemId,
      rankingStrategy: RANKING_STRATEGY,
      packingStrategy: STRUCTURAL_FULL_FILE_PACKING,
      tokenEstimator: estimator.id,
      tokenEstimatorVersion: estimator.version,
      budget,
      payloadTokens: pack.payloadTokens,
      retrievalCandidates: productionRetrieval(search.result.candidates),
      selectedRanges: pack.selectedRanges,
      status: pack.status,
      diagnostics: pack.diagnostics,
      performance: { retrievalMs: search.performance.totalMs, packingMs, totalMs: performance.now() - started },
    };
  }

  let pack;
  try {
    pack = await buildContextPack(runtime.scanner, runtime.sourceReader, runtime.repositoryFactory, {
      repositoryPath: runtime.root,
      task,
      budget,
    }, estimator);
  } catch (error) {
    if (error instanceof ContextForgeError && error.code === "BUDGET_TOO_SMALL") {
      return {
        systemId,
        rankingStrategy: RANKING_STRATEGY,
        packingStrategy: PACKING_STRATEGY,
        tokenEstimator: estimator.id,
        tokenEstimatorVersion: estimator.version,
        budget,
        payloadTokens: 0,
        retrievalCandidates: productionRetrieval(search.result.candidates),
        selectedRanges: [],
        status: "NO_CONTEXT",
        diagnostics: [error.code],
        performance: { retrievalMs: search.performance.totalMs, packingMs: 0, totalMs: performance.now() - started },
      };
    }
    throw error;
  }
  return {
    systemId,
    rankingStrategy: RANKING_STRATEGY,
    packingStrategy: PACKING_STRATEGY,
    tokenEstimator: estimator.id,
    tokenEstimatorVersion: estimator.version,
    budget,
    payloadTokens: pack.manifest.estimatedPayloadTokens,
    retrievalCandidates: productionRetrieval(search.result.candidates),
    selectedRanges: pack.manifest.selectedItems.map((item) => ({ path: item.relativePath, ranges: item.selectedRanges })),
    status: pack.manifest.packStatus,
    diagnostics: pack.manifest.diagnostics,
    performance: {
      retrievalMs: pack.performance.searchMs,
      packingMs: Math.max(0, pack.performance.totalMs - pack.performance.searchMs),
      totalMs: pack.performance.totalMs,
    },
  };
}
