import { performance } from "node:perf_hooks";
import { buildContextCapsule } from "./build-context-capsule.js";
import type { ContextCapsuleV1 } from "../core/context-capsule.js";
import type { RepositoryScanner } from "./map-repository.js";
import type { RepositorySourceReader } from "./repository-source.js";
import type { ContextPackRequest } from "./build-context-pack.js";
import { validateTokenBudget } from "./build-context-pack.js";
import type { SearchExecutionV2 } from "./search-repository-v2.js";
import { searchRepositoryV2 } from "./search-repository-v2.js";
import type { IndexRepositoryFactory, IndexedFile } from "../core/repository-index.js";
import type { RelationshipSyntaxAnalyzer } from "../core/language-analysis.js";
import type { ContextRange, SelectedContextItem } from "../core/context-pack.js";
import { renderContextItem, renderContextMarkdown, type RenderableContextItem } from "../core/context-serialization.js";
import { ContextForgeError } from "../core/errors.js";
import { buildPackContextPlan, classifyPackCandidate, PLAN_ROLES, type PackContextPlan } from "../core/packing/context-plan.js";
import { PACK_V2, PACK_V2_STRATEGY, PACK_V2_POLICY, selectPlanAwarePack, type PackDropReason, type PackRangeOption, type PreparedPackCandidate } from "../core/packing/pack-v2.js";
import { boundedRange, logicalLines, mergeContextRanges, rangeContains } from "../core/packing/ranges.js";
import { selectMarkdownSectionRanges } from "../core/packing/markdown-sections.js";
import type { RankedFileCandidateV2 } from "../core/task-retrieval-v2.js";
import { GenericTokenEstimator, type TokenEstimator } from "../core/token-estimation.js";
import { createRequestFragmentRenderer } from "../core/packing/request-fragments.js";

export type PackV2Search = (request: { readonly repositoryPath: string; readonly task: string; readonly limit: number; readonly captureCapsule?: boolean }) => Promise<SearchExecutionV2>;
export interface PackV2Options {
  readonly estimator?: TokenEstimator;
  readonly relationshipAnalyzer?: RelationshipSyntaxAnalyzer;
  readonly search?: PackV2Search;
  readonly planVariant?: PackContextPlan["variant"];
}
interface Prepared extends PreparedPackCandidate {
  readonly candidate: RankedFileCandidateV2;
  readonly item: RenderableContextItem;
}

function itemRole(candidate: RankedFileCandidateV2): SelectedContextItem["role"] {
  if (candidate.category === "test") return "TEST";
  if (candidate.category === "documentation") return "DOCUMENTATION";
  if (candidate.category === "configuration") return "CONFIGURATION";
  return candidate.origin === "EXPANDED" ? "DEPENDENCY" : "PRIMARY_CODE";
}

function rangeOptions(item: RenderableContextItem, file: IndexedFile, candidate: RankedFileCandidateV2 | null, signals: readonly string[], estimator: TokenEstimator): { options: PackRangeOption[]; preferred: number } {
  const options: PackRangeOption[] = [];
  const add = (ranges: readonly ContextRange[], wholeFile = false): void => {
    const merged = mergeContextRanges(ranges, 0);
    if (merged.length === 0 || merged.length > PACK_V2.maximumRanges) return;
    if (options.some((option) => JSON.stringify(option.ranges) === JSON.stringify(merged))) return;
    options.push({ ranges: merged, wholeFile, tokens: estimator.estimate(renderContextItem({ ...item, ranges: merged, partial: !wholeFile })) });
  };
  const whole: ContextRange = { startLine: 1, endLine: item.lines.length, reasons: ["WHOLE_FILE"] };
  const instruction = candidate === null;
  const sourceCost = estimator.estimate(item.lines.join("\n"));
  const smallWhole = item.lines.length <= PACK_V2.wholeFileMaximumLines && sourceCost <= PACK_V2.wholeFileMaximumTokens;
  if ((instruction && sourceCost <= PACK_V2.instructionMaximumTokens) || (smallWhole && (candidate?.relevantSymbols.length ?? 0) === 0)) {
    add([whole], true);
    return { options, preferred: 0 };
  }
  if (item.role === "DOCUMENTATION" || instruction) {
    const sections = selectMarkdownSectionRanges(item.lines, signals, instruction ? PACK_V2.maximumInstructionSections : 3);
    if (instruction && sections[0] !== undefined) {
      const first = sections[0];
      const prefix = boundedRange(first.startLine, Math.min(first.endLine, first.startLine + 7), item.lines.length, ["MARKDOWN_SECTION", "BOUNDED_FILE_PREFIX"]);
      if (prefix !== null) add([prefix]);
    }
    if (sections[0] !== undefined) add([sections[0]]);
    add(sections);
  } else if (candidate !== null && candidate.relevantSymbols.length > 0) {
    const indexed = new Map(file.analysis.symbols.map((symbol) => [symbol.id, symbol]));
    const symbols = candidate.relevantSymbols.filter((symbol) => {
      const actual = indexed.get(symbol.identity);
      return actual !== undefined && actual.startLine === symbol.startLine && actual.endLine === symbol.endLine && symbol.endLine <= item.lines.length;
    }).slice(0, PACK_V2.maximumSymbols);
    for (const count of [1, 2, PACK_V2.maximumSymbols]) {
      add(symbols.slice(0, count).map((symbol) => ({ startLine: symbol.startLine, endLine: symbol.endLine, reasons: ["SYMBOL_RANGE"] })));
    }
    if (smallWhole) { add([whole], true); return { options, preferred: options.length - 1 }; }
    const preferred = options.length - 1;
    add(symbols.flatMap((symbol) => {
      const range = boundedRange(symbol.startLine - 3, symbol.endLine + 3, item.lines.length, ["SYMBOL_RANGE", "SURROUNDING_CONTEXT"]);
      return range === null ? [] : [range];
    }));
    return { options, preferred };
  } else {
    const normalized = signals.map((signal) => signal.toLowerCase()).filter((signal) => signal.length >= 2);
    const ranges: ContextRange[] = [];
    for (let index = 0; index < item.lines.length && ranges.length < 3; index += 1) {
      if (!normalized.some((signal) => (item.lines[index] ?? "").toLowerCase().includes(signal))) continue;
      const range = boundedRange(index + 1 - 3, index + 1 + 3, item.lines.length, ["LEXICAL_RANGE", "SURROUNDING_CONTEXT"]);
      if (range !== null) ranges.push(range);
    }
    if (ranges[0] !== undefined) add([ranges[0]]);
    add(ranges);
    if (ranges.length === 0) {
      const prefix = boundedRange(1, 80, item.lines.length, ["BOUNDED_FILE_PREFIX"]);
      if (prefix !== null) add([prefix]);
    }
  }
  return { options: instruction ? options.filter((option) => option.tokens <= PACK_V2.instructionMaximumTokens) : options, preferred: 0 };
}

/** Experimental application path; CLI/MCP composition continues to call Pack V1. */
export async function buildContextPackV2(scanner: RepositoryScanner, reader: RepositorySourceReader, factory: IndexRepositoryFactory, request: ContextPackRequest, options: PackV2Options = {}) {
  const started = performance.now();
  validateTokenBudget(request.budget);
  const estimator = options.estimator ?? new GenericTokenEstimator();
  const searchStarted = performance.now();
  const search = await (options.search ?? ((input) => searchRepositoryV2(scanner, reader, factory, { ...input, ablation: "RELATION_FULL" }, options.relationshipAnalyzer)))({ ...request, limit: PACK_V2.candidateLimit });
  const searchMs = performance.now() - searchStarted;
  const planStarted = performance.now();
  const plan = buildPackContextPlan(search.result.taskAnalysis, options.planVariant);
  const contextPlanMs = performance.now() - planStarted;
  const { scan, snapshot } = search.context;
  if (snapshot.generation !== search.result.generation) throw new ContextForgeError("PACK_FAILED", "Search and packing generation identities do not match.");
  const files = new Map(snapshot.files.map((file) => [file.relativePath, file]));
  const entries = new Map(scan.entries.map((entry) => [entry.path, entry]));
  const signals = search.result.normalizedQuery.signals.filter((signal) => !signal.lowValue).map((signal) => signal.normalized);
  const dropped: { path: string; rank: number | null; reason: PackDropReason }[] = [];
  const sourceSafetyExclusions = request.captureCapsule === true ? new Set<number | null>() : undefined;
  const prepared: Prepared[] = [];
  let verifiedFiles = 0;
  let verifiedBytes = 0;
  let sourceVerificationMs = 0;
  let rangeSelectionMs = 0;
  let roleAssignmentMs = 0;
  let partial = false;
  const read = async (path: string, rank: number | null): Promise<{ file: IndexedFile; lines: readonly string[] } | null> => {
    const file = files.get(path);
    const entry = entries.get(path);
    if (file === undefined || entry === undefined || file.contentStatus !== "text" || entry.content !== "text" || file.contentHash === null || entry.category === "dependency" || entry.category === "generated") {
      dropped.push({ path, rank, reason: "UNSUPPORTED_CONTENT" });
      return null;
    }
    if (verifiedFiles >= PACK_V2.candidateLimit || verifiedBytes + (entry.size ?? 0) > PACK_V2.maximumVerifiedBytes) {
      sourceSafetyExclusions?.add(rank);
      dropped.push({ path, rank, reason: "SAFETY_LIMIT" }); partial = true; return null;
    }
    const readStarted = performance.now();
    const source = await reader.readTextFile(scan.rootRealPath, entry);
    sourceVerificationMs += performance.now() - readStarted;
    verifiedFiles += 1;
    if (source.status !== "read" || source.contentHash !== file.contentHash) {
      dropped.push({ path, rank, reason: "STALE_SOURCE" }); partial = true; return null;
    }
    verifiedBytes += source.size;
    if (verifiedBytes > PACK_V2.maximumVerifiedBytes) { sourceSafetyExclusions?.add(rank); dropped.push({ path, rank, reason: "SAFETY_LIMIT" }); partial = true; return null; }
    return { file, lines: logicalLines(source.source) };
  };
  let instruction: RenderableContextItem | null = null;
  if (files.has("AGENTS.md")) {
    const content = await read("AGENTS.md", null);
    if (content !== null) {
      const item: RenderableContextItem = { identity: "file:AGENTS.md", relativePath: "AGENTS.md", role: "REPOSITORY_INSTRUCTION", ranges: [], lines: content.lines, language: "markdown", selectionReasons: [{ kind: "REQUIRED_INSTRUCTION", detail: "root repository-provided instructions", contribution: 0 }], partial: true };
      const selected = rangeOptions(item, content.file, null, signals, estimator).options[0];
      if (selected !== undefined) instruction = { ...item, ranges: selected.ranges, partial: !selected.wholeFile };
    }
    if (instruction === null || instruction.partial) partial = true;
  }
  const seen = new Set<string>();
  for (const [index, candidate] of search.result.candidates.slice(0, PACK_V2.candidateLimit).entries()) {
    const rank = index + 1;
    if (candidate.relativePath === "AGENTS.md" && instruction !== null) continue;
    if (seen.has(candidate.relativePath)) { dropped.push({ path: candidate.relativePath, rank, reason: "REDUNDANT_RANGE" }); continue; }
    seen.add(candidate.relativePath);
    if (candidate.generation !== snapshot.generation) { dropped.push({ path: candidate.relativePath, rank, reason: "STALE_SOURCE" }); partial = true; continue; }
    const content = await read(candidate.relativePath, rank);
    if (content === null) continue;
    const roleStarted = performance.now();
    const classification = classifyPackCandidate(candidate);
    roleAssignmentMs += performance.now() - roleStarted;
    const item: RenderableContextItem = { identity: candidate.identity, relativePath: candidate.relativePath, role: itemRole(candidate), ranges: [], lines: content.lines, language: content.file.analysis.language, selectionReasons: candidate.scoreContributions.slice(0, 16).map((entry) => ({ kind: entry.kind, detail: entry.reason, contribution: entry.value })), partial: true };
    const rangeStarted = performance.now();
    const variants = rangeOptions(item, content.file, candidate, signals, estimator);
    rangeSelectionMs += performance.now() - rangeStarted;
    if (variants.options.length === 0) { dropped.push({ path: candidate.relativePath, rank, reason: "NO_USEFUL_RANGE" }); continue; }
    prepared.push({ path: candidate.relativePath, rank, classification, candidate, item, ...variants });
  }
  let serializationMs = 0;
  let tokenEstimationMs = 0;
  const fragments = createRequestFragmentRenderer();
  const optionItems = new Map<PackRangeOption, RenderableContextItem>();
  const render = (levels: ReadonlyMap<string, number>, final = false): string => {
    const begin = performance.now();
    const markdown = renderContextMarkdown({ task: request.task, repositoryName: search.result.repository.name, generation: snapshot.generation, rankingStrategy: search.result.rankingStrategy, packingStrategy: PACK_V2_STRATEGY, tokenEstimator: estimator.id, tokenEstimatorVersion: estimator.version, requestedBudget: request.budget, gitContext: null,
      items: [...(instruction === null ? [] : [instruction]), ...prepared.flatMap((entry) => {
        const level = levels.get(entry.path);
        const selected = level === undefined ? undefined : entry.options[level];
        if (selected === undefined) return [];
        let item = optionItems.get(selected);
        if (item === undefined) {
          item = { ...entry.item, ranges: selected.ranges, partial: !selected.wholeFile };
          optionItems.set(selected, item);
        }
        return [item];
      })],
    }, final ? renderContextItem : fragments.render);
    serializationMs += performance.now() - begin;
    return markdown;
  };
  const cost = (levels: ReadonlyMap<string, number>): number => {
    const markdown = render(levels);
    const begin = performance.now();
    const tokens = estimator.estimate(markdown);
    tokenEstimationMs += performance.now() - begin;
    return tokens;
  };
  const selectionStarted = performance.now();
  const selection = selectPlanAwarePack(prepared, plan, request.budget, cost);
  const selectionMs = performance.now() - selectionStarted;
  if (selection.levels.size === 0) throw new ContextForgeError(prepared.length === 0 ? "PACK_FAILED" : "BUDGET_TOO_SMALL", "No generation-verified useful candidate fits the complete serialized pack.");
  // Independently serialize without the cache and verify the unchanged estimator.
  const markdown = render(selection.levels, true);
  const estimatedPayloadTokens = estimator.estimate(markdown);
  if (estimatedPayloadTokens > request.budget) throw new ContextForgeError("PACK_FAILED", "Final serialized Pack V2 exceeds the requested budget.");
  const selectedItems: SelectedContextItem[] = prepared.flatMap((entry) => {
    const level = selection.levels.get(entry.path);
    const selected = level === undefined ? undefined : entry.options[level];
    if (selected === undefined) return [];
    return [{ identity: entry.candidate.identity, relativePath: entry.path, role: entry.item.role, secondaryRoles: [], candidateRank: entry.rank, candidateScore: entry.candidate.rawScore, candidateOrigin: entry.candidate.origin, graphDistance: entry.candidate.graphDistance, selectionReasons: entry.item.selectionReasons,
      relevantSymbols: entry.candidate.relevantSymbols.filter((symbol) => selected.ranges.some((range) => rangeContains(range, symbol.startLine, symbol.endLine))).map(({ identity, name, qualifiedName, startLine, endLine }) => ({ identity, name, qualifiedName, startLine, endLine })),
      selectedRanges: selected.ranges, wholeFile: selected.wholeFile, estimatedTokens: selected.tokens, contentStatus: selected.wholeFile ? "VERIFIED_GENERATION" : "PARTIAL" }];
  });
  if (instruction !== null) selectedItems.unshift({ identity: instruction.identity, relativePath: instruction.relativePath, role: instruction.role, secondaryRoles: [], candidateRank: null, candidateScore: null, candidateOrigin: null, graphDistance: null, selectionReasons: instruction.selectionReasons, relevantSymbols: [], selectedRanges: instruction.ranges, wholeFile: !instruction.partial, estimatedTokens: estimator.estimate(renderContextItem(instruction)), contentStatus: instruction.partial ? "PARTIAL" : "VERIFIED_GENERATION" });
  dropped.push(...selection.drops.map((drop) => ({ ...drop, rank: prepared.find((entry) => entry.path === drop.path)?.rank ?? null })));
  const execution = {
    markdown,
    manifest: { schemaVersion: "2.0", task: request.task, repository: search.result.repository, generation: snapshot.generation, indexStatus: search.result.indexStatus, packStatus: partial ? "PARTIAL" as const : "COMPLETE" as const, rankingStrategy: search.result.rankingStrategy, packingStrategy: PACK_V2_STRATEGY, tokenEstimator: estimator.id, tokenEstimatorVersion: estimator.version, requestedBudget: request.budget, estimatedPayloadTokens, unusedBudget: request.budget - estimatedPayloadTokens, selectedItems, droppedCandidates: dropped.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)), diagnostics: [...search.result.diagnostics, ...(partial ? ["PACK_PARTIAL"] : [])], plan,
      planDiagnostics: {
        policy: PACK_V2_POLICY, anchor: selection.anchor, targetFacet: selection.targetFacet,
        targetFacetSatisfied: prepared.some((entry) => selection.levels.has(entry.path) && entry.classification.facet === selection.targetFacet && entry.classification.strongPrimary), events: selection.events,
        roles: PLAN_ROLES.map((role) => {
          const available = prepared.filter((entry) => entry.classification.roles.includes(role));
          const selected = available.filter((entry) => selection.levels.has(entry.path));
          return { role, priority: plan.roles.find((entry) => entry.role === role)?.priority, available: available.length, selected: selected.length, dropped: available.length - selected.length, protectionSatisfied: selected.length > 0, unavailable: available.length === 0,
            // Multi-role coverage totals overlap; payload is charged once globally.
            estimatedTokens: selected.reduce((sum, entry) => sum + (entry.options[selection.levels.get(entry.path) ?? 0]?.tokens ?? 0), 0),
            unusedOpportunity: selected.length === 0 ? plan.roles.find((entry) => entry.role === role)?.opportunity ?? 0 : 0,
            borrowedItems: selection.events.filter((event) => event.phase === "GLOBAL" && selected.some((entry) => entry.path === event.path)).length };
        }),
        candidates: prepared.map((entry) => ({ path: entry.path, rank: entry.rank, ...entry.classification, selectedLevel: selection.levels.get(entry.path) ?? null, options: entry.options, evidence: [...entry.candidate.directEvidence, ...entry.candidate.expansionEvidence] })),
      },
    },
    performance: { searchMs, contextPlanMs, roleAssignmentMs, sourceVerificationMs, rangeSelectionMs, selectionMs, serializationMs, tokenEstimationMs, verifiedFiles, verifiedBytes, fragmentCache: { ...fragments.counters }, totalMs: performance.now() - started },
  };
  if (sourceSafetyExclusions === undefined) return execution as typeof execution & { readonly capsule?: ContextCapsuleV1 };
  const capsule = buildContextCapsule(snapshot, scan, search.result, execution.manifest, markdown, dropped, { search: search.result, relationships: search.context.capsuleRelationships ?? search.result.relationships, plan, policy: PACK_V2_POLICY, events: selection.events, candidates: execution.manifest.planDiagnostics.candidates, roles: execution.manifest.planDiagnostics.roles, sourceSafetyExclusions });
  return { ...execution, capsule, performance: { ...execution.performance, totalMs: performance.now() - started } };
}
