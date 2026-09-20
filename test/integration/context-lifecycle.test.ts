import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { createContextForgeLifecycle } from "../../src/composition/contextforge-lifecycle.js";
import { SqliteCapsuleHistory } from "../../src/adapters/sqlite/sqlite-capsule-history.js";
import { inspectReplay, recompileContext, verifyReplay } from "../../src/application/context-lifecycle.js";
import { canonicalSerialize, hashCapsuleCore, validateCapsule } from "../../src/core/context-capsule.js";
import { normalizeControls } from "../../src/core/context-controls.js";
import { diffContexts } from "../../src/core/context-diff.js";
import { contextCoverage } from "../../src/core/context-coverage.js";
import { GenericTokenEstimator } from "../../src/core/token-estimation.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

async function setup(t: test.TestContext) {
  const temp = await realpath(await createTemporaryDirectory("lifecycle")), root = join(temp, "repo");
  t.after(() => removeTemporaryDirectory(temp));
  await mkdir(root);
  for (let i = 0; i < 12; i++) await writeFixture(root, `src/ledger${i}.ts`, `export function ledger${i}() {\n${Array.from({ length: 24 }, (_, n) => `  const value${n} = 'BODY_PRIVATE_SENTINEL_${i}_${n}';`).join("\n")}\n  return 'ledger';\n}\n`);
  await writeFixture(root, "AGENTS.md", "# Rules\nVerify changed behavior.\n");
  await writeFixture(root, ".env", "SECRET_SENTINEL=never_read\n");
  const app = await createContextForgeLifecycle(root); await app.index();
  const execution = await app.compile({ task: "fix ledger", budget: 2000, captureCapsule: true });
  return { temp, root, app, execution, capsule: validateCapsule(execution.capsule) };
}

test("lifecycle: exact replay, immutable what-if, semantic transitions, deterministic controls and hard budget", async (t) => {
  const { app, capsule, execution } = await setup(t);
  const original = canonicalSerialize(capsule);
  assert.equal((await verifyReplay(app, capsule)).result.status, "EXACT_MATCH");
  const selected = capsule.deterministic.selected.find((s) => s.role !== "REPOSITORY_INSTRUCTION"); assert.ok(selected);
  const target = capsule.deterministic.candidates.find((c) => c.id === selected.candidateRef); assert.ok(target);
  const path = capsule.deterministic.files.find((f) => f.id === target.fileRef)?.path; assert.ok(path);
  const after = await recompileContext(app, capsule, { controls: [{ kind: "EXCLUDE", path }] });
  assert.ok(!after.capsule.deterministic.selected.some((s) => s.candidateRef === selected.candidateRef));
  assert.ok(after.diff.candidates.some((d) => d.id === selected.candidateRef && d.before?.disposition === "SELECTED" && d.after?.disposition === "DROPPED"));
  assert.notEqual(after.capsule.capsuleHash, capsule.capsuleHash);
  assert.equal(canonicalSerialize(capsule), original);
  assert.equal((await verifyReplay(app, after.capsule)).result.status, "EXACT_MATCH");
  assert.equal(after.capsule.capsuleHash, (await recompileContext(app, capsule, { controls: [{ kind: "EXCLUDE", path }] })).capsule.capsuleHash);
  const empty = diffContexts(capsule, capsule); assert.deepEqual(empty.candidates, []); assert.deepEqual(empty.compilation, []);
  const ranged = await recompileContext(app, capsule, { controls: [{ kind: "RANGE", path, startLine: 2, endLine: 3 }] });
  const rangeSelection = ranged.capsule.deterministic.selected.find((s) => s.candidateRef === selected.candidateRef); assert.ok(rangeSelection);
  assert.deepEqual(ranged.capsule.deterministic.ranges.filter((r) => rangeSelection.rangeRefs.includes(r.id)).map((r) => [r.startLine, r.endLine]), [[2, 3]]);
  assert.equal(ranged.capsule.deterministic.overrides[0]?.parentCapsuleHash, capsule.capsuleHash);
  const dropped = capsule.deterministic.candidates.find((c) => c.disposition === "DROPPED" && c.kind === "FILE" && c.fileRef !== capsule.deterministic.files.find((f) => f.path === "AGENTS.md")?.id); assert.ok(dropped);
  const droppedPath = capsule.deterministic.files.find((f) => f.id === dropped.fileRef)?.path; assert.ok(droppedPath);
  const pinned = await recompileContext(app, capsule, { controls: [{ kind: "PIN", path: droppedPath }] });
  assert.ok(pinned.capsule.deterministic.selected.some((s) => s.candidateRef === dropped.id));
  for (const kind of ["PREFER", "FOCUS"] as const) {
    const changed = await recompileContext(app, capsule, { controls: [{ kind, path: droppedPath }] });
    assert.ok(changed.capsule.deterministic.selected.some((s) => s.candidateRef === dropped.id));
  }
  for (const run of [after, ranged, pinned]) assert.ok(new GenericTokenEstimator().estimate(run.execution.markdown) <= run.capsule.deterministic.budget.requested);
  assert.notEqual(execution.markdown, after.execution.markdown);
  await assert.rejects(recompileContext(app, capsule, { budget: 1, controls: [{ kind: "PIN", path }] }), { code: "CONTROL_CONFLICT" });
  await assert.rejects(recompileContext(app, capsule, { controls: [{ kind: "PIN", path: ".env" }] }), { code: "CONTROL_CONFLICT" });
  await assert.rejects(recompileContext(app, capsule, { controls: [{ kind: "RANGE", path, startLine: 1, endLine: 9999 }] }), { code: "CONTROL_CONFLICT" });
});

test("replay: changed task/source, redacted task, generation change, unavailable strategy, offline inspection", async (t) => {
  const { app, capsule, root } = await setup(t);
  assert.equal((await verifyReplay(app, capsule, "different task")).result.status, "TASK_MISMATCH");
  const task = "fix ledger path=C:\\private\\repo";
  const privateCapsule = validateCapsule((await app.compile({ task, budget: 2000, captureCapsule: true })).capsule);
  assert.equal((await verifyReplay(app, privateCapsule)).result.status, "TASK_REQUIRED");
  assert.equal((await verifyReplay(app, privateCapsule, task)).result.status, "EXACT_MATCH");
  const future = structuredClone(capsule); future.deterministic.strategies.pack = "contextforge-pack-v999"; future.capsuleHash = hashCapsuleCore(future.deterministic);
  assert.equal((await verifyReplay(app, future)).result.status, "STRATEGY_UNAVAILABLE");
  await app.index();
  const generation = await verifyReplay(app, capsule);
  assert.equal(generation.result.status, "PAYLOAD_CHANGED");
  await assert.rejects(recompileContext(app, capsule, { controls: [] }), { code: "CONTROL_CONFLICT" });
  await writeFixture(root, "src/ledger0.ts", "export const changed = true;\n");
  assert.equal((await verifyReplay(app, capsule)).result.status, "SOURCE_CHANGED");
  await removeTemporaryDirectory(root);
  assert.equal(inspectReplay(capsule).status, "INSPECTED");
  assert.equal((await verifyReplay(app, capsule)).result.status, "CANNOT_REPRODUCE");
});

test("history: deduplication, reopen, source-light compressed objects, bounds, delete and prune", async (t) => {
  const { app, capsule, temp } = await setup(t);
  const storePath = join(temp, "history");
  let store = new SqliteCapsuleHistory(storePath);
  const first = store.save(capsule), repeat = store.save(capsule);
  assert.deepEqual(first, repeat); assert.equal(store.stats().count, 1);
  assert.ok(first.storedBytes < first.metadataBytes);
  assert.ok(!JSON.stringify(store.get(first.id)).includes("BODY_PRIVATE_SENTINEL"));
  store.close(); store = new SqliteCapsuleHistory(storePath);
  try {
  assert.equal(store.get(first.id).capsuleHash, capsule.capsuleHash);
  const next = await recompileContext(app, capsule, { budget: 3000, controls: [] }); store.save(next.capsule);
  assert.equal(store.list(1).length, 1); assert.equal(store.list(1, 1).length, 1);
  assert.throws(() => store.list(101), { code: "HISTORY_ERROR" });
  assert.throws(() => store.get("../../escape"), { code: "HISTORY_ERROR" });
  assert.equal(store.prune(1), 1); assert.equal(store.stats().count, 1);
  const remaining = store.list()[0]; assert.ok(remaining);
  assert.equal(store.delete(remaining.id), true); assert.equal(store.delete(remaining.id), false);
  assert.throws(() => store.get(remaining.id), { code: "HISTORY_MISSING" });
  const raw = await readFile(join(storePath, "capsules.sqlite"));
  assert.ok(!raw.includes(Buffer.from("BODY_PRIVATE_SENTINEL")));
  t.diagnostic(`fixture metadata=${first.metadataBytes}, compressed=${first.storedBytes}`);
  } finally { store.close(); }
});

test("history: corrupted objects and future format reject safely; junction path rejected", async (t) => {
  const { capsule, temp } = await setup(t), path = join(temp, "history");
  const store = new SqliteCapsuleHistory(path); store.save(capsule); store.close();
  const db = new DatabaseSync(join(path, "capsules.sqlite"));
  db.prepare("UPDATE capsules SET body=?").run(Buffer.from("corrupt")); db.close();
  const corrupt = new SqliteCapsuleHistory(path);
  assert.throws(() => corrupt.get(capsule.capsuleHash), { code: "HISTORY_ERROR" });
  assert.throws(() => corrupt.save(capsule), { code: "HISTORY_ERROR" }); corrupt.close();
  const future = new DatabaseSync(join(path, "capsules.sqlite")); future.exec("PRAGMA user_version=999"); future.close();
  assert.throws(() => new SqliteCapsuleHistory(path), { code: "UNSUPPORTED_SCHEMA" });
  const link = join(temp, "linked-history"); await symlink(path, link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => new SqliteCapsuleHistory(link), { code: "HISTORY_ERROR" });
});

test("controls reject malicious, duplicate and conflicting requests", () => {
  for (const input of [[{ kind: "PIN", path: "../secret" }], [{ kind: "PIN", path: "C:/secret" }], [{ kind: "EXCLUDE", path: "AGENTS.md" }], [{ kind: "RANGE", path: "x.ts", startLine: 3, endLine: 1 }], [{ kind: "PIN", path: "x.ts" }, { kind: "EXCLUDE", path: "x.ts" }], Array.from({ length: 33 }, () => ({ kind: "PIN", path: "x.ts" }))]) assert.throws(() => normalizeControls(input), { code: "CONTROL_CONFLICT" });
});

test("coverage has factual counts and explicit limitations without inventing completeness", async (t) => {
  const { capsule } = await setup(t); const coverage = contextCoverage(capsule);
  assert.equal(coverage.candidates.available, capsule.deterministic.candidates.length);
  assert.equal(coverage.planner, "NOT_RUN"); assert.deepEqual(coverage.roles, []);
  assert.ok(coverage.limitations.includes("NOT_CONTEXT_COMPLETENESS"));
  assert.deepEqual(coverage.lints, []);
});

test("lint contracts: each rule has a positive, negative and recorded-evidence assertion", async (t) => {
  const { app, capsule } = await setup(t);
  const originalCoverage = contextCoverage(capsule);
  for (const code of ["AVAILABLE_ROLE_NOT_SELECTED", "TOP_CANDIDATE_BUDGET_LOSS", "SOURCE_UNAVAILABLE"]) assert.ok(!originalCoverage.lints.some((l) => l.code === code));
  // Synthetic captured facts exercise reporting rules; no benchmark Gold enters production.
  const reference = structuredClone(capsule); reference.deterministic.strategies.pack = "contextforge-pack-v2";
  const roles = validateCapsule((await app.compile({ task: "fix ledger", budget: 2000, captureCapsule: true }, reference)).capsule);
  roles.deterministic.coverage.planRoles = [{ role: "VALIDATION", available: 1, selected: 0, estimatedTokens: 0, borrowedItems: 0 }];
  for (const candidate of roles.deterministic.candidates) candidate.planRoles = [];
  const roleCandidate = roles.deterministic.candidates[0]; assert.ok(roleCandidate); roleCandidate.planRoles = ["VALIDATION"];
  roles.capsuleHash = hashCapsuleCore(roles.deterministic);
  const roleLint = contextCoverage(roles).lints.find((l) => l.code === "AVAILABLE_ROLE_NOT_SELECTED");
  assert.ok(roleLint); assert.deepEqual(roleLint.entities, [roleCandidate.id]); assert.equal(roleLint.evidence.code, "VALIDATION");
  roles.deterministic.coverage.planRoles[0]!.selected = 1; roles.capsuleHash = hashCapsuleCore(roles.deterministic);
  assert.ok(!contextCoverage(roles).lints.some((l) => l.code === "AVAILABLE_ROLE_NOT_SELECTED"));
  for (const safety of [false, true]) {
    const copy = structuredClone(capsule), c = copy.deterministic;
    const candidate = c.candidates.find((item) => item.rank === 1); assert.ok(candidate);
    const decision = c.decisions.find((d) => candidate.decisionRefs.includes(d.id)); assert.ok(decision);
    c.selected = c.selected.filter((s) => s.candidateRef !== candidate.id); c.selected.forEach((s, i) => { s.finalOrder = i; });
    c.dropped = c.dropped.filter((id) => id !== candidate.id); c.excluded = c.excluded.filter((id) => id !== candidate.id);
    candidate.disposition = safety ? "EXCLUDED" : "DROPPED"; decision.disposition = candidate.disposition;
    decision.reason = safety ? "STALE_SOURCE" : "BUDGET_EXHAUSTED"; decision.stage = safety ? "SAFETY" : "PACKING";
    (safety ? c.excluded : c.dropped).push(candidate.id);
    c.coverage.selectedExplained = c.selected.length; c.coverage.selectedTotal = c.selected.length;
    c.coverage.droppedExplained = c.dropped.length; c.coverage.droppedTotal = c.dropped.length;
    c.budget.itemContribution = c.selected.reduce((sum, s) => sum + s.estimatedTokens, 0); c.budget.envelopeAndOtherContribution = c.budget.estimatedTokens - c.budget.itemContribution;
    copy.capsuleHash = hashCapsuleCore(c);
    const code = safety ? "SOURCE_UNAVAILABLE" : "TOP_CANDIDATE_BUDGET_LOSS";
    const lint = contextCoverage(copy).lints.find((l) => l.code === code);
    assert.ok(lint); assert.ok(lint.entities.includes(candidate.id)); assert.ok(lint.evidence.refs.includes(decision.id));
    const transition = diffContexts(capsule, copy).candidates.find((item) => item.id === candidate.id);
    assert.ok(transition?.changes.includes("disposition")); assert.ok(transition?.changes.includes("reasons"));
  }
});

test("recompile rejects generation activation between verification and compilation", async (t) => {
  const { app, capsule } = await setup(t);
  const racing = { verifySources: (input: Parameters<typeof app.verifySources>[0]) => app.verifySources(input), compile: async (...args: Parameters<typeof app.compile>) => { await app.index(); return app.compile(...args); } };
  await assert.rejects(recompileContext(racing, capsule, { controls: [] }), { code: "CONTROL_CONFLICT" });
});

test("history: concurrent real processes deduplicate without lost writes or partial entries", async (t) => {
  const { capsule, temp } = await setup(t), directory = join(temp, "concurrent-history"), file = join(temp, "capsule.json");
  await writeFile(file, JSON.stringify(capsule));
  async function saveWithProcesses(target: string, count: number): Promise<void> {
    const children = Array.from({ length: count }, () => spawn(process.execPath, [join(process.cwd(), ".test-dist/test/helpers/history-process.js"), target, file], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }));
    const errors = children.map(() => "");
    children.forEach((child, index) => child.stderr.on("data", (chunk: Buffer) => { errors[index] += chunk.toString(); }));
    const exits = children.map((child) => once(child, "exit"));
    try {
      await Promise.all(children.map(async (child) => { const [chunk] = await once(child.stdout, "data") as [Buffer]; assert.equal(chunk.toString(), "READY\n"); }));
      for (const child of children) child.stdin.end("SAVE\n");
      for (const [index, result] of (await Promise.all(exits)).entries()) assert.equal(result[0], 0, errors[index]);
    } finally { for (const child of children) if (child.exitCode === null) child.kill(); await Promise.all(exits); }
  }
  for (let iteration = 0; iteration < 10; iteration++) {
    const target = join(directory, `fresh-${iteration}`);
    await saveWithProcesses(target, 2);
    const store = new SqliteCapsuleHistory(target);
    try { assert.equal(store.stats().count, 1); assert.equal(store.get(capsule.capsuleHash).capsuleHash, capsule.capsuleHash); } finally { store.close(); }
  }
  const fourProcess = join(directory, "fresh-four-process");
  await saveWithProcesses(fourProcess, 4);
  const initialized = new SqliteCapsuleHistory(fourProcess); initialized.close();
  await saveWithProcesses(fourProcess, 4);
  const store = new SqliteCapsuleHistory(fourProcess);
  try { assert.equal(store.stats().count, 1); assert.equal(store.get(capsule.capsuleHash).capsuleHash, capsule.capsuleHash); } finally { store.close(); }

  const controlled = join(directory, "controlled-overlap"), helper = join(process.cwd(), ".test-dist/test/helpers/history-process.js");
  const holder = spawn(process.execPath, [helper, controlled, file, "hold-bootstrap"], { stdio: ["pipe", "pipe", "pipe", "pipe"], windowsHide: true });
  const waiter = spawn(process.execPath, [helper, controlled, file, "observe-bootstrap"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const holderErrors: Buffer[] = [], waiterErrors: Buffer[] = [];
  holder.stderr.on("data", (chunk: Buffer) => holderErrors.push(chunk)); waiter.stderr.on("data", (chunk: Buffer) => waiterErrors.push(chunk));
  const holderExit = once(holder, "exit"), waiterExit = once(waiter, "exit");
  const holderLines = createInterface({ input: holder.stdout })[Symbol.asyncIterator](), waiterLines = createInterface({ input: waiter.stdout })[Symbol.asyncIterator]();
  const expectLine = async (lines: AsyncIterator<string>, expected: string) => { const result = await lines.next(); assert.equal(result.value, expected); };
  try {
    await Promise.all([expectLine(holderLines, "READY"), expectLine(waiterLines, "READY")]);
    holder.stdin.end("SAVE\n");
    await expectLine(holderLines, "BOOTSTRAP_LOCKED");
    waiter.stdin.end("SAVE\n");
    await expectLine(waiterLines, "BOOTSTRAP_BEGIN");
    // Barriers establish the overlap. This deliberate hold exceeds the former
    // 750 ms bootstrap limit and is the behavior under test, not synchronization.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const release = holder.stdio[3] as NodeJS.WritableStream | null; assert.ok(release); release.end("RELEASE\n");
    const [holderResult, waiterResult] = await Promise.all([holderExit, waiterExit]);
    assert.equal(holderResult[0], 0, Buffer.concat(holderErrors).toString());
    assert.equal(waiterResult[0], 0, Buffer.concat(waiterErrors).toString());
    const controlledStore = new SqliteCapsuleHistory(controlled);
    try { assert.equal(controlledStore.stats().count, 1); assert.equal(controlledStore.get(capsule.capsuleHash).capsuleHash, capsule.capsuleHash); } finally { controlledStore.close(); }
  } finally {
    if (holder.exitCode === null) holder.kill(); if (waiter.exitCode === null) waiter.kill();
    await Promise.all([holderExit, waiterExit]);
  }
});

test("history: initialization wait is bounded and operation timeout is restored", async (t) => {
  const { capsule, temp } = await setup(t), directory = join(temp, "history-timeouts"), databasePath = join(directory, "capsules.sqlite");
  await mkdir(directory);
  const bootstrapHolder = new DatabaseSync(databasePath, { timeout: 25 });
  bootstrapHolder.exec("BEGIN EXCLUSIVE");
  const bootstrapStarted = performance.now();
  assert.throws(() => new SqliteCapsuleHistory(directory), { code: "HISTORY_ERROR" });
  const bootstrapElapsed = performance.now() - bootstrapStarted;
  assert.ok(bootstrapElapsed >= 2500 && bootstrapElapsed < 7000, `bootstrap wait was ${bootstrapElapsed}ms`);
  assert.equal(bootstrapHolder.prepare("PRAGMA user_version").get()?.user_version, 0);
  assert.equal(bootstrapHolder.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").get()?.count, 0);
  bootstrapHolder.exec("ROLLBACK"); bootstrapHolder.close();

  const store = new SqliteCapsuleHistory(directory), operationHolder = new DatabaseSync(databasePath, { timeout: 25 });
  try {
    operationHolder.exec("BEGIN IMMEDIATE");
    const operationStarted = performance.now();
    assert.throws(() => store.save(capsule), { code: "HISTORY_ERROR" });
    const operationElapsed = performance.now() - operationStarted;
    assert.ok(operationElapsed >= 500 && operationElapsed < 2500, `operation wait was ${operationElapsed}ms`);
    operationHolder.exec("ROLLBACK");
    assert.equal(store.stats().count, 0);
    assert.equal(store.save(capsule).id, capsule.capsuleHash);
    assert.equal(store.stats().count, 1);
  } finally {
    try { operationHolder.exec("ROLLBACK"); } catch { /* transaction already closed */ }
    operationHolder.close(); store.close();
  }
});
