import { basename, posix } from "node:path";
import { performance } from "node:perf_hooks";

import type { RepositoryScanner, ScanResult } from "./map-repository.js";
import type { RepositorySourceReader } from "./repository-source.js";
import { ContextForgeError } from "../core/errors.js";
import type { AnalyzedSymbol } from "../core/language-analysis.js";
import type { IndexedFile, IndexRepositoryFactory, RepositoryIndexSnapshot } from "../core/repository-index.js";
import type { GraphEdge, GitFileSignal } from "../core/repository-graph.js";
import {
  STRUCTURAL_V1,
  deduplicateEvidence,
  hubDamping,
  roundScore,
  scoreEvidence,
} from "../core/ranking/structural-v1.js";
import {
  RANKING_STRATEGY,
  SEARCH_SCHEMA_VERSION,
  type CandidateEvidence,
  type CandidateEvidenceKind,
  type CandidateOrigin,
  type RankedFileCandidate,
  type RelevantSymbol,
  type SearchExecution,
  type SearchIndexStatus,
  type SearchResult,
} from "../core/task-retrieval.js";
import {
  decomposeIdentifier,
  normalizeSearchTerm,
  normalizeTaskQuery,
  type QuerySignal,
} from "../core/task-query.js";

export interface SearchRepositoryRequest {
  readonly repositoryPath: string;
  readonly task: string;
  readonly limit?: number;
}

export interface SearchRepositoryExecution extends SearchExecution {
  /** Internal application context; never serialized by the Search CLI contract. */
  readonly context: {
    readonly scan: ScanResult;
    readonly snapshot: RepositoryIndexSnapshot;
  };
}

interface SymbolReference {
  readonly file: IndexedFile;
  readonly symbol: AnalyzedSymbol;
}

interface CandidateBuilder {
  readonly file: IndexedFile;
  readonly directEvidence: CandidateEvidence[];
  readonly expansionEvidence: CandidateEvidence[];
  readonly symbolEvidence: Map<string, { readonly symbol: AnalyzedSymbol; readonly evidence: CandidateEvidence[] }>;
  readonly gitEvidence: CandidateEvidence[];
  graphDistance: number | null;
}

interface Neighbor {
  readonly path: string;
  readonly kind: Extract<CandidateEvidenceKind, "FILE_IMPORTS_FILE" | "FILE_IMPORTED_BY" | "TEST_RELATION" | "DOCUMENT_RELATION">;
  readonly confidence: number;
  readonly edge: GraphEdge;
}

interface LexicalMatch {
  readonly file: IndexedFile;
  readonly evidence: readonly CandidateEvidence[];
  readonly score: number;
}

const SOURCE_TOKEN = /[\p{L}\p{N}_$@.-]+/gu;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
  const previous = map.get(key);
  if (previous === undefined) map.set(key, [value]);
  else previous.push(value);
}

function evidence(
  kind: CandidateEvidenceKind,
  family: CandidateEvidence["family"],
  signal: QuerySignal | null,
  target: string,
  weight: number,
  detail: string,
  graphDistance = 0,
  sourceCandidate: string | null = null,
): CandidateEvidence {
  return {
    kind,
    family,
    querySignal: signal?.value ?? null,
    target,
    weight: roundScore(weight),
    graphDistance,
    sourceCandidate,
    detail,
  };
}

function signalFactor(signal: QuerySignal): number {
  if (signal.lowValue) return 0;
  return signal.source === "DERIVED" ? 0.72 : 1;
}

function originFor(builder: CandidateBuilder): CandidateOrigin {
  if (builder.directEvidence.length > 0 && builder.expansionEvidence.length > 0) return "DIRECT_AND_EXPANDED";
  return builder.directEvidence.length > 0 ? "DIRECT" : "EXPANDED";
}

function categoryPriority(file: Pick<IndexedFile, "category">): number {
  switch (file.category) {
    case "source": return 0;
    case "test": return 1;
    case "configuration": return 2;
    case "documentation": return 3;
    default: return 4;
  }
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

function originPriority(origin: CandidateOrigin): number {
  switch (origin) {
    case "DIRECT_AND_EXPANDED": return 0;
    case "DIRECT": return 1;
    case "EXPANDED": return 2;
  }
}

function compareRanked(left: RankedFileCandidate, right: RankedFileCandidate): number {
  return (
    right.rawScore - left.rawScore ||
    originPriority(left.origin) - originPriority(right.origin) ||
    categoryPriority(left) - categoryPriority(right) ||
    compareText(left.relativePath, right.relativePath)
  );
}

function sourceTermCounts(source: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of source.matchAll(SOURCE_TOKEN)) {
    const full = normalizeSearchTerm(match[0]);
    const forms = new Set([full, ...decomposeIdentifier(match[0])]);
    for (const form of forms) counts.set(form, Math.min(3, (counts.get(form) ?? 0) + 1));
  }
  return counts;
}

function substringCount(source: string, term: string): number {
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

function lexicalCount(normalizedSource: string, termCounts: Map<string, number>, signal: QuerySignal): number {
  if (signal.kind === "CJK_TERM" || signal.normalized.includes(" ") || signal.kind === "PATH") {
    return substringCount(normalizedSource, signal.normalized);
  }
  return termCounts.get(signal.normalized) ?? 0;
}

function lexicalWeight(signal: QuerySignal, count: number): number {
  const technical = new Set<QuerySignal["kind"]>([
    "CODE_LITERAL",
    "DOTTED_IDENTIFIER",
    "ERROR_LITERAL",
    "FILE_NAME",
    "PATH",
    "QUALIFIED_IDENTIFIER",
  ]).has(signal.kind);
  if (technical) return STRUCTURAL_V1.weights.exactTechnicalLexical * signalFactor(signal);
  const repeated =
    STRUCTURAL_V1.weights.sourceLexicalFirst +
    (count >= 2 ? STRUCTURAL_V1.weights.sourceLexicalSecond : 0) +
    (count >= 3 ? STRUCTURAL_V1.weights.sourceLexicalThird : 0);
  return repeated * signalFactor(signal);
}

function makeBuilder(file: IndexedFile): CandidateBuilder {
  return {
    file,
    directEvidence: [],
    expansionEvidence: [],
    symbolEvidence: new Map(),
    gitEvidence: [],
    graphDistance: null,
  };
}

function addDirect(
  candidates: Map<string, CandidateBuilder>,
  file: IndexedFile,
  item: CandidateEvidence,
  symbol: AnalyzedSymbol | null = null,
): void {
  const builder = candidates.get(file.relativePath) ?? makeBuilder(file);
  candidates.set(file.relativePath, builder);
  builder.directEvidence.push(item);
  if (symbol !== null) {
    const previous = builder.symbolEvidence.get(symbol.id) ?? { symbol, evidence: [] };
    previous.evidence.push(item);
    builder.symbolEvidence.set(symbol.id, previous);
  }
}

function addExpansion(candidates: Map<string, CandidateBuilder>, file: IndexedFile, item: CandidateEvidence): void {
  const builder = candidates.get(file.relativePath) ?? makeBuilder(file);
  candidates.set(file.relativePath, builder);
  if (builder.expansionEvidence.length < STRUCTURAL_V1.expansion.maximumExpansionEvidencePerCandidate) {
    builder.expansionEvidence.push(item);
  }
  builder.graphDistance = builder.graphDistance === null ? item.graphDistance : Math.min(builder.graphDistance, item.graphDistance);
}

function relevantSymbols(builder: CandidateBuilder): RelevantSymbol[] {
  return [...builder.symbolEvidence.values()]
    .map(({ symbol, evidence: items }) => ({
      identity: symbol.id,
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      startColumn: symbol.startColumn,
      endColumn: symbol.endColumn,
      evidence: deduplicateEvidence(items),
    }))
    .sort((left, right) => {
      const leftWeight = Math.max(0, ...left.evidence.map((item) => item.weight));
      const rightWeight = Math.max(0, ...right.evidence.map((item) => item.weight));
      return rightWeight - leftWeight || compareText(left.qualifiedName, right.qualifiedName) || left.startLine - right.startLine || compareText(left.identity, right.identity);
    })
    .slice(0, STRUCTURAL_V1.retrieval.maximumRelevantSymbolsPerCandidate);
}

function trimDirectEvidence(candidates: Map<string, CandidateBuilder>): void {
  for (const builder of candidates.values()) {
    const bounded = deduplicateEvidence(builder.directEvidence).slice(0, STRUCTURAL_V1.retrieval.maximumDirectEvidencePerCandidate);
    builder.directEvidence.splice(0, builder.directEvidence.length, ...bounded);
    for (const symbol of builder.symbolEvidence.values()) {
      const symbolEvidence = deduplicateEvidence(symbol.evidence).slice(0, 16);
      symbol.evidence.splice(0, symbol.evidence.length, ...symbolEvidence);
    }
  }
}

function rankBuilder(builder: CandidateBuilder, generation: number): RankedFileCandidate {
  const directEvidence = deduplicateEvidence(builder.directEvidence);
  const expansionEvidence = deduplicateEvidence(builder.expansionEvidence);
  const scored = scoreEvidence([...directEvidence, ...expansionEvidence, ...builder.gitEvidence]);
  const rawScore = roundScore(scored.rawScore);
  return {
    identity: `file:${builder.file.relativePath}`,
    relativePath: builder.file.relativePath,
    category: builder.file.category,
    language: builder.file.analysis.language,
    origin: originFor(builder),
    directEvidence,
    expansionEvidence,
    scoreContributions: scored.contributions,
    score: rawScore,
    rawScore,
    graphDistance: builder.graphDistance,
    rankingStrategy: RANKING_STRATEGY,
    generation,
    relevantSymbols: relevantSymbols(builder),
  };
}

function buildDirectCandidates(files: readonly IndexedFile[], signals: readonly QuerySignal[]): Map<string, CandidateBuilder> {
  const candidates = new Map<string, CandidateBuilder>();
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
      for (const component of new Set([...decomposeIdentifier(symbol.name), ...decomposeIdentifier(symbol.qualifiedName)])) {
        addMapValue(symbolComponents, component, reference);
      }
    }
    for (const imported of file.analysis.imports) {
      for (const term of new Set([normalizeSearchTerm(imported.moduleSpecifier), ...decomposeIdentifier(imported.moduleSpecifier)])) {
        addMapValue(importTerms, term, file);
      }
    }
  }

  const take = <T>(values: readonly T[] | undefined): readonly T[] =>
    (values ?? []).slice(0, STRUCTURAL_V1.retrieval.perSignalCandidateLimit);
  for (const signal of signals) {
    const factor = signalFactor(signal);
    if (factor <= 0) continue;
    for (const file of take(exactPaths.get(signal.normalized))) {
      addDirect(candidates, file, evidence("EXACT_PATH", "IDENTITY", signal, file.relativePath, STRUCTURAL_V1.weights.exactPath * factor, `exact path: ${signal.value}`));
    }
    for (const file of take(basenames.get(signal.normalized))) {
      addDirect(candidates, file, evidence("EXACT_BASENAME", "IDENTITY", signal, posix.basename(file.relativePath), STRUCTURAL_V1.weights.exactBasename * factor, `exact filename: ${signal.value}`));
    }
    for (const reference of take(qualifiedSymbols.get(signal.normalized))) {
      addDirect(candidates, reference.file, evidence("EXACT_QUALIFIED_SYMBOL", "IDENTITY", signal, reference.symbol.qualifiedName, STRUCTURAL_V1.weights.exactQualifiedSymbol * factor, `exact qualified symbol: ${reference.symbol.qualifiedName}`), reference.symbol);
    }
    for (const reference of take(symbolNames.get(signal.normalized))) {
      addDirect(candidates, reference.file, evidence("EXACT_SYMBOL", "IDENTITY", signal, reference.symbol.name, STRUCTURAL_V1.weights.exactSymbol * factor, `exact symbol: ${reference.symbol.name}`), reference.symbol);
    }
    for (const reference of take(symbolComponents.get(signal.normalized))) {
      addDirect(candidates, reference.file, evidence("SYMBOL_COMPONENT", "LEXICAL", signal, reference.symbol.qualifiedName, STRUCTURAL_V1.weights.symbolComponent * factor, `symbol component: ${signal.value} in ${reference.symbol.qualifiedName}`), reference.symbol);
    }
    for (const file of take(pathComponents.get(signal.normalized))) {
      addDirect(candidates, file, evidence("PATH_COMPONENT", "LEXICAL", signal, file.relativePath, STRUCTURAL_V1.weights.pathComponent * factor, `path component: ${signal.value}`));
    }
    for (const file of take(importTerms.get(signal.normalized))) {
      addDirect(candidates, file, evidence("IMPORT_MODULE", "LEXICAL", signal, file.relativePath, STRUCTURAL_V1.weights.importModule * factor, `import/module metadata: ${signal.value}`));
    }
  }
  return candidates;
}

function rankedBuilders(candidates: Map<string, CandidateBuilder>, generation: number): RankedFileCandidate[] {
  return [...candidates.values()].map((builder) => rankBuilder(builder, generation)).sort(compareRanked);
}

function relationKind(edge: GraphEdge, fromPath: string): Neighbor["kind"] {
  if (edge.kind === "FILE_IMPORTS_FILE") return edge.sourcePath === fromPath ? "FILE_IMPORTS_FILE" : "FILE_IMPORTED_BY";
  return edge.kind === "TEST_RELATES_TO_FILE" ? "TEST_RELATION" : "DOCUMENT_RELATION";
}

function relationFactor(kind: Neighbor["kind"]): number {
  return STRUCTURAL_V1.expansion.relationFactors[kind];
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
  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) => relationFactor(right.kind) - relationFactor(left.kind) || compareText(left.path, right.path) || compareText(left.edge.id, right.edge.id));
  }
  return adjacency;
}

function expansionDetail(kind: Neighbor["kind"], source: string, target: string, distance: number): string {
  switch (kind) {
    case "FILE_IMPORTS_FILE": return `structural dependency from ${source} to ${target} at distance ${distance}`;
    case "FILE_IMPORTED_BY": return `reverse dependency from ${source} to ${target} at distance ${distance}`;
    case "TEST_RELATION": return `related test/source from ${source} to ${target} at distance ${distance}`;
    case "DOCUMENT_RELATION": return `related documentation/source from ${source} to ${target} at distance ${distance}`;
  }
}

function expandCandidates(
  candidates: Map<string, CandidateBuilder>,
  primary: readonly RankedFileCandidate[],
  files: ReadonlyMap<string, IndexedFile>,
  edges: readonly GraphEdge[],
): { readonly expandedPaths: ReadonlySet<string>; readonly truncated: boolean } {
  const adjacency = graphAdjacency(edges);
  const seeds = primary.slice(0, STRUCTURAL_V1.expansion.maximumPrimarySeeds);
  const expandedPaths = new Set<string>();
  let truncated = false;
  for (const seed of seeds) {
    const queue: { readonly path: string; readonly depth: number }[] = [{ path: seed.relativePath, depth: 0 }];
    const bestDepth = new Map<string, number>([[seed.relativePath, 0]]);
    const traversed = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || current.depth >= STRUCTURAL_V1.expansion.maximumDepth) continue;
      const allNeighbors = adjacency.get(current.path) ?? [];
      if (allNeighbors.length > STRUCTURAL_V1.expansion.maximumNeighborsPerNode) truncated = true;
      for (const neighbor of allNeighbors.slice(0, STRUCTURAL_V1.expansion.maximumNeighborsPerNode)) {
        const distance = current.depth + 1;
        if (neighbor.path === seed.relativePath) continue;
        const edgeVisit = `${current.path}\u0000${neighbor.path}\u0000${neighbor.edge.id}`;
        if (traversed.has(edgeVisit)) continue;
        traversed.add(edgeVisit);
        const file = files.get(neighbor.path);
        if (file === undefined) continue;
        if (!candidates.has(neighbor.path) && !expandedPaths.has(neighbor.path)) {
          if (expandedPaths.size >= STRUCTURAL_V1.expansion.globalExpandedCandidateLimit) {
            truncated = true;
            continue;
          }
          expandedPaths.add(neighbor.path);
        }
        const degree = adjacency.get(neighbor.path)?.length ?? 0;
        const decay = STRUCTURAL_V1.expansion.distanceDecay[distance] ?? 0;
        const weight = seed.rawScore * STRUCTURAL_V1.expansion.inheritedScoreFactor * decay * relationFactor(neighbor.kind) * neighbor.confidence * hubDamping(degree);
        addExpansion(
          candidates,
          file,
          evidence(
            neighbor.kind,
            "STRUCTURAL",
            null,
            neighbor.path,
            weight,
            expansionDetail(neighbor.kind, seed.relativePath, neighbor.path, distance),
            distance,
            seed.relativePath,
          ),
        );
        const previousDepth = bestDepth.get(neighbor.path);
        if (previousDepth === undefined || distance < previousDepth) {
          bestDepth.set(neighbor.path, distance);
          queue.push({ path: neighbor.path, depth: distance });
        }
      }
    }
  }
  return { expandedPaths, truncated };
}

function applyGitEvidence(candidates: Map<string, CandidateBuilder>, signals: readonly GitFileSignal[]): void {
  const byPath = new Map(signals.map((signal) => [signal.relativePath, signal]));
  for (const builder of candidates.values()) {
    const signal = byPath.get(builder.file.relativePath);
    if (signal === undefined) continue;
    if (signal.workingTreeStatus !== "clean" && signal.workingTreeStatus !== "deleted") {
      builder.gitEvidence.push(evidence("GIT_DIRTY", "GIT", null, builder.file.relativePath, STRUCTURAL_V1.weights.gitDirty, `weak Git signal: ${signal.workingTreeStatus}`));
    }
    if (signal.recentCommitCount > 0) {
      builder.gitEvidence.push(evidence("GIT_RECENCY", "GIT", null, builder.file.relativePath, Math.min(STRUCTURAL_V1.weights.gitRecencyMaximum, Math.log2(1 + signal.recentCommitCount)), `weak Git signal: ${signal.recentCommitCount} recent change(s)`));
    }
  }
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

async function executeSearchRepository(
  scanner: RepositoryScanner,
  sourceReader: RepositorySourceReader,
  repositoryFactory: IndexRepositoryFactory,
  request: SearchRepositoryRequest,
): Promise<SearchRepositoryExecution> {
  const totalStarted = performance.now();
  const normalizationStarted = performance.now();
  const query = normalizeTaskQuery(request.task);
  const normalizationMs = performance.now() - normalizationStarted;
  const limit = request.limit ?? STRUCTURAL_V1.cli.defaultLimit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > STRUCTURAL_V1.cli.maximumLimit) {
    throw new ContextForgeError("INVALID_TASK", `Search limit must be an integer from 1 to ${STRUCTURAL_V1.cli.maximumLimit}.`);
  }

  const scan = await scanner.scan(request.repositoryPath);
  const active = await repositoryFactory(scan.rootRealPath).loadActive();
  if (active === null) {
    throw new ContextForgeError("INDEX_REQUIRED", "No active RepoBound index exists. Run 'repobound index .' first.");
  }
  if (active.graph === null) {
    throw new ContextForgeError("INDEX_REQUIRED", "The active index predates Repository Graph support. Run 'repobound index .' again.");
  }

  const retrievalStarted = performance.now();
  const eligibleFiles = active.files.filter(isSearchEligible);
  const fileByPath = new Map(eligibleFiles.map((file) => [file.relativePath, file]));
  const currentEntries = scan.entries
    .filter((entry) => (entry.type === "file" || entry.type === "symlink") && entry.skipReason !== "symlink_directory")
    .sort((left, right) => compareText(left.path, right.path));
  const currentByPath = new Map(currentEntries.map((entry) => [entry.path, entry]));
  const currentPaths = new Set(currentByPath.keys());
  const indexedPaths = new Set(active.files.map((file) => file.relativePath));
  const added = new Set([...currentPaths].filter((path) => !indexedPaths.has(path)));
  const deleted = new Set([...indexedPaths].filter((path) => !currentPaths.has(path)));
  let candidates = query.diagnostics.lowInformation ? new Map<string, CandidateBuilder>() : buildDirectCandidates(eligibleFiles, query.signals);
  trimDirectEvidence(candidates);
  const directBeforeLexical = rankedBuilders(candidates, active.generation);
  const directPriority = new Map(directBeforeLexical.map((candidate, index) => [candidate.relativePath, index]));
  const retrievalMs = performance.now() - retrievalStarted;

  const lexicalStarted = performance.now();
  const changed = new Set<string>();
  for (const file of active.files) {
    const current = currentByPath.get(file.relativePath);
    if (current !== undefined && (current.content !== file.contentStatus || current.size !== file.size)) changed.add(file.relativePath);
  }
  const lexicalMatches: LexicalMatch[] = [];
  let lexicalFilesScanned = 0;
  let lexicalBytesScanned = 0;
  let lexicalSkippedFiles = [...changed, ...deleted].filter((path) => fileByPath.get(path)?.contentStatus === "text").length;
  let lexicalTruncated = false;
  const lexicalFiles = eligibleFiles
    .filter((file) => currentByPath.get(file.relativePath)?.content === "text")
    .sort((left, right) => (directPriority.get(left.relativePath) ?? Number.MAX_SAFE_INTEGER) - (directPriority.get(right.relativePath) ?? Number.MAX_SAFE_INTEGER) || compareText(left.relativePath, right.relativePath));
  for (const file of lexicalFiles) {
    const entry = currentByPath.get(file.relativePath);
    if (entry === undefined) continue;
    if (
      lexicalFilesScanned >= STRUCTURAL_V1.retrieval.maximumLexicalFiles ||
      lexicalBytesScanned + (entry.size ?? 0) > STRUCTURAL_V1.retrieval.maximumLexicalBytes
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
    if (query.diagnostics.lowInformation) continue;
    const termCounts = sourceTermCounts(source.source);
    const normalizedSource = normalizeSearchTerm(source.source);
    const matched: CandidateEvidence[] = [];
    for (const signal of query.signals) {
      if (signalFactor(signal) <= 0) continue;
      const count = lexicalCount(normalizedSource, termCounts, signal);
      if (count <= 0) continue;
      matched.push(evidence("SOURCE_LEXICAL", "LEXICAL", signal, file.relativePath, lexicalWeight(signal, count), `source lexical: ${signal.value} (${count} capped occurrence${count === 1 ? "" : "s"})`));
    }
    if (matched.length > 0) {
      const boundedMatched = deduplicateEvidence(matched).slice(0, STRUCTURAL_V1.retrieval.maximumSignalsPerLexicalFile);
      lexicalMatches.push({ file, evidence: boundedMatched, score: scoreEvidence(boundedMatched).rawScore });
    }
  }
  lexicalMatches.sort((left, right) => right.score - left.score || compareText(left.file.relativePath, right.file.relativePath));
  if (lexicalMatches.length > STRUCTURAL_V1.retrieval.maximumLexicalCandidates) lexicalTruncated = true;
  for (const match of lexicalMatches.slice(0, STRUCTURAL_V1.retrieval.maximumLexicalCandidates)) {
    for (const item of match.evidence) addDirect(candidates, match.file, item);
  }
  trimDirectEvidence(candidates);
  const lexicalMs = performance.now() - lexicalStarted;

  const primaryRanked = rankedBuilders(candidates, active.generation).slice(0, STRUCTURAL_V1.retrieval.primaryCandidateLimit);
  const primaryPaths = new Set(primaryRanked.map((candidate) => candidate.relativePath));
  candidates = new Map([...candidates].filter(([path]) => primaryPaths.has(path)));
  const directCandidates = candidates.size;

  const expansionStarted = performance.now();
  const expanded = query.diagnostics.lowInformation
    ? { expandedPaths: new Set<string>() as ReadonlySet<string>, truncated: false }
    : expandCandidates(candidates, primaryRanked, fileByPath, active.graph.edges);
  const expansionMs = performance.now() - expansionStarted;

  const rankingStarted = performance.now();
  if (active.graph.git.status === "available") applyGitEvidence(candidates, active.graph.git.files);
  const finalRanked = rankedBuilders(candidates, active.generation).slice(0, STRUCTURAL_V1.expansion.finalCandidateLimit);
  const rankingMs = performance.now() - rankingStarted;
  const status = indexStatus(added, deleted, changed, lexicalSkippedFiles, lexicalTruncated);
  const diagnostics = [
    ...(query.diagnostics.lowInformation ? ["QUERY_LOW_INFORMATION"] : []),
    ...(status.status === "STALE" ? ["INDEX_STALE"] : []),
    ...(changed.size > 0 ? ["LEXICAL_SOURCE_STALE"] : []),
    ...(lexicalTruncated ? ["LEXICAL_SCAN_TRUNCATED"] : []),
    ...(expanded.truncated ? ["GRAPH_EXPANSION_TRUNCATED"] : []),
  ];
  const result: SearchResult = {
    schemaVersion: SEARCH_SCHEMA_VERSION,
    task: query.rawTask,
    repository: { name: basename(scan.rootRealPath), root: "." as const },
    generation: active.generation,
    rankingStrategy: RANKING_STRATEGY,
    indexStatus: status,
    normalizedQuery: {
      schemaVersion: query.schemaVersion,
      queryVersion: query.queryVersion,
      byteLength: query.byteLength,
      signals: query.signals,
      diagnostics: query.diagnostics,
    },
    candidates: finalRanked.slice(0, limit),
    diagnostics,
    counts: {
      directCandidates,
      expandedCandidates: expanded.expandedPaths.size,
      finalCandidates: finalRanked.length,
      lexicalFilesScanned,
      lexicalBytesScanned,
    },
  };
  return {
    result,
    context: { scan, snapshot: active },
    performance: {
      normalizationMs,
      retrievalMs,
      lexicalMs,
      expansionMs,
      rankingMs,
      totalMs: performance.now() - totalStarted,
    },
  };
}

export async function searchRepository(
  scanner: RepositoryScanner,
  sourceReader: RepositorySourceReader,
  repositoryFactory: IndexRepositoryFactory,
  request: SearchRepositoryRequest,
): Promise<SearchRepositoryExecution> {
  try {
    return await executeSearchRepository(scanner, sourceReader, repositoryFactory, request);
  } catch (error) {
    if (error instanceof ContextForgeError) throw error;
    throw new ContextForgeError("SEARCH_FAILED", "Repository search failed without changing the active index.", { cause: error });
  }
}
