import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { reviewFixture } from "./review-fixture.mjs";
const packageRoot = resolve(process.argv[2] ?? "."), temp = await realpath(await mkdtemp(join(tmpdir(), "contextforge-review-cli-")));
const repository = join(temp, "repo"), capsuleFile = join(temp, "review.json"), payloadFile = join(temp, "review.md");
try {
  await mkdir(repository); await reviewFixture(repository);
  const cli = join(packageRoot, "dist/cli/main.js");
  const runResult = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: temp, windowsHide: true, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error) throw result.error;
    return { exitCode: result.status, output: JSON.parse(result.stdout), stderr: result.stderr };
  };
  const run = (...args) => {
    const result = runResult(...args);
    if (result.exitCode !== 0) throw new Error(`Installed CLI failed (${result.exitCode}): ${result.stderr}`);
    return result.output;
  };
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

  const createGitRepository = async (name, files) => {
    const root = join(temp, name); await mkdir(root);
    const git = (...args) => execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd: root, windowsHide: true, encoding: "utf8" });
    git("init", "-b", "main");
    await writeFile(join(root, ".gitignore"), ".contextforge/\n", "utf8");
    for (const [path, source] of Object.entries(files)) {
      const destination = join(root, ...path.split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, source, "utf8");
    }
    git("add", "."); git("-c", "user.name=ContextForge smoke", "-c", "user.email=smoke@example.invalid", "commit", "-m", "fixture");
    return { root, git };
  };

  const deleted = await createGitRepository("delete repo", { "src/service.ts": "export function service() { return 1; }\n" });
  assert.equal(run("index", deleted.root, "--json").generation, 1);
  await rm(join(deleted.root, "src", "service.ts"));
  const deletedCapsule = join(temp, "delete-review.json");
  const deleteReview = run("review", deleted.root, "--refresh-index", "--budget", "1000", "--json", "--capsule", deletedCapsule);
  assert.deepEqual(deleteReview.capsule.deterministic.review.changes.map((change) => [change.status, change.path, change.availability]), [["DELETED", "src/service.ts", "DELETED_METADATA_ONLY"]]);
  assert.equal(deleteReview.capsule.deterministic.selected.length, 0);
  assert.equal(JSON.stringify(deleteReview).includes("export function service"), false);
  assert.ok(deleteReview.coverage.review.lints.some((lint) => lint.code === "HISTORICAL_SOURCE_UNAVAILABLE"));
  const deleteReplay = runResult("replay", deletedCapsule, "--verify", "--repository", deleted.root);
  assert.equal(deleteReplay.exitCode, 0);
  assert.equal(deleteReplay.output.status, "EXACT_MATCH");
  await writeFile(join(deleted.root, "src", "service.ts"), "export function service() { return 1; }\n", "utf8");
  assert.equal(deleted.git("status", "--porcelain=v1"), "");
  assert.equal(run("index", deleted.root, "--json").generation, 3);
  const restoredReplay = runResult("replay", deletedCapsule, "--verify", "--repository", deleted.root);
  assert.equal(restoredReplay.exitCode, 19);
  assert.notEqual(restoredReplay.output.status, "EXACT_MATCH");

  const renamed = await createGitRepository("rename repo", {
    "src/A.ts": "export const value = 1;\n",
    "src/consumer.ts": "import { value } from './A.js';\nexport const result = value;\n",
  });
  assert.equal(run("index", renamed.root, "--json").generation, 1);
  renamed.git("mv", "--", "src/A.ts", "src/B.ts");
  await writeFile(join(renamed.root, "src", "consumer.ts"), "import { value } from './B.js';\nexport const result = value;\n", "utf8");
  const renameReview = run("review", renamed.root, "--refresh-index", "--budget", "1500", "--json");
  assert.ok(renameReview.capsule.deterministic.review.changes.some((change) => change.status === "RENAMED" && change.path === "src/B.ts" && change.previousPath === "src/A.ts"));
  renamed.git("mv", "--", "src/B.ts", "src/A.ts");
  await writeFile(join(renamed.root, "src", "consumer.ts"), "import { value } from './A.js';\nexport const result = value;\n", "utf8");
  assert.equal(renamed.git("status", "--porcelain=v1"), "");
  assert.equal(run("index", renamed.root, "--json").generation, 3);

  console.log(JSON.stringify({ version: "contextforge-review-cli-smoke-v1", passed: 1, failed: 0, package: process.argv[2] ? "INSTALLED_PACKAGE" : "WORKTREE", deleteReplay: deleteReplay.output.status, restoredDeleteReplay: restoredReplay.output.status, operations: ["review-modify", "review-delete", "review-rename", "rename-restore-index", "capsule-output", "source-output", "explain", "coverage", "pin-recompile", "diff", "replay"] }));
} finally { await rm(temp, { recursive: true, force: true }); }
