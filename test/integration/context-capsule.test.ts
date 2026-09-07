import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildIndex } from "../../src/application/build-index.js";
import { buildContextPack } from "../../src/application/build-context-pack.js";
import { buildContextPackV2 } from "../../src/application/build-context-pack-v2.js";
import { searchRepository } from "../../src/application/search-repository.js";
import { canonicalSerialize, capsulePath, capsuleSchema, hashCapsuleCore, parseCapsule, sha256, validateCapsule, type ContextCapsuleV1 } from "../../src/core/context-capsule.js";
import { createCapsuleExplainer, explainContext } from "../../src/core/explain-context.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

const scanner = new FileSystemRepositoryScanner(), reader = new FileSystemRepositorySourceReader(), analyzer = new TreeSitterLanguageAnalyzer();
const factory = (root: string) => new SqliteIndexRepository(root);
const exec = promisify(execFile);
const fixture = async (root: string): Promise<void> => {
  await writeFixture(root, "src/ledger.ts", "export class Ledger {\n  saveValue() {\n    return 'CAPSULE_BODY_SENTINEL_7ac9';\n  }\n}\n");
  await writeFixture(root, "test/ledger.test.ts", "import { Ledger } from '../src/ledger.js';\nexport function verifyLedger() { return new Ledger().saveValue(); }\n");
  await writeFixture(root, "AGENTS.md", "# Instructions\nTest changed behavior.\n");
  await writeFixture(root, ".env", "PRIVATE_CAPSULE_SENTINEL=secret\n");
  await buildIndex(scanner, reader, analyzer, factory, { repositoryPath: root });
};
const compile = (root: string, v2: boolean, captureCapsule: boolean, budget = 2000, task = "fix Ledger saveValue") => v2
  ? buildContextPackV2(scanner, reader, factory, { repositoryPath: root, task, budget, captureCapsule }, { relationshipAnalyzer: analyzer })
  : buildContextPack(scanner, reader, factory, { repositoryPath: root, task, budget, captureCapsule });

for (const v2 of [false, true]) test(`Capsule ${v2 ? "V2" : "V1"}: same compilation, exact bytes, ordered manifest, evidence, cross-process`, async (t) => {
  const temp = await createTemporaryDirectory("capsule"), root = join(temp, "repo");
  t.after(() => removeTemporaryDirectory(temp));
  await mkdir(root); await fixture(root);
  let capsule: ContextCapsuleV1 | undefined;
  for (const budget of [2000, 4000]) {
    const off = await compile(root, v2, false, budget), on = await compile(root, v2, true, budget);
    assert.deepEqual(on.manifest, off.manifest);
    assert.equal(on.markdown, off.markdown);
    assert.equal(off.capsule, undefined);
    const shape = capsuleSchema.safeParse(on.capsule);
    assert.ok(shape.success, JSON.stringify(shape.error?.issues));
    capsule = validateCapsule(on.capsule);
    assert.equal(capsule.deterministic.payloadHash, createHash("sha256").update(Buffer.from(off.markdown)).digest("hex"));
    const serialized = JSON.stringify(capsule);
    assert.ok(!serialized.includes("CAPSULE_BODY_SENTINEL") && !serialized.includes("PRIVATE_CAPSULE_SENTINEL"));
    assert.ok(!serialized.includes(root) && !serialized.includes(temp));
    assert.equal(capsule.deterministic.repository.gitCommit, null);
    assert.equal(capsule.deterministic.repository.gitDirty, null);
    let offset = -1;
    for (const selection of capsule.deterministic.selected) {
      const candidate = capsule.deterministic.candidates.find((c) => c.id === selection.candidateRef);
      const path = capsule.deterministic.files.find((f) => f.id === candidate?.fileRef)?.path;
      const next = on.markdown.indexOf(`Path: ${JSON.stringify(path)}`, offset + 1);
      assert.ok(next > offset); offset = next;
      assert.equal(explainContext(capsule, { type: "WHY_SELECTED", subject: selection.candidateRef }).status, "OK");
    }
    const explain = createCapsuleExplainer(capsule);
    for (const candidate of capsule.deterministic.candidates.filter((c) => c.score !== null)) {
      const sum = capsule.deterministic.evidence.filter((e) => e.stage === "RANKING" && candidate.evidenceRefs.includes(e.id)).reduce((sum, e) => sum + e.weight, 0);
      assert.ok(Math.abs(sum - (candidate.score ?? 0)) < 0.0001);
    }
    for (const ref of capsule.deterministic.dropped) assert.equal(explain({ type: "WHY_DROPPED", subject: ref }).status, "OK");
    assert.equal(explain({ type: "WHY_SELECTED", subject: "absent.ts" }).status, "NOT_CONSIDERED");
    const selected = capsule.deterministic.selected[0]; assert.ok(selected);
    assert.equal(explain({ type: "WHY_DROPPED", subject: selected.candidateRef }).status, "INSUFFICIENT_EVIDENCE");
    assert.equal(capsule.deterministic.coverage.selectedExplained, capsule.deterministic.selected.length);
    assert.equal(capsule.deterministic.plan === null, !v2);
    assert.equal(capsule.deterministic.strategies.relationship === null, !v2);
    if (v2) assert.ok(capsule.deterministic.relationships.length > 0);
    assert.equal(capsule.capsuleHash, (await compile(root, v2, true, budget)).capsule?.capsuleHash);
  }
  assert.ok(capsule);
  const differentBudget = await compile(root, v2, true, 8000);
  assert.notEqual(capsule.capsuleHash, differentBudget.capsule?.capsuleHash);
  assert.notEqual(capsule.capsuleHash, (await compile(root, v2, true, 4000, "review Ledger saveValue")).capsule?.capsuleHash);
  const privateTask = "fix Ledger saveValue C:\\Users\\private-user\\repo";
  const redacted = validateCapsule((await compile(root, v2, true, 4000, privateTask)).capsule);
  assert.equal(redacted.deterministic.task.text, "fix Ledger saveValue <ABSOLUTE_PATH>");
  assert.deepEqual(redacted.deterministic.task.normalized, []);
  assert.equal(redacted.deterministic.task.taskHash, sha256(privateTask));
  assert.ok(!JSON.stringify(redacted).includes("private-user"));
  const alteredRuntime = structuredClone(capsule); alteredRuntime.runtime.createdAt = "different"; alteredRuntime.runtime.assemblyMs = 42; alteredRuntime.runtime.os = "other-platform";
  assert.equal(validateCapsule(alteredRuntime).capsuleHash, capsule.capsuleHash);
  const helper = resolve(".test-dist/test/helpers/capsule-process.js");
  const one = await exec(process.execPath, [helper, root, v2 ? "v2" : "v1"]);
  const two = await exec(process.execPath, [helper, root, v2 ? "v2" : "v1"]);
  assert.equal(one.stdout, two.stdout);
  const golden = JSON.parse(one.stdout) as { capsuleHash: string };
  t.diagnostic(`canonical fixture ${v2 ? "V2" : "V1"}: ${golden.capsuleHash}`);
  assert.equal(golden.capsuleHash, v2 ? "5167f0db5b5926e90fd6552969242cc1c8736e45f763fbf4d13c6c19979e5aa0" : "8be6ef8549b7765cdb11d6bbab8286d0913f991a12793557a90bd50ea7175cb9");
});

test("Capsule rejects malformed structure and references even when the attacker recomputes its hash", async (t) => {
  const root = await createTemporaryDirectory("capsule-validation"); t.after(() => removeTemporaryDirectory(root)); await fixture(root);
  const original = validateCapsule((await compile(root, false, true)).capsule);
  const corrupt = (change: (c: ContextCapsuleV1) => void): void => { const c = structuredClone(original); change(c); c.capsuleHash = hashCapsuleCore(c.deterministic); assert.throws(() => validateCapsule(c)); };
  corrupt((c) => { c.deterministic.evidence.splice(0, 1); });
  corrupt((c) => { c.deterministic.files.push(c.deterministic.files[0]!); });
  corrupt((c) => { c.deterministic.selected[0]!.finalOrder = 9; });
  corrupt((c) => { c.deterministic.selected.reverse().forEach((s, i) => { s.finalOrder = i; }); });
  corrupt((c) => { c.deterministic.ranges[0]!.startLine = 999; });
  corrupt((c) => { c.deterministic.candidates[0]!.fileRef = "missing"; });
  corrupt((c) => { c.deterministic.files[0]!.path = "C:/private/source.ts"; });
  assert.throws(() => validateCapsule({ ...original, schemaVersion: "contextforge-capsule-v999" }), /Unsupported Context Capsule/u);
  assert.throws(() => validateCapsule({ ...original, source: "not allowed" }));
  assert.throws(() => parseCapsule("{"));
  assert.throws(() => validateCapsule({ ...original, deterministic: { ...original.deterministic, evidence: Array.from({ length: 20_000 }, () => null) } }));
  assert.throws(() => parseCapsule('{"__proto__":{"polluted":true}}'));
  assert.throws(() => parseCapsule(" ".repeat(8 * 1024 * 1024 + 1)), /input limit/u);
  assert.throws(() => canonicalSerialize({ bad: undefined }));
  assert.throws(() => canonicalSerialize({ bad: Infinity }));
  assert.equal(canonicalSerialize({ b: 2, a: [null, -0] }), canonicalSerialize({ a: [null, 0], b: 2 }));
  assert.equal(capsulePath("src\\ledger.ts"), "src/ledger.ts");
  assert.throws(() => capsulePath("../escape"));
  assert.notEqual(sha256("payload\n"), sha256("payload\r\n"));
  for (const mutate of [(c: ContextCapsuleV1) => { c.deterministic.repository.activeGeneration++; }, (c: ContextCapsuleV1) => { c.deterministic.files[0]!.sourceHash = "a".repeat(64); }, (c: ContextCapsuleV1) => { c.deterministic.ranges[0]!.endLine++; }]) {
    const copy = structuredClone(original); mutate(copy); assert.notEqual(hashCapsuleCore(copy.deterministic), original.capsuleHash);
  }
});

test("Safety exclusion keeps the real stale-source reason and never claims a budget drop", async (t) => {
  const root = await createTemporaryDirectory("capsule-stale"); t.after(() => removeTemporaryDirectory(root)); await fixture(root);
  const task = "fix Ledger saveValue";
  const search = await searchRepository(scanner, reader, factory, { repositoryPath: root, task, limit: 64 });
  await writeFixture(root, "test/ledger.test.ts", "// STALE_PRIVATE_BODY\n");
  const result = await buildContextPack(scanner, reader, factory, { repositoryPath: root, task, budget: 4000, captureCapsule: true }, undefined, () => Promise.resolve(search));
  const capsule = validateCapsule(result.capsule);
  const explanation = explainContext(capsule, { type: "WHY_EXCLUDED", subject: "test/ledger.test.ts" });
  assert.equal(explanation.status, "OK");
  assert.equal(explanation.facts.decisions?.[0]?.reason, "STALE_SOURCE");
  assert.ok(!JSON.stringify(capsule).includes("STALE_PRIVATE_BODY"));
});

test("CLI sidecar preserves stdout and offline Explain succeeds after repository removal", async (t) => {
  const temp = await createTemporaryDirectory("capsule-cli"), root = join(temp, "repo"), sidecar = join(temp, "capsule.json");
  t.after(() => removeTemporaryDirectory(temp)); await mkdir(root); await fixture(root);
  const cli = resolve("dist/cli/main.js");
  const args = [cli, "pack", "fix Ledger saveValue", root, "--budget", "2000"];
  const off = await exec(process.execPath, args), on = await exec(process.execPath, [...args, "--capsule", sidecar]);
  assert.equal(on.stdout, off.stdout);
  const capsule = parseCapsule(await readFile(sidecar, "utf8"));
  assert.equal(sha256(on.stdout), capsule.deterministic.payloadHash);
  await assert.rejects(exec(process.execPath, [...args, "--capsule", sidecar]), /OUTPUT_EXISTS/u);
  await removeTemporaryDirectory(root);
  const explained = await exec(process.execPath, [cli, "explain", sidecar, "--json"], { cwd: temp });
  assert.equal((JSON.parse(explained.stdout) as { status: string }).status, "OK");
  assert.ok(!explained.stdout.includes("CAPSULE_BODY_SENTINEL"));
  await assert.rejects(exec(process.execPath, [cli, "explain", temp]), /INVALID_CAPSULE/u);
  const giant = join(temp, "giant.json"); await writeFixture(temp, "giant.json", " ".repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(exec(process.execPath, [cli, "explain", giant]), /INVALID_CAPSULE/u);
});
