import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createContextForgeLifecycle } from "../dist/composition/contextforge-lifecycle.js";
import { SqliteCapsuleHistory } from "../dist/adapters/sqlite/sqlite-capsule-history.js";
import { startStudio } from "../dist/adapters/studio/studio-server.js";
import { compileReview, indexReview } from "../dist/composition/contextforge-review.js";
import { contextCoverage } from "../dist/core/context-coverage.js";
import { reviewFixture } from "./review-fixture.mjs";

const root = await realpath(await mkdtemp(join(tmpdir(), "repobound-visual-launch-")));
const reviewRoot = await realpath(await mkdtemp(join(tmpdir(), "repobound-proof-review-")));
let browser, studio, history;
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const selectedPaths = (capsule) => {
  const files = new Map(capsule.deterministic.files.map((file) => [file.id, file.path]));
  const candidates = new Map(capsule.deterministic.candidates.map((candidate) => [candidate.id, candidate]));
  return capsule.deterministic.selected.map((selected) => files.get(candidates.get(selected.candidateRef)?.fileRef)).filter(Boolean);
};
try {
  await mkdir(join(root, "src")); await mkdir(join(root, "test")); await mkdir(join(root, "integration")); await mkdir(join(root, "docs"));
  await writeFile(join(root, "AGENTS.md"), "# Session fixture\nSynthetic demonstration. Verify session expiration and concurrent refresh behavior.\n");
  await writeFile(join(root, "src", "session-store.ts"), "export class SessionStore {\n  private readonly values = new Map<string, number>();\n  read(id: string) { return this.values.get(id); }\n  write(id: string, expiresAt: number) { this.values.set(id, expiresAt); }\n}\n");
  await writeFile(join(root, "src", "session.ts"), "import { SessionStore } from './session-store.js';\nconst store = new SessionStore();\nexport function session(id: string, now: number) {\n  const expiresAt = store.read(id) ?? now + 30;\n  store.write(id, expiresAt);\n  return { id, expiresAt };\n}\n");
  await writeFile(join(root, "test", "session.test.ts"), "import { session } from '../src/session.js';\nexport function sessionRaceTest() {\n  return [session('race', 1), session('race', 2)];\n}\n");
  await writeFile(join(root, "integration", "session.integration.test.ts"), "import { session } from '../src/session.js';\nexport function integrationSessionRace() {\n" + Array.from({ length: 22 }, (_, index) => `  const result${index} = session('integration', ${index});`).join("\n") + "\n  return result21;\n}\n");
  await writeFile(join(root, "docs", "SESSION.md"), "# Session lifecycle\nThe store owns expiry state. Refreshes must preserve monotonic session expiry.\n");
  for (const name of ["refresh", "expiration", "cleanup", "cache", "metrics", "audit", "migration", "compatibility"]) {
    await writeFile(join(root, "src", `session-${name}.ts`), `import { session } from './session.js';\nexport function session_${name}(id: string, now: number) {\n${Array.from({ length: 17 }, (_, index) => `  const check${index} = { id, now: now + ${index}, kind: '${name}' };`).join("\n")}\n  return session(id, now);\n}\n`);
  }

  const app = await createContextForgeLifecycle(root); history = new SqliteCapsuleHistory(join(root, ".contextforge/history")); studio = await startStudio(app, history);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  const errors = [], remote = [], apiResults = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (new URL(request.url()).origin !== studio.origin) remote.push(request.url()); });
  page.on("response", async (response) => { if (response.url() === `${studio.origin}/api` && response.ok()) { try { apiResults.push(await response.json()); } catch { /* Non-JSON is impossible for the Studio API. */ } } });
  await page.goto(studio.url); await page.locator("#status").filter({ hasText: "Ready." }).waitFor();
  await page.locator("#task").fill("Fix session race condition"); await page.locator("#budget").fill("800"); await page.locator("#compile").click();
  await page.locator("#status").filter({ hasText: "Compiled and saved" }).waitFor(); await pause(100);
  const initial = apiResults.findLast((result) => result.capsule && !result.diff); assert.ok(initial, "Compile response must be recorded");
  await mkdir("docs/assets", { recursive: true }); await mkdir(".studio-output", { recursive: true }); await mkdir("site/proof/data", { recursive: true });
  await page.screenshot({ path: "docs/assets/repobound-hero.png" });
  await page.screenshot({ path: "docs/assets/repobound-context.png" });
  await page.locator("#filter").selectOption("DROPPED");
  const testRow = page.locator("#candidates tr").filter({ hasText: "integration/session.integration.test.ts" }); assert.equal(await testRow.count(), 1, "Proof fixture test must really be dropped");
  await testRow.getByRole("button").click(); await page.locator("#status").filter({ hasText: "Explain: OK" }).waitFor(); await pause(100);
  const explained = apiResults.findLast((result) => result.facts); assert.ok(explained, "Explain response must be recorded");
  await page.screenshot({ path: "docs/assets/repobound-why.png" });
  await page.locator("#share").click();
  const snapshotUrl = await page.locator("#snapshot").evaluate((canvas) => canvas.toDataURL("image/png"));
  const snapshotBytes = Buffer.from(snapshotUrl.slice(snapshotUrl.indexOf(",") + 1), "base64");
  assert.equal(snapshotBytes.readUInt32BE(16), 1200); assert.equal(snapshotBytes.readUInt32BE(20), 630);
  await writeFile("docs/assets/context-snapshot.png", snapshotBytes); await copyFile("docs/assets/context-snapshot.png", "docs/assets/social-card.png");
  await page.locator("#share-close").click();
  await page.locator('[data-nav="context"]').click(); await page.locator('[data-tab="proposal"]').click();
  await testRow.getByRole("button").click(); await page.locator("#status").filter({ hasText: "Explain: OK" }).waitFor();
  await page.getByRole("toolbar", { name: "Actions for selected files" }).getByRole("button", { name: "Include", exact: true }).click(); await page.locator("#recompile").click(); await page.locator("#status").filter({ hasText: "New Capsule saved" }).waitFor(); await pause(100);
  const rebuilt = apiResults.findLast((result) => result.diff); assert.ok(rebuilt, "Rebuild response must be recorded");
  const transition = rebuilt.diff.candidates.find((candidate) => candidate.path === "integration/session.integration.test.ts");
  assert.equal(transition?.before?.disposition, "DROPPED"); assert.equal(transition?.after?.disposition, "SELECTED");
  await page.screenshot({ path: ".studio-output/studio-rebuild.png" });
  for (const [width, height] of [[1024, 768], [1280, 800], [1512, 982]]) {
    await page.setViewportSize({ width, height }); await page.locator('[data-nav="context"]').click(); await page.locator('[data-tab="proposal"]').click();
    assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
    await page.screenshot({ path: `.studio-output/studio-launch-${width}.png` });
  }

  await reviewFixture(reviewRoot); await indexReview(reviewRoot);
  const review = await compileReview(reviewRoot, { base: "HEAD", budget: 1000 });
  const reviewCoverage = contextCoverage(review.capsule);
  const reviewFiles = review.capsule.deterministic.review?.changes.map((change) => change.path) ?? [];
  const reviewRelation = review.capsule.deterministic.review?.impact[0];
  const initialCapsule = initial.capsule, rebuiltCapsule = rebuilt.capsule;
  const proof = {
    schemaVersion: "repobound-proof-v1",
    source: "Deterministic local fixtures executed through RepoBound v0.5.1",
    generatedFrom: { taskCapsule: initialCapsule.capsuleHash, rebuiltCapsule: rebuiltCapsule.capsuleHash, reviewCapsule: review.capsule.capsuleHash },
    cases: [
      { slug: "task-context", kind: "Task Context", title: "Fix session race condition", budget: initialCapsule.deterministic.budget.requested, estimatedTokens: initialCapsule.deterministic.budget.estimatedTokens, selected: initialCapsule.deterministic.selected.length, dropped: initialCapsule.deterministic.dropped.length, files: selectedPaths(initialCapsule).slice(0, 5), snapshot: "/assets/context-snapshot.png" },
      { slug: "review-context", kind: "Review Context", title: "Review a tracked ledger change", budget: review.capsule.deterministic.budget.requested, estimatedTokens: review.capsule.deterministic.budget.estimatedTokens, selected: review.capsule.deterministic.selected.length, dropped: review.capsule.deterministic.dropped.length, changedFiles: reviewFiles, relationship: reviewRelation ? { from: reviewRelation.from, to: reviewRelation.to, type: reviewRelation.type, classification: reviewRelation.classification } : null, coverage: reviewCoverage.review ? { represented: reviewCoverage.review.changedSymbols.represented, available: reviewCoverage.review.changedSymbols.available } : null },
      { slug: "context-debugging", kind: "Context Debugging", title: "Why was the integration test dropped?", file: "integration/session.integration.test.ts", initial: transition.before.disposition, control: "Include", rebuilt: transition.after.disposition, recordedDecision: explained.facts.decisions.map((decision) => decision.reason), beforeCapsule: initialCapsule.capsuleHash, afterCapsule: rebuiltCapsule.capsuleHash }
    ]
  };
  await writeFile("site/proof/data/cases.json", JSON.stringify(proof, null, 2) + "\n");

  const videoContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: ".studio-output/video", size: { width: 1280, height: 800 } } });
  const demo = await videoContext.newPage(); await demo.goto(studio.url); await demo.locator("#status").filter({ hasText: "Ready." }).waitFor(); await pause(800);
  await demo.locator("#task").pressSequentially("Fix session race condition", { delay: 32 }); await pause(500); await demo.locator("#budget").fill("800"); await demo.locator("#compile").click(); await demo.locator("#status").filter({ hasText: "Compiled and saved" }).waitFor(); await pause(2200);
  await demo.locator("#filter").selectOption("DROPPED"); const videoRow = demo.locator("#candidates tr").filter({ hasText: "integration/session.integration.test.ts" }); await videoRow.getByRole("button").click(); await demo.locator("#status").filter({ hasText: "Explain: OK" }).waitFor(); await pause(2400);
  await demo.locator('[data-nav="context"]').click(); await demo.locator('[data-tab="proposal"]').click(); await videoRow.getByRole("button").click(); await demo.locator("#status").filter({ hasText: "Explain: OK" }).waitFor(); await pause(900);
  await demo.getByRole("toolbar", { name: "Actions for selected files" }).getByRole("button", { name: "Include", exact: true }).click(); await pause(1300); await demo.locator("#recompile").click(); await demo.locator("#status").filter({ hasText: "New Capsule saved" }).waitFor(); await pause(2600);
  const video = demo.video(); await demo.close(); await videoContext.close(); const videoPath = await video.path(); await copyFile(videoPath, "docs/assets/repobound-hero.webm");
  assert.ok((await stat("docs/assets/repobound-hero.webm")).size < 20 * 1024 * 1024, "Hero WebM must remain under 20 MiB");
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  console.log(JSON.stringify({ fixture: "synthetic session race", task: "Fix session race condition", budget: 800, taskCapsule: initialCapsule.capsuleHash, reviewCapsule: review.capsule.capsuleHash, transition: "integration/session.integration.test.ts DROPPED → SELECTED", snapshot: { width: 1200, height: 630, bytes: snapshotBytes.length }, heroWebmBytes: (await stat("docs/assets/repobound-hero.webm")).size, modelExecuted: false, remoteRequests: remote.length, browserErrors: errors.length }));
} finally {
  await browser?.close(); await studio?.close(); history?.close(); await rm(root, { recursive: true, force: true }); await rm(reviewRoot, { recursive: true, force: true });
}
