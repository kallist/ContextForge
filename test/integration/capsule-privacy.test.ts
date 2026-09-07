import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildIndex } from "../../src/application/build-index.js";
import { buildContextPack } from "../../src/application/build-context-pack.js";
import { buildContextPackV2 } from "../../src/application/build-context-pack-v2.js";
import { hashCapsuleCore, parseCapsule, sha256, validateCapsule, type ContextCapsuleV1 } from "../../src/core/context-capsule.js";
import { createCapsuleExplainer, renderExplain } from "../../src/core/explain-context.js";
import { hasAbsolutePath, redactAbsolutePaths } from "../../src/core/capsule-privacy.js";
import { auditCapsulePrivacy } from "../../benchmarks/src/capsule-privacy-audit.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

const exec = promisify(execFile);
const taskCases = [
  "fix Ledger saveValue path=/home/example-user/project",
  "fix Ledger saveValue path=/home/capsule-user/project",
  'fix Ledger saveValue open(/Users/example-user/project) [/tmp/private] {root:/var/lib/private}',
  'fix Ledger saveValue path=C:\\Users\\example-user\\project root="D:\\private repo\\src" C:/Users/example-user/project',
  "fix Ledger saveValue path=\\\\private-server\\share\\project file:///home/example-user/project file:///C:/Users/example-user/project",
  "fix Ledger saveValue compare src/ledger.ts with /home/example-user/project and https://example.com/docs",
  "fix Ledger saveValue " + "/x ".repeat(5000),
];

for (const v2 of [false, true]) test(`Capsule privacy ${v2 ? "V2" : "V1"}: embedded absolute task path is never exported`, async (t) => {
  const temp = await createTemporaryDirectory("capsule-privacy"), root = join(temp, "repo");
  t.after(() => removeTemporaryDirectory(temp));
  await mkdir(root);
  await writeFixture(root, "src/ledger.ts", "export class Ledger { saveValue() { return 'PRIVATE_SOURCE_BODY_01R'; } }\n");
  const scanner = new FileSystemRepositoryScanner(), reader = new FileSystemRepositorySourceReader(), analyzer = new TreeSitterLanguageAnalyzer();
  const factory = (root: string) => new SqliteIndexRepository(root);
  await buildIndex(scanner, reader, analyzer, factory, { repositoryPath: root });
  let capsule: ContextCapsuleV1 | undefined;
  for (const task of taskCases) {
    const request = { repositoryPath: root, task, budget: task.length > 4000 ? 32000 : 4000 };
    const compile = (captureCapsule: boolean) => v2
      ? buildContextPackV2(scanner, reader, factory, { ...request, captureCapsule }, { relationshipAnalyzer: analyzer })
      : buildContextPack(scanner, reader, factory, { ...request, captureCapsule });
    const off = await compile(false), on = await compile(true);
    assert.equal(on.markdown, off.markdown);
    assert.deepEqual(on.manifest, off.manifest);
    assert.equal(on.manifest.task, task);
    capsule = validateCapsule(on.capsule);
    assert.equal(capsule.deterministic.task.taskHash, sha256(task));
    assert.equal(capsule.deterministic.payloadHash, sha256(off.markdown));
    assert.ok(!JSON.stringify(capsule).includes("/home/example-user/project"), "absolute path leaked through Capsule task metadata");
    assert.equal(capsule.deterministic.task.text, redactAbsolutePaths(task));
    assert.deepEqual(capsule.deterministic.task.normalized, []);
    assert.ok(capsule.deterministic.evidence.every((e) => e.querySignal === null));
    const json = JSON.stringify(capsule);
    auditCapsulePrivacy(capsule);
    for (const privateText of ["example-user", "capsule-user", "private-server", "private repo", "PRIVATE_SOURCE_BODY_01R"]) assert.ok(!json.includes(privateText));
    const explain = createCapsuleExplainer(capsule);
    for (const query of [{ type: "SUMMARY" }, { type: "WHY_SELECTED", subject: capsule.deterministic.selected[0]!.candidateRef }, { type: "WHY_SELECTED", subject: task.slice(0, 4096) } ] as const) {
      const result = explain(query);
      assert.ok(!JSON.stringify(result).includes("example-user"));
      assert.ok(!hasAbsolutePath(renderExplain(result)));
      assert.ok(!hasAbsolutePath(JSON.stringify(result)));
    }
    assert.equal((await compile(true)).capsule?.capsuleHash, capsule.capsuleHash);
  }
  assert.ok(capsule);
  // Every protected free-form family rejects external plaintext even with a new hash.
  const changes: ((c: ContextCapsuleV1, text: string) => void)[] = [
    (c, text) => { c.deterministic.task.text = text; },
    (c, text) => { c.deterministic.task.normalized = [text]; },
    (c, text) => { c.deterministic.symbols[0]!.name = text; },
    (c, text) => { c.deterministic.symbols[0]!.qualifiedName = text; },
    (c, text) => { c.deterministic.evidence[0]!.querySignal = text; },
    (c, text) => { c.deterministic.repository.analysisVersion = text; },
    (c, text) => { c.runtime.createdAt = text; },
    (c, text) => { c.deterministic.relationships.push({ id: "rel_privacy", type: "IMPORT", sourceFileRef: c.deterministic.files[0]!.id, targetFileRef: c.deterministic.files[0]!.id, sourceSymbolId: null, targetSymbolId: null, classification: "HEURISTIC", confidence: 0.5, distance: 1, derivation: text, provenance: "GENERATION_GRAPH", generation: c.deterministic.repository.activeGeneration, location: null }); },
  ];
  for (const path of ["/home/external-user/repo", "C:\\Users\\external-user\\repo", "\\\\external-server\\share", "file:///tmp/external"]) for (const change of changes) {
    const copy = structuredClone(capsule); change(copy, `value=${path}`); copy.capsuleHash = hashCapsuleCore(copy.deterministic);
    assert.throws(() => parseCapsule(JSON.stringify(copy)), /privacy violation/u);
  }
  for (const text of ["src/foo.ts", "../relative/path", "./local/path", "https://example.com/docs", "ordinary prose a / b"]) {
    const copy: ContextCapsuleV1 = structuredClone(capsule); copy.deterministic.task.text = text; copy.capsuleHash = hashCapsuleCore(copy.deterministic);
    assert.equal(validateCapsule(copy).deterministic.task.text, text);
  }
  for (const change of [
    (c: ContextCapsuleV1) => { c.deterministic.diagnostics.codes = ["path=/tmp/private"]; },
    (c: ContextCapsuleV1) => { c.deterministic.evidence[0]!.sourceCandidate = "/tmp/private"; },
    (c: ContextCapsuleV1) => { c.deterministic.files[0]!.path = "/tmp/private"; },
  ]) {
    const copy = structuredClone(capsule); change(copy); copy.capsuleHash = hashCapsuleCore(copy.deterministic);
    assert.throws(() => validateCapsule(copy));
  }
  const helper = resolve(".test-dist/test/helpers/capsule-process.js"), privateTask = taskCases[0]!;
  const one = await exec(process.execPath, [helper, root, v2 ? "v2" : "v1", privateTask]);
  const two = await exec(process.execPath, [helper, root, v2 ? "v2" : "v1", privateTask]);
  assert.equal(one.stdout, two.stdout);
  assert.ok(!one.stdout.includes("example-user"));
  const fixtureHash = (JSON.parse(one.stdout) as { capsuleHash: string }).capsuleHash;
  t.diagnostic(`privacy canonical fixture ${v2 ? "V2" : "V1"}: ${fixtureHash}`);
  assert.equal(fixtureHash, v2 ? "64c656587b95086a974df7c6de4a56a4dbc326f00d8fa96d00871c3c63251016" : "8bb042f565db9bb5698a49c3b0ce9aa7e3ca5a0ca027a1686ab062608affb001");

  // A real CLI export can be inspected after its repository has been removed.
  const sidecar = join(temp, "capsule.json"), cli = resolve("dist/cli/main.js");
  const exported = await exec(process.execPath, [cli, "pack", privateTask, root, "--budget", "4000", "--capsule", sidecar]);
  const saved = parseCapsule(await readFile(sidecar, "utf8"));
  assert.equal(saved.deterministic.payloadHash, sha256(exported.stdout));
  await removeTemporaryDirectory(root);
  for (const json of [false, true]) {
    const result = await exec(process.execPath, [cli, "explain", sidecar, ...(json ? ["--json"] : [])], { cwd: temp });
    assert.ok(!result.stdout.includes("example-user"));
    assert.ok(!hasAbsolutePath(result.stdout));
  }
  const external = structuredClone(saved); external.deterministic.task.text = privateTask; external.capsuleHash = hashCapsuleCore(external.deterministic);
  await writeFile(sidecar, JSON.stringify(external));
  await assert.rejects(exec(process.execPath, [cli, "explain", sidecar]), (error: unknown) => error instanceof Error && /privacy violation/u.test(error.message) && !error.message.includes("example-user"));
});

test("Capsule sanitizes path-shaped source symbol labels without changing source selection", async (t) => {
  const root = await createTemporaryDirectory("capsule-symbol-privacy"); t.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/ledger.ts", 'export class Ledger { "/tmp/metadata-private"() { return 1; } }\n');
  const scanner = new FileSystemRepositoryScanner(), reader = new FileSystemRepositorySourceReader(), analyzer = new TreeSitterLanguageAnalyzer();
  const factory = (root: string) => new SqliteIndexRepository(root);
  await buildIndex(scanner, reader, analyzer, factory, { repositoryPath: root });
  const request = { repositoryPath: root, task: 'fix Ledger."/tmp/metadata-private"', budget: 4000 };
  const off = await buildContextPack(scanner, reader, factory, request);
  const on = await buildContextPack(scanner, reader, factory, { ...request, captureCapsule: true });
  assert.equal(on.markdown, off.markdown);
  const capsule = validateCapsule(on.capsule);
  assert.ok(capsule.deterministic.symbols.some((s) => s.name.includes("<ABSOLUTE_PATH>")));
  assert.ok(!JSON.stringify(capsule).includes("metadata-private"));
  auditCapsulePrivacy(capsule);
});
