import { performance } from "node:perf_hooks";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createContextForgeLifecycle } from "../dist/composition/contextforge-lifecycle.js";
import { SqliteCapsuleHistory } from "../dist/adapters/sqlite/sqlite-capsule-history.js";
import { validateCapsule } from "../dist/core/context-capsule.js";
import { diffContexts } from "../dist/core/context-diff.js";
import { recompileContext, verifyReplay } from "../dist/application/context-lifecycle.js";
const root = await realpath(await mkdtemp(join(tmpdir(), "contextforge-lifecycle-perf-")));
let history;
try {
  await mkdir(join(root, "src"));
  for (let i = 0; i < 64; i++) await writeFile(join(root, "src", `ledger${i}.ts`), `export class Ledger${i} {\n${Array.from({ length: 50 }, (_, n) => `  save${n}() { return ${i + n}; }`).join("\n")}\n}\n`);
  const app = await createContextForgeLifecycle(root); await app.index();
  history = new SqliteCapsuleHistory(join(root, ".contextforge/history"));
  const samples = [], objects = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now(); const execution = await app.compile({ task: `fix Ledger${i} save1 save2 save3`, budget: 2000 + i * 100, captureCapsule: true }); const compiledMs = performance.now() - start;
    const capsule = validateCapsule(execution.capsule); const saveStart = performance.now(); const entry = history.save(capsule); const savedMs = performance.now() - saveStart;
    const loadStart = performance.now(); history.get(entry.id); const loadMs = performance.now() - loadStart;
    objects.push(capsule); samples.push({ compiledMs, savedMs, loadMs, metadataBytes: entry.metadataBytes, storedBytes: entry.storedBytes });
  }
  const startList = performance.now(); history.list(10); const listMs = performance.now() - startList;
  const startDiff = performance.now(); diffContexts(objects[0], objects[1]); const diffMs = performance.now() - startDiff;
  const startReplay = performance.now(); const replay = await verifyReplay(app, objects[0]); const replayMs = performance.now() - startReplay;
  const startControl = performance.now(); await recompileContext(app, objects[0], { controls: [], budget: 3000 }); const recompileMs = performance.now() - startControl;
  const output = { schemaVersion: "contextforge-lifecycle-performance-v1", environment: { platform: process.platform, node: process.version }, fixture: "64 TypeScript files, 50 methods each; 10 task/budget compilations", samples, history: history.stats(), listMs, diffMs, replayMs, replayStatus: replay.result.status, recompileMs, limitations: ["LOCAL_SYNTHETIC_ONLY", "NOT_MILLION_ENTRY_HISTORY", "NOT_NETWORK_FILESYSTEM"] };
  const outputDirectory = resolve(".studio-output"); await mkdir(outputDirectory, { recursive: true }); await writeFile(join(outputDirectory, "lifecycle-performance.json"), JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify(output));
} finally { history?.close(); await rm(root, { recursive: true, force: true }); }
