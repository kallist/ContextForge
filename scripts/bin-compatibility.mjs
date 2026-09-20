import assert from "node:assert/strict";
import { access, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const source = resolve(".");
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run via npm run bin:compatibility");
const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "repobound-bin-compatibility-")));

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
    ...options,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) throw new Error(output || String(result.error));
  assert.doesNotMatch(output, /\b(?:EEXIST|EPERM)\b/u, "npm reported an executable collision or partial cleanup");
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function npm(args, cwd) {
  return run(process.execPath, [npmCli, ...args], cwd);
}

function executable(prefix, name) {
  return process.platform === "win32" ? join(prefix, `${name}.cmd`) : join(prefix, "bin", name);
}

function globalModules(prefix) {
  return process.platform === "win32" ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules");
}

function runExecutable(prefix, name, args) {
  const path = executable(prefix, name);
  if (process.platform !== "win32") return run(path, args, temporaryRoot).stdout;
  const quotedArgs = args.map((value) => `"${value.replaceAll('"', '""')}"`).join(" ");
  const commandLine = `""${path}"${quotedArgs === "" ? "" : ` ${quotedArgs}`}"`;
  return run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine], temporaryRoot, { windowsVerbatimArguments: true }).stdout;
}

async function expectAbsent(path) {
  await assert.rejects(access(path), (error) => error?.code === "ENOENT");
}

function install(prefix, cache, spec, registry = false) {
  const args = ["install", "--global", "--prefix", prefix, "--cache", cache, "--no-audit", "--no-fund"];
  if (registry) args.push("--registry", "https://registry.npmjs.org");
  args.push(spec);
  return npm(args, temporaryRoot);
}

function uninstall(prefix, cache, spec) {
  return npm(["uninstall", "--global", "--prefix", prefix, "--cache", cache, "--no-audit", "--no-fund", spec], temporaryRoot);
}

async function verifyBoth(prefix) {
  const oldRoot = join(globalModules(prefix), "@kallist", "contextforge");
  const newRoot = join(globalModules(prefix), "@kallist", "repobound");
  const oldPackage = JSON.parse(await readFile(join(oldRoot, "package.json"), "utf8"));
  const newPackage = JSON.parse(await readFile(join(newRoot, "package.json"), "utf8"));
  assert.equal(oldPackage.version, "0.5.0");
  assert.equal(newPackage.version, "0.5.1");
  assert.deepEqual(newPackage.bin, { repobound: "dist/cli/main.js" });
  await access(join(oldRoot, "dist", "cli", "main.js"));
  await access(join(newRoot, "dist", "cli", "main.js"));
  await access(executable(prefix, "contextforge"));
  await access(executable(prefix, "repobound"));
  assert.equal(runExecutable(prefix, "contextforge", ["--version"]).trim(), "0.5.0");
  assert.equal(runExecutable(prefix, "repobound", ["--version"]).trim(), "0.5.1");
  assert.match(runExecutable(prefix, "contextforge", ["--help"]), /contextforge map/u);
  assert.match(runExecutable(prefix, "repobound", ["--help"]), /repobound map/u);
  const listed = JSON.parse(npm(["list", "--global", "--prefix", prefix, "--depth=0", "--json"], temporaryRoot).stdout);
  assert.equal(listed.dependencies?.["@kallist/contextforge"]?.version, "0.5.0");
  assert.equal(listed.dependencies?.["@kallist/repobound"]?.version, "0.5.1");
  return { contextforge: "0.5.0", repobound: "0.5.1", packagesComplete: true };
}

try {
  const packed = JSON.parse(npm(["pack", "--json", "--pack-destination", temporaryRoot], source).stdout)[0];
  assert.equal(packed.name, "@kallist/repobound");
  assert.equal(packed.version, "0.5.1");
  const tarball = join(temporaryRoot, packed.filename);

  const scenarioAPrefix = join(temporaryRoot, "old-then-new", "prefix");
  const scenarioACache = join(temporaryRoot, "old-then-new", "cache");
  install(scenarioAPrefix, scenarioACache, "@kallist/contextforge@0.5.0", true);
  assert.equal(runExecutable(scenarioAPrefix, "contextforge", ["--version"]).trim(), "0.5.0");
  install(scenarioAPrefix, scenarioACache, tarball);
  const oldThenNew = await verifyBoth(scenarioAPrefix);
  uninstall(scenarioAPrefix, scenarioACache, "@kallist/contextforge");
  await expectAbsent(executable(scenarioAPrefix, "contextforge"));
  await expectAbsent(join(globalModules(scenarioAPrefix), "@kallist", "contextforge"));
  assert.equal(runExecutable(scenarioAPrefix, "repobound", ["--version"]).trim(), "0.5.1");

  const scenarioBPrefix = join(temporaryRoot, "new-then-old", "prefix");
  const scenarioBCache = join(temporaryRoot, "new-then-old", "cache");
  install(scenarioBPrefix, scenarioBCache, tarball);
  assert.equal(runExecutable(scenarioBPrefix, "repobound", ["--version"]).trim(), "0.5.1");
  install(scenarioBPrefix, scenarioBCache, "@kallist/contextforge@0.5.0", true);
  const newThenOld = await verifyBoth(scenarioBPrefix);
  uninstall(scenarioBPrefix, scenarioBCache, "@kallist/repobound");
  await expectAbsent(executable(scenarioBPrefix, "repobound"));
  await expectAbsent(join(globalModules(scenarioBPrefix), "@kallist", "repobound"));
  assert.equal(runExecutable(scenarioBPrefix, "contextforge", ["--version"]).trim(), "0.5.0");

  console.log(JSON.stringify({
    schemaVersion: "repobound-global-bin-compatibility-v1",
    packageOwnership: {
      "@kallist/contextforge": ["contextforge"],
      "@kallist/repobound": ["repobound"],
    },
    oldThenNew: { install: "PASS", ...oldThenNew, uninstallOldPreservesRepobound: true },
    newThenOld: { install: "PASS", ...newThenOld, uninstallNewPreservesContextforge: true },
    forceUsed: false,
    installShimUsed: false,
    passed: true,
    package: { files: packed.entryCount, packedBytes: packed.size, unpackedBytes: packed.unpackedSize, shasum: packed.shasum, integrity: packed.integrity },
  }));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
