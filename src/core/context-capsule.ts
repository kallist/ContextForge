import { createHash } from "node:crypto";
import { z } from "zod";
import { ContextForgeError } from "./errors.js";
import { isNormalizedRepositoryPath } from "./repository-graph.js";
import { CAPSULE_TEXT_LIMIT, hasAbsolutePath } from "./capsule-privacy.js";

export const CAPSULE_SCHEMA = "contextforge-capsule-v1";
export const EXPLAIN_SCHEMA = "contextforge-explain-v1";
export const MAX_CAPSULE_BYTES = 8 * 1024 * 1024;

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** JSON only, UTF-16 key order, semantic array order, no undefined/non-finite values. */
export function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`).join(",")}}`;
  }
  throw new ContextForgeError("INVALID_CAPSULE", "Capsule contains a non-JSON value.");
}

export function capsuleId(kind: string, identity: unknown): string {
  return `${kind}_${sha256(canonicalSerialize(identity)).slice(0, 24)}`;
}

export function capsulePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!isNormalizedRepositoryPath(normalized)) throw new ContextForgeError("INVALID_CAPSULE", "Invalid repository-relative capsule path.");
  return normalized;
}

const privacy = (value: string): boolean => !hasAbsolutePath(value);
const privacyMessage = "Capsule privacy violation: absolute filesystem path in protected text.";
const text = z.string().max(CAPSULE_TEXT_LIMIT).refine(privacy, privacyMessage);
const id = z.string().min(1).max(4096).refine(privacy, privacyMessage);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const code = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/u);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const finite = z.number().finite();
const path = z.string().max(4096).refine(isNormalizedRepositoryPath);
const refs = z.array(id).max(4096);
const position = z.strictObject({ startLine: count.min(1), endLine: count.min(1) }).refine((p) => p.endLine >= p.startLine);
const strategy = z.string().max(128).regex(/^[a-z][a-z0-9-]*-v[0-9]+(?:-[a-z0-9-]+)?$/u);
const disposition = z.enum(["SELECTED", "DROPPED", "EXCLUDED"]);
const reason = z.enum(["SELECTED", "REQUIRED_INSTRUCTION", "BUDGET_EXHAUSTED", "LOWER_PRIORITY", "DUPLICATE", "STALE_SOURCE", "SECTION_LIMIT", "UNSUPPORTED_CONTENT", "NO_USEFUL_RANGE", "SOURCE_VERIFICATION_LIMIT", "GLOBAL_BUDGET", "SAFETY_LIMIT", "REDUNDANT_RANGE"]);

export const capsuleCoreSchema = z.strictObject({
  repository: z.strictObject({ gitCommit: z.string().regex(/^[a-f0-9]{40,64}$/u).nullable(), gitDirty: z.boolean().nullable(), gitScope: z.literal("INDEXED_SAFE_FILES"), activeGeneration: count.min(1), indexGeneration: count.min(1), indexSchema: count, analysisVersion: text }),
  task: z.strictObject({ taskHash: hash, representation: z.literal("RAW_UTF8"), text: text.nullable(), normalized: z.array(text).max(1024), analysis: z.strictObject({ strategy, action: code, mode: code, concepts: z.array(code).max(32), risks: z.array(code).max(32) }).nullable() }),
  strategies: z.strictObject({ retrieval: strategy, ranking: strategy, relationship: strategy.nullable(), planner: strategy.nullable(), pack: strategy, policy: strategy.nullable(), estimator: strategy, estimatorVersion: code, retrievalConfiguration: code.nullable(), planVariant: code.nullable() }),
  budget: z.strictObject({ requested: count.min(1), estimatedTokens: count, unused: count, utilization: finite, itemContribution: count, envelopeAndOtherContribution: finite, budgetDrops: count, safetyDrops: count }),
  files: z.array(z.strictObject({ id, path, sourceHash: hash.nullable(), language: code.nullable(), category: code })).max(4096),
  symbols: z.array(z.strictObject({ id, fileRef: id, name: text, qualifiedName: text, kind: code, parentId: id.nullable(), startLine: count.min(1), endLine: count.min(1), startColumn: count.min(1), endColumn: count.min(1) })).max(8192),
  ranges: z.array(z.strictObject({ id, fileRef: id, sourceHash: hash.nullable(), startLine: count.min(1), endLine: count.min(1), symbolRefs: refs, reasons: z.array(code).max(32) })).max(4096),
  candidates: z.array(z.strictObject({ id, fileRef: id, kind: z.enum(["FILE", "INSTRUCTION"]), rank: count.min(1).nullable(), score: finite.nullable(), origin: code.nullable(), graphDistance: count.nullable(), symbolRefs: refs, rangeRefs: refs, evidenceRefs: refs, relationshipRefs: refs, planRoles: z.array(code).max(8), facet: code.nullable(), directness: code.nullable(), disposition, decisionRefs: refs })).max(128),
  evidence: z.array(z.strictObject({ id, stage: z.enum(["RETRIEVAL", "RANKING", "PACKING"]), code, family: code, weight: finite, derivation: z.enum(["STRUCTURAL", "HEURISTIC", "VERIFIED_SOURCE", "RECORDED", "POLICY"]), confidence: finite.nullable(), taskSignalId: id.nullable(), querySignal: text.nullable(), sourceCandidate: path.nullable(), location: position.nullable(), relationshipRef: id.nullable() })).max(16_384),
  relationships: z.array(z.strictObject({ id, type: code, sourceFileRef: id, targetFileRef: id, sourceSymbolId: id.nullable(), targetSymbolId: id.nullable(), classification: z.enum(["STRUCTURAL_FACT", "HEURISTIC"]), confidence: z.union([code, finite]), distance: count, derivation: z.string().max(1024).refine(privacy, privacyMessage), provenance: code, generation: count.min(1), location: position.nullable() })).max(4096),
  decisions: z.array(z.strictObject({ id, candidateRef: id, stage: z.enum(["PACKING", "SAFETY"]), reason, disposition, decisionSource: z.literal("COMPILER"), evidenceRefs: refs, requestedBudget: count, finalPayloadTokens: count })).max(256),
  selected: z.array(z.strictObject({ candidateRef: id, finalOrder: count, role: code, secondaryRoles: z.array(code).max(8), rangeRefs: refs, symbolRefs: refs, estimatedTokens: count, wholeFile: z.boolean(), evidenceRefs: refs, decisionRefs: refs })).max(128),
  dropped: refs,
  excluded: refs,
  plan: z.strictObject({ strategy, mode: code, action: code, variant: code, roles: z.array(z.strictObject({ role: code, priority: code, opportunity: count })).max(8) }).nullable(),
  packingEvents: z.array(z.strictObject({ candidateRef: id, phase: code, role: code.nullable(), facet: code, directness: code, rank: count, compactOptionTokens: count, tokens: count, cumulativeTokens: count })).max(2048),
  coverage: z.strictObject({ selectedExplained: count, selectedTotal: count, droppedExplained: count, droppedTotal: count, planRoles: z.array(z.strictObject({ role: code, available: count, selected: count, estimatedTokens: count, borrowedItems: count })).max(8) }),
  diagnostics: z.strictObject({ codes: z.array(code).max(256), scanExclusions: z.array(z.strictObject({ reason: code, count })).max(32), candidateCount: count, evidenceCount: count }),
  overrides: z.array(z.never()).max(0),
  payloadHash: hash,
});

export const capsuleSchema = z.strictObject({ schemaVersion: z.literal(CAPSULE_SCHEMA), explainVersion: z.literal(EXPLAIN_SCHEMA), deterministic: capsuleCoreSchema, runtime: z.strictObject({ createdAt: text, assemblyMs: finite.nonnegative(), canonicalizationHashMs: finite.nonnegative(), os: code.optional(), node: code.optional() }), capsuleHash: hash });
export type CapsuleCore = z.infer<typeof capsuleCoreSchema>;
export type ContextCapsuleV1 = z.infer<typeof capsuleSchema>;

export function hashCapsuleCore(core: CapsuleCore): string {
  return sha256(canonicalSerialize({ schemaVersion: CAPSULE_SCHEMA, explainVersion: EXPLAIN_SCHEMA, deterministic: core }));
}

function invalid(): never {
  throw new ContextForgeError("INVALID_CAPSULE", "Invalid Context Capsule structure, identity or references.");
}

// Reject hostile shape explosions before a schema library allocates per-element errors.
function preflight(value: unknown): void {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    if (++nodes > 200_000 || entry.depth > 24) invalid();
    if (typeof entry.value === "string" && entry.value.length > 16_384) invalid();
    if (Array.isArray(entry.value)) {
      if (entry.value.length > 16_384) invalid();
      for (const child of entry.value) pending.push({ value: child, depth: entry.depth + 1 });
    } else if (typeof entry.value === "object" && entry.value !== null) {
      if (Object.getPrototypeOf(entry.value) !== Object.prototype) invalid();
      const record = entry.value as Record<string, unknown>, keys = Object.keys(record);
      if (keys.length > 64 || keys.some((key) => ["__proto__", "prototype", "constructor"].includes(key))) invalid();
      for (const key of keys) pending.push({ value: record[key], depth: entry.depth + 1 });
    }
  }
}

/** Pure bounded validation. It neither opens source paths nor loads an index. */
export function validateCapsule(value: unknown): ContextCapsuleV1 {
  preflight(value);
  if (typeof value === "object" && value !== null && "schemaVersion" in value && value.schemaVersion !== CAPSULE_SCHEMA) {
    throw new ContextForgeError("UNSUPPORTED_SCHEMA", "Unsupported Context Capsule schema; expected contextforge-capsule-v1.");
  }
  const parsed = capsuleSchema.safeParse(value);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.message === privacyMessage)) throw new ContextForgeError("INVALID_CAPSULE", privacyMessage);
    invalid();
  }
  const capsule = parsed.data;
  const c = capsule.deterministic;
  const unique = <T extends { id: string }>(items: readonly T[]): Map<string, T> => {
    const map = new Map(items.map((item) => [item.id, item]));
    if (map.size !== items.length) invalid();
    return map;
  };
  const files = unique(c.files), symbols = unique(c.symbols), ranges = unique(c.ranges), candidates = unique(c.candidates), evidence = unique(c.evidence), decisions = unique(c.decisions), relationships = unique(c.relationships);
  const checkRefs = (values: readonly string[], map: ReadonlyMap<string, unknown>): void => { if (new Set(values).size !== values.length || values.some((ref) => !map.has(ref))) invalid(); };
  for (const f of c.files) if (f.id !== capsuleId("file", f.path)) invalid();
  for (const s of c.symbols) {
    if (!files.has(s.fileRef) || s.endLine < s.startLine || (s.endLine === s.startLine && s.endColumn < s.startColumn)) invalid();
    // Parent IDs are original index identities; a parent need not be a relevant/delivered symbol.
  }
  for (const r of c.ranges) {
    if (!files.has(r.fileRef) || r.endLine < r.startLine || files.get(r.fileRef)?.sourceHash !== r.sourceHash) invalid();
    checkRefs(r.symbolRefs, symbols);
    if (r.symbolRefs.some((ref) => symbols.get(ref)?.fileRef !== r.fileRef)) invalid();
  }
  for (const e of c.evidence) if (e.relationshipRef !== null && !relationships.has(e.relationshipRef)) invalid();
  for (const r of c.relationships) if (!files.has(r.sourceFileRef) || !files.has(r.targetFileRef) || (r.sourceSymbolId !== null && !symbols.has(r.sourceSymbolId)) || (r.targetSymbolId !== null && !symbols.has(r.targetSymbolId))) invalid();
  for (const item of c.candidates) {
    if (!files.has(item.fileRef) || item.id !== capsuleId("candidate", [files.get(item.fileRef)?.path, item.kind]) || (item.kind === "INSTRUCTION") !== (item.rank === null)) invalid();
    checkRefs(item.symbolRefs, symbols); checkRefs(item.rangeRefs, ranges); checkRefs(item.evidenceRefs, evidence); checkRefs(item.relationshipRefs, relationships); checkRefs(item.decisionRefs, decisions);
    if (item.decisionRefs.length === 0 || item.decisionRefs.some((ref) => decisions.get(ref)?.candidateRef !== item.id)) invalid();
    if (item.symbolRefs.some((ref) => symbols.get(ref)?.fileRef !== item.fileRef) || item.rangeRefs.some((ref) => ranges.get(ref)?.fileRef !== item.fileRef)) invalid();
    if (item.score !== null) {
      const sum = item.evidenceRefs.reduce((sum, ref) => sum + (evidence.get(ref)?.stage === "RANKING" ? evidence.get(ref)?.weight ?? 0 : 0), 0);
      if (Math.abs(sum - item.score) >= 0.0001) invalid();
    }
  }
  for (const d of c.decisions) {
    if (!candidates.has(d.candidateRef)) invalid();
    checkRefs(d.evidenceRefs, evidence);
    const excluded = ["STALE_SOURCE", "UNSUPPORTED_CONTENT", "SOURCE_VERIFICATION_LIMIT"].includes(d.reason);
    if ((d.reason === "SELECTED") !== (d.disposition === "SELECTED") || (excluded && d.disposition !== "EXCLUDED") || (d.stage === "SAFETY") !== (d.disposition === "EXCLUDED") || d.requestedBudget !== c.budget.requested || d.finalPayloadTokens !== c.budget.estimatedTokens) invalid();
  }
  for (const [index, s] of c.selected.entries()) {
    if (s.finalOrder !== index || candidates.get(s.candidateRef)?.disposition !== "SELECTED") invalid();
    checkRefs(s.symbolRefs, symbols); checkRefs(s.rangeRefs, ranges); checkRefs(s.evidenceRefs, evidence); checkRefs(s.decisionRefs, decisions);
    const candidate = candidates.get(s.candidateRef);
    if (s.rangeRefs.length === 0 || s.evidenceRefs.some((ref) => !candidate?.evidenceRefs.includes(ref)) || s.decisionRefs.some((ref) => decisions.get(ref)?.candidateRef !== s.candidateRef)) invalid();
    let end = 0;
    for (const ref of s.rangeRefs) { const r = ranges.get(ref); if (r === undefined || r.startLine <= end || r.fileRef !== candidates.get(s.candidateRef)?.fileRef) invalid(); end = r.endLine; }
  }
  checkRefs(c.dropped, candidates); checkRefs(c.excluded, candidates);
  if (new Set(c.selected.map((s) => s.candidateRef)).size !== c.selected.length) invalid();
  const roles = ["REPOSITORY_INSTRUCTION", "PRIMARY_CODE", "TEST", "DEPENDENCY", "DOCUMENTATION", "CONFIGURATION"];
  const ordered = [...c.selected].sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role) || (candidates.get(a.candidateRef)?.rank ?? 0) - (candidates.get(b.candidateRef)?.rank ?? 0));
  if (ordered.some((s, i) => s.candidateRef !== c.selected[i]?.candidateRef || !roles.includes(s.role))) invalid();
  for (const item of c.candidates) {
    const expected = item.disposition === "SELECTED" ? c.selected.some((s) => s.candidateRef === item.id) : (item.disposition === "DROPPED" ? c.dropped : c.excluded).includes(item.id);
    if (!expected || !item.decisionRefs.some((ref) => decisions.get(ref)?.disposition === item.disposition)) invalid();
  }
  if (c.dropped.some((ref) => candidates.get(ref)?.disposition !== "DROPPED") || c.excluded.some((ref) => candidates.get(ref)?.disposition !== "EXCLUDED")) invalid();
  if (c.packingEvents.some((e) => !candidates.has(e.candidateRef))) invalid();
  if (c.budget.estimatedTokens > c.budget.requested || c.budget.unused !== c.budget.requested - c.budget.estimatedTokens || c.repository.activeGeneration !== c.repository.indexGeneration) invalid();
  if (c.diagnostics.candidateCount !== c.candidates.length || c.diagnostics.evidenceCount !== c.evidence.length) invalid();
  const selectedExplained = c.selected.filter((s) => s.evidenceRefs.some((ref) => evidence.get(ref)?.stage !== "RANKING")).length;
  if (c.coverage.selectedTotal !== c.selected.length || c.coverage.selectedExplained !== selectedExplained || selectedExplained !== c.selected.length || c.coverage.droppedTotal !== c.dropped.length || c.coverage.droppedExplained !== c.dropped.length) invalid();
  if (c.budget.itemContribution !== c.selected.reduce((sum, s) => sum + s.estimatedTokens, 0) || c.budget.envelopeAndOtherContribution !== c.budget.estimatedTokens - c.budget.itemContribution) invalid();
  if ((c.plan === null) !== (c.strategies.planner === null) || (c.task.analysis === null) !== (c.strategies.relationship === null)) invalid();
  if (capsule.capsuleHash !== hashCapsuleCore(c)) invalid();
  return capsule;
}

export function parseCapsule(json: string): ContextCapsuleV1 {
  if (Buffer.byteLength(json, "utf8") > MAX_CAPSULE_BYTES) throw new ContextForgeError("INVALID_CAPSULE", "Context Capsule exceeds the 8 MiB input limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return invalid(); }
  return validateCapsule(parsed);
}
