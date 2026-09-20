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
const run = (command, args, cwd, options = {}) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: process.env, ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
  return result.stdout;
};
const executable = (prefix, name) => process.platform === "win32" ? join(prefix, `${name}.cmd`) : join(prefix, "bin", name);
const runCli = (prefix, name, args, cwd) => {
  const cli = executable(prefix, name);
  if (process.platform !== "win32") return run(cli, args, cwd);
  const quotedArgs = args.map((value) => `"${value.replaceAll('"', '""')}"`).join(" ");
  return run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `""${cli}"${quotedArgs === "" ? "" : ` ${quotedArgs}`}"`], cwd, { windowsVerbatimArguments: true });
};

try {
  const packed = JSON.parse(run(process.execPath, [npm, "pack", "--json", "--pack-destination", temp], source))[0];
  assert.equal(packed.name, "@kallist/repobound");
  assert.equal(packed.version, "0.5.1");
  const prefix = join(temp, "coexistence-prefix");
  const cache = join(temp, "fresh-cache");
  const repository = join(temp, "repository");
  const artifacts = join(temp, "artifacts");
  for (const directory of [repository, artifacts]) await mkdir(directory, { recursive: true });
  run(process.execPath, [npm, "install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache, "--registry", "https://registry.npmjs.org", "@kallist/contextforge@0.5.0"], temp);
  const stable = (args) => runCli(prefix, "contextforge", args, repository);
  await reviewFixture(repository);
  assert.equal(stable(["--version"]).trim(), "0.5.0");
  const oldIndex = JSON.parse(stable(["index", repository, "--json"]));
  const taskCapsule = join(artifacts, "contextforge-v050-task.json");
  const reviewCapsule = join(artifacts, "contextforge-v050-review.json");
  stable(["pack", "fix ledger", repository, "--budget", "1000", "--capsule", taskCapsule, "--out", join(artifacts, "old-task.md")]);
  stable(["review", repository, "--base", "HEAD", "--budget", "1000", "--capsule", reviewCapsule, "--out", join(artifacts, "old-review.md")]);
  const history = join(repository, ".contextforge", "history");
  const savedTask = JSON.parse(stable(["history", "save", taskCapsule, "--store", history]));
  const savedReview = JSON.parse(stable(["history", "save", reviewCapsule, "--store", history]));
  run(process.execPath, [npm, "install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", join(temp, packed.filename)], temp);
  const candidate = (args) => runCli(prefix, "repobound", args, repository);
  assert.equal(candidate(["--version"]).trim(), "0.5.1");
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
  assert.equal(JSON.parse(stable(["search", "fix ledger", repository, "--json"])).generation, oldIndex.generation);
  assert.ok(JSON.parse(stable(["history", "list", "--store", history])).entries.some(({ id }) => id === savedTask.id));
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
    coexistence: "contextforge@0.5.0 + repobound@0.5.1",
    bothClisOperational: true,
    passed: true,
  };
  await mkdir(".benchmark-output", { recursive: true });
  await writeFile(".benchmark-output/repobound-state-compatibility.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await rm(temp, { recursive: true, force: true });
}
