import { basename, posix } from "node:path";
import { performance } from "node:perf_hooks";

import type { RepositoryScanner, ScanResult } from "./map-repository.js";
import type { RepositorySourceReader } from "./repository-source.js";
import { fuseCandidateEvidenceV2 } from "../core/candidate-fusion-v2.js";
import { buildContextPlan } from "../core/context-plan-v2.js";
import { ContextForgeError } from "../core/errors.js";
import type { AnalyzedSymbol } from "../core/language-analysis.js";
import type { IndexedFile, IndexRepositoryFactory, RepositoryIndexSnapshot } from "../core/repository-index.js";
import type { GitFileSignal, GraphEdge } from "../core/repository-graph.js";
import {
  RETRIEVAL_V2,
  ambiguityFactor,
  hubDampingV2,
  identityWeight,
  lexicalEvidenceWeight,
  roundV2Score,
  scoreV2Evidence,
} from "../core/ranking/retrieval-v2.js";
import { analyzeTask, resolveTaskAnalysisAmbiguity, type TaskAnalysis, type TaskSignal } from "../core/task-analysis-v2.js";
import { decomposeIdentifier, normalizeSearchTerm } from "../core/task-query.js";
import {
  RETRIEVAL_V2_SCHEMA_VERSION,
  RETRIEVAL_V2_STRATEGY,
  createCandidateEvidenceV2,
  findNarrowestOwningSymbolV2,
  type CandidateEvidenceKindV2,
  type CandidateEvidenceV2,
  type RankedFileCandidateV2,
  type RetrievalV2Ablation,
  type SearchPerformanceV2,
  type SearchResultV2,
} from "../core/task-retrieval-v2.js";
import type { SearchIndexStatus } from "../core/task-retrieval.js";

export interface SearchRepositoryV2Request {
  readonly repositoryPath: string;
  readonly task: string;
  readonly limit?: number;
  readonly ablation?: RetrievalV2Ablation;
}

export interface SearchExecutionV2 {
  readonly result: SearchResultV2;
  readonly context: { readonly scan: ScanResult; readonly snapshot: RepositoryIndexSnapshot };
  readonly performance: SearchPerformanceV2;
}

interface SymbolReference {
  readonly file: IndexedFile;
  readonly symbol: AnalyzedSymbol;
}

interface MatchLocation {
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

interface LexicalFileEvidence {
  readonly file: IndexedFile;
  readonly evidence: readonly CandidateEvidenceV2[];
  readonly score: number;
}

interface Neighbor {
  readonly path: string;
  readonly kind: Extract<CandidateEvidenceKindV2, "FILE_IMPORTS_FILE" | "FILE_IMPORTED_BY" | "TEST_RELATION" | "DOCUMENT_RELATION">;
  readonly confidence: number;
  readonly edge: GraphEdge;
}

const SOURCE_TOKEN = /[\p{L}\p{N}_$@.-]+/gu;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key);
  if (values === undefined) map.set(key, [value]);
  else values.push(value);
}

function isSearchEligible(file: IndexedFile): boolean {
  return (
    file.contentStatus === "text" &&
    file.contentHash !== null &&
    file.category !== "generated" &&
    file.category !== "dependency" &&
    file.category !== "binary_asset"
  );
}

function ablationSettings(ablation: RetrievalV2Ablation): { readonly structural: boolean; readonly ambiguity: boolean; readonly ownership: boolean } {
  switch (ablation) {
    case "IDENTITY_LEXICAL": return { structural: false, ambiguity: false, ownership: false };
    case "IDENTITY_LEXICAL_STRUCTURAL": return { structural: true, ambiguity: false, ownership: false };
    case "IDENTITY_LEXICAL_STRUCTURAL_AMBIGUITY": return { structural: true, ambiguity: true, ownership: false };
    case "FULL": return { structural: true, ambiguity: true, ownership: true };
  }
}

function identityEvidence(
  matchKind: Extract<CandidateEvidenceKindV2, "EXACT_PATH" | "EXACT_BASENAME" | "EXACT_QUALIFIED_SYMBOL" | "EXACT_SYMBOL" | "AMBIGUOUS_SYMBOL" | "SYMBOL_COMPONENT" | "PATH_COMPONENT" | "IMPORT_MODULE">,
  family: CandidateEvidenceV2["family"],
  signal: TaskSignal,
  file: IndexedFile,
  symbol: AnalyzedSymbol | null,
  applyAmbiguity: boolean,
): CandidateEvidenceV2 {
  const target = symbol?.qualifiedName ?? file.relativePath;
  return createCandidateEvidenceV2({
    source: "IDENTITY",
    family,
    target: { file: file.relativePath, symbolId: symbol?.id ?? null },
    taskSignalId: signal.id,
    matchKind,
    confidence: matchKind === "AMBIGUOUS_SYMBOL" || matchKind === "SYMBOL_COMPONENT" || matchKind === "PATH_COMPONENT" || matchKind === "IMPORT_MODULE" ? 0.7 : 1,
    derivation: matchKind === "PATH_COMPONENT" || matchKind === "IMPORT_MODULE" ? "HEURISTIC" : "STRUCTURAL",
    location: symbol === null ? null : { startLine: symbol.startLine, endLine: symbol.endLine },
    sourceCandidate: null,
    relationshipId: null,
    graphDistance: 0,
    ambiguity: signal.ambiguity,
    rawFeature: signal.repositoryMatches,
    boundedContribution: identityWeight(matchKind, signal, applyAmbiguity),
    explanation: `${matchKind.toLowerCase().replaceAll("_", " ")} matched task signal ${signal.id} at ${target}.`,
  });
}

function buildIdentityEvidence(files: readonly IndexedFile[], analysis: TaskAnalysis, applyAmbiguity: boolean): CandidateEvidenceV2[] {
  const exactPaths = new Map<string, IndexedFile[]>();
  const basenames = new Map<string, IndexedFile[]>();
  const pathComponents = new Map<string, IndexedFile[]>();
  const symbolNames = new Map<string, SymbolReference[]>();
  const qualifiedSymbols = new Map<string, SymbolReference[]>();
  const symbolComponents = new Map<string, SymbolReference[]>();
  const importTerms = new Map<string, IndexedFile[]>();
  for (const file of files) {
    addMapValue(exactPaths, normalizeSearchTerm(file.relativePath), file);
    addMapValue(basenames, normalizeSearchTerm(posix.basename(file.relativePath)), file);
    for (const component of new Set(decomposeIdentifier(file.relativePath))) addMapValue(pathComponents, component, file);
    for (const symbol of file.analysis.symbols) {
      const reference = { file, symbol };
      addMapValue(symbolNames, normalizeSearchTerm(symbol.name), reference);
      addMapValue(qualifiedSymbols, normalizeSearchTerm(symbol.qualifiedName), reference);
      for (const component of new Set([...decomposeIdentifier(symbol.name), ...decomposeIdentifier(symbol.qualifiedName)])) addMapValue(symbolComponents, component, reference);
    }
    for (const imported of file.analysis.imports) {
      for (const term of new Set([normalizeSearchTerm(imported.moduleSpecifier), ...decomposeIdentifier(imported.moduleSpecifier)])) addMapValue(importTerms, term, file);
    }
  }
  const result: CandidateEvidenceV2[] = [];
  const take = <T>(values: readonly T[] | undefined): readonly T[] => (values ?? []).slice(0, RETRIEVAL_V2.retrieval.perSignalCandidateLimit);
  for (const signal of analysis.signals) {
    if (signal.lowValue) continue;
    if (signal.kind === "PATH") {
      for (const file of take(exactPaths.get(signal.normalized))) result.push(identityEvidence("EXACT_PATH", "IDENTITY", signal, file, null, applyAmbiguity));
    }
    if (signal.kind === "FILE_NAME" || signal.kind === "PATH") {
      for (const file of take(basenames.get(signal.normalized))) result.push(identityEvidence("EXACT_BASENAME", "IDENTITY", signal, file, null, applyAmbiguity));
    }
    if (signal.kind === "QUALIFIED_SYMBOL") {
      for (const reference of take(qualifiedSymbols.get(signal.normalized))) result.push(identityEvidence("EXACT_QUALIFIED_SYMBOL", "IDENTITY", signal, reference.file, reference.symbol, applyAmbiguity));
    }
    if (signal.kind === "SYMBOL" || signal.kind === "QUALIFIED_SYMBOL") {
      for (const reference of take(symbolNames.get(signal.normalized))) result.push(identityEvidence("EXACT_SYMBOL", "IDENTITY", signal, reference.file, reference.symbol, applyAmbiguity));
    } else if (signal.kind === "NATURAL_TERM") {
      for (const reference of take(symbolNames.get(signal.normalized))) result.push(identityEvidence("AMBIGUOUS_SYMBOL", "SYMBOL", signal, reference.file, reference.symbol, applyAmbiguity));
    }
    for (const reference of take(symbolComponents.get(signal.normalized))) result.push(identityEvidence("SYMBOL_COMPONENT", "SYMBOL", signal, reference.file, reference.symbol, applyAmbiguity));
    for (const file of take(pathComponents.get(signal.normalized))) result.push(identityEvidence("PATH_COMPONENT", "LEXICAL", signal, file, null, applyAmbiguity));
    for (const file of take(importTerms.get(signal.normalized))) result.push(identityEvidence("IMPORT_MODULE", "LEXICAL", signal, file, null, applyAmbiguity));
  }
  return result;
}

function matchLocation(line: string, lineNumber: number, startIndex: number, length: number): MatchLocation {
  return {
      startLine: lineNumber,
      endLine: lineNumber,
      startColumn: Buffer.byteLength(line.slice(0, startIndex), "utf8") + 1,
      endColumn: Buffer.byteLength(line.slice(0, startIndex + length), "utf8") + 1,
  };
}

function lexicalLocationsBySignal(source: string, signals: readonly TaskSignal[]): ReadonlyMap<string, readonly MatchLocation[]> {
  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const locations = new Map<string, MatchLocation[]>();
  const tokenSignals = new Map<string, TaskSignal[]>();
  const substringSignals: TaskSignal[] = [];
  for (const signal of signals) {
    if (signal.lowValue) continue;
    if (signal.kind === "CJK_TERM" || signal.kind === "PATH" || signal.normalized.includes(" ")) {
      substringSignals.push(signal);
    } else {
      addMapValue(tokenSignals, signal.normalized, signal);
    }
  }
  const add = (signal: TaskSignal, location: MatchLocation): void => {
    const previous = locations.get(signal.id) ?? [];
    if (previous.length >= 3) return;
    const identity = `${location.startLine}:${location.startColumn}:${location.endColumn}`;
    if (previous.some((item) => `${item.startLine}:${item.startColumn}:${item.endColumn}` === identity)) return;
    previous.push(location);
    locations.set(signal.id, previous);
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const match of line.matchAll(SOURCE_TOKEN)) {
      if (match.index === undefined) continue;
      const location = matchLocation(line, index + 1, match.index, match[0].length);
      for (const form of new Set([normalizeSearchTerm(match[0]), ...decomposeIdentifier(match[0])])) {
        for (const signal of tokenSignals.get(form) ?? []) add(signal, location);
      }
    }
    const normalized = line.toLowerCase();
    for (const signal of substringSignals) {
      if ((locations.get(signal.id)?.length ?? 0) >= 3) continue;
      let offset = 0;
      while ((locations.get(signal.id)?.length ?? 0) < 3 && signal.normalized.length > 0) {
        const found = normalized.indexOf(signal.normalized, offset);
        if (found < 0) break;
        add(signal, matchLocation(line, index + 1, found, signal.normalized.length));
        offset = found + signal.normalized.length;
      }
    }
  }
  return locations;
}

function lexicalEvidence(
  file: IndexedFile,
  signal: TaskSignal,
  locations: readonly MatchLocation[],
  applyAmbiguity: boolean,
): CandidateEvidenceV2[] {
  const first = locations[0];
  if (first === undefined) return [];
  const evidence: CandidateEvidenceV2[] = [createCandidateEvidenceV2({
    source: "VERIFIED_LEXICAL",
    family: "LEXICAL",
    target: { file: file.relativePath, symbolId: null },
    taskSignalId: signal.id,
    matchKind: "VERIFIED_LEXICAL",
    confidence: 1,
    derivation: "VERIFIED_SOURCE",
    location: { startLine: first.startLine, endLine: first.endLine },
    sourceCandidate: null,
    relationshipId: null,
    graphDistance: 0,
    ambiguity: signal.ambiguity,
    rawFeature: locations.length,
    boundedContribution: lexicalEvidenceWeight(signal, locations.length, applyAmbiguity),
    explanation: `generation-verified lexical evidence for task signal ${signal.id} in ${file.relativePath} (${locations.length} capped occurrence${locations.length === 1 ? "" : "s"}).`,
  })];
  const ownershipContribution = Math.min(
    RETRIEVAL_V2.weights.lexicalOwnership,
    lexicalEvidenceWeight(signal, locations.length, applyAmbiguity) * 0.5,
  );
  const owners = new Map<string, { readonly symbol: AnalyzedSymbol; readonly location: MatchLocation }>();
  for (const location of locations) {
    const owner = findNarrowestOwningSymbolV2(file.analysis, location);
    if (owner !== null && !owners.has(owner.id)) owners.set(owner.id, { symbol: owner, location });
  }
  for (const { symbol, location } of owners.values()) {
    evidence.push(createCandidateEvidenceV2({
      source: "SYMBOL_OWNERSHIP",
      family: "SYMBOL",
      target: { file: file.relativePath, symbolId: symbol.id },
      taskSignalId: signal.id,
      matchKind: "LEXICAL_SYMBOL_OWNERSHIP",
      confidence: 1,
      derivation: "STRUCTURAL",
      location: { startLine: location.startLine, endLine: location.endLine },
      sourceCandidate: null,
      relationshipId: null,
      graphDistance: 0,
      ambiguity: signal.ambiguity,
      rawFeature: symbol.qualifiedName,
      boundedContribution: roundV2Score(ownershipContribution),
      explanation: `verified lexical match for task signal ${signal.id} is owned by ${symbol.qualifiedName} in ${file.relativePath}.`,
    }));
  }
  return evidence;
}

function relationKind(edge: GraphEdge, fromPath: string): Neighbor["kind"] {
  if (edge.kind === "FILE_IMPORTS_FILE") return edge.sourcePath === fromPath ? "FILE_IMPORTS_FILE" : "FILE_IMPORTED_BY";
  return edge.kind === "TEST_RELATES_TO_FILE" ? "TEST_RELATION" : "DOCUMENT_RELATION";
}

function relationFactor(kind: Neighbor["kind"]): number {
  return RETRIEVAL_V2.expansion.relationFactors[kind];
}

function graphAdjacency(edges: readonly GraphEdge[]): Map<string, Neighbor[]> {
  const adjacency = new Map<string, Neighbor[]>();
  for (const edge of edges) {
    for (const [fromPath, toPath] of [[edge.sourcePath, edge.targetPath], [edge.targetPath, edge.sourcePath]] as const) {
      const item: Neighbor = { path: toPath, kind: relationKind(edge, fromPath), confidence: edge.confidence, edge };
      const previous = adjacency.get(fromPath);
      if (previous === undefined) adjacency.set(fromPath, [item]);
      else previous.push(item);
    }
  }
  for (const neighbors of adjacency.values()) neighbors.sort((left, right) => relationFactor(right.kind) - relationFactor(left.kind) || compareText(left.path, right.path) || compareText(left.edge.id, right.edge.id));
  return adjacency;
}

function expandStructuralEvidence(
  primary: readonly RankedFileCandidateV2[],
  files: ReadonlyMap<string, IndexedFile>,
  edges: readonly GraphEdge[],
): { readonly evidence: CandidateEvidenceV2[]; readonly expandedPaths: ReadonlySet<string>; readonly truncated: boolean } {
  const adjacency = graphAdjacency(edges);
  const seeds = primary.filter((candidate) => candidate.priorityTier <= 3).slice(0, RETRIEVAL_V2.expansion.maximumPrimarySeeds);
  const evidence: CandidateEvidenceV2[] = [];
  const expandedPaths = new Set<string>();
  let truncated = false;
  for (const seed of seeds) {
    const queue: { readonly path: string; readonly depth: number }[] = [{ path: seed.relativePath, depth: 0 }];
    const bestDepth = new Map<string, number>([[seed.relativePath, 0]]);
    const traversed = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || current.depth >= RETRIEVAL_V2.expansion.maximumDepth) continue;
      const allNeighbors = adjacency.get(current.path) ?? [];
      if (allNeighbors.length > RETRIEVAL_V2.expansion.maximumNeighborsPerNode) truncated = true;
      for (const neighbor of allNeighbors.slice(0, RETRIEVAL_V2.expansion.maximumNeighborsPerNode)) {
        const distance = current.depth + 1;
        if (neighbor.path === seed.relativePath || !files.has(neighbor.path)) continue;
        const visit = `${current.path}\u0000${neighbor.path}\u0000${neighbor.edge.id}`;
        if (traversed.has(visit)) continue;
        traversed.add(visit);
        if (!primary.some((candidate) => candidate.relativePath === neighbor.path) && !expandedPaths.has(neighbor.path)) {
          if (expandedPaths.size >= RETRIEVAL_V2.expansion.globalExpandedCandidateLimit) {
            truncated = true;
            continue;
          }
          expandedPaths.add(neighbor.path);
        }
        const degree = adjacency.get(neighbor.path)?.length ?? 0;
        const decay = RETRIEVAL_V2.expansion.distanceDecay[distance] ?? 0;
        const contribution = Math.min(
          RETRIEVAL_V2.familyCaps.STRUCTURAL,
          seed.rawScore * RETRIEVAL_V2.expansion.inheritedScoreFactor * decay * relationFactor(neighbor.kind) * neighbor.confidence * hubDampingV2(degree),
        );
        evidence.push(createCandidateEvidenceV2({
          source: neighbor.kind === "TEST_RELATION" || neighbor.kind === "DOCUMENT_RELATION" ? "TEST_DOCUMENTATION" : "FILE_STRUCTURAL",
          family: "STRUCTURAL",
          target: { file: neighbor.path, symbolId: null },
          taskSignalId: null,
          matchKind: neighbor.kind,
          confidence: neighbor.confidence,
          derivation: neighbor.edge.derivation === "structural" ? "STRUCTURAL" : "HEURISTIC",
          location: null,
          sourceCandidate: seed.relativePath,
          relationshipId: neighbor.edge.id,
          graphDistance: distance,
          ambiguity: "NOT_APPLICABLE",
          rawFeature: neighbor.kind,
          boundedContribution: roundV2Score(contribution),
          explanation: `${neighbor.kind.toLowerCase().replaceAll("_", " ")} supports ${neighbor.path} from seed ${seed.relativePath} at graph distance ${distance}.`,
        }));
        const previousDepth = bestDepth.get(neighbor.path);
        if (previousDepth === undefined || distance < previousDepth) {
          bestDepth.set(neighbor.path, distance);
          queue.push({ path: neighbor.path, depth: distance });
        }
      }
    }
  }
  return { evidence, expandedPaths, truncated };
}

function gitEvidence(candidates: readonly RankedFileCandidateV2[], signals: readonly GitFileSignal[]): CandidateEvidenceV2[] {
  const candidatePaths = new Set(candidates.map((candidate) => candidate.relativePath));
  const evidence: CandidateEvidenceV2[] = [];
  for (const signal of signals) {
    if (!candidatePaths.has(signal.relativePath)) continue;
    if (signal.workingTreeStatus !== "clean" && signal.workingTreeStatus !== "deleted") {
      evidence.push(createCandidateEvidenceV2({
        source: "GIT", family: "GIT", target: { file: signal.relativePath, symbolId: null }, taskSignalId: null,
        matchKind: "GIT_DIRTY", confidence: 1, derivation: "STRUCTURAL", location: null, sourceCandidate: null,
        relationshipId: null, graphDistance: 0, ambiguity: "NOT_APPLICABLE", rawFeature: signal.workingTreeStatus,
        boundedContribution: RETRIEVAL_V2.weights.gitDirty, explanation: `weak Git working-tree signal for ${signal.relativePath}.`,
      }));
    }
    if (signal.recentCommitCount > 0) {
      evidence.push(createCandidateEvidenceV2({
        source: "GIT", family: "GIT", target: { file: signal.relativePath, symbolId: null }, taskSignalId: null,
        matchKind: "GIT_RECENCY", confidence: 1, derivation: "STRUCTURAL", location: null, sourceCandidate: null,
        relationshipId: null, graphDistance: 0, ambiguity: "NOT_APPLICABLE", rawFeature: signal.recentCommitCount,
        boundedContribution: Math.min(RETRIEVAL_V2.weights.gitRecencyMaximum, Math.log2(1 + signal.recentCommitCount)),
        explanation: `weak bounded Git recency signal for ${signal.relativePath}.`,
      }));
    }
  }
  return evidence;
}

function indexStatus(
  added: ReadonlySet<string>,
  deleted: ReadonlySet<string>,
  changed: ReadonlySet<string>,
  lexicalSkippedFiles: number,
  verificationIncomplete: boolean,
): SearchIndexStatus {
  const stalePaths = [...new Set([...added, ...deleted, ...changed])].sort(compareText);
  return {
    status: stalePaths.length > 0 ? "STALE" : verificationIncomplete ? "PARTIAL" : "FRESH",
    changedFiles: stalePaths.length,
    addedFiles: added.size,
    deletedFiles: deleted.size,
    lexicalSkippedFiles,
    stalePaths,
  };
}

function scoreTieCount(candidates: readonly RankedFileCandidateV2[], limit: number): number {
  const counts = new Map<number, number>();
  for (const candidate of candidates.slice(0, limit)) counts.set(candidate.rawScore, (counts.get(candidate.rawScore) ?? 0) + 1);
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

async function executeSearchRepositoryV2(
  scanner: RepositoryScanner,
  sourceReader: RepositorySourceReader,
  repositoryFactory: IndexRepositoryFactory,
  request: SearchRepositoryV2Request,
): Promise<SearchExecutionV2> {
  const totalStarted = performance.now();
  const ablation = request.ablation ?? "FULL";
  const settings = ablationSettings(ablation);
  const analysisStarted = performance.now();
  const initialAnalysis = analyzeTask(request.task);
  const taskAnalysisInitialMs = performance.now() - analysisStarted;
  const limit = request.limit ?? RETRIEVAL_V2.cli.defaultLimit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > RETRIEVAL_V2.cli.maximumLimit) {
    throw new ContextForgeError("INVALID_TASK", `Search limit must be an integer from 1 to ${RETRIEVAL_V2.cli.maximumLimit}.`);
  }
  const scan = await scanner.scan(request.repositoryPath);
  const active = await repositoryFactory(scan.rootRealPath).loadActive();
  if (active === null) throw new ContextForgeError("INDEX_REQUIRED", "No active ContextForge index exists. Run 'contextforge index .' first.");
  if (active.graph === null) throw new ContextForgeError("INDEX_REQUIRED", "The active index predates Repository Graph support. Run 'contextforge index .' again.");
  const eligibleFiles = active.files.filter(isSearchEligible);
  const analysisResolutionStarted = performance.now();
  const taskAnalysis = resolveTaskAnalysisAmbiguity(initialAnalysis, eligibleFiles);
  const taskAnalysisMs = taskAnalysisInitialMs + performance.now() - analysisResolutionStarted;
  const planStarted = performance.now();
  const contextPlan = buildContextPlan(taskAnalysis);
  const contextPlanMs = performance.now() - planStarted;
  const lowInformation = taskAnalysis.diagnostics.includes("TASK_LOW_INFORMATION");

  const fileByPath = new Map(eligibleFiles.map((file) => [file.relativePath, file]));
  const currentEntries = scan.entries
    .filter((entry) => (entry.type === "file" || entry.type === "symlink") && entry.skipReason !== "symlink_directory")
    .sort((left, right) => compareText(left.path, right.path));
  const currentByPath = new Map(currentEntries.map((entry) => [entry.path, entry]));
  const currentPaths = new Set(currentByPath.keys());
  const indexedPaths = new Set(active.files.map((file) => file.relativePath));
  const added = new Set([...currentPaths].filter((path) => !indexedPaths.has(path)));
  const deleted = new Set([...indexedPaths].filter((path) => !currentPaths.has(path)));

  const identityStarted = performance.now();
  const identity = lowInformation ? [] : buildIdentityEvidence(eligibleFiles, taskAnalysis, settings.ambiguity);
  const identityMs = performance.now() - identityStarted;

  const lexicalStarted = performance.now();
  const changed = new Set<string>();
  for (const file of active.files) {
    const current = currentByPath.get(file.relativePath);
    if (current !== undefined && (current.content !== file.contentStatus || current.size !== file.size)) changed.add(file.relativePath);
  }
  const lexicalFiles: LexicalFileEvidence[] = [];
  let lexicalFilesScanned = 0;
  let lexicalBytesScanned = 0;
  let lexicalSkippedFiles = [...changed, ...deleted].filter((path) => fileByPath.get(path)?.contentStatus === "text").length;
  let lexicalTruncated = false;
  let ownershipSuccesses = 0;
  let ownershipFallbacks = 0;
  const identityPaths = new Set(identity.map((item) => item.target.file));
  const orderedLexicalFiles = eligibleFiles
    .filter((file) => currentByPath.get(file.relativePath)?.content === "text")
    .sort((left, right) => Number(identityPaths.has(right.relativePath)) - Number(identityPaths.has(left.relativePath)) || compareText(left.relativePath, right.relativePath));
  for (const file of orderedLexicalFiles) {
    const entry = currentByPath.get(file.relativePath);
    if (entry === undefined) continue;
    if (
      lexicalFilesScanned >= RETRIEVAL_V2.retrieval.maximumLexicalFiles ||
      lexicalBytesScanned + (entry.size ?? 0) > RETRIEVAL_V2.retrieval.maximumLexicalBytes
    ) {
      lexicalTruncated = true;
      lexicalSkippedFiles += 1;
      continue;
    }
    const source = await sourceReader.readTextFile(scan.rootRealPath, entry);
    if (source.status !== "read" || source.contentHash !== file.contentHash) {
      if (!changed.has(file.relativePath)) lexicalSkippedFiles += 1;
      changed.add(file.relativePath);
      continue;
    }
    lexicalFilesScanned += 1;
    lexicalBytesScanned += source.size;
    if (lowInformation) continue;
    const items: CandidateEvidenceV2[] = [];
    const locationsBySignal = lexicalLocationsBySignal(source.source, taskAnalysis.signals);
    for (const signal of taskAnalysis.signals) {
      if (signal.lowValue) continue;
      const locations = locationsBySignal.get(signal.id) ?? [];
      if (locations.length === 0) continue;
      const signalEvidence = lexicalEvidence(file, signal, locations, settings.ambiguity);
      const ownerCount = signalEvidence.filter((item) => item.matchKind === "LEXICAL_SYMBOL_OWNERSHIP").length;
      if (ownerCount > 0) ownershipSuccesses += ownerCount;
      else ownershipFallbacks += 1;
      items.push(...signalEvidence.filter((item) => settings.ownership || item.matchKind !== "LEXICAL_SYMBOL_OWNERSHIP"));
    }
    if (items.length > 0) {
      const bounded = items.slice(0, RETRIEVAL_V2.retrieval.maximumSignalsPerLexicalFile * 2);
      lexicalFiles.push({ file, evidence: bounded, score: scoreV2Evidence(bounded).rawScore });
    }
  }
  lexicalFiles.sort((left, right) => right.score - left.score || compareText(left.file.relativePath, right.file.relativePath));
  if (lexicalFiles.length > RETRIEVAL_V2.retrieval.maximumLexicalCandidates) lexicalTruncated = true;
  const lexical = lexicalFiles.slice(0, RETRIEVAL_V2.retrieval.maximumLexicalCandidates).flatMap((item) => item.evidence);
  const lexicalMs = performance.now() - lexicalStarted;

  const firstFusionStarted = performance.now();
  const firstFusion = fuseCandidateEvidenceV2(eligibleFiles, [...identity, ...lexical], active.generation);
  const primary = firstFusion.candidates.slice(0, RETRIEVAL_V2.retrieval.primaryCandidateLimit);
  const fusionFirstMs = performance.now() - firstFusionStarted;

  const expansionStarted = performance.now();
  const expanded = settings.structural
    ? expandStructuralEvidence(primary, fileByPath, active.graph.edges)
    : { evidence: [] as CandidateEvidenceV2[], expandedPaths: new Set<string>() as ReadonlySet<string>, truncated: false };
  const graphExpansionMs = performance.now() - expansionStarted;

  const rankingStarted = performance.now();
  const preGitFusion = fuseCandidateEvidenceV2(eligibleFiles, [...identity, ...lexical, ...expanded.evidence], active.generation);
  const git = active.graph.git.status === "available" ? gitEvidence(preGitFusion.candidates, active.graph.git.files) : [];
  const finalFusion = fuseCandidateEvidenceV2(eligibleFiles, [...identity, ...lexical, ...expanded.evidence, ...git], active.generation);
  const finalRanked = finalFusion.candidates.slice(0, RETRIEVAL_V2.expansion.finalCandidateLimit);
  const rankingMs = performance.now() - rankingStarted;
  const fusionMs = fusionFirstMs;
  const status = indexStatus(added, deleted, changed, lexicalSkippedFiles, lexicalTruncated);
  const ambiguousSignalIds = new Set(taskAnalysis.signals.filter((signal) => signal.ambiguity === "COLLIDING").map((signal) => signal.id));
  const ambiguityDiscounts = settings.ambiguity
    ? new Set([...identity, ...lexical].filter((item) => item.taskSignalId !== null && ambiguousSignalIds.has(item.taskSignalId) && item.ambiguity === "COLLIDING" && ambiguityFactor("COLLIDING", Number(item.rawFeature) || 2, true) < 1).map((item) => item.taskSignalId)).size
    : 0;
  const capEvents = finalFusion.capEvents;
  const diagnostics = [
    ...taskAnalysis.diagnostics,
    ...contextPlan.diagnostics,
    ...(status.status === "STALE" ? ["INDEX_STALE"] : []),
    ...(changed.size > 0 ? ["LEXICAL_SOURCE_STALE"] : []),
    ...(lexicalTruncated ? ["LEXICAL_SCAN_TRUNCATED"] : []),
    ...(expanded.truncated ? ["GRAPH_EXPANSION_TRUNCATED"] : []),
    ...(ownershipFallbacks > 0 ? [`LEXICAL_OWNERSHIP_FALLBACK:${ownershipFallbacks}`] : []),
    ...(ambiguityDiscounts > 0 ? [`AMBIGUITY_DISCOUNT_APPLIED:${ambiguityDiscounts}`] : []),
    ...(capEvents > 0 ? [`CANDIDATE_EVIDENCE_CAP:${capEvents}`] : []),
  ].sort(compareText);
  const result = {
    schemaVersion: RETRIEVAL_V2_SCHEMA_VERSION,
    task: request.task,
    repository: { name: basename(scan.rootRealPath), root: "." as const },
    generation: active.generation,
    rankingStrategy: RETRIEVAL_V2_STRATEGY,
    ablation,
    indexStatus: status,
    taskAnalysis,
    contextPlan,
    normalizedQuery: {
      schemaVersion: taskAnalysis.schemaVersion,
      queryVersion: taskAnalysis.strategy,
      byteLength: Buffer.byteLength(request.task, "utf8"),
      signals: taskAnalysis.signals,
      diagnostics: {
        lowInformation,
        controlCharacters: taskAnalysis.diagnostics.includes("TASK_CONTROL_CHARACTERS_REMOVED") ? 1 : 0,
      },
    },
    candidates: finalRanked.slice(0, limit),
    diagnostics,
    counts: {
      identityEvidence: identity.length,
      lexicalEvidence: lexical.filter((item) => item.matchKind === "VERIFIED_LEXICAL").length,
      ownershipEvidence: lexical.filter((item) => item.matchKind === "LEXICAL_SYMBOL_OWNERSHIP").length,
      structuralEvidence: expanded.evidence.length,
      fusedCandidates: finalRanked.length,
      expandedCandidates: expanded.expandedPaths.size,
      ambiguityDiscounts,
      lexicalOwnershipSuccesses: ownershipSuccesses,
      lexicalOwnershipFallbacks: ownershipFallbacks,
      lexicalFilesScanned,
      lexicalBytesScanned,
      top5ScoreTies: scoreTieCount(finalRanked, 5),
      top10ScoreTies: scoreTieCount(finalRanked, 10),
      evidenceCapEvents: capEvents,
    },
  } as const;
  return {
    result,
    context: { scan, snapshot: active },
    performance: {
      taskAnalysisMs,
      contextPlanMs,
      identityMs,
      lexicalMs,
      fusionMs,
      graphExpansionMs,
      rankingMs,
      totalMs: performance.now() - totalStarted,
    },
  };
}

export async function searchRepositoryV2(
  scanner: RepositoryScanner,
  sourceReader: RepositorySourceReader,
  repositoryFactory: IndexRepositoryFactory,
  request: SearchRepositoryV2Request,
): Promise<SearchExecutionV2> {
  try {
    return await executeSearchRepositoryV2(scanner, sourceReader, repositoryFactory, request);
  } catch (error) {
    if (error instanceof ContextForgeError) throw error;
    throw new ContextForgeError("SEARCH_FAILED", "Repository retrieval v2 failed without changing the active index.", { cause: error });
  }
}

export type SearchRepositoryV2Context = { readonly scan: ScanResult; readonly snapshot: RepositoryIndexSnapshot };
