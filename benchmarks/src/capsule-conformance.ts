import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildIndex } from "../../src/application/build-index.js";
import { buildContextPack } from "../../src/application/build-context-pack.js";
import { buildContextPackV2 } from "../../src/application/build-context-pack-v2.js";
import { searchRepository } from "../../src/application/search-repository.js";
import { searchRepositoryV2 } from "../../src/application/search-repository-v2.js";
import { canonicalSerialize, capsuleSchema, sha256, validateCapsule } from "../../src/core/context-capsule.js";
import { createCapsuleExplainer, renderExplain } from "../../src/core/explain-context.js";
import { auditCapsulePrivacy } from "./capsule-privacy-audit.js";
import { ContextForgeError } from "../../src/core/errors.js";
import { loadDataset, validateDatasetFreeze } from "./dataset.js";
import { createBenchmarkTemporaryRoot, materializeRepository, removeBenchmarkTemporaryRoot, assertCorpusUnchanged } from "./materialize.js";
import { createRepositoryRuntime } from "./systems.js";
import { evaluateSelection } from "./metrics.js";
import { QUALITY_BUDGETS, type SystemSelection } from "./types.js";

// Instrumentation conformance only: no new strategy, Gold, metric, or leaderboard.
const root = resolve(process.cwd()), scanner = new FileSystemRepositoryScanner(), reader = new FileSystemRepositorySourceReader(), analyzer = new TreeSitterLanguageAnalyzer();
const factory = (path: string) => new SqliteIndexRepository(path);
const dataset = await loadDataset(root), lock = await validateDatasetFreeze(dataset, root);
const temp = await createBenchmarkTemporaryRoot();
const output = join(root, ".benchmark-output"); await mkdir(output, { recursive: true });
const median = (values: number[]): number => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
const summarize = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return { min: s[0] ?? 0, median: median(s), p95: s[Math.max(0, Math.ceil(s.length * .95) - 1)] ?? 0, max: s.at(-1) ?? 0 }; };

async function compile(repositoryPath: string, task: string, budget: number, v2: boolean, captureCapsule: boolean) {
  let search: Awaited<ReturnType<typeof searchRepository>>["result"] | Awaited<ReturnType<typeof searchRepositoryV2>>["result"] | undefined;
  const started = performance.now();
  const request = { repositoryPath, task, budget, captureCapsule };
  const pack = v2 ? await buildContextPackV2(scanner, reader, factory, request, { search: async (input) => {
    const execution = await searchRepositoryV2(scanner, reader, factory, { ...input, ablation: "RELATION_FULL" }, analyzer); search = execution.result; return execution;
  } }) : await buildContextPack(scanner, reader, factory, request, undefined, async (s, r, f, input) => {
    const execution = await searchRepository(s, r, f, input); search = execution.result; return execution;
  });
  const totalMs = performance.now() - started;
  assert.ok(search);
  const selection: SystemSelection = { systemId: v2 ? "contextforge-v2-plan-pack" : "contextforge-v1", rankingStrategy: search.rankingStrategy, packingStrategy: pack.manifest.packingStrategy, tokenEstimator: pack.manifest.tokenEstimator, tokenEstimatorVersion: pack.manifest.tokenEstimatorVersion, budget, payloadTokens: pack.manifest.estimatedPayloadTokens,
    retrievalCandidates: search.candidates.map((c) => ({ path: c.relativePath, relevantSymbols: c.relevantSymbols.map((s) => ({ path: c.relativePath, identity: s.identity, name: s.name, qualifiedName: s.qualifiedName })) })),
    selectedRanges: pack.manifest.selectedItems.map((s) => ({ path: s.relativePath, ranges: s.selectedRanges })), status: pack.manifest.packStatus, diagnostics: pack.manifest.diagnostics,
    performance: { retrievalMs: pack.performance.searchMs, packingMs: totalMs - pack.performance.searchMs, totalMs } };
  return { pack, search, selection, totalMs };
}

const mode = process.argv[2] ?? "conformance";
try {
  if (mode === "conformance") {
    const runs: { taskId: string; system: string; budget: number; status: string; capsuleHash: string | null; payloadHash: string | null; coreHash: string | null; bytes: number; candidates: number; evidence: number; events: number; selected: number; dropped: number; excluded: number; selectedExplained: number; droppedExplained: number }[] = [];
    for (const definition of dataset.repositories) {
      const materialized = await materializeRepository(definition, root, temp);
      await buildIndex(scanner, reader, analyzer, factory, { repositoryPath: materialized.root });
      const runtime = await createRepositoryRuntime(materialized.root);
      for (const task of dataset.tasks.filter((t) => t.repositoryId === definition.repositoryId)) {
        for (const v2 of [false, true]) for (const budget of QUALITY_BUDGETS) {
          const attempt = await compile(materialized.root, task.taskText, budget, v2, false).then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
          if (attempt.value === null) {
            const error = attempt.error;
            assert.ok(error instanceof ContextForgeError && ["BUDGET_TOO_SMALL", "PACK_FAILED"].includes(error.code));
            for (let repeat = 0; repeat < 2; repeat++) await assert.rejects(compile(materialized.root, task.taskText, budget, v2, true), (e: unknown) => e instanceof ContextForgeError && e.code === error.code && e.message === error.message);
            runs.push({ taskId: task.taskId, system: v2 ? "V2" : "V1", budget, status: error.code, capsuleHash: null, payloadHash: null, coreHash: null, bytes: 0, candidates: 0, evidence: 0, events: 0, selected: 0, dropped: 0, excluded: 0, selectedExplained: 0, droppedExplained: 0 });
            continue;
          }
          const off = attempt.value;
          const on = await compile(materialized.root, task.taskText, budget, v2, true);
          assert.equal(on.pack.markdown, off.pack.markdown, "CAPSULE_CHANGED_CONTEXT");
          assert.deepEqual(on.pack.manifest, off.pack.manifest);
          assert.deepEqual(on.search, off.search);
          assert.deepEqual(await evaluateSelection(runtime, task, lock.datasetHash, on.selection), await evaluateSelection(runtime, task, lock.datasetHash, off.selection));
          const shape = capsuleSchema.safeParse(on.pack.capsule);
          assert.ok(shape.success, JSON.stringify(shape.error?.issues));
          const capsule = validateCapsule(on.pack.capsule), c = capsule.deterministic;
          auditCapsulePrivacy(capsule);
          assert.equal(c.payloadHash, sha256(off.pack.markdown));
          const explain = createCapsuleExplainer(capsule);
          for (const [type, subjects] of [["SUMMARY", [undefined]], ["WHY_SELECTED", c.selected.map((s) => s.candidateRef)], ["WHY_DROPPED", c.dropped], ["WHY_EXCLUDED", c.excluded]] as const) for (const subject of subjects) {
            const result = explain(subject === undefined ? { type } : { type, subject });
            assert.equal(result.status, "OK");
            auditCapsulePrivacy(result);
            auditCapsulePrivacy(renderExplain(result));
          }
          const repeated = await compile(materialized.root, task.taskText, budget, v2, true);
          assert.equal(canonicalSerialize(repeated.pack.capsule?.deterministic), canonicalSerialize(c));
          assert.equal(repeated.pack.capsule?.capsuleHash, capsule.capsuleHash);
          const bytes = Buffer.byteLength(JSON.stringify(capsule));
          assert.ok(bytes < 2 * 1024 * 1024, "Unexpected multi-megabyte capsule");
          runs.push({ taskId: task.taskId, system: v2 ? "V2" : "V1", budget, status: "CONTEXT", capsuleHash: capsule.capsuleHash, payloadHash: c.payloadHash, coreHash: sha256(canonicalSerialize(c)), bytes, candidates: c.candidates.length, evidence: c.evidence.length, events: c.decisions.length + c.packingEvents.length, selected: c.selected.length, dropped: c.dropped.length, excluded: c.excluded.length, selectedExplained: c.coverage.selectedExplained, droppedExplained: c.coverage.droppedExplained });
        }
        process.stdout.write(`Capsule identity: ${task.taskId} (V1/V2 x 5 budgets)\n`);
      }
      await assertCorpusUnchanged(materialized);
    }
    assert.equal(runs.length, 240);
    const identity = runs.map(({ taskId, system, budget, status, capsuleHash, payloadHash, coreHash }) => ({ taskId, system, budget, status, capsuleHash, payloadHash, coreHash }));
    const emitted = runs.filter((r) => r.status === "CONTEXT");
    const report = { version: "contextforge-capsule-conformance-v1", datasetHash: lock.datasetHash, cases: runs.length, emittedCapsules: emitted.length, noContext: runs.length - emitted.length, deterministicRepetitions: 2, aggregateHash: sha256(canonicalSerialize(identity)), size: summarize(emitted.map((r) => r.bytes)), counts: Object.fromEntries(["candidates", "evidence", "events", "selected", "dropped", "excluded"].map((key) => [key, summarize(emitted.map((r) => r[key as "candidates"]))])), runs };
    await writeFile(join(output, "capsule-conformance.json"), JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(`Capsule PASS 240/240; aggregate ${report.aggregateHash}\n`);
  } else if (mode === "performance") {
    const fixed = dataset.repositories.find((r) => r.kind === "PINNED_GIT"); assert.ok(fixed);
    const task = dataset.tasks.find((t) => t.repositoryId === fixed.repositoryId); assert.ok(task);
    const materialized = await materializeRepository(fixed, root, temp);
    await buildIndex(scanner, reader, analyzer, factory, { repositoryPath: materialized.root });
    const synthetic = join(temp, "synthetic-1000");
    await mkdir(join(synthetic, "src", "services"), { recursive: true }); await mkdir(join(synthetic, "tests"));
    await writeFile(join(synthetic, "AGENTS.md"), "# Synthetic instructions\n\nKeep service dependencies deterministic.\n");
    for (let i = 0; i < 899; i++) await writeFile(join(synthetic, "src", "services", `service-${String(i).padStart(4, "0")}.ts`), [...(i === 0 ? [] : [`import { Service${i - 1} } from "./service-${String(i - 1).padStart(4, "0")}.js";`]), `export class Service${i} {`, `  runService${i}(): number { return ${i === 0 ? "0" : `new Service${i - 1}().runService${i - 1}() + 1`}; }`, "}", ""].join("\n"));
    for (let i = 0; i < 100; i++) { const service = String(i * 8).padStart(4, "0"); await writeFile(join(synthetic, "tests", `service-${service}.test.ts`), `import { Service${i * 8} } from "../src/services/service-${service}.js";\nexport const expected${i} = new Service${i * 8}().runService${i * 8}();\n`); }
    await buildIndex(scanner, reader, analyzer, factory, { repositoryPath: synthetic });
    const samples: { corpus: string; system: string; repetition: number; capture: boolean; totalMs: number; searchMs: number; packMs: number; assemblyMs: number; hashMs: number; explainMs: number }[] = [];
    for (const [corpus, path, text] of [["fixed", materialized.root, task.taskText], ["synthetic", synthetic, "repair Service420.runService420 dependency behavior"]] as const) for (const v2 of [false, true]) {
      await compile(path, text, 8000, v2, false); await compile(path, text, 8000, v2, true);
      for (let repetition = 0; repetition < 5; repetition++) for (const capture of repetition % 2 === 0 ? [false, true] : [true, false]) {
        const result = await compile(path, text, 8000, v2, capture);
        const assemblyMs = result.pack.capsule?.runtime.assemblyMs ?? 0, hashMs = result.pack.capsule?.runtime.canonicalizationHashMs ?? 0;
        const explainStart = performance.now();
        if (capture) { const explain = createCapsuleExplainer(result.pack.capsule); explain({ type: "SUMMARY" }); const c = result.pack.capsule?.deterministic; if (c?.selected[0]) explain({ type: "WHY_SELECTED", subject: c.selected[0].candidateRef }); if (c?.dropped[0]) explain({ type: "WHY_DROPPED", subject: c.dropped[0] }); }
        samples.push({ corpus, system: v2 ? "V2" : "V1", repetition, capture, totalMs: result.totalMs, searchMs: result.pack.performance.searchMs, packMs: result.totalMs - result.pack.performance.searchMs - assemblyMs - hashMs, assemblyMs, hashMs, explainMs: capture ? performance.now() - explainStart : 0 });
      }
    }
    const medians = ["fixed", "synthetic"].flatMap((corpus) => ["V1", "V2"].map((system) => {
      const selected = samples.filter((s) => s.corpus === corpus && s.system === system), off = selected.filter((s) => !s.capture), on = selected.filter((s) => s.capture);
      const offMs = median(off.map((s) => s.totalMs)), onMs = median(on.map((s) => s.totalMs));
      return { corpus, system, offMs, onMs, ratio: onMs / offMs, assemblyMs: median(on.map((s) => s.assemblyMs)), hashMs: median(on.map((s) => s.hashMs)), explainMs: median(on.map((s) => s.explainMs)) };
    }));
    await writeFile(join(output, "capsule-performance.json"), JSON.stringify({ version: "contextforge-capsule-performance-v1", environment: { os: platform(), arch: arch(), node: process.version }, repetitions: 5, ordering: "alternating OFF/ON; one warm pair per corpus/system", samples, medians }, null, 2) + "\n");
    process.stdout.write(JSON.stringify(medians, null, 2) + "\n");
    assert.ok(medians.filter((s) => s.corpus === "fixed").every((s) => s.ratio <= 1.20), "CAPSULE_OVERHEAD_EXCEEDS_1.20");
  } else throw new Error("Expected conformance or performance.");
} finally { await removeBenchmarkTemporaryRoot(temp); }
