import { performance } from "node:perf_hooks";
import type { ScanResult } from "./map-repository.js";
import type { ContextPackSearchExecution } from "./build-context-pack.js";
import type { RepositoryIndexSnapshot } from "../core/repository-index.js";
import { INDEX_SCHEMA_VERSION } from "../core/repository-index.js";
import type { SelectedContextItem } from "../core/context-pack.js";
import { CAPSULE_SCHEMA, EXPLAIN_SCHEMA, capsuleId, capsulePath, hashCapsuleCore, sha256, type CapsuleCore, type ContextCapsuleV1 } from "../core/context-capsule.js";
import type { SearchResultV2 } from "../core/task-retrieval-v2.js";
import type { PackContextPlan, CandidateRoles } from "../core/packing/context-plan.js";
import type { PackSelectionEvent } from "../core/packing/pack-v2.js";
import { RELATIONSHIP_INTELLIGENCE_V2_VERSION } from "../core/relationship-intelligence-v2.js";
import { ContextForgeError } from "../core/errors.js";

interface PackObservation {
  readonly task: string;
  readonly requestedBudget: number;
  readonly estimatedPayloadTokens: number;
  readonly packingStrategy: string;
  readonly tokenEstimator: string;
  readonly tokenEstimatorVersion: string;
  readonly selectedItems: readonly SelectedContextItem[];
  readonly diagnostics: readonly string[];
}
interface DropObservation { readonly path: string; readonly rank: number | null; readonly reason: CapsuleCore["decisions"][number]["reason"] }
export interface CapsuleV2Observation {
  readonly search: SearchResultV2;
  readonly relationships: SearchResultV2["relationships"];
  readonly plan: PackContextPlan;
  readonly policy: string;
  readonly events: readonly PackSelectionEvent[];
  readonly candidates: readonly ({ readonly path: string } & CandidateRoles)[];
  readonly roles: readonly { readonly role: string; readonly available: number; readonly selected: number; readonly estimatedTokens: number; readonly borrowedItems: number }[];
  readonly sourceSafetyExclusions: ReadonlySet<number | null>;
}

const FINAL_ROLES = ["REPOSITORY_INSTRUCTION", "PRIMARY_CODE", "TEST", "DEPENDENCY", "DOCUMENTATION", "CONFIGURATION"];
const EXCLUSIONS = new Set(["STALE_SOURCE", "UNSUPPORTED_CONTENT", "SOURCE_VERIFICATION_LIMIT"]);

/** Omit machine path-bearing task strings, while retaining identity of the raw request. */
function taskText(value: string): string | null {
  return /(?:[a-z]:[\\/]|\\\\|(?:^|[\s"'`(])\/)/iu.test(value) ? null : value;
}

/** Consumes one compilation's existing structures. No IO and no selection decisions. */
export function buildContextCapsule(
  snapshot: RepositoryIndexSnapshot, scan: ScanResult, search: ContextPackSearchExecution["result"],
  pack: PackObservation, markdown: string, drops: readonly DropObservation[], v2?: CapsuleV2Observation,
): ContextCapsuleV1 {
  const started = performance.now();
  const safeTask = taskText(pack.task);
  const indexed = new Map(snapshot.files.map((file) => [file.relativePath, file]));
  const files = new Map<string, CapsuleCore["files"][number]>();
  const symbols = new Map<string, CapsuleCore["symbols"][number]>();
  const ranges = new Map<string, CapsuleCore["ranges"][number]>();
  const evidence = new Map<string, CapsuleCore["evidence"][number]>();
  const relationships = new Map<string, CapsuleCore["relationships"][number]>();
  const candidates: CapsuleCore["candidates"] = [];
  const decisions: CapsuleCore["decisions"] = [];
  const selected: CapsuleCore["selected"] = [];
  const fileRef = (raw: string): string => {
    const path = capsulePath(raw), id = capsuleId("file", path), file = indexed.get(path);
    files.set(id, { id, path, sourceHash: file?.contentHash ?? null, language: file?.analysis.language ?? null, category: file?.category ?? "unknown" });
    return id;
  };
  const symbolRef = (path: string, identity: string): string | null => {
    const symbol = indexed.get(path)?.analysis.symbols.find((item) => item.id === identity);
    if (symbol === undefined) return null;
    symbols.set(symbol.id, { id: symbol.id, fileRef: fileRef(path), name: symbol.name, qualifiedName: symbol.qualifiedName, kind: symbol.kind, parentId: symbol.parentSymbolId, startLine: symbol.startLine, endLine: symbol.endLine, startColumn: symbol.startColumn, endColumn: symbol.endColumn });
    return symbol.id;
  };
  const relationById = new Map([...(v2?.search.relationships ?? []), ...(v2?.relationships ?? [])].map((r) => [r.id, r]));
  const graphById = new Map(snapshot.graph?.edges.map((r) => [r.id, r]) ?? []);
  const relationshipRef = (identity: string | undefined | null): string | null => {
    if (identity === undefined || identity === null) return null;
    const r = relationById.get(identity);
    if (r === undefined) {
      const edge = graphById.get(identity);
      if (edge === undefined) throw new ContextForgeError("INVALID_CAPSULE", "Compiler evidence references an unrecorded relationship.");
      relationships.set(edge.id, { id: edge.id, type: edge.kind, sourceFileRef: fileRef(edge.sourcePath), targetFileRef: fileRef(edge.targetPath), sourceSymbolId: null, targetSymbolId: null, classification: edge.derivation === "structural" ? "STRUCTURAL_FACT" : "HEURISTIC", confidence: edge.confidence, distance: 1, derivation: edge.derivation, provenance: "GENERATION_GRAPH", generation: snapshot.generation, location: null });
      return edge.id;
    }
    relationships.set(r.id, { id: r.id, type: r.type, sourceFileRef: fileRef(r.source.file), targetFileRef: fileRef(r.target.file), sourceSymbolId: r.source.symbolId === null ? null : symbolRef(r.source.file, r.source.symbolId), targetSymbolId: r.target.symbolId === null ? null : symbolRef(r.target.file, r.target.symbolId), classification: r.classification, confidence: r.confidence, distance: r.distance, derivation: r.derivation, provenance: r.provenance.kind, generation: r.provenance.generation, location: r.provenance.location });
    return r.id;
  };
  const recordEvidence = (entry: Omit<CapsuleCore["evidence"][number], "id">, subject: string, observation: unknown = null): string => {
    const id = capsuleId("evidence", [subject, entry, observation]); evidence.set(id, { id, ...entry }); return id;
  };
  const ordered = [...pack.selectedItems].sort((a, b) => FINAL_ROLES.indexOf(a.role) - FINAL_ROLES.indexOf(b.role));
  const add = (path: string, rank: number | null, candidate: ContextPackSearchExecution["result"]["candidates"][number] | null, selection: SelectedContextItem | undefined): void => {
    const kind = rank === null ? "INSTRUCTION" : "FILE";
    const id = capsuleId("candidate", [capsulePath(path), kind]);
    const f = fileRef(path);
    const eRefs: string[] = [];
    const rRefs: string[] = [];
    for (const item of [...candidate?.directEvidence ?? [], ...candidate?.expansionEvidence ?? []]) {
      const relation = relationshipRef(item.relationshipId);
      if (relation !== null) rRefs.push(relation);
      eRefs.push(recordEvidence({ stage: "RETRIEVAL", code: item.kind, family: item.family, weight: item.weight,
        derivation: item.derivation ?? (item.kind === "SOURCE_LEXICAL" ? "VERIFIED_SOURCE" : ["TEST_RELATION", "DOCUMENT_RELATION"].includes(item.kind) ? "HEURISTIC" : "RECORDED"),
        confidence: item.confidence ?? null, taskSignalId: item.taskSignalId ?? null, querySignal: safeTask === null ? null : taskText(item.querySignal ?? v2?.search.taskAnalysis.signals.find((s) => s.id === item.taskSignalId)?.normalized ?? "") || null, sourceCandidate: item.sourceCandidate ?? null, location: item.location ?? null, relationshipRef: relation }, id, item.id ?? sha256(item.detail)));
    }
    // Preserve contribution multiplicity: equal weights/codes can describe distinct hits.
    for (const [ordinal, item] of (candidate?.scoreContributions ?? []).entries()) eRefs.push(recordEvidence({ stage: "RANKING", code: item.kind, family: item.family, weight: item.value, derivation: "RECORDED", confidence: null, taskSignalId: null, querySignal: null, sourceCandidate: null, location: null, relationshipRef: null }, id, [item.evidenceId ?? sha256(item.reason), ordinal]));
    if (kind === "INSTRUCTION") eRefs.push(recordEvidence({ stage: "PACKING", code: "REQUIRED_INSTRUCTION", family: "POLICY", weight: 0, derivation: "POLICY", confidence: null, taskSignalId: null, querySignal: null, sourceCandidate: null, location: null, relationshipRef: null }, id));
    const evidenceRefs = [...new Set(eRefs)];
    const drop = drops.find((d) => d.path === path && d.rank === rank);
    // V2 skips the ranked root instruction when its mandatory representation is present.
    const reason = selection !== undefined ? "SELECTED" : drop?.reason ?? (v2 !== undefined && path === "AGENTS.md" && rank !== null && ordered.some((s) => s.relativePath === path) ? "REDUNDANT_RANGE" : null);
    if (reason === null) throw new ContextForgeError("INVALID_CAPSULE", "Compiler candidate has no recorded final disposition.");
    const disposition = selection !== undefined ? "SELECTED" : EXCLUSIONS.has(reason) || (reason === "SAFETY_LIMIT" && v2?.sourceSafetyExclusions.has(rank)) ? "EXCLUDED" : "DROPPED";
    const decisionId = capsuleId("decision", [id, disposition, reason]);
    decisions.push({ id: decisionId, candidateRef: id, stage: disposition === "EXCLUDED" ? "SAFETY" : "PACKING", reason, disposition, decisionSource: "COMPILER", evidenceRefs, requestedBudget: pack.requestedBudget, finalPayloadTokens: pack.estimatedPayloadTokens });
    const symbolRefs = [...new Set((candidate?.relevantSymbols ?? selection?.relevantSymbols ?? []).flatMap((s) => { const ref = symbolRef(path, s.identity); return ref === null ? [] : [ref]; }))];
    const selectedSymbolRefs = selection?.relevantSymbols.flatMap((s) => { const ref = symbolRef(path, s.identity); return ref === null ? [] : [ref]; }) ?? [];
    const rangeRefs = selection?.selectedRanges.map((range) => {
      const ref = capsuleId("range", [capsulePath(path), indexed.get(path)?.contentHash ?? null, range.startLine, range.endLine]);
      ranges.set(ref, { id: ref, fileRef: f, sourceHash: indexed.get(path)?.contentHash ?? null, startLine: range.startLine, endLine: range.endLine, reasons: [...range.reasons], symbolRefs: selectedSymbolRefs.filter((s) => { const symbol = symbols.get(s); return symbol !== undefined && symbol.startLine >= range.startLine && symbol.endLine <= range.endLine; }) });
      return ref;
    }) ?? [];
    const classification = v2?.candidates.find((c) => c.path === path);
    candidates.push({ id, fileRef: f, kind, rank, score: candidate?.rawScore ?? null, origin: candidate?.origin ?? null, graphDistance: candidate?.graphDistance ?? null, symbolRefs, rangeRefs, evidenceRefs, relationshipRefs: [...new Set(rRefs)], planRoles: [...classification?.roles ?? []], facet: classification?.facet ?? null, directness: classification?.directness ?? null, disposition, decisionRefs: [decisionId] });
    if (selection !== undefined) selected.push({ candidateRef: id, finalOrder: ordered.indexOf(selection), role: selection.role, secondaryRoles: [...selection.secondaryRoles], rangeRefs, symbolRefs: selectedSymbolRefs, estimatedTokens: selection.estimatedTokens, wholeFile: selection.wholeFile, evidenceRefs, decisionRefs: [decisionId] });
  };
  for (const [index, candidate] of search.candidates.entries()) add(candidate.relativePath, index + 1, candidate, ordered.find((s) => s.relativePath === candidate.relativePath && s.candidateRank === index + 1));
  for (const item of ordered.filter((s) => s.candidateRank === null)) add(item.relativePath, null, null, item);
  for (const drop of drops.filter((d) => d.rank === null)) if (!ordered.some((s) => s.relativePath === drop.path && s.candidateRank === null)) add(drop.path, null, null, undefined);
  selected.sort((a, b) => a.finalOrder - b.finalOrder);
  const selectedExplained = selected.filter((s) => s.evidenceRefs.some((ref) => evidence.get(ref)?.stage !== "RANKING")).length;
  const dropped = candidates.filter((c) => c.disposition === "DROPPED").map((c) => c.id);
  if (selectedExplained !== selected.length) throw new ContextForgeError("INVALID_CAPSULE", "Selected context lacks recorded relevance evidence.");
  const git = snapshot.graph?.git;
  const contribution = selected.reduce((sum, s) => sum + s.estimatedTokens, 0);
  const byId = <T extends { id: string }>(map: Map<string, T>): T[] => [...map.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const deterministic: CapsuleCore = {
    repository: { gitCommit: git?.head ?? null, gitDirty: git?.status === "available" ? git.files.some((f) => f.workingTreeStatus !== "clean") : null, gitScope: "INDEXED_SAFE_FILES", activeGeneration: snapshot.generation, indexGeneration: snapshot.generation, indexSchema: INDEX_SCHEMA_VERSION, analysisVersion: snapshot.analysisVersion },
    task: { taskHash: sha256(pack.task), representation: "RAW_UTF8", text: safeTask, normalized: safeTask === null ? [] : search.normalizedQuery.signals.map((s) => taskText(s.normalized)).filter((s): s is string => s !== null), analysis: v2 === undefined ? null : { strategy: v2.search.taskAnalysis.strategy, action: v2.search.taskAnalysis.action, mode: v2.search.taskAnalysis.mode, concepts: [...v2.search.taskAnalysis.concepts], risks: v2.search.taskAnalysis.riskSignals.map((s) => s.kind) } },
    strategies: { retrieval: search.rankingStrategy, ranking: search.rankingStrategy, relationship: v2 === undefined ? null : RELATIONSHIP_INTELLIGENCE_V2_VERSION, planner: v2?.plan.strategy ?? null, pack: pack.packingStrategy, policy: v2?.policy ?? null, estimator: pack.tokenEstimator, estimatorVersion: pack.tokenEstimatorVersion, retrievalConfiguration: v2?.search.ablation ?? null, planVariant: v2?.plan.variant ?? null },
    budget: { requested: pack.requestedBudget, estimatedTokens: pack.estimatedPayloadTokens, unused: pack.requestedBudget - pack.estimatedPayloadTokens, utilization: pack.estimatedPayloadTokens / pack.requestedBudget, itemContribution: contribution, envelopeAndOtherContribution: pack.estimatedPayloadTokens - contribution, budgetDrops: decisions.filter((d) => ["GLOBAL_BUDGET", "BUDGET_EXHAUSTED"].includes(d.reason)).length, safetyDrops: decisions.filter((d) => ["SAFETY_LIMIT", "SOURCE_VERIFICATION_LIMIT"].includes(d.reason)).length },
    files: byId(files), symbols: byId(symbols), ranges: byId(ranges), candidates, evidence: byId(evidence), relationships: byId(relationships), decisions, selected, dropped, excluded: candidates.filter((c) => c.disposition === "EXCLUDED").map((c) => c.id),
    plan: v2 === undefined ? null : { ...v2.plan, roles: v2.plan.roles.map((r) => ({ ...r })) },
    packingEvents: v2?.events.map((e) => ({ candidateRef: capsuleId("candidate", [capsulePath(e.path), "FILE"]), phase: e.phase, role: e.role, facet: e.facet, directness: e.directness, rank: e.rank, compactOptionTokens: e.compactOptionTokens, tokens: e.tokens, cumulativeTokens: e.cumulativeTokens })) ?? [],
    coverage: { selectedExplained, selectedTotal: selected.length, droppedExplained: dropped.length, droppedTotal: dropped.length, planRoles: v2?.roles.map((r) => ({ role: r.role, available: r.available, selected: r.selected, estimatedTokens: r.estimatedTokens, borrowedItems: r.borrowedItems })) ?? [] },
    diagnostics: { codes: [...pack.diagnostics], scanExclusions: [...scan.exclusionCounts].sort(([a], [b]) => a < b ? -1 : 1).map(([reason, count]) => ({ reason, count })), candidateCount: candidates.length, evidenceCount: evidence.size }, overrides: [], payloadHash: sha256(markdown),
  };
  const assemblyMs = performance.now() - started, hashStarted = performance.now();
  const capsuleHash = hashCapsuleCore(deterministic);
  return { schemaVersion: CAPSULE_SCHEMA, explainVersion: EXPLAIN_SCHEMA, deterministic, runtime: { createdAt: new Date().toISOString(), assemblyMs, canonicalizationHashMs: performance.now() - hashStarted }, capsuleHash };
}
