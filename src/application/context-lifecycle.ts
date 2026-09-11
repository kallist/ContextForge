import { canonicalSerialize, sha256, validateCapsule, type ContextCapsuleV1 } from "../core/context-capsule.js";
import { normalizeControls, type ContextControl } from "../core/context-controls.js";
import { contextCoverage } from "../core/context-coverage.js";
import { diffContexts } from "../core/context-diff.js";
import { explainContext } from "../core/explain-context.js";
import { ContextForgeError } from "../core/errors.js";
import type { ContextPackExecution } from "../core/context-pack.js";
import type { ContextPackRequest } from "./build-context-pack.js";
import type { RepositoryScanner } from "./map-repository.js";
import type { RepositorySourceReader } from "./repository-source.js";
import type { IndexRepositoryFactory } from "../core/repository-index.js";

export interface LifecycleCompiler {
  compile(request: Omit<ContextPackRequest, "repositoryPath">, reference?: ContextCapsuleV1): Promise<Pick<ContextPackExecution, "markdown" | "capsule">>;
  verifySources(capsule: ContextCapsuleV1): Promise<{ changed: string[]; generation: number | null }>;
}
export type ReplayStatus = "INSPECTED" | "EXACT_MATCH" | "PAYLOAD_MATCH_PROVENANCE_CHANGED" | "TASK_REQUIRED" | "TASK_MISMATCH" | "SOURCE_CHANGED" | "STRATEGY_UNAVAILABLE" | "PAYLOAD_CHANGED" | "CANNOT_REPRODUCE";
export interface ReplayResult {
  schemaVersion: "contextforge-replay-v1";
  status: ReplayStatus;
  capsuleHash: string;
  reproducedCapsuleHash: string | null;
  payloadMatches: boolean | null;
  changedFiles: string[];
  reason: string;
  limitations: string[];
}
const limitations = ["NO_HISTORICAL_SOURCE_RESTORATION", "RECORDED_SAFE_FILES_ONLY", "HASHES_ARE_NOT_AUTHENTICATION", "NO_GLOBAL_REPOSITORY_IDENTITY"];
function rawTask(capsule: ContextCapsuleV1, supplied?: string): string | null {
  const task = supplied ?? capsule.deterministic.task.text;
  return task !== null && sha256(task) === capsule.deterministic.task.taskHash ? task : null;
}
export function inspectReplay(input: unknown) {
  const capsule = validateCapsule(input);
  return { schemaVersion: "contextforge-replay-v1", status: "INSPECTED", explanation: explainContext(capsule, { type: "SUMMARY" }), coverage: contextCoverage(capsule), limitations };
}
export async function verifyReplay(compiler: LifecycleCompiler, input: unknown, suppliedTask?: string): Promise<{ result: ReplayResult; execution?: Pick<ContextPackExecution, "markdown" | "capsule"> }> {
  const capsule = validateCapsule(input), task = rawTask(capsule, suppliedTask);
  const result = (status: ReplayStatus, reason: string, changedFiles: string[] = []): { result: ReplayResult } => ({ result: { schemaVersion: "contextforge-replay-v1", status, capsuleHash: capsule.capsuleHash, reproducedCapsuleHash: null, payloadMatches: null, changedFiles, reason, limitations } });
  if (task === null) return suppliedTask === undefined ? result("TASK_REQUIRED", "Supply the original raw task; sanitized display metadata cannot reproduce its identity.") : result("TASK_MISMATCH", "The supplied task hash differs from the recorded raw task identity.");
  try {
    const sources = await compiler.verifySources(capsule);
    if (sources.changed.length > 0) return result("SOURCE_CHANGED", "Recorded safe source hashes no longer match. Historical source bytes were not stored.", sources.changed);
    if (sources.generation === null) return result("CANNOT_REPRODUCE", "No active index is available; inspection remains available offline.");
    const provenance = capsule.deterministic.overrides[0];
    const execution = await compiler.compile({ task, budget: capsule.deterministic.budget.requested, captureCapsule: true, ...(provenance === undefined ? {} : { controlProvenance: provenance }) }, capsule);
    const current = validateCapsule(execution.capsule);
    if (canonicalSerialize(current.deterministic.strategies) !== canonicalSerialize(capsule.deterministic.strategies)) return result("STRATEGY_UNAVAILABLE", "This compiler cannot execute the recorded strategy configuration exactly.");
    const matches = current.deterministic.payloadHash === capsule.deterministic.payloadHash;
    return { execution, result: { schemaVersion: "contextforge-replay-v1", status: current.capsuleHash === capsule.capsuleHash ? "EXACT_MATCH" : matches ? "PAYLOAD_MATCH_PROVENANCE_CHANGED" : "PAYLOAD_CHANGED", capsuleHash: capsule.capsuleHash, reproducedCapsuleHash: current.capsuleHash, payloadMatches: matches, changedFiles: [], reason: matches ? "Current compilation reproduced the exact recorded payload hash; inspect provenance identity separately." : "Recompilation produced different bytes despite matching recorded source hashes. Generation, strategy implementation or other inputs may differ.", limitations } };
  } catch (error) {
    return result(error instanceof ContextForgeError && error.code === "STRATEGY_UNAVAILABLE" ? "STRATEGY_UNAVAILABLE" : "CANNOT_REPRODUCE", "The bound repository or recorded compilation could not be reproduced safely. Inspection remains available.");
  }
}

export async function recompileContext(compiler: LifecycleCompiler, input: unknown, request: { task?: string; budget?: number; controls: readonly ContextControl[] }) {
  const parent = validateCapsule(input), task = rawTask(parent, request.task);
  if (task === null) throw new ContextForgeError("CONTROL_CONFLICT", "Supply the original task matching the recorded task hash before recompiling.");
  const controls = normalizeControls(request.controls);
  const sources = await compiler.verifySources(parent);
  if (sources.changed.length > 0 || sources.generation !== parent.deterministic.repository.activeGeneration) throw new ContextForgeError("CONTROL_CONFLICT", "The proposal source or generation changed. Compile a fresh proposal before applying controls.");
  const execution = await compiler.compile({ task, budget: request.budget ?? parent.deterministic.budget.requested, captureCapsule: true, controlProvenance: { version: "contextforge-controls-v1", parentCapsuleHash: parent.capsuleHash, controls } }, parent);
  const capsule = validateCapsule(execution.capsule);
  if (parent.deterministic.review?.changeHash !== capsule.deterministic.review?.changeHash) throw new ContextForgeError("CONTROL_CONFLICT", "The change set changed. Compile a fresh Review proposal before applying controls.");
  if (canonicalSerialize(capsule.deterministic.strategies) !== canonicalSerialize(parent.deterministic.strategies)) throw new ContextForgeError("STRATEGY_UNAVAILABLE", "Recompilation cannot substitute a different recorded strategy configuration.");
  if (capsule.deterministic.repository.activeGeneration !== parent.deterministic.repository.activeGeneration) throw new ContextForgeError("CONTROL_CONFLICT", "The active generation changed during recompilation. Open a fresh proposal.");
  return { execution, capsule, diff: diffContexts(parent, capsule), coverage: contextCoverage(capsule) };
}

export async function verifyRecordedSources(scanner: RepositoryScanner, reader: RepositorySourceReader, factory: IndexRepositoryFactory, repositoryPath: string, capsule: ContextCapsuleV1) {
  const scan = await scanner.scan(repositoryPath), snapshot = await factory(scan.rootRealPath).loadActive();
  const entries = new Map(scan.entries.map((entry) => [entry.path, entry]));
  const changed: string[] = [];
  let bytes = 0;
  for (const file of capsule.deterministic.files) {
    if (file.sourceHash === null) continue;
    const entry = entries.get(file.path);
    if (entry === undefined || entry.content !== "text" || (bytes += entry.size ?? 0) > 32 * 1024 * 1024) { changed.push(file.path); continue; }
    const source = await reader.readTextFile(scan.rootRealPath, entry);
    if (source.status !== "read" || source.contentHash !== file.sourceHash) changed.push(file.path);
  }
  return { changed, generation: snapshot?.generation ?? null };
}
