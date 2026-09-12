import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { createContextForgeLifecycle } from "../../src/composition/contextforge-lifecycle.js";
import { compileReview } from "../../src/composition/contextforge-review.js";
import { ReviewGitReader } from "../../src/adapters/git/review-git-reader.js";
import { canonicalSerialize, hashCapsuleCore, validateCapsule } from "../../src/core/context-capsule.js";
import { contextCoverage } from "../../src/core/context-coverage.js";
import { recompileContext, verifyReplay } from "../../src/application/context-lifecycle.js";
import { GenericTokenEstimator } from "../../src/core/token-estimation.js";
import { SqliteCapsuleHistory } from "../../src/adapters/sqlite/sqlite-capsule-history.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

async function setup(t: test.TestContext) {
  const temp = await realpath(await createTemporaryDirectory("review")), root = join(temp, "repo");
  await mkdir(root); t.after(() => removeTemporaryDirectory(temp));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  git("init");
  await writeFixture(root, "src/ledger.ts", "export function ledger(value: number) {\n  return value + 1;\n}\n");
  await writeFixture(root, "src/caller.ts", "import { ledger } from './ledger.js';\nexport function caller() { return ledger(2); }\n");
  await writeFixture(root, "test/ledger.test.ts", "import { ledger } from '../src/ledger.js';\nexport function testLedger() { return ledger(1) === 2; }\n");
  await writeFixture(root, "src/contract.ts", "export interface Store { save(): void; }\n");
  await writeFixture(root, "src/store.ts", "import { Store } from './contract.js';\nexport class LocalStore implements Store { save() {} }\n");
  await writeFixture(root, ".env", "SECRET_SENTINEL=initial\n");
  git("add", "."); git("-c", "user.name=Review fixture", "-c", "user.email=review@example.invalid", "commit", "-m", "fixture");
  await writeFixture(root, "src/ledger.ts", "export function ledger(value: number) {\n  return value + 2;\n}\n");
  await writeFixture(root, ".env", "SECRET_SENTINEL=changed\n");
  const app = await createContextForgeLifecycle(root); await app.index();
  return { root, app, git };
}

test("Review: real Git changes seed callers/tests, deterministic hard budget, history, controls and replay", async (t) => {
  const { root, app } = await setup(t);
  const a = await compileReview(root, { budget: 2000 });
  const b = await compileReview(root, { budget: 2000 });
  assert.equal(a.capsule.capsuleHash, b.capsule.capsuleHash);
  assert.equal(a.markdown, b.markdown);
  assert.equal(a.capsule.schemaVersion, "contextforge-capsule-v2");
  assert.ok(a.review.changes.some((c) => c.path === "src/ledger.ts" && c.symbols.some((s) => s.name === "ledger" && s.change === "MODIFIED")));
  assert.ok(a.review.impact.some((r) => r.from === "src/caller.ts" && r.to === "src/ledger.ts" && r.type === "SYMBOL_REFERENCES_SYMBOL" && r.classification === "STRUCTURAL_FACT"));
  assert.ok(a.review.impact.some((r) => /TEST/u.test(r.type)));
  assert.equal(a.review.excludedChanges, 1);
  assert.ok(!canonicalSerialize(a.capsule).includes("SECRET_SENTINEL"));
  assert.ok(!canonicalSerialize(a.capsule).includes(root.replaceAll("\\", "/")));
  assert.ok(new GenericTokenEstimator().estimate(a.markdown) <= 2000);
  assert.equal((await verifyReplay(app, a.capsule)).result.status, "EXACT_MATCH");
  const original = canonicalSerialize(a.capsule);
  const controlled = await recompileContext(app, a.capsule, { controls: [{ kind: "EXCLUDE", path: "src/caller.ts" }] });
  assert.equal(canonicalSerialize(a.capsule), original);
  assert.equal(controlled.capsule.deterministic.overrides[0]?.parentCapsuleHash, a.capsule.capsuleHash);
  assert.ok(controlled.diff.candidates.some((c) => c.path === "src/caller.ts" && c.after?.disposition === "DROPPED"));
  assert.equal((await verifyReplay(app, controlled.capsule)).result.status, "EXACT_MATCH");
  assert.ok(contextCoverage(controlled.capsule).review?.lints.some((l) => l.code === "DIRECT_IMPACT_NOT_SELECTED"));
  const history = new SqliteCapsuleHistory(join(root, ".contextforge/history"));
  try { history.save(a.capsule); history.save(controlled.capsule); assert.equal(history.list(10).length, 2); assert.equal(history.get(a.capsule.capsuleHash).capsuleHash, a.capsule.capsuleHash); } finally { history.close(); }
  await assert.rejects(compileReview(root, { budget: 1 }), /budget/iu);
  await writeFixture(root, "src/ledger.ts", "export function ledger() { return 99; }\n");
  assert.equal((await verifyReplay(app, a.capsule)).result.status, "SOURCE_CHANGED");
  await assert.rejects(recompileContext(app, a.capsule, { controls: [] }), /changed/iu);
});

test("Review: additions, renames, deletion metadata, implementation facts and malicious refs", async (t) => {
  const { root, app, git } = await setup(t);
  await rename(join(root, "src/caller.ts"), join(root, "src/renamed.ts"));
  await rm(join(root, "test/ledger.test.ts"));
  await writeFixture(root, "src/new.ts", "export function added() { return 1; }\n");
  await writeFixture(root, "src/contract.ts", "export interface Store { save(): void; load(): void; }\n");
  git("add", "src/caller.ts", "src/renamed.ts", "src/new.ts"); await app.index();
  const result = await compileReview(root, { budget: 3000 });
  assert.ok(result.review.changes.some((c) => c.status === "ADDED" && c.symbols.some((s) => s.change === "ADDED")));
  assert.ok(result.review.changes.some((c) => c.status === "RENAMED" && c.previousPath === "src/caller.ts"));
  assert.ok(result.review.changes.some((c) => c.status === "DELETED" && c.availability === "DELETED_METADATA_ONLY"));
  assert.ok(result.review.impact.some((r) => /IMPLEMENT/u.test(r.type) && r.classification === "STRUCTURAL_FACT"));
  for (const base of ["--output=pwned", "HEAD;echo bad", "$(echo bad)", "HEAD\n", "HEAD@{1}", "../outside"]) await assert.rejects(new ReviewGitReader(root).resolve(base));
  const malformed = structuredClone(result.capsule); malformed.deterministic.review!.base = "invalid";
  assert.throws(() => validateCapsule(malformed));
});

test("Review: security exclusions, deletion-only hunks, new change conflicts and empty inputs", async (t) => {
  const { root, app, git } = await setup(t);
  await writeFixture(root, "orphan.ts", "export const temporary = 1;\n"); await app.index();
  await rm(join(root, "orphan.ts")); await app.index();
  await writeFixture(root, "ignored.ts", "export const protectedValue = 'IGNORED_REVIEW_SENTINEL';\n");
  await writeFixture(root, "binary.png", "BINARY_REVIEW_SENTINEL");
  git("add", "ignored.ts", "binary.png"); git("-c", "user.name=Review fixture", "-c", "user.email=review@example.invalid", "commit", "-m", "add exclusions");
  await writeFixture(root, ".contextforgeignore", "ignored.ts\n");
  await writeFixture(root, "ignored.ts", "export const changed = 'IGNORED_REVIEW_SENTINEL';\n");
  await writeFixture(root, "binary.png", "CHANGED_BINARY_REVIEW_SENTINEL");
  await writeFixture(root, "src/ledger.ts", "export function ledger(value: number) {\n}\n");
  await app.index();
  const result = await compileReview(root, { budget: 2000 });
  assert.ok(result.review.changes.some((c) => c.path === "src/ledger.ts" && c.symbols.some((s) => s.name === "ledger" && s.change === "MODIFIED")));
  assert.ok(result.review.excludedChanges >= 3);
  assert.ok(!result.markdown.includes("REVIEW_SENTINEL"));
  assert.ok(!canonicalSerialize(result.capsule).includes("ignored.ts"));
  await assert.rejects(recompileContext(app, result.capsule, { controls: [{ kind: "PIN", path: ".env" }] }), /target|proposal/iu);
  git("add", "."); git("-c", "user.name=Review fixture", "-c", "user.email=review@example.invalid", "commit", "-m", "complete");
  assert.notEqual((await verifyReplay(app, result.capsule)).result.status, "EXACT_MATCH");
  await assert.rejects(compileReview(root, { budget: 2000 }), /No reviewable/iu);
});

test("Review: read-only analysis never executes repository-configured clean/process filters", async (t) => {
  const { root, app, git } = await setup(t);
  await writeFixture(root, ".gitattributes", "*.ts filter=attack\n");
  git("config", "filter.attack.clean", "node -e \"require('fs').writeFileSync('filter-executed','unsafe');process.stdin.pipe(process.stdout)\"");
  git("config", "filter.attack.process", "node -e \"require('fs').writeFileSync('filter-executed','unsafe')\"");
  git("config", "filter.attack.required", "true");
  await app.index();
  const result = await compileReview(root, { budget: 2000 });
  assert.ok(result.review.changes.some((f) => f.path === "src/ledger.ts"));
  await assert.rejects(readFile(join(root, "filter-executed")), { code: "ENOENT" });
});

test("Review: a pure tracked delete produces deterministic metadata-only Capsules before and after refresh", async (t) => {
  const temp = await realpath(await createTemporaryDirectory("review-delete-only")), root = join(temp, "repo");
  await mkdir(root); t.after(() => removeTemporaryDirectory(temp));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  git("init", "-b", "main");
  await writeFixture(root, ".gitignore", ".contextforge/\n");
  await writeFixture(root, "src/service.ts", "export function service() { return 1; }\n");
  git("add", "--", ".gitignore", "src/service.ts");
  git("-c", "user.name=Review fixture", "-c", "user.email=review@example.invalid", "commit", "-m", "fixture");
  const app = await createContextForgeLifecycle(root);
  await app.index();
  await rm(join(root, "src", "service.ts"));
  await assert.rejects(compileReview(root, { budget: 1 }), { code: "BUDGET_TOO_SMALL" });

  const staleGeneration = await compileReview(root, { budget: 1000 });
  assert.equal(validateCapsule(staleGeneration.capsule).schemaVersion, "contextforge-capsule-v2");
  assert.deepEqual(staleGeneration.review.changes.map((change) => ({ path: change.path, status: change.status, availability: change.availability, sourceHash: change.sourceHash, symbols: change.symbols.length })), [
    { path: "src/service.ts", status: "DELETED", availability: "DELETED_METADATA_ONLY", sourceHash: null, symbols: 0 },
  ]);
  assert.equal(staleGeneration.capsule.deterministic.selected.length, 0);
  assert.equal(staleGeneration.capsule.deterministic.files.some((file) => file.path === "src/service.ts"), false);
  assert.equal(staleGeneration.markdown.includes("export function service"), false);
  assert.ok(new GenericTokenEstimator().estimate(staleGeneration.markdown) <= 1000);

  await app.index();
  const refreshedA = await compileReview(root, { budget: 1000 });
  const refreshedB = await compileReview(root, { budget: 1000 });
  assert.equal(refreshedA.capsule.capsuleHash, refreshedB.capsule.capsuleHash);
  assert.equal(refreshedA.markdown, refreshedB.markdown);
  assert.equal(refreshedA.capsule.deterministic.selected.length, 0);
  const coverage = contextCoverage(refreshedA.capsule).review;
  assert.deepEqual(coverage?.changedFiles, { available: 1, selected: 0 });
  assert.deepEqual(coverage?.changedSymbols, { available: 0, represented: 0 });
  assert.ok(coverage?.lints.some((lint) => lint.code === "HISTORICAL_SOURCE_UNAVAILABLE"));
  const ordinaryEmpty = structuredClone(refreshedA.capsule);
  ordinaryEmpty.schemaVersion = "contextforge-capsule-v1";
  delete ordinaryEmpty.deterministic.review;
  ordinaryEmpty.capsuleHash = hashCapsuleCore(ordinaryEmpty.deterministic);
  assert.throws(() => validateCapsule(ordinaryEmpty), /Invalid Context Capsule/iu);
  const restarted = await createContextForgeLifecycle(root);
  assert.equal((await verifyReplay(restarted, refreshedA.capsule)).result.status, "EXACT_MATCH");

  await writeFixture(root, "src/service.ts", "export function service() { return 1; }\n");
  assert.equal(git("status", "--porcelain=v1"), "");
  await app.index();
  assert.notEqual((await verifyReplay(app, refreshedA.capsule)).result.status, "EXACT_MATCH");
});

test("Review: a deleted import target retains only supportable one-hop evidence from a pre-change generation", async (t) => {
  const temp = await realpath(await createTemporaryDirectory("review-delete-relation")), root = join(temp, "repo");
  await mkdir(root); t.after(() => removeTemporaryDirectory(temp));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  git("init", "-b", "main");
  await writeFixture(root, "src/service.ts", "export function service() { return 1; }\n");
  await writeFixture(root, "src/caller.ts", "import { service } from './service.js';\nexport const result = service();\n");
  git("add", "--", "src/service.ts", "src/caller.ts");
  git("-c", "user.name=Review fixture", "-c", "user.email=review@example.invalid", "commit", "-m", "fixture");
  const app = await createContextForgeLifecycle(root);
  await app.index();
  await rm(join(root, "src", "service.ts"));

  const result = await compileReview(root, { budget: 1500 });
  assert.ok(result.review.impact.some((impact) => impact.from === "src/caller.ts" && impact.to === "src/service.ts" && impact.classification === "STRUCTURAL_FACT"));
  const caller = result.capsule.deterministic.files.find((file) => file.path === "src/caller.ts");
  assert.ok(caller);
  const selected = result.capsule.deterministic.selected.find((item) => result.capsule.deterministic.candidates.find((candidate) => candidate.id === item.candidateRef)?.fileRef === caller.id);
  assert.ok(selected?.evidenceRefs.some((reference) => result.capsule.deterministic.evidence.find((evidence) => evidence.id === reference)?.code === "FILE_IMPORTS_FILE"));
  assert.equal(result.capsule.deterministic.files.some((file) => file.path === "src/service.ts"), false);
  assert.equal(result.markdown.includes("export function service"), false);
});

test("Review: rename, delete and restore lifecycle preserves valid metadata and a healthy durable index", async (t) => {
  const temp = await realpath(await createTemporaryDirectory("review-rename-delete-restore")), root = join(temp, "repo");
  await mkdir(root); t.after(() => removeTemporaryDirectory(temp));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  git("init", "-b", "main");
  await writeFixture(root, ".gitignore", ".contextforge/\n");
  await writeFixture(root, "src/A.ts", "export const value = 1;\n");
  git("add", "--", ".gitignore", "src/A.ts");
  git("-c", "user.name=Review fixture", "-c", "user.email=review@example.invalid", "commit", "-m", "baseline");
  const app = await createContextForgeLifecycle(root);
  await app.index();

  git("mv", "--", "src/A.ts", "src/B.ts");
  await app.index();
  const renameReview = await compileReview(root, { budget: 1000 });
  assert.ok(renameReview.review.changes.some((change) => change.status === "RENAMED" && change.path === "src/B.ts" && change.previousPath === "src/A.ts"));
  git("-c", "user.name=Review fixture", "-c", "user.email=review@example.invalid", "commit", "-m", "rename");
  await app.index();

  await rm(join(root, "src", "B.ts"));
  await app.index();
  const deleteReview = await compileReview(root, { budget: 1000 });
  assert.deepEqual(deleteReview.review.changes.map((change) => [change.status, change.path, change.availability]), [["DELETED", "src/B.ts", "DELETED_METADATA_ONLY"]]);
  assert.equal(deleteReview.capsule.deterministic.selected.length, 0);

  await writeFixture(root, "src/B.ts", "export const value = 1;\n");
  assert.equal(git("status", "--porcelain=v1"), "");
  await app.index();
  assert.equal((await app.status()).indexStatus, "CURRENT");
  assert.notEqual((await verifyReplay(app, deleteReview.capsule)).result.status, "EXACT_MATCH");
});
