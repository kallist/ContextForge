import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { realpath } from "node:fs/promises";
import { createContextForgeLifecycle } from "../../src/composition/contextforge-lifecycle.js";
import { SqliteCapsuleHistory } from "../../src/adapters/sqlite/sqlite-capsule-history.js";
import { startStudio } from "../../src/adapters/studio/studio-server.js";
import { validateCapsule } from "../../src/core/context-capsule.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

test("Studio real API: compile, explain, control, diff, verify, durable reopen and hostile inputs", async () => {
  const root = await realpath(await createTemporaryDirectory("studio-api"));
  await writeFixture(root, "src/ledger.ts", "export function ledger() { return 'SOURCE_BODY_SENTINEL'; }\n");
  await writeFixture(root, "src/ledger-helper.ts", "export function ledgerHelper() { return 2; }\n");
  await writeFixture(root, ".env", "STUDIO_PRIVATE_SENTINEL=secret\n");
  const app = await createContextForgeLifecycle(root), history = new SqliteCapsuleHistory(join(root, ".contextforge/history"));
  const studio = await startStudio(app, history);
  const token = new URL(studio.url).hash.slice(1);
  const headers = { Origin: studio.origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const call = (value: unknown, extra: Record<string, string> = {}) => fetch(`${studio.origin}/api`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(value) });
  const rawStatus = (extra: Record<string, string>) => new Promise<number>((resolve, reject) => {
    const req = httpRequest(`${studio.origin}/api`, { method: "POST", headers: { ...headers, ...extra } }, (res) => { res.resume(); res.on("end", () => { resolve(res.statusCode ?? 0); }); });
    req.on("error", reject); req.end(JSON.stringify({ action: "history" }));
  });
  try {
    const page = await fetch(studio.origin); assert.equal(page.status, 200); assert.ok((await page.text()).includes("Human controls"));
    assert.ok(page.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
    assert.equal((await fetch(`${studio.origin}/studio.js`)).status, 200);
    assert.equal((await fetch(`${studio.origin}/../package.json`)).status, 404);
    assert.equal((await call({ action: "history" }, { Origin: "https://hostile.example" })).status, 403);
    assert.equal((await call({ action: "history" }, { Authorization: "wrong" })).status, 403);
    assert.equal(await rawStatus({ Host: "hostile.example" }), 403);
    assert.equal(await rawStatus({ "Sec-Fetch-Site": "cross-site" }), 403);
    const compiledResponse = await call({ action: "compile", task: "fix ledger", budget: 2000, refreshIndex: true }); assert.equal(compiledResponse.status, 200);
    const compiled = await compiledResponse.json() as { capsule: unknown; payload: string };
    const capsule = validateCapsule(compiled.capsule); assert.ok(compiled.payload.includes("SOURCE_BODY_SENTINEL"));
    assert.ok(!JSON.stringify(compiled.capsule).includes("SOURCE_BODY_SENTINEL"));
    const file = capsule.deterministic.files.find((f) => f.path === "src/ledger.ts"); assert.ok(file);
    const candidate = capsule.deterministic.candidates.find((c) => c.fileRef === file.id); assert.ok(candidate);
    const explain = await call({ action: "explain", id: capsule.capsuleHash, query: { type: "WHY_SELECTED", subject: candidate.id } }); assert.equal(explain.status, 200);
    const changedResponse = await call({ action: "recompile", id: capsule.capsuleHash, budget: 2000, controls: [{ kind: "EXCLUDE", path: "src/ledger.ts" }] }); assert.equal(changedResponse.status, 200);
    const changed = await changedResponse.json() as { capsule: unknown; diff: { candidates: unknown[] } }; const next = validateCapsule(changed.capsule);
    assert.ok(changed.diff.candidates.length > 0); assert.notEqual(capsule.capsuleHash, next.capsuleHash);
    const replay = await (await call({ action: "verify", id: next.capsuleHash })).json() as { replay: { status: string } }; assert.equal(replay.replay.status, "EXACT_MATCH");
    assert.equal(history.list().length, 2);
    for (const invalid of [{ action: "open", id: "../../escape" }, { action: "import", capsule: { schemaVersion: "evil" } }, { action: "recompile", id: capsule.capsuleHash, budget: 1, controls: [{ kind: "PIN", path: ".env" }] }, { action: "open", id: capsule.capsuleHash, path: root }]) {
      const response = await call(invalid); assert.equal(response.status, 400); const output = await response.text(); assert.ok(!output.includes(root) && !output.includes("STUDIO_PRIVATE_SENTINEL"));
    }
    const privateResult = await call({ action: "compile", task: "fix ledger path=C:\\private\\repo", budget: 2000, refreshIndex: false });
    const privateText = await privateResult.text(); assert.equal(privateResult.status, 200); assert.ok(!privateText.includes("C:\\\\private"));
    const privateData = JSON.parse(privateText) as { payload: unknown }; assert.equal(privateData.payload, null);
    assert.equal((await fetch(`${studio.origin}/api`, { method: "POST", headers, body: " ".repeat(9 * 1024 * 1024) })).status, 400);
  } finally { await studio.close(); history.close(); await removeTemporaryDirectory(root); }
});
