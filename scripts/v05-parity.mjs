import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { reviewFixture } from "./review-fixture.mjs";

const source = resolve(".");
const temp = await realpath(await mkdtemp(join(tmpdir(), "repobound-brand-parity-")));
const npm = process.env.npm_execpath;
assert.ok(npm, "Run via npm run brand:parity");
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
  return result.stdout;
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

try {
  const pack = JSON.parse(run(process.execPath, [npm, "pack", "--json", "--pack-destination", temp], source))[0];
  assert.equal(pack.name, "@kallist/repobound");
  assert.equal(pack.version, "0.5.1");
  const results = [];
  for (const [label, spec, packagePath, version] of [
    ["stable", "@kallist/contextforge@0.5.0", join("@kallist", "contextforge"), "0.5.0"],
    ["candidate", join(temp, pack.filename), join("@kallist", "repobound"), "0.5.1"],
  ]) {
    const install = join(temp, label, "install");
    const repo = join(temp, label, "repo");
    const artifacts = join(temp, label, "artifacts");
    await mkdir(install, { recursive: true });
    await mkdir(repo, { recursive: true });
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(install, "package.json"), "{}");
    const installArguments = [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", join(temp, label, "fresh-cache")];
    if (label === "stable") installArguments.push("--registry", "https://registry.npmjs.org");
    installArguments.push(spec);
    run(process.execPath, installArguments, install);
    const cli = join(install, "node_modules", packagePath, "dist", "cli", "main.js");
    const command = (args) => run(process.execPath, [cli, ...args], repo);
    await reviewFixture(repo);
    assert.equal(command(["--version"]).trim(), version);
    assert.ok(command(["--help"]).includes("review"));
    const index = JSON.parse(command(["index", repo, "--json"]));
    const search = JSON.parse(command(["search", "fix ledger", repo, "--json"]));
    command(["pack", "fix ledger", repo, "--budget", "1000", "--capsule", join(artifacts, "task.json"), "--out", join(artifacts, "task.md")]);
    command(["review", repo, "--base", "HEAD", "--budget", "1000", "--capsule", join(artifacts, "review.json"), "--out", join(artifacts, "review.md")]);
    const task = JSON.parse(await readFile(join(artifacts, "task.json"), "utf8"));
    const review = JSON.parse(await readFile(join(artifacts, "review.json"), "utf8"));
    const explain = JSON.parse(command(["explain", join(artifacts, "task.json"), "--query", "WHY_SELECTED", "--subject", "src/ledger.ts", "--json"]));
    const coverage = JSON.parse(command(["coverage", join(artifacts, "task.json"), "--json"]));
    const reviewCoverage = JSON.parse(command(["coverage", join(artifacts, "review.json"), "--json"]));
    const replay = JSON.parse(command(["replay", join(artifacts, "task.json"), "--verify", "--repository", repo]));
    const aliasCoverage = label === "candidate"
      ? run(process.execPath, [npm, "exec", "--", "contextforge", "coverage", join(artifacts, "task.json"), "--json"], install)
      : null;
    results.push({ index, search, task, review, explain, coverage, reviewCoverage, replay, aliasCoverage, taskMarkdown: await readFile(join(artifacts, "task.md"), "utf8"), reviewMarkdown: await readFile(join(artifacts, "review.md"), "utf8") });
  }
  const normalize = (result) => {
    const value = structuredClone(result);
    delete value.index.performance;
    delete value.index.repositoryRoot;
    delete value.index.indexedAt;
    delete value.search.performance;
    delete value.search.repositoryRoot;
    delete value.task.runtime;
    delete value.review.runtime;
    delete value.aliasCoverage;
    return value;
  };
  const stable = normalize(results[0]);
  const candidate = normalize(results[1]);
  await mkdir(".benchmark-output", { recursive: true });
  await writeFile(".benchmark-output/repobound-brand-parity-diagnostic.json", JSON.stringify([stable, candidate], null, 2));
  assert.deepEqual(candidate, stable, "Brand migration semantic parity: normalization must not erase behavior differences");
  assert.equal(results[1].aliasCoverage, `${JSON.stringify(results[1].coverage, null, 2)}\n`, "Candidate direct CLI output must stay byte-identical for the compatibility alias target");
  const report = {
    schemaVersion: "repobound-brand-parity-v1",
    gate: "public @kallist/contextforge@0.5.0 vs fresh @kallist/repobound@0.5.1 tarball",
    baselineRegistry: "https://registry.npmjs.org",
    candidateOrder: "IDENTICAL",
    scores: "IDENTICAL",
    selected: "IDENTICAL",
    dropped: "IDENTICAL",
    ranges: "IDENTICAL",
    taskPayloadSha256: sha256(stable.taskMarkdown),
    reviewPayloadSha256: sha256(stable.reviewMarkdown),
    reviewSemantics: "IDENTICAL",
    explain: "IDENTICAL",
    coverageLint: "IDENTICAL",
    replay: "IDENTICAL",
    legacyAlias: "IDENTICAL",
    normalization: ["index.performance", "index.repositoryRoot", "index.indexedAt", "search.performance", "search.repositoryRoot", "task.runtime", "review.runtime"],
    normalizationExclusions: ["candidate order", "scores", "selected/dropped", "source", "ranges", "evidence", "relationships", "budget", "reasons", "payload"],
    package: { name: pack.name, version: pack.version, files: pack.entryCount, packedBytes: pack.size, unpackedBytes: pack.unpackedSize, shasum: pack.shasum, integrity: pack.integrity },
    passed: true,
  };
  await writeFile(".benchmark-output/repobound-brand-parity.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await rm(temp, { recursive: true, force: true });
}
