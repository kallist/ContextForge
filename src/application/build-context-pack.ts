import { performance } from "node:perf_hooks";
import { buildContextCapsule } from "./build-context-capsule.js";

import type { RepositoryScanner, ScanResult } from "./map-repository.js";
import type { RepositorySourceReader } from "./repository-source.js";
import { searchRepository } from "./search-repository.js";
import {
  CONTEXT_PACK_SCHEMA_VERSION,
  PACKING_STRATEGY,
  type ContextPackExecution,
  type ContextPackManifest,
  type ContextRange,
  type ContextRelevantSymbol,
  type ContextRole,
  type ContextSelectionReason,
  type DropReason,
  type DroppedCandidate,
  type SelectedContextItem,
} from "../core/context-pack.js";
import {
  renderContextItem,
  renderContextMarkdown,
  type ContextMarkdownInput,
  type RenderableContextItem,
} from "../core/context-serialization.js";
import { ContextForgeError } from "../core/errors.js";
import type { IndexedFile, IndexRepositoryFactory, RepositoryIndexSnapshot } from "../core/repository-index.js";
import type { FileCategory } from "../core/repository-map.js";
import { selectMarkdownSectionRanges } from "../core/packing/markdown-sections.js";
import { PACK_V1 } from "../core/packing/pack-v1.js";
import { boundedRange, logicalLines, mergeContextRanges, rangeContains } from "../core/packing/ranges.js";
import type { CandidateOrigin, SearchIndexStatus } from "../core/task-retrieval.js";
import { GenericTokenEstimator, type TokenEstimator } from "../core/token-estimation.js";

export interface ContextPackRequest {
  readonly captureCapsule?: boolean;
  readonly repositoryPath: string;
  readonly task: string;
  readonly budget: number;
}

interface PackCandidateEvidence {
  readonly id?: string;
  readonly querySignal?: string | null;
  readonly confidence?: number;
  readonly derivation?: "STRUCTURAL" | "HEURISTIC" | "VERIFIED_SOURCE";
  readonly taskSignalId?: string | null;
  readonly sourceCandidate?: string | null;
  readonly relationshipId?: string | null;
  readonly location?: { readonly startLine: number; readonly endLine: number } | null;
  readonly kind: string;
  readonly family: string;
  readonly weight: number;
  readonly detail: string;
}

interface PackRankedCandidate {
  readonly identity: string;
  readonly relativePath: string;
  readonly category: FileCategory;
  readonly origin: CandidateOrigin;
  readonly directEvidence: readonly PackCandidateEvidence[];
  readonly expansionEvidence: readonly PackCandidateEvidence[];
  readonly scoreContributions: readonly { readonly kind: string; readonly family: string; readonly value: number; readonly reason: string; readonly evidenceId?: string | null }[];
  readonly rawScore: number;
  readonly graphDistance: number | null;
  readonly relevantSymbols: readonly {
    readonly identity: string;
    readonly name: string;
    readonly qualifiedName: string;
    readonly startLine: number;
    readonly endLine: number;
  }[];
}

export interface ContextPackSearchExecution {
  readonly result: {
    readonly repository: { readonly name: string; readonly root: "." };
    readonly generation: number;
    readonly rankingStrategy: string;
    readonly indexStatus: SearchIndexStatus;
    readonly normalizedQuery: {
      readonly signals: readonly { readonly normalized: string; readonly lowValue: boolean }[];
    };
    readonly candidates: readonly PackRankedCandidate[];
    readonly diagnostics: readonly string[];
  };
  readonly context: { readonly scan: ScanResult; readonly snapshot: RepositoryIndexSnapshot };
  readonly performance: { readonly totalMs: number };
}

export type ContextPackSearch = (
  scanner: RepositoryScanner,
  sourceReader: RepositorySourceReader,
  repositoryFactory: IndexRepositoryFactory,
  request: { readonly repositoryPath: string; readonly task: string; readonly limit: number },
) => Promise<ContextPackSearchExecution>;

interface Representation {
  readonly ranges: readonly ContextRange[];
  readonly wholeFile: boolean;
  readonly estimatedTokens: number;
}

interface CandidatePlan {
  readonly candidate: PackRankedCandidate | null;
  readonly file: IndexedFile;
  readonly rank: number | null;
  readonly role: Exclude<ContextRole, "GIT_CONTEXT">;
  readonly secondaryRoles: readonly ContextRole[];
  readonly lines: readonly string[];
  readonly selectionReasons: readonly ContextSelectionReason[];
  readonly representations: readonly Representation[];
  selectedLevel: number;
}

interface PhaseTimers {
  roleAssignmentMs: number;
  sourceVerificationMs: number;
  rangeSelectionMs: number;
  rangeMergingMs: number;
  tokenEstimationMs: number;
  serializationMs: number;
}

const DROP_REASONS: readonly DropReason[] = [
  "BUDGET_EXHAUSTED",
  "LOWER_PRIORITY",
  "DUPLICATE",
  "STALE_SOURCE",
  "SECTION_LIMIT",
  "UNSUPPORTED_CONTENT",
  "NO_USEFUL_RANGE",
  "SOURCE_VERIFICATION_LIMIT",
];

const SECTION_OVERHEAD_ESTIMATE = 16;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

class MeasuredEstimator implements TokenEstimator {
  readonly id: string;
  readonly version: string;
  readonly #delegate: TokenEstimator;
  readonly #timers: PhaseTimers;

  constructor(delegate: TokenEstimator, timers: PhaseTimers) {
    this.#delegate = delegate;
    this.#timers = timers;
    this.id = delegate.id;
    this.version = delegate.version;
  }

  estimate(serializedText: string): number {
    const started = performance.now();
    const estimate = this.#delegate.estimate(serializedText);
    this.#timers.tokenEstimationMs += performance.now() - started;
    return estimate;
  }
}

export function validateTokenBudget(budget: number): void {
  if (!Number.isSafeInteger(budget) || budget <= 0 || budget > PACK_V1.maximumBudget) {
    throw new ContextForgeError("INVALID_BUDGET", `Budget must be a positive safe integer no greater than ${PACK_V1.maximumBudget}.`);
  }
}

function roleFor(candidate: PackRankedCandidate): Exclude<ContextRole, "REPOSITORY_INSTRUCTION" | "GIT_CONTEXT"> {
  switch (candidate.category) {
    case "test": return "TEST";
    case "documentation": return "DOCUMENTATION";
    case "configuration": return "CONFIGURATION";
    default: return candidate.origin === "EXPANDED" ? "DEPENDENCY" : "PRIMARY_CODE";
  }
}

function secondaryRoles(candidate: PackRankedCandidate, primary: ContextRole): ContextRole[] {
  const roles = new Set<ContextRole>();
  if (candidate.expansionEvidence.some((item) => item.kind === "FILE_IMPORTS_FILE" || item.kind === "FILE_IMPORTED_BY")) roles.add("DEPENDENCY");
  if (candidate.expansionEvidence.some((item) => item.kind === "TEST_RELATION")) roles.add("TEST");
  if (candidate.expansionEvidence.some((item) => item.kind === "DOCUMENT_RELATION")) roles.add("DOCUMENTATION");
  roles.delete(primary);
  return PACK_V1.sectionOrder.filter((role) => roles.has(role));
}

function selectionReasons(candidate: PackRankedCandidate): ContextSelectionReason[] {
  return candidate.scoreContributions.slice(0, 16).map((contribution) => ({
    kind: contribution.kind,
    detail: contribution.reason,
    contribution: contribution.value,
  }));
}

function renderable(plan: CandidatePlan, representation: Representation): RenderableContextItem {
  return {
    identity: plan.candidate?.identity ?? `file:${plan.file.relativePath}`,
    relativePath: plan.file.relativePath,
    role: plan.role,
    ranges: representation.ranges,
    lines: plan.lines,
    language: plan.file.analysis.language,
    selectionReasons: plan.selectionReasons,
    partial: !representation.wholeFile,
  };
}

function timedMerge(ranges: readonly ContextRange[], timers: PhaseTimers): ContextRange[] {
  const started = performance.now();
  const merged = mergeContextRanges(ranges, PACK_V1.nearbyRangeMergeGap);
  timers.rangeMergingMs += performance.now() - started;
  return merged;
}

function makeRepresentation(
  plan: Omit<CandidatePlan, "representations" | "selectedLevel">,
  ranges: readonly ContextRange[],
  wholeFile: boolean,
  estimator: TokenEstimator,
  timers: PhaseTimers,
): Representation | null {
  const merged = timedMerge(ranges, timers);
  if (merged.length === 0) return null;
  const provisional: Representation = { ranges: merged, wholeFile, estimatedTokens: 0 };
  return {
    ...provisional,
    estimatedTokens: estimator.estimate(renderContextItem(renderable({ ...plan, representations: [], selectedLevel: -1 }, provisional))),
  };
}

function importRanges(file: IndexedFile, maximumLine: number): ContextRange[] {
  const ranges: ContextRange[] = [];
  let lines = 0;
  for (const record of [...file.analysis.imports].sort((left, right) => left.startLine - right.startLine)) {
    const size = record.endLine - record.startLine + 1;
    if (lines + size > PACK_V1.maximumImportLines) break;
    const range = boundedRange(record.startLine, record.endLine, maximumLine, ["IMPORT_BLOCK"]);
    if (range !== null) ranges.push(range);
    lines += size;
  }
  return ranges;
}

function symbolRanges(
  candidate: PackRankedCandidate,
  file: IndexedFile,
  maximumLine: number,
  symbolLimit: number,
  surrounding: number,
  includeParentsAndImports: boolean,
): ContextRange[] {
  const ranges: ContextRange[] = [];
  const symbolsById = new Map(file.analysis.symbols.map((symbol) => [symbol.id, symbol]));
  for (const relevant of candidate.relevantSymbols.slice(0, symbolLimit)) {
    const range = boundedRange(
      relevant.startLine - surrounding,
      relevant.endLine + surrounding,
      maximumLine,
      surrounding > 0 ? ["SYMBOL_RANGE", "SURROUNDING_CONTEXT"] : ["SYMBOL_RANGE"],
    );
    if (range !== null) ranges.push(range);
    if (!includeParentsAndImports) continue;
    const indexed = symbolsById.get(relevant.identity);
    const parent = indexed?.parentSymbolId === null || indexed?.parentSymbolId === undefined
      ? undefined
      : symbolsById.get(indexed.parentSymbolId);
    if (parent !== undefined && parent.startLine < relevant.startLine) {
      const parentHeader = boundedRange(parent.startLine, Math.min(parent.startLine + 2, relevant.startLine - 1), maximumLine, ["PARENT_CONTEXT"]);
      if (parentHeader !== null) ranges.push(parentHeader);
    }
  }
  if (includeParentsAndImports) ranges.push(...importRanges(file, maximumLine));
  return ranges;
}

function lexicalRanges(lines: readonly string[], signals: readonly string[], surrounding: number, maximumRanges: number): ContextRange[] {
  const normalizedSignals = [...new Set(signals.map((signal) => signal.toLowerCase()).filter((signal) => signal.length >= 2))];
  const ranges: ContextRange[] = [];
  for (let index = 0; index < lines.length && ranges.length < maximumRanges; index += 1) {
    const normalizedLine = (lines[index] ?? "").toLowerCase();
    if (!normalizedSignals.some((signal) => normalizedLine.includes(signal))) continue;
    const range = boundedRange(index + 1 - surrounding, index + 1 + surrounding, lines.length, ["LEXICAL_RANGE", "SURROUNDING_CONTEXT"]);
    if (range !== null) ranges.push(range);
  }
  return ranges;
}

function uniqueRepresentations(representations: readonly (Representation | null)[]): Representation[] {
  const seen = new Set<string>();
  const result: Representation[] = [];
  for (const representation of representations) {
    if (representation === null) continue;
    const identity = representation.ranges.map((range) => `${range.startLine}-${range.endLine}`).join(",");
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(representation);
  }
  return result;
}

function buildRepresentations(
  plan: Omit<CandidatePlan, "representations" | "selectedLevel">,
  signals: readonly string[],
  estimator: TokenEstimator,
  timers: PhaseTimers,
  instruction = false,
): Representation[] {
  const started = performance.now();
  const lines = plan.lines;
  const maximumLine = lines.length;
  const wholeRange: ContextRange = { startLine: 1, endLine: maximumLine, reasons: [plan.role === "CONFIGURATION" ? "CONFIGURATION_FILE" : "WHOLE_FILE"] };
  const sourceEstimate = estimator.estimate(lines.join("\n"));
  const wholeLimit = instruction ? PACK_V1.instructionMaximumTokens : PACK_V1.wholeFileMaximumTokens;
  if ((instruction || maximumLine <= PACK_V1.wholeFileMaximumLines) && sourceEstimate <= wholeLimit) {
    const whole = makeRepresentation(plan, [wholeRange], true, estimator, timers);
    timers.rangeSelectionMs += performance.now() - started;
    return whole === null ? [] : [whole];
  }

  let representations: (Representation | null)[];
  if (plan.role === "DOCUMENTATION" || plan.role === "REPOSITORY_INSTRUCTION") {
    const taskSections = selectMarkdownSectionRanges(lines, signals, instruction ? PACK_V1.maximumInstructionSections : PACK_V1.maximumMarkdownSections);
    const instructionSignals = ["scope", "security", "test", "git", "required"];
    const selectedSignals = instruction && taskSections.length === 0 ? instructionSignals : signals;
    const first = selectMarkdownSectionRanges(lines, selectedSignals, 1);
    const expanded = selectMarkdownSectionRanges(
      lines,
      selectedSignals,
      instruction ? PACK_V1.maximumInstructionSections : PACK_V1.maximumMarkdownSections,
    );
    const firstSection = first[0] ?? expanded[0];
    const boundedInstructionPrefixes = instruction && firstSection !== undefined
      ? [8, 20, 40, PACK_V1.boundedPrefixLines].map((lineCount) => boundedRange(
        firstSection.startLine,
        Math.min(firstSection.endLine, firstSection.startLine + lineCount - 1),
        maximumLine,
        ["MARKDOWN_SECTION", "BOUNDED_FILE_PREFIX"],
      ))
      : [];
    representations = [
      ...boundedInstructionPrefixes.map((range) => makeRepresentation(plan, range === null ? [] : [range], false, estimator, timers)),
      makeRepresentation(plan, first, false, estimator, timers),
      makeRepresentation(plan, expanded, false, estimator, timers),
    ];
  } else if (plan.candidate !== null && plan.candidate.relevantSymbols.length > 0) {
    representations = [
      makeRepresentation(
        plan,
        symbolRanges(plan.candidate, plan.file, maximumLine, PACK_V1.maximumRelevantSymbolsPerLevel[0], PACK_V1.surroundingLines, false),
        false,
        estimator,
        timers,
      ),
      makeRepresentation(
        plan,
        symbolRanges(plan.candidate, plan.file, maximumLine, PACK_V1.maximumRelevantSymbolsPerLevel[1], PACK_V1.surroundingLines, false),
        false,
        estimator,
        timers,
      ),
      makeRepresentation(
        plan,
        symbolRanges(plan.candidate, plan.file, maximumLine, PACK_V1.maximumRelevantSymbolsPerLevel[2], PACK_V1.enrichedSurroundingLines, true),
        false,
        estimator,
        timers,
      ),
    ];
  } else {
    const first = lexicalRanges(lines, signals, PACK_V1.surroundingLines, 1);
    const expanded = lexicalRanges(lines, signals, PACK_V1.enrichedSurroundingLines, PACK_V1.maximumLexicalRanges);
    const prefix = boundedRange(1, PACK_V1.boundedPrefixLines, maximumLine, ["BOUNDED_FILE_PREFIX"]);
    representations = [
      makeRepresentation(plan, first.length > 0 ? first : prefix === null ? [] : [prefix], false, estimator, timers),
      makeRepresentation(plan, expanded.length > 0 ? [...expanded, ...importRanges(plan.file, maximumLine)] : prefix === null ? [] : [prefix], false, estimator, timers),
    ];
  }
  timers.rangeSelectionMs += performance.now() - started;
  return uniqueRepresentations(representations).filter((representation) => !instruction || representation.estimatedTokens <= PACK_V1.instructionMaximumTokens);
}

function chosenRepresentation(plan: CandidatePlan): Representation | null {
  return plan.selectedLevel < 0 ? null : plan.representations[plan.selectedLevel] ?? null;
}

function markdownInput(
  task: string,
  repositoryName: string,
  generation: number,
  rankingStrategy: string,
  estimatorId: string,
  estimatorVersion: string,
  budget: number,
  plans: readonly CandidatePlan[],
  gitContext: string | null,
): ContextMarkdownInput {
  return {
    task,
    repositoryName,
    generation,
    rankingStrategy,
    packingStrategy: PACKING_STRATEGY,
    tokenEstimator: estimatorId,
    tokenEstimatorVersion: estimatorVersion,
    requestedBudget: budget,
    items: plans.flatMap((plan) => {
      const representation = chosenRepresentation(plan);
      return representation === null ? [] : [renderable(plan, representation)];
    }),
    gitContext,
  };
}

function approximateCost(
  skeletonCost: number,
  plans: readonly CandidatePlan[],
  gitTokens: number,
): number {
  const activeRoles = new Set<ContextRole>();
  let total = skeletonCost + gitTokens;
  for (const plan of plans) {
    const representation = chosenRepresentation(plan);
    if (representation === null) continue;
    total += representation.estimatedTokens;
    activeRoles.add(plan.role);
  }
  if (gitTokens > 0) activeRoles.add("GIT_CONTEXT");
  return total + activeRoles.size * SECTION_OVERHEAD_ESTIMATE;
}

function sectionCost(plans: readonly CandidatePlan[], role: ContextRole): number {
  return plans
    .filter((plan) => plan.role === role)
    .reduce((total, plan) => total + (chosenRepresentation(plan)?.estimatedTokens ?? 0), 0);
}

function roleCount(plans: readonly CandidatePlan[], role: ContextRole): number {
  return plans.filter((plan) => plan.role === role && plan.selectedLevel >= 0).length;
}

function selectLevelIfFits(
  plan: CandidatePlan,
  level: number,
  plans: readonly CandidatePlan[],
  skeletonCost: number,
  gitTokens: number,
  budget: number,
): boolean {
  const previous = plan.selectedLevel;
  plan.selectedLevel = level;
  if (approximateCost(skeletonCost, plans, gitTokens) <= budget) return true;
  plan.selectedLevel = previous;
  return false;
}

function reductionOrder(plans: readonly CandidatePlan[], protectedPlan: CandidatePlan): CandidatePlan[] {
  const priority = (plan: CandidatePlan): number => {
    if (plan.role === "DOCUMENTATION") return 0;
    if (plan.role === "DEPENDENCY" && (plan.candidate?.graphDistance ?? 0) >= 2) return 1;
    if (plan.role === "TEST") return 2;
    if (plan.role === "DEPENDENCY") return 3;
    if (plan.role === "CONFIGURATION") return 4;
    if (plan.role === "PRIMARY_CODE") return plan === protectedPlan ? 7 : 5;
    return 6;
  };
  return [...plans]
    .filter((plan) => plan.selectedLevel >= 0)
    .sort((left, right) => priority(left) - priority(right) || (right.rank ?? -1) - (left.rank ?? -1) || compareText(right.file.relativePath, left.file.relativePath));
}

function selectedSymbols(plan: CandidatePlan, ranges: readonly ContextRange[]): ContextRelevantSymbol[] {
  if (plan.candidate === null) return [];
  return plan.candidate.relevantSymbols
    .filter((symbol) => ranges.some((range) => rangeContains(range, symbol.startLine, symbol.endLine)))
    .map((symbol) => ({
      identity: symbol.identity,
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
    }));
}

export async function buildContextPack(
  scanner: RepositoryScanner,
  sourceReader: RepositorySourceReader,
  repositoryFactory: IndexRepositoryFactory,
  request: ContextPackRequest,
  tokenEstimator: TokenEstimator = new GenericTokenEstimator(),
  searchExecutor: ContextPackSearch = searchRepository,
): Promise<ContextPackExecution> {
  const totalStarted = performance.now();
  validateTokenBudget(request.budget);
  const timers: PhaseTimers = {
    roleAssignmentMs: 0,
    sourceVerificationMs: 0,
    rangeSelectionMs: 0,
    rangeMergingMs: 0,
    tokenEstimationMs: 0,
    serializationMs: 0,
  };
  const estimator = new MeasuredEstimator(tokenEstimator, timers);
  const search = await searchExecutor(scanner, sourceReader, repositoryFactory, {
    repositoryPath: request.repositoryPath,
    task: request.task,
    limit: PACK_V1.searchCandidateLimit,
  });
  const planningStarted = performance.now();
  const { scan, snapshot } = search.context;
  if (snapshot.generation !== search.result.generation) {
    throw new ContextForgeError("PACK_FAILED", "Search and packing generation identities do not match.");
  }
  const fileByPath = new Map(snapshot.files.map((file) => [file.relativePath, file]));
  const entryByPath = new Map(scan.entries.map((entry) => [entry.path, entry]));
  const signalValues = search.result.normalizedQuery.signals
    .filter((signal) => !signal.lowValue)
    .map((signal) => signal.normalized);
  const plans: CandidatePlan[] = [];
  const dropped: DroppedCandidate[] = [];
  const capsuleDrops: DroppedCandidate[] | undefined = request.captureCapsule === true ? [] : undefined;
  const droppedCounts = new Map<DropReason, number>(DROP_REASONS.map((reason) => [reason, 0]));
  const diagnostics = new Set<string>(search.result.diagnostics);
  let verifiedFiles = 0;
  let verifiedBytes = 0;
  let staleSource = false;
  let verificationLimited = false;

  const recordDrop = (candidate: PackRankedCandidate | null, rank: number | null, path: string, reason: DropReason): void => {
    capsuleDrops?.push({ relativePath: path, candidateRank: rank, score: candidate?.rawScore ?? null, dropReason: reason });
    droppedCounts.set(reason, (droppedCounts.get(reason) ?? 0) + 1);
    if (dropped.length < PACK_V1.maximumDroppedCandidates) {
      dropped.push({ relativePath: path, candidateRank: rank, score: candidate?.rawScore ?? null, dropReason: reason });
    }
  };

  const verify = async (file: IndexedFile): Promise<readonly string[] | null> => {
    const entry = entryByPath.get(file.relativePath);
    if (entry === undefined || entry.content !== "text" || file.contentHash === null) return null;
    if (verifiedFiles >= PACK_V1.maximumCandidateSources || verifiedBytes + (entry.size ?? 0) > PACK_V1.maximumVerifiedBytes) {
      verificationLimited = true;
      return null;
    }
    const started = performance.now();
    const source = await sourceReader.readTextFile(scan.rootRealPath, entry);
    timers.sourceVerificationMs += performance.now() - started;
    if (source.status !== "read" || source.contentHash !== file.contentHash) {
      staleSource = true;
      return null;
    }
    verifiedFiles += 1;
    verifiedBytes += source.size;
    return logicalLines(source.source);
  };

  const instructionFile = fileByPath.get("AGENTS.md");
  let instructionPlan: CandidatePlan | null = null;
  if (instructionFile !== undefined) {
    const lines = await verify(instructionFile);
    if (lines === null) {
      staleSource = true;
      recordDrop(null, null, "AGENTS.md", verificationLimited ? "SOURCE_VERIFICATION_LIMIT" : "STALE_SOURCE");
      diagnostics.add("REPOSITORY_INSTRUCTION_UNAVAILABLE");
    } else {
      const base: Omit<CandidatePlan, "representations" | "selectedLevel"> = {
        candidate: null,
        file: instructionFile,
        rank: null,
        role: "REPOSITORY_INSTRUCTION",
        secondaryRoles: [],
        lines,
        selectionReasons: [{ kind: "REQUIRED_INSTRUCTION", detail: "root repository-provided instructions", contribution: 0 }],
      };
      const representations = buildRepresentations(base, signalValues, estimator, timers, true);
      if (representations.length === 0) {
        recordDrop(null, null, "AGENTS.md", "NO_USEFUL_RANGE");
        diagnostics.add("REPOSITORY_INSTRUCTION_PARTIAL");
      } else {
        instructionPlan = { ...base, representations, selectedLevel: 0 };
        plans.push(instructionPlan);
      }
    }
  }

  for (let index = 0; index < search.result.candidates.length; index += 1) {
    const candidate = search.result.candidates[index];
    if (candidate === undefined) continue;
    const rank = index + 1;
    if (candidate.relativePath === "AGENTS.md") {
      recordDrop(candidate, rank, candidate.relativePath, "DUPLICATE");
      continue;
    }
    const file = fileByPath.get(candidate.relativePath);
    if (file === undefined || file.contentStatus !== "text" || file.contentHash === null) {
      recordDrop(candidate, rank, candidate.relativePath, "UNSUPPORTED_CONTENT");
      continue;
    }
    if (verifiedFiles >= PACK_V1.maximumCandidateSources || verifiedBytes + (file.size ?? 0) > PACK_V1.maximumVerifiedBytes) {
      verificationLimited = true;
      recordDrop(candidate, rank, candidate.relativePath, "SOURCE_VERIFICATION_LIMIT");
      continue;
    }
    const lines = await verify(file);
    if (lines === null) {
      recordDrop(candidate, rank, candidate.relativePath, verificationLimited ? "SOURCE_VERIFICATION_LIMIT" : "STALE_SOURCE");
      continue;
    }
    const roleStarted = performance.now();
    const role = roleFor(candidate);
    const base: Omit<CandidatePlan, "representations" | "selectedLevel"> = {
      candidate,
      file,
      rank,
      role,
      secondaryRoles: secondaryRoles(candidate, role),
      lines,
      selectionReasons: selectionReasons(candidate),
    };
    timers.roleAssignmentMs += performance.now() - roleStarted;
    const representations = buildRepresentations(base, signalValues, estimator, timers);
    if (representations.length === 0) {
      recordDrop(candidate, rank, candidate.relativePath, "NO_USEFUL_RANGE");
      continue;
    }
    plans.push({ ...base, representations, selectedLevel: -1 });
  }

  if (verificationLimited) diagnostics.add("SOURCE_VERIFICATION_LIMIT");
  if (staleSource) diagnostics.add("STALE_SELECTED_SOURCE");
  const candidates = plans.filter((plan) => plan.candidate !== null);
  const protectedPlan = candidates[0];
  if (protectedPlan === undefined) {
    throw new ContextForgeError("PACK_FAILED", "No generation-verified useful candidate is available for this task. Reindex or make the task more specific.");
  }
  protectedPlan.selectedLevel = 0;

  const emptyRenderStarted = performance.now();
  const emptyMarkdown = renderContextMarkdown(markdownInput(
    request.task,
    search.result.repository.name,
    snapshot.generation,
    search.result.rankingStrategy,
    estimator.id,
    estimator.version,
    request.budget,
    [],
    null,
  ));
  timers.serializationMs += performance.now() - emptyRenderStarted;
  const skeletonCost = estimator.estimate(emptyMarkdown);
  const requiredPlans = plans.filter((plan) => plan.selectedLevel >= 0);
  const minimumRenderStarted = performance.now();
  const minimumMarkdown = renderContextMarkdown(markdownInput(
    request.task,
    search.result.repository.name,
    snapshot.generation,
    search.result.rankingStrategy,
    estimator.id,
    estimator.version,
    request.budget,
    requiredPlans,
    null,
  ));
  timers.serializationMs += performance.now() - minimumRenderStarted;
  const minimumRequiredEstimate = estimator.estimate(minimumMarkdown);
  if (minimumRequiredEstimate > request.budget) {
    throw new ContextForgeError(
      "BUDGET_TOO_SMALL",
      `Budget ${request.budget} cannot fit the required envelope and one useful context unit; minimum estimate is ${minimumRequiredEstimate} using ${estimator.id}.`,
    );
  }

  const instructionCost = instructionPlan === null
    ? 0
    : (chosenRepresentation(instructionPlan)?.estimatedTokens ?? 0);
  const flexibleBudget = Math.max(0, request.budget - skeletonCost - instructionCost);
  for (const role of PACK_V1.roleOrder) {
    const rolePlans = candidates.filter((plan) => plan.role === role);
    const target = flexibleBudget * PACK_V1.flexibleShares[role];
    for (const plan of rolePlans) {
      if (plan.selectedLevel >= 0 || roleCount(plans, role) >= PACK_V1.maximumItems[role]) continue;
      const minimum = plan.representations[0];
      if (minimum === undefined || sectionCost(plans, role) + minimum.estimatedTokens > target) continue;
      selectLevelIfFits(plan, 0, plans, skeletonCost, 0, request.budget);
    }
  }

  for (const role of ["TEST", "DEPENDENCY", "DOCUMENTATION", "CONFIGURATION"] as const) {
    if (roleCount(plans, role) > 0) continue;
    const first = candidates.find((plan) => plan.role === role && plan.selectedLevel < 0);
    if (first !== undefined) selectLevelIfFits(first, 0, plans, skeletonCost, 0, request.budget);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const role of PACK_V1.roleOrder) {
      const rolePlans = candidates.filter((plan) => plan.role === role);
      for (const plan of rolePlans.filter((item) => item.selectedLevel >= 0)) {
        const next = plan.selectedLevel + 1;
        if (next < plan.representations.length && selectLevelIfFits(plan, next, plans, skeletonCost, 0, request.budget)) changed = true;
      }
      if (roleCount(plans, role) < PACK_V1.maximumItems[role]) {
        const nextPlan = rolePlans.find((plan) => plan.selectedLevel < 0);
        if (nextPlan !== undefined && selectLevelIfFits(nextPlan, 0, plans, skeletonCost, 0, request.budget)) changed = true;
      }
    }
  }

  let gitContext: string | null = null;
  let gitTokens = 0;
  const git = snapshot.graph?.git;
  if (git?.status === "available" && (git.branch !== null || git.head !== null)) {
    const selectedPaths = new Set(plans.filter((plan) => plan.selectedLevel >= 0).map((plan) => plan.file.relativePath));
    const dirty = git.files
      .filter((file) => selectedPaths.has(file.relativePath) && file.workingTreeStatus !== "clean")
      .slice(0, 5)
      .map((file) => `${file.relativePath}: ${file.workingTreeStatus}`);
    const proposed = [
      ...(git.branch === null ? [] : [`Branch: ${git.branch}`]),
      ...(git.head === null ? [] : [`HEAD: ${git.head}`]),
      ...dirty,
    ].join("\n");
    const proposedTokens = estimator.estimate(proposed);
    if (
      proposedTokens <= PACK_V1.gitMaximumTokens &&
      approximateCost(skeletonCost, plans, proposedTokens) <= request.budget
    ) {
      gitContext = proposed;
      gitTokens = proposedTokens;
    }
  }

  let renderStarted = performance.now();
  let markdown = renderContextMarkdown(markdownInput(
    request.task,
    search.result.repository.name,
    snapshot.generation,
    search.result.rankingStrategy,
    estimator.id,
    estimator.version,
    request.budget,
    plans,
    gitContext,
  ));
  timers.serializationMs += performance.now() - renderStarted;
  let finalVerificationStarted = performance.now();
  let finalEstimate = estimator.estimate(markdown);
  let finalVerificationMs = performance.now() - finalVerificationStarted;
  const reductionStarted = performance.now();
  let reductionIterations = 0;
  const maximumReductionIterations = plans.reduce((total, plan) => total + plan.representations.length + 1, 1);
  while (finalEstimate > request.budget && reductionIterations < maximumReductionIterations) {
    reductionIterations += 1;
    if (gitContext !== null) {
      gitContext = null;
      gitTokens = 0;
    } else {
      const reducible = reductionOrder(plans, protectedPlan).find((plan) => {
        if (plan === protectedPlan && plan.selectedLevel === 0) return false;
        if (plan === instructionPlan && plan.selectedLevel === 0) return false;
        return true;
      });
      if (reducible === undefined) break;
      reducible.selectedLevel -= 1;
    }
    renderStarted = performance.now();
    markdown = renderContextMarkdown(markdownInput(
      request.task,
      search.result.repository.name,
      snapshot.generation,
      search.result.rankingStrategy,
      estimator.id,
      estimator.version,
      request.budget,
      plans,
      gitContext,
    ));
    timers.serializationMs += performance.now() - renderStarted;
    finalVerificationStarted = performance.now();
    finalEstimate = estimator.estimate(markdown);
    finalVerificationMs += performance.now() - finalVerificationStarted;
  }
  const reductionMs = performance.now() - reductionStarted;
  if (finalEstimate > request.budget) {
    throw new ContextForgeError(
      "BUDGET_TOO_SMALL",
      `Budget ${request.budget} cannot fit the minimum useful pack; minimum estimate is ${minimumRequiredEstimate} using ${estimator.id}.`,
    );
  }

  for (const plan of candidates.filter((plan) => plan.selectedLevel < 0)) {
    recordDrop(plan.candidate, plan.rank, plan.file.relativePath, approximateCost(skeletonCost, plans, gitTokens) >= request.budget ? "BUDGET_EXHAUSTED" : "SECTION_LIMIT");
  }
  const selectedItems: SelectedContextItem[] = plans.flatMap((plan) => {
    const representation = chosenRepresentation(plan);
    if (representation === null) return [];
    const rendered = renderContextItem(renderable(plan, representation));
    return [{
      identity: plan.candidate?.identity ?? `file:${plan.file.relativePath}`,
      relativePath: plan.file.relativePath,
      role: plan.role,
      secondaryRoles: plan.secondaryRoles,
      candidateRank: plan.rank,
      candidateScore: plan.candidate?.rawScore ?? null,
      candidateOrigin: plan.candidate?.origin ?? null,
      graphDistance: plan.candidate?.graphDistance ?? null,
      selectionReasons: plan.selectionReasons,
      relevantSymbols: selectedSymbols(plan, representation.ranges),
      selectedRanges: representation.ranges,
      wholeFile: representation.wholeFile,
      estimatedTokens: estimator.estimate(rendered),
      contentStatus: representation.wholeFile ? "VERIFIED_GENERATION" : "PARTIAL",
    } satisfies SelectedContextItem];
  });
  const sectionRoles = PACK_V1.sectionOrder;
  const sections = sectionRoles.map((role) => {
    if (role === "GIT_CONTEXT") return { role, selectedItems: gitContext === null ? 0 : 1, estimatedTokens: gitTokens };
    const items = selectedItems.filter((item) => item.role === role);
    return { role, selectedItems: items.length, estimatedTokens: items.reduce((total, item) => total + item.estimatedTokens, 0) };
  });
  const packPartial = staleSource || verificationLimited || (instructionFile !== undefined && (instructionPlan === null || chosenRepresentation(instructionPlan)?.wholeFile !== true));
  if (packPartial) diagnostics.add("PACK_PARTIAL");
  const unusedBudget = request.budget - finalEstimate;
  const manifest: ContextPackManifest = {
    schemaVersion: CONTEXT_PACK_SCHEMA_VERSION,
    task: request.task,
    repository: search.result.repository,
    generation: snapshot.generation,
    indexStatus: search.result.indexStatus,
    packStatus: packPartial ? "PARTIAL" : "COMPLETE",
    rankingStrategy: search.result.rankingStrategy,
    packingStrategy: PACKING_STRATEGY,
    tokenEstimator: estimator.id,
    tokenEstimatorVersion: estimator.version,
    requestedBudget: request.budget,
    estimatedPayloadTokens: finalEstimate,
    unusedBudget,
    utilization: round(finalEstimate / request.budget),
    unusedBudgetReason: unusedBudget === 0
      ? null
      : staleSource
        ? "STALE_HIGH_VALUE_CONTEXT"
        : candidates.some((plan) => plan.selectedLevel < 0)
          ? "SECTION_POLICY_LIMIT"
          : "NO_MORE_USEFUL_CONTEXT",
    sections,
    selectedItems,
    droppedCandidates: dropped.sort((left, right) => (left.candidateRank ?? Number.MAX_SAFE_INTEGER) - (right.candidateRank ?? Number.MAX_SAFE_INTEGER) || compareText(left.relativePath, right.relativePath)),
    droppedSummary: Object.fromEntries(DROP_REASONS.map((reason) => [reason, droppedCounts.get(reason) ?? 0])) as Record<DropReason, number>,
    diagnostics: [...diagnostics].sort(compareText),
  };
  const planningMs = performance.now() - planningStarted;
  return {
    ...(capsuleDrops === undefined ? {} : { capsule: buildContextCapsule(snapshot, scan, search.result, manifest, markdown, capsuleDrops.map((d) => ({ path: d.relativePath, rank: d.candidateRank, reason: d.dropReason }))) }),
    markdown,
    manifest,
    performance: {
      searchMs: search.performance.totalMs,
      planningMs,
      roleAssignmentMs: timers.roleAssignmentMs,
      sourceVerificationMs: timers.sourceVerificationMs,
      rangeSelectionMs: timers.rangeSelectionMs,
      rangeMergingMs: timers.rangeMergingMs,
      tokenEstimationMs: timers.tokenEstimationMs,
      serializationMs: timers.serializationMs,
      finalVerificationMs,
      reductionMs,
      reductionIterations,
      totalMs: performance.now() - totalStarted,
      verifiedFiles,
      verifiedBytes,
    },
  };
}
