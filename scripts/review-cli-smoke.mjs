import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { reviewFixture } from "./review-fixture.mjs";
const packageRoot = resolve(process.argv[2] ?? "."), temp = await mkdtemp(join(tmpdir(), "contextforge-review-cli-"));
const repository = join(temp, "repo"), capsuleFile = join(temp, "review.json"), payloadFile = join(temp, "review.md");
try {
  await mkdir(repository); await reviewFixture(repository);
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [join(packageRoot, "dist/cli/main.js"), ...args], { cwd: temp, windowsHide: true, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }));
  const review = run("review", repository, "--refresh-index", "--base", "HEAD", "--budget", "1000", "--json", "--capsule", capsuleFile, "--out", payloadFile);
  assert.equal(review.capsule.schemaVersion, "contextforge-capsule-v2");
  assert.ok(review.coverage.review.changedSymbols.represented > 0);
  assert.ok(!(await readFile(payloadFile, "utf8")).includes("REVIEW_SECRET_SENTINEL"));
  const explanation = run("explain", capsuleFile, "--query", "WHY_SELECTED", "--subject", "src/ledger.ts", "--json");
  assert.equal(explanation.status, "OK"); assert.ok(explanation.facts.review.impact.length > 0);
  assert.equal(run("replay", capsuleFile, "--verify", "--repository", repository).status, "EXACT_MATCH");
  const c = review.capsule.deterministic, dropped = c.candidates.find((i) => i.disposition === "DROPPED"); assert.ok(dropped);
  const path = c.files.find((f) => f.id === dropped.fileRef).path;
  const controls = join(temp, "controls.json"); await writeFile(controls, JSON.stringify([{ kind: "PIN", path }]));
  const child = run("recompile", capsuleFile, "--repository", repository, "--controls", controls, "--store", join(repository, ".contextforge/history"));
  assert.equal(child.capsule.deterministic.overrides[0].parentCapsuleHash, review.capsule.capsuleHash);
  assert.ok(child.diff.candidates.some((i) => i.path === path && i.before.disposition === "DROPPED" && i.after.disposition === "SELECTED"));
  const childFile = join(temp, "child.json"); await writeFile(childFile, JSON.stringify(child.capsule));
  assert.equal(run("replay", childFile, "--verify", "--repository", repository).status, "EXACT_MATCH");
  console.log(JSON.stringify({ version: "contextforge-review-cli-smoke-v1", passed: 1, failed: 0, package: process.argv[2] ? "INSTALLED_PACKAGE" : "WORKTREE", operations: ["review", "capsule-output", "source-output", "explain", "coverage", "pin-recompile", "diff", "replay"] }));
} finally { await rm(temp, { recursive: true, force: true }); }
