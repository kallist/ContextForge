import { z } from "zod";
import { EXPLAIN_SCHEMA, validateCapsule, type CapsuleCore, type ContextCapsuleV1 } from "./context-capsule.js";
import { ContextForgeError } from "./errors.js";
import { redactAbsolutePaths } from "./capsule-privacy.js";

export const explainQuerySchema = z.strictObject({
  type: z.enum(["SUMMARY", "WHY_SELECTED", "WHY_DROPPED", "WHY_EXCLUDED", "BUDGET", "STRATEGY"]),
  subject: z.string().min(1).max(4096).optional(),
}).refine((q) => !q.type.startsWith("WHY_") || q.subject !== undefined);
export type ExplainQueryV1 = z.infer<typeof explainQuerySchema>;
export interface ExplainResultV1 {
  readonly schemaVersion: typeof EXPLAIN_SCHEMA;
  readonly query: ExplainQueryV1;
  readonly subject: string | null;
  readonly status: "OK" | "NOT_CONSIDERED" | "INSUFFICIENT_EVIDENCE" | "AMBIGUOUS";
  readonly facts: {
    readonly capsuleHash: string;
    readonly payloadHash: string;
    readonly repository?: CapsuleCore["repository"];
    readonly task?: CapsuleCore["task"];
    readonly budget?: CapsuleCore["budget"];
    readonly strategies?: CapsuleCore["strategies"];
    readonly coverage?: CapsuleCore["coverage"];
    readonly counts?: { readonly candidates: number; readonly selected: number; readonly dropped: number; readonly excluded: number; readonly files: number; readonly symbols: number; readonly ranges: number };
    readonly matchingCandidateIds?: readonly string[];
    readonly candidate?: CapsuleCore["candidates"][number];
    readonly file?: CapsuleCore["files"][number];
    readonly selection?: CapsuleCore["selected"][number];
    readonly evidence?: CapsuleCore["evidence"];
    readonly decisions?: CapsuleCore["decisions"];
    readonly relationships?: CapsuleCore["relationships"];
    readonly ranges?: CapsuleCore["ranges"];
    readonly symbols?: CapsuleCore["symbols"];
    readonly packingEvents?: CapsuleCore["packingEvents"];
    readonly review?: CapsuleCore["review"];
  };
  readonly evidenceRefs: readonly string[];
  readonly decisionRefs: readonly string[];
  readonly limitations: readonly string[];
}

/** Validate once when opening a capsule; repeated queries use the validated copy. */
export function createCapsuleExplainer(input: unknown): (query: ExplainQueryV1) => ExplainResultV1 {
  const capsule = validateCapsule(input);
  return (query) => explainValidated(capsule, query);
}

export function explainContext(input: unknown, query: ExplainQueryV1): ExplainResultV1 {
  return createCapsuleExplainer(input)(query);
}

function explainValidated(capsule: ContextCapsuleV1, input: ExplainQueryV1): ExplainResultV1 {
  const parsed = explainQuerySchema.safeParse(input);
  if (!parsed.success) throw new ContextForgeError("USAGE", "Invalid Explain query or missing subject.");
  const query = parsed.data, c = capsule.deterministic;
  const safeQuery = query.subject === undefined ? query : { ...query, subject: redactAbsolutePaths(query.subject, 4096) };
  const facts: ExplainResultV1["facts"] = { capsuleHash: capsule.capsuleHash, payloadHash: c.payloadHash, ...(c.review === undefined ? {} : { review: c.review }) };
  const base = { schemaVersion: EXPLAIN_SCHEMA, query: safeQuery, subject: safeQuery.subject ?? null, facts, evidenceRefs: [], decisionRefs: [], limitations: ["RECORDED_COMPILER_DECISIONS_ONLY", "BOUNDED_CANDIDATE_SET", ...(c.plan === null && c.review === undefined ? ["PLANNER_NOT_RUN", "RELATIONSHIP_STAGE_NOT_RUN"] : [])] } as const;
  if (query.type === "SUMMARY") return { ...base, status: "OK", facts: { ...facts, repository: c.repository, task: c.task, budget: c.budget, strategies: c.strategies, coverage: c.coverage, counts: { candidates: c.candidates.length, selected: c.selected.length, dropped: c.dropped.length, excluded: c.excluded.length, files: c.files.length, symbols: c.symbols.length, ranges: c.ranges.length } } };
  if (query.type === "BUDGET") return { ...base, status: "OK", facts: { ...facts, budget: c.budget, strategies: c.strategies, coverage: c.coverage, packingEvents: c.packingEvents }, limitations: [...base.limitations, "ITEM_ESTIMATES_EXCLUDE_SHARED_ENVELOPE", "ROLE_CONTRIBUTIONS_MAY_OVERLAP"] };
  if (query.type === "STRATEGY") return { ...base, status: "OK", facts: { ...facts, strategies: c.strategies } };
  const subject = query.subject ?? "";
  const normalized = subject.replaceAll("\\", "/");
  const exact = c.candidates.find((candidate) => candidate.id === subject);
  const matches = exact === undefined ? c.candidates.filter((candidate) => c.files.some((file) => file.id === candidate.fileRef && file.path === normalized) || c.symbols.some((symbol) => candidate.symbolRefs.includes(symbol.id) && [symbol.id, symbol.name, symbol.qualifiedName].includes(subject))) : [exact];
  if (matches.length === 0) return { ...base, status: "NOT_CONSIDERED", limitations: [...base.limitations, "CAPSULE_DOES_NOT_PROVE_WHY_ABSENT"] };
  if (matches.length > 1) return { ...base, status: "AMBIGUOUS", facts: { ...facts, matchingCandidateIds: matches.map((c) => c.id) }, limitations: [...base.limitations, "USE_CANDIDATE_ID"] };
  const candidate = matches[0];
  if (candidate === undefined) throw new Error("Missing candidate.");
  const file = c.files.find((file) => file.id === candidate.fileRef);
  const selection = c.selected.find((s) => s.candidateRef === candidate.id);
  const evidence = c.evidence.filter((e) => candidate.evidenceRefs.includes(e.id));
  const decisions = c.decisions.filter((d) => candidate.decisionRefs.includes(d.id));
  const expected = query.type.slice(4);
  const sufficient = candidate.disposition === expected && decisions.length > 0 && (expected !== "SELECTED" || evidence.some((e) => e.stage !== "RANKING"));
  return { ...base, status: sufficient ? "OK" : "INSUFFICIENT_EVIDENCE", subject: candidate.id, evidenceRefs: candidate.evidenceRefs, decisionRefs: candidate.decisionRefs,
    facts: { ...facts, candidate, ...(file === undefined ? {} : { file }), ...(selection === undefined ? {} : { selection }), evidence, decisions, relationships: c.relationships.filter((r) => candidate.relationshipRefs.includes(r.id)), ranges: c.ranges.filter((r) => candidate.rangeRefs.includes(r.id)), symbols: c.symbols.filter((s) => candidate.symbolRefs.includes(s.id)), packingEvents: c.packingEvents.filter((e) => e.candidateRef === candidate.id), strategies: c.strategies },
    limitations: [...base.limitations, ...(evidence.some((e) => e.derivation === "HEURISTIC") ? ["HEURISTIC_EVIDENCE_IS_NOT_STRUCTURAL_FACT"] : []), ...(sufficient ? [] : ["RECORDED_DISPOSITION_DOES_NOT_SUPPORT_QUERY"])] };
}

/** Deterministic plain output; JSON quoting prevents terminal-control injection. */
export function renderExplain(result: ExplainResultV1): string {
  return [`RepoBound Explain ${result.query.type}: ${result.status}`, ...Object.entries(result.facts).map(([key, value]) => `${key}: ${JSON.stringify(value)}`), `limitations: ${JSON.stringify(result.limitations)}`, ""].join("\n");
}
