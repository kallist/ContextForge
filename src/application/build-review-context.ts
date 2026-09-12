import type { RepositoryScanner } from "./map-repository.js";
import type { RepositorySourceReader } from "./repository-source.js";
import { buildContextPack, type ContextPackRequest, type ContextPackSearchExecution } from "./build-context-pack.js";
import type { IndexRepositoryFactory } from "../core/repository-index.js";
import type { TreeSitterLanguageAnalyzer } from "../adapters/parser/tree-sitter-language-analyzer.js";
import type { ReviewGitReader } from "../adapters/git/review-git-reader.js";
import { canonicalSerialize, hashCapsuleCore, sha256, validateCapsule } from "../core/context-capsule.js";
import { redactAbsolutePaths } from "../core/capsule-privacy.js";
import { deriveSymbolRelationshipsV2 } from "../core/derive-symbol-relationships-v2.js";
import type { ReviewModel } from "../core/review-model.js";
import { ContextForgeError } from "../core/errors.js";
import { looksBinary } from "../core/file-policies.js";

export interface ReviewRequest extends Omit<ContextPackRequest, "task"> { base?: string }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Change-seeded proposal; the normal task retrieval/ranking path is never invoked. */
export async function buildReviewContext(scanner: RepositoryScanner, reader: RepositorySourceReader, factory: IndexRepositoryFactory, analyzer: TreeSitterLanguageAnalyzer, git: ReviewGitReader, request: ReviewRequest) {
  const started = performance.now();
  const base = await git.resolve(request.base ?? "HEAD"), head = await git.resolve("HEAD");
  const raw = await git.changes(base);
  const scan = await scanner.scan(request.repositoryPath), snapshot = await factory(scan.rootRealPath).loadActive();
  if (snapshot === null) throw new ContextForgeError("INDEX_REQUIRED", "Index the current repository before compiling Review Context.");
  const entries = new Map(scan.entries.filter((e) => e.content === "text").map((e) => [e.path, e]));
  const files = new Map(snapshot.files.map((f) => [f.relativePath, f]));
  const sources = new Map<string, string>();
  let bytes = 0;
  const verified = async (path: string): Promise<string | null> => {
    const entry = entries.get(path), file = files.get(path);
    if (entry === undefined) return null;
    if (file === undefined || file.contentHash === null) throw new ContextForgeError("INDEX_REQUIRED", "The review index is stale. Refresh it before compiling.");
    bytes += entry.size ?? 0;
    if (bytes > 16 * 1024 * 1024) throw new ContextForgeError("USAGE", "Review source verification exceeds the 16 MiB limit.");
    const source = await reader.readTextFile(scan.rootRealPath, entry);
    if (source.status !== "read" || source.contentHash !== file.contentHash) throw new ContextForgeError("CONTROL_CONFLICT", "Source changed since indexing. Refresh the proposal.");
    sources.set(path, source.source);
    return source.source;
  };
  const review: ReviewModel = { version: "contextforge-review-v1", input: "BASE_TO_WORKTREE", base, head, changeHash: "0".repeat(64), changes: [], impact: [], limits: { changedFiles: 64, candidates: 100, depth: 1, sourceBytes: 16777216 }, excludedChanges: raw.excluded, diagnostics: ["UNTRACKED_FILES_NOT_INCLUDED", "BOUNDED_STATIC_IMPACT_NOT_RUNTIME_PROOF"] };
  for (const change of raw.changes) {
    const source = await verified(change.path);
    if (source === null && change.status !== "DELETED") { review.excludedChanges++; continue; }
    const ranges = source === null ? [] : await git.ranges(base, change.path, change.previousPath);
    // Deleted files carry metadata only: current security policy cannot approve historical bytes.
    const previous = source === null || change.status === "ADDED" ? null : await git.previousSource(base, change.previousPath ?? change.path);
    const oldAnalysis = previous === null || looksBinary(Buffer.from(previous)) ? null : await analyzer.analyze({ relativePath: change.path, source: previous });
    const current = files.get(change.path)?.analysis.symbols ?? [];
    const prior = oldAnalysis?.symbols ?? [];
    const intersects = (start: number, end: number, side: "before" | "after") => ranges.some((r) => start <= Math.max(1, r[side].startLine) + Math.max(1, r[side].count) - 1 && end >= Math.max(1, r[side].startLine));
    const symbols: ReviewModel["changes"][number]["symbols"] = current.filter((s) => intersects(s.startLine, s.endLine, "after")).map((s) => ({ id: s.id, name: redactAbsolutePaths(s.qualifiedName), kind: s.kind, change: prior.some((p) => p.qualifiedName === s.qualifiedName && p.kind === s.kind) ? "MODIFIED" : "ADDED", startLine: s.startLine, endLine: s.endLine }));
    for (const s of prior.filter((p) => intersects(p.startLine, p.endLine, "before") && !current.some((c) => c.qualifiedName === p.qualifiedName && c.kind === p.kind))) symbols.push({ id: s.id, name: redactAbsolutePaths(s.qualifiedName), kind: s.kind, change: "REMOVED", startLine: s.startLine, endLine: s.endLine });
    review.changes.push({ ...change, sourceHash: source === null ? null : files.get(change.path)?.contentHash ?? null, previousSourceHash: previous === null ? null : sha256(previous), availability: source === null ? "DELETED_METADATA_ONLY" : "VERIFIED", ranges, symbols });
  }
  review.changes.sort((a, b) => compare(a.path, b.path));
  review.changeHash = sha256(canonicalSerialize({ base, head, changes: review.changes, excludedChanges: review.excludedChanges }));
  const changed = new Set(review.changes.map((c) => c.path));
  if (changed.size === 0) throw new ContextForgeError("USAGE", "No reviewable tracked changes. Stage new files or choose an earlier base.");
  const adjacent = (snapshot.graph?.edges ?? []).filter((e) => changed.has(e.sourcePath) || changed.has(e.targetPath));
  const paths = [...new Set([...changed, ...adjacent.flatMap((e) => [e.sourcePath, e.targetPath]).sort(compare)])].filter((p) => entries.has(p) && files.has(p));
  if (paths.length > 100) review.diagnostics.push("IMPACT_CANDIDATE_LIMIT");
  const chosen = paths.slice(0, 100);
  for (const path of chosen) if (!sources.has(path)) await verified(path);
  const syntax = [];
  for (const path of chosen) syntax.push(await analyzer.analyzeRelationships({ relativePath: path, source: sources.get(path) ?? "" }));
  const derivation = deriveSymbolRelationshipsV2(snapshot.files.filter((f) => chosen.includes(f.relativePath)), syntax, snapshot.graph?.resolvedImports ?? [], snapshot.generation);
  const impact = new Map<string, ReviewModel["impact"][number]>();
  for (const edge of adjacent.filter((e) => chosen.includes(e.sourcePath) || chosen.includes(e.targetPath))) impact.set(edge.id, { id: edge.id, from: edge.sourcePath, to: edge.targetPath, type: edge.kind, classification: edge.derivation === "structural" ? "STRUCTURAL_FACT" : "HEURISTIC", sourceSymbol: null, targetSymbol: null });
  for (const r of derivation.relationships.filter((r) => changed.has(r.source.file) || changed.has(r.target.file))) impact.set(r.id, { id: r.id, from: r.source.file, to: r.target.file, type: r.type, classification: r.classification, sourceSymbol: r.source.symbolId, targetSymbol: r.target.symbolId });
  review.impact = [...impact.values()].sort((a, b) => compare(a.id, b.id)).slice(0, 1024);
  if (impact.size > 1024) review.diagnostics.push("IMPACT_RELATION_LIMIT");
  if (derivation.unresolvedCalls + derivation.ambiguousCalls + derivation.unresolvedImplementations > 0) review.diagnostics.push("UNRESOLVED_STATIC_RELATIONSHIPS");
  const analysisMs = performance.now() - started;
  const task = [`Review tracked changes ${base} to working tree; change ${review.changeHash}.`, "Change summary (bounded; full metadata in Review Capsule):", ...review.changes.map((f) => `${f.status} ${f.path}: ${f.symbols.slice(0, 8).map((s) => `${s.change} ${s.name}`).join(", ") || f.availability}; ${f.ranges.slice(0, 6).map((r) => `-${r.before.startLine},${r.before.count} +${r.after.startLine},${r.after.count}`).join("; ")}`)].join("\n").slice(0, 12000);
  const search: ContextPackSearchExecution = {
    result: { repository: { name: "repository", root: "." }, generation: snapshot.generation, rankingStrategy: "contextforge-review-v1", indexStatus: { status: "FRESH", changedFiles: 0, addedFiles: 0, deletedFiles: 0, lexicalSkippedFiles: 0, stalePaths: [] }, normalizedQuery: { signals: [] }, diagnostics: review.diagnostics,
      candidates: chosen.map((path, index) => {
        const file = files.get(path)!;
        const relations = review.impact.filter((r) => r.from === path || r.to === path);
        const evidence = changed.has(path) ? [{ kind: "CHANGED_IMPLEMENTATION", family: "GIT", weight: 100, detail: "Verified Git change" }] : relations.map((r) => ({ kind: r.type, family: "STRUCTURAL", weight: 50, detail: "Recorded one-hop change relationship", derivation: r.classification === "HEURISTIC" ? "HEURISTIC" as const : "STRUCTURAL" as const, sourceCandidate: changed.has(r.from) ? r.from : r.to }));
        return { identity: path, relativePath: path, category: file.category, origin: changed.has(path) ? "DIRECT" as const : "EXPANDED" as const, directEvidence: evidence, expansionEvidence: [], scoreContributions: [{ kind: "REVIEW_ORDER", family: "GIT", value: 100 - index / 100, reason: "Changed files first, then deterministic single-hop context" }], rawScore: 100 - index / 100, graphDistance: changed.has(path) ? 0 : 1, relevantSymbols: file.analysis.symbols.filter((s) => changed.has(path) ? review.changes.find((c) => c.path === path)?.symbols.some((c) => c.id === s.id && c.change !== "REMOVED") : relations.some((r) => r.sourceSymbol === s.id || r.targetSymbol === s.id)).map((s) => ({ identity: s.id, name: s.name, qualifiedName: s.qualifiedName, startLine: s.startLine, endLine: s.endLine })) };
      }),
    }, context: { scan, snapshot }, performance: { totalMs: analysisMs },
  };
  const metadataOnlyDelete = review.changes.length > 0 && review.changes.every((change) => change.status === "DELETED" && change.availability === "DELETED_METADATA_ONLY");
  const execution = await buildContextPack(scanner, reader, factory, { ...request, task, captureCapsule: true }, undefined, () => Promise.resolve(search), { allowEmptySelection: metadataOnlyDelete });
  // Recheck consumed sources and Git range identity before publishing an immutable result.
  const after = await scanner.scan(request.repositoryPath);
  const afterEntries = new Map(after.entries.map((e) => [e.path, e]));
  for (const [path, source] of sources) {
    const entry = afterEntries.get(path), read = entry === undefined ? null : await reader.readTextFile(after.rootRealPath, entry);
    if (read?.status !== "read" || read.contentHash !== sha256(source)) throw new ContextForgeError("CONTROL_CONFLICT", "Source changed during review analysis. Compile a fresh proposal.");
  }
  if ((await git.resolve("HEAD")) !== head || (await git.changes(base)).identity !== raw.identity) throw new ContextForgeError("CONTROL_CONFLICT", "Git changed during review analysis.");
  for (const c of review.changes.filter((c) => c.availability === "VERIFIED")) if (canonicalSerialize(await git.ranges(base, c.path, c.previousPath)) !== canonicalSerialize(c.ranges)) throw new ContextForgeError("CONTROL_CONFLICT", "Git ranges changed during review analysis.");
  const capsule = execution.capsule;
  if (capsule === undefined) throw new ContextForgeError("INVALID_CAPSULE", "Review compilation did not capture a Context Capsule.");
  capsule.schemaVersion = "contextforge-capsule-v2";
  capsule.deterministic.review = review;
  capsule.capsuleHash = hashCapsuleCore(capsule.deterministic);
  return { ...execution, capsule: validateCapsule(capsule), review, reviewPerformance: { analysisMs, totalMs: performance.now() - started } };
}
