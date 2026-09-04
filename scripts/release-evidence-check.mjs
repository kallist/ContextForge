import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const evidence = "benchmarks/analysis/v0.2/final/";
const read = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inventory = await read(evidence + "integrity-manifest.json");
for (const item of [...inventory.invariantFiles, ...inventory.evidenceFiles]) {
  assert.ok(!item.path.includes("..") && !/^[A-Za-z]:|^[/\\]/u.test(item.path), "Unsafe evidence inventory path");
  assert.equal(sha(await readFile(resolve(root, item.path))), item.sha256, `Release invariant changed: ${item.path}`);
}
const quality = await read(evidence + "quality-results-v0.2.json");
const aggregate = await read(evidence + "aggregate-results-v0.2.json");
const decision = await read(evidence + "candidate-decision-v0.2.json");
const performance = await read(evidence + "performance-results-v0.2.json");
const reference = await read("benchmarks/reference/contextforge-benchmark-v1/quality-results.json");
const v1 = ["lexical-full-file-v1", "structural-full-file-v1", "contextforge-v1"];
assert.equal(quality.manifest.datasetHash, "75685087e8392840b4bb61ae19cef9ccb92df66844e79e0e87a0b7c6437a0002");
assert.equal(quality.manifest.contextforgeCommit, inventory.evaluationCommit);
assert.equal(quality.cases.length, 720);
assert.equal(new Set(quality.cases.map((c) => `${c.taskId}/${c.systemId}/${c.budget}`)).size, 720);
assert.deepEqual(quality.cases.filter((c) => v1.includes(c.systemId)), reference.cases);
assert.equal(sha(JSON.stringify(quality.cases)), inventory.historical720CaseObjectsSha256);
assert.ok(quality.cases.every((c) => c.payloadTokens <= c.budget));
for (const row of aggregate.allBudget) {
  const cases = quality.cases.filter((c) => c.systemId === row.systemId && c.budget === row.budget);
  assert.equal(cases.length, 24);
  for (const key of ["requiredFileRecall", "requiredSymbolRecall", "overallGoldRecall", "goldRangePrecision", "noiseRatio", "payloadTokens"]) {
    const values = cases.map((c) => c[key]).filter((v) => v !== null);
    assert.equal(row[key], values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  }
}
const successes = quality.cases.filter((c) => c.systemId === "contextforge-v1" && c.budget === 8000 && c.requiredFileRecall === 1 && c.requiredSymbolRecall === 1).map((c) => c.taskId);
assert.equal(successes.length, 19);
for (const id of quality.manifest.systems.slice(3)) {
  const values = quality.cases.filter((c) => c.systemId === id && c.budget === 8000 && successes.includes(c.taskId));
  assert.equal(values.length, 19);
  assert.ok(values.every((c) => c.requiredFileRecall === 1 && c.requiredSymbolRecall === 1));
}
assert.equal(decision.selectedExperimentalCandidate, "contextforge-v2-plan-pack");
assert.equal(decision.publicDefault, "contextforge-v1");
assert.equal(decision.defaultSwitch, false);
assert.equal(decision.publicExposure, "INTERNAL_ONLY");
assert.equal(performance.repetitions, 3);
assert.equal(performance.samples.length, 36);
const fixed = performance.medians.filter((m) => m.repositoryId === "contextforge-phase5");
const ratio = fixed.find((m) => m.systemId === decision.selectedExperimentalCandidate).totalMs / fixed.find((m) => m.systemId === "contextforge-v1").totalMs;
assert.ok(ratio <= 1.5, "Selected candidate fails frozen performance guardrail");
assert.equal(decision.determinism.repetitions, 2);
assert.equal(decision.determinism.fullDiagnosticSha256, "7a642da215cabf165ecd249f0f1c0e3a6b61be707cb820cb3990341911f63c4e");
process.stdout.write("V0.2 release evidence PASS: invariant hashes, 720 historical case objects, 360 V1 references, macro metrics, 19/0, budget and candidate gates.\n");
