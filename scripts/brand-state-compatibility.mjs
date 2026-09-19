import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { reviewFixture } from "./review-fixture.mjs";

const source = resolve(".");
const npm = process.env.npm_execpath;
assert.ok(npm, "Run via npm run brand:state-compatibility");
const temp = await realpath(await mkdtemp(join(tmpdir(), "repobound-state-compatibility-")));
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
  return result.stdout;
};

try {
  const packed = JSON.parse(run(process.execPath, [npm, "pack", "--json", "--pack-destination", temp], source))[0];
  assert.equal(packed.name, "@kallist/repobound");
  assert.equal(packed.version, "0.5.1");
  const stableInstall = join(temp, "stable-install");
  const candidateInstall = join(temp, "candidate-install");
  const repository = join(temp, "repository");
  const artifacts = join(temp, "artifacts");
  for (const directory of [stableInstall, candidateInstall, repository, artifacts]) await mkdir(directory, { recursive: true });
  for (const directory of [stableInstall, candidateInstall]) await writeFile(join(directory, "package.json"), "{}");
  run(process.execPath, [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", join(temp, "stable-cache"), "--registry", "https://registry.npmjs.org", "@kallist/contextforge@0.5.0"], stableInstall);
  run(process.execPath, [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", join(temp, packed.filename)], candidateInstall);
  const stableCli = join(stableInstall, "node_modules", "@kallist", "contextforge", "dist", "cli", "main.js");
  const candidateCli = join(candidateInstall, "node_modules", "@kallist", "repobound", "dist", "cli", "main.js");
  const stable = (args) => run(process.execPath, [stableCli, ...args], repository);
  const candidate = (args) => run(process.execPath, [candidateCli, ...args], repository);
  await reviewFixture(repository);
  const oldIndex = JSON.parse(stable(["index", repository, "--json"]));
  const taskCapsule = join(artifacts, "contextforge-v050-task.json");
  const reviewCapsule = join(artifacts, "contextforge-v050-review.json");
  stable(["pack", "fix ledger", repository, "--budget", "1000", "--capsule", taskCapsule, "--out", join(artifacts, "old-task.md")]);
  stable(["review", repository, "--base", "HEAD", "--budget", "1000", "--capsule", reviewCapsule, "--out", join(artifacts, "old-review.md")]);
  const history = join(repository, ".contextforge", "history");
  const savedTask = JSON.parse(stable(["history", "save", taskCapsule, "--store", history]));
  const savedReview = JSON.parse(stable(["history", "save", reviewCapsule, "--store", history]));
  const search = JSON.parse(candidate(["search", "fix ledger", repository, "--json"]));
  assert.equal(search.generation, oldIndex.generation);
  assert.equal(search.indexStatus.status, "FRESH");
  const list = JSON.parse(candidate(["history", "list", "--store", history]));
  assert.ok(list.entries.some(({ id }) => id === savedTask.id));
  assert.ok(list.entries.some(({ id }) => id === savedReview.id));
  assert.equal(JSON.parse(candidate(["history", "show", savedTask.id, "--store", history])).capsuleHash, savedTask.id);
  assert.equal(JSON.parse(candidate(["explain", taskCapsule, "--json"])).status, "OK");
  assert.equal(JSON.parse(candidate(["coverage", taskCapsule, "--json"])).schemaVersion, "contextforge-coverage-v1");
  assert.equal(JSON.parse(candidate(["coverage", reviewCapsule, "--json"])).schemaVersion, "contextforge-coverage-v1");
  const replay = JSON.parse(candidate(["replay", taskCapsule, "--verify", "--repository", repository]));
  assert.ok(["EXACT_MATCH", "PAYLOAD_MATCH_PROVENANCE_CHANGED"].includes(replay.status));
  const candidateReview = JSON.parse(candidate(["review", repository, "--base", "HEAD", "--budget", "1000", "--json"]));
  assert.equal(candidateReview.capsule.schemaVersion, "contextforge-capsule-v2");
  await access(join(repository, ".contextforge", "index.sqlite"));
  await assert.rejects(access(join(repository, ".repobound")), (error) => error?.code === "ENOENT");
  const report = {
    schemaVersion: "repobound-state-compatibility-v1",
    sourcePackage: "@kallist/contextforge@0.5.0",
    sourceRegistry: "https://registry.npmjs.org",
    candidatePackage: "@kallist/repobound@0.5.1",
    index: "READ WITHOUT REBUILD",
    history: "READ",
    capsule: "VALID",
    explain: "PASS",
    coverage: "PASS",
    replay: replay.status,
    review: "PASS",
    stateRoot: ".contextforge",
    duplicateStateRoot: false,
    databaseMigration: false,
    passed: true,
  };
  await mkdir(".benchmark-output", { recursive: true });
  await writeFile(".benchmark-output/repobound-state-compatibility.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await rm(temp, { recursive: true, force: true });
}
