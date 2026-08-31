import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const repositoryRoot = resolve(import.meta.dirname, "..");
const npmCliPath = process.env.npm_execpath;
if (typeof npmCliPath !== "string" || npmCliPath.length === 0) {
  throw new Error("Release hardening must be started through npm.");
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "contextforge-release-hardening-"));
const installRoot = join(temporaryRoot, "install");
const scaleRoot = join(temporaryRoot, "规模 repo with spaces");
const contentionRoot = join(temporaryRoot, "mcp contention repo");
const soakRoot = join(temporaryRoot, "mcp soak repo");
const scaleFileCount = Number(process.env.CONTEXTFORGE_RELEASE_SCALE_FILES ?? "1200");
const soakRequests = Number(process.env.CONTEXTFORGE_RELEASE_SOAK_REQUESTS ?? "1000");
const contentionIterations = 10;
const task = "ReleaseTarget.run";
const budget = 8_000;

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    timeout: options.timeout ?? 180_000,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  return result;
}

function mustRun(command, args, cwd, options = {}) {
  const result = run(command, args, cwd, options);
  if (result.status !== 0) {
    throw new Error(
      [`Command failed (${String(result.status)}): ${command} ${args.join(" ")}`, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout;
}

function spawnCaptured(command, args, cwd, env = process.env) {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completed = new Promise((resolveCompleted, rejectCompleted) => {
    child.once("error", rejectCompleted);
    child.once("close", (status, signal) => resolveCompleted({ status, signal, stdout, stderr }));
  });
  return { child, completed };
}

async function writeScaleSources(root, revision) {
  const sourceRoot = join(root, "src");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(
    join(sourceRoot, "release-target.ts"),
    "export class ReleaseTarget { run() { return 'stable'; } }\n",
    "utf8",
  );
  const batchSize = 100;
  for (let start = 0; start < scaleFileCount; start += batchSize) {
    await Promise.all(Array.from({ length: Math.min(batchSize, scaleFileCount - start) }, (_, offset) => {
      const id = start + offset;
      const padded = String(id).padStart(5, "0");
      const previous = String(id - 1).padStart(5, "0");
      const dependency = id === 0 ? "" : `import { generated${previous} } from "./generated-${previous}.js";\n`;
      return writeFile(
        join(sourceRoot, `generated-${padded}.ts`),
        `${dependency}export function generated${padded}() { return ${id} + ${revision}${id === 0 ? "" : ` + generated${previous}()`}; }\n`,
        "utf8",
      );
    }));
  }
}

async function waitForFile(path, child, timeoutMs = 30_000, boundary = "activation") {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child !== undefined && child.exitCode !== null) {
      throw new Error(`Barrier process exited before reaching the ${boundary} boundary.`);
    }
    try {
      await access(path);
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`Timed out waiting for the independent process ${boundary} barrier.`);
}

async function createSignalFile(path, value) {
  try {
    await writeFile(path, value, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  }
}

async function withTimeout(promise, label, timeoutMs = 30_000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function sqliteHealth(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").all().map((row) => row.integrity_check);
    const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
    const state = database
      .prepare("SELECT active_generation_id AS generation, schema_version AS schemaVersion FROM repository_state WHERE singleton_id = 1")
      .get();
    const building = database.prepare("SELECT COUNT(*) AS count FROM index_generation WHERE status = 'BUILDING'").get();
    const counts = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM indexed_file WHERE generation_id = repository_state.active_generation_id) AS files,
        (SELECT COUNT(*) FROM symbol WHERE generation_id = repository_state.active_generation_id) AS symbols,
        (SELECT COUNT(*) FROM graph_edge WHERE generation_id = repository_state.active_generation_id) AS edges
      FROM repository_state WHERE singleton_id = 1
    `).get();
    return { integrity, foreignKeys, state, building: building.count, counts };
  } finally {
    database.close();
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.equal(processExists(pid), false, `MCP child ${pid} remained alive after close.`);
}

function processObservation(pid) {
  if (process.platform === "win32") {
    const script = `$p=Get-Process -Id ${pid} -ErrorAction Stop; [pscustomobject]@{rss=$p.WorkingSet64;handles=$p.HandleCount}|ConvertTo-Json -Compress`;
    const result = run("powershell.exe", ["-NoProfile", "-Command", script], repositoryRoot, { timeout: 10_000 });
    if (result.status !== 0) return { rssBytes: null, handles: null };
    const parsed = JSON.parse(result.stdout);
    return { rssBytes: parsed.rss, handles: parsed.handles };
  }
  const rss = run("ps", ["-o", "rss=", "-p", String(pid)], repositoryRoot, { timeout: 10_000 });
  const rssBytes = rss.status === 0 ? Number(rss.stdout.trim()) * 1024 : null;
  if (process.platform === "linux") {
    try {
      return { rssBytes, handles: spawnSync("sh", ["-c", `find /proc/${pid}/fd -mindepth 1 -maxdepth 1 | wc -l`], { encoding: "utf8" }).stdout.trim() };
    } catch {
      return { rssBytes, handles: null };
    }
  }
  return { rssBytes, handles: null };
}

function createMcpClient(command, args, name) {
  const transport = new StdioClientTransport({
    command,
    args,
    cwd: installRoot,
    stderr: "pipe",
  });
  const stderr = [];
  transport.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));
  const client = new Client(
    { name, version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  return { client, transport, stderr };
}

try {
  assert.ok(Number.isSafeInteger(scaleFileCount) && scaleFileCount >= 1000);
  assert.ok(Number.isSafeInteger(soakRequests) && soakRequests >= 1000);
  await mkdir(installRoot, { recursive: true });
  await writeFile(join(installRoot, "package.json"), '{"name":"contextforge-release-hardening","private":true}', "utf8");
  const packJson = mustRun(
    process.execPath,
    [npmCliPath, "--silent", "pack", "--json", "--pack-destination", temporaryRoot],
    repositoryRoot,
  );
  const pack = JSON.parse(packJson)[0];
  assert.equal(typeof pack?.filename, "string");
  const tarballPath = join(temporaryRoot, pack.filename);
  mustRun(process.execPath, [npmCliPath, "install", "--no-audit", "--no-fund", tarballPath], installRoot);
  const cliPath = join(installRoot, "node_modules", "contextforge", "dist", "cli", "main.js");
  const installedPackageRoot = join(installRoot, "node_modules", "contextforge");
  await access(cliPath);
  const sqliteModulePath = join(
    installRoot,
    "node_modules",
    "contextforge",
    "dist",
    "adapters",
    "sqlite",
    "sqlite-index-repository.js",
  );
  const barrierHelperPath = join(temporaryRoot, "activation-barrier.mjs");
  await writeFile(barrierHelperPath, `
    import { access, writeFile } from "node:fs/promises";
    import { pathToFileURL } from "node:url";
    const [modulePath, repositoryRoot, readyPath, releasePath] = process.argv.slice(2);
    const { SqliteIndexRepository } = await import(pathToFileURL(modulePath).href);
    const repository = new SqliteIndexRepository(repositoryRoot, {
      testHooks: {
        async onWritePoint(point) {
          if (point !== "before_activation") return;
          await writeFile(readyPath, "ready", "utf8");
          while (true) {
            try { await access(releasePath); break; }
            catch (error) {
              if (!(error instanceof Error) || error.code !== "ENOENT") throw error;
              await new Promise((resolveWait) => setTimeout(resolveWait, 10));
            }
          }
        },
      },
    });
    const active = await repository.loadActive();
    if (active === null) throw new Error("Activation barrier requires an active generation.");
    await repository.buildAndActivate(active.analysisVersion, () => Promise.resolve({
      analysisVersion: active.analysisVersion,
      files: active.files,
      ...(active.graph === null ? {} : { graph: active.graph }),
    }));
  `, "utf8");
  const mcpBarrierHelperPath = join(repositoryRoot, "scripts", "release-hardening-mcp-writer.mjs");
  await access(mcpBarrierHelperPath);

  await mkdir(scaleRoot, { recursive: true });
  await writeFile(join(scaleRoot, "AGENTS.md"), "# Synthetic release fixture\nDo not execute repository source.\n", "utf8");
  await writeScaleSources(scaleRoot, 1);
  const coldStarted = performance.now();
  const cold = JSON.parse(mustRun(process.execPath, [cliPath, "index", scaleRoot, "--json"], installRoot));
  const coldIndexMs = performance.now() - coldStarted;
  assert.equal(cold.generation, 1);
  const databasePath = join(scaleRoot, ".contextforge", "index.sqlite");
  const initialHealth = sqliteHealth(databasePath);
  assert.deepEqual(initialHealth.integrity, ["ok"]);
  assert.deepEqual(initialHealth.foreignKeys, []);
  assert.equal(initialHealth.counts.files, scaleFileCount + 2);

  const warmStarted = performance.now();
  mustRun(process.execPath, [cliPath, "index", scaleRoot, "--json"], installRoot);
  const warmIndexMs = performance.now() - warmStarted;
  const searchStarted = performance.now();
  const searchOne = mustRun(process.execPath, [cliPath, "search", task, scaleRoot, "--json"], installRoot);
  const searchMs = performance.now() - searchStarted;
  const searchTwo = mustRun(process.execPath, [cliPath, "search", task, scaleRoot, "--json"], installRoot);
  const pack8kStarted = performance.now();
  const packMarkdownOne = mustRun(process.execPath, [cliPath, "pack", task, scaleRoot, "--budget", String(budget)], installRoot);
  const pack8kMs = performance.now() - pack8kStarted;
  const packMarkdownTwo = mustRun(process.execPath, [cliPath, "pack", task, scaleRoot, "--budget", String(budget)], installRoot);
  const pack16kStarted = performance.now();
  mustRun(process.execPath, [cliPath, "pack", task, scaleRoot, "--budget", "16000"], installRoot);
  const pack16kMs = performance.now() - pack16kStarted;
  const packJsonOne = mustRun(process.execPath, [cliPath, "pack", task, scaleRoot, "--budget", String(budget), "--json"], installRoot);
  const packJsonTwo = mustRun(process.execPath, [cliPath, "pack", task, scaleRoot, "--budget", String(budget), "--json"], installRoot);
  assert.equal(searchOne, searchTwo);
  assert.equal(packMarkdownOne, packMarkdownTwo);
  assert.equal(packJsonOne, packJsonTwo);

  await writeScaleSources(scaleRoot, 2);
  const competingWriterReady = join(temporaryRoot, "competing-writer.ready");
  const competingWriterRelease = join(temporaryRoot, "competing-writer.release");
  const firstWriter = spawnCaptured(
    process.execPath,
    [barrierHelperPath, sqliteModulePath, scaleRoot, competingWriterReady, competingWriterRelease],
    installRoot,
  );
  await waitForFile(competingWriterReady, firstWriter.child);
  const secondWriter = run(process.execPath, [cliPath, "index", scaleRoot, "--json"], installRoot);
  assert.equal(secondWriter.status, 7);
  assert.match(secondWriter.stderr, /INDEX_BUSY/u);
  await writeFile(competingWriterRelease, "release", "utf8");
  const firstWriterResult = await firstWriter.completed;
  assert.equal(firstWriterResult.status, 0, firstWriterResult.stderr);

  const generationBeforeReadWrite = sqliteHealth(databasePath).state.generation;
  const readWriteReady = join(temporaryRoot, "read-write.ready");
  const readWriteRelease = join(temporaryRoot, "read-write.release");
  const readWriteWriter = spawnCaptured(
    process.execPath,
    [barrierHelperPath, sqliteModulePath, scaleRoot, readWriteReady, readWriteRelease],
    installRoot,
  );
  await waitForFile(readWriteReady, readWriteWriter.child);
  const concurrentSearch = JSON.parse(mustRun(process.execPath, [cliPath, "search", task, scaleRoot, "--json"], installRoot));
  const concurrentPack = JSON.parse(mustRun(
    process.execPath,
    [cliPath, "pack", task, scaleRoot, "--budget", String(budget), "--json"],
    installRoot,
  ));
  assert.equal(concurrentSearch.generation, generationBeforeReadWrite);
  assert.equal(concurrentPack.generation, generationBeforeReadWrite);
  await writeFile(readWriteRelease, "release", "utf8");
  const readWriteResult = await readWriteWriter.completed;
  assert.equal(readWriteResult.status, 0, readWriteResult.stderr);
  assert.equal(
    JSON.parse(mustRun(process.execPath, [cliPath, "search", task, scaleRoot, "--json"], installRoot)).generation,
    generationBeforeReadWrite + 1,
  );

  const stableBeforeCrash = sqliteHealth(databasePath).state.generation;
  const crashReady = join(temporaryRoot, "crash.ready");
  const crashRelease = join(temporaryRoot, "crash.release");
  const crashingWriter = spawnCaptured(
    process.execPath,
    [barrierHelperPath, sqliteModulePath, scaleRoot, crashReady, crashRelease],
    installRoot,
  );
  await waitForFile(crashReady, crashingWriter.child);
  assert.equal(crashingWriter.child.kill("SIGKILL"), true);
  const crashResult = await crashingWriter.completed;
  assert.notEqual(crashResult.status, 0);
  const afterCrash = sqliteHealth(databasePath);
  assert.deepEqual(afterCrash.integrity, ["ok"]);
  assert.deepEqual(afterCrash.foreignKeys, []);
  assert.equal(afterCrash.state.generation, stableBeforeCrash);
  assert.equal(afterCrash.building, 0);
  mustRun(process.execPath, [cliPath, "search", task, scaleRoot, "--json"], installRoot);
  mustRun(process.execPath, [cliPath, "pack", task, scaleRoot, "--budget", String(budget), "--json"], installRoot);
  const recoveryStarted = performance.now();
  const recovered = JSON.parse(mustRun(process.execPath, [cliPath, "index", scaleRoot, "--json"], installRoot));
  const recoveryMs = performance.now() - recoveryStarted;
  assert.ok(recovered.generation > stableBeforeCrash);

  const corruptRoot = join(temporaryRoot, "corrupt repo");
  await mkdir(join(corruptRoot, ".contextforge"), { recursive: true });
  await writeFile(join(corruptRoot, "source.ts"), "export const safe = true;\n", "utf8");
  await writeFile(join(corruptRoot, ".contextforge", "index.sqlite"), "not sqlite", "utf8");
  const corrupt = run(process.execPath, [cliPath, "search", "safe", corruptRoot, "--json"], installRoot);
  assert.equal(corrupt.status, 6);
  assert.match(corrupt.stderr, /INDEX_CORRUPT/u);
  assert.equal(corrupt.stderr.includes(corruptRoot), false);

  const futureRoot = join(temporaryRoot, "future schema repo");
  await mkdir(join(futureRoot, ".contextforge"), { recursive: true });
  await writeFile(join(futureRoot, "source.ts"), "export const future = true;\n", "utf8");
  const futurePath = join(futureRoot, ".contextforge", "index.sqlite");
  const futureDatabase = new DatabaseSync(futurePath);
  futureDatabase.exec(`
    CREATE TABLE repository_state (
      singleton_id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, active_generation_id INTEGER NULL
    ) STRICT;
    INSERT INTO repository_state VALUES (1, 999, NULL);
  `);
  futureDatabase.close();
  const future = run(process.execPath, [cliPath, "search", "future", futureRoot, "--json"], installRoot);
  assert.equal(future.status, 6);
  assert.match(future.stderr, /UNSUPPORTED_SCHEMA/u);
  const futureVerification = new DatabaseSync(futurePath, { readOnly: true });
  assert.equal(
    futureVerification.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'index_generation'").get(),
    undefined,
  );
  futureVerification.close();

  const parserFailureRoot = join(temporaryRoot, "parser asset failure repo");
  await mkdir(parserFailureRoot, { recursive: true });
  await writeFile(join(parserFailureRoot, "source.ts"), "export const parser = true;\n", "utf8");
  const parserAsset = join(installRoot, "node_modules", "contextforge", "dist", "adapters", "parser", "assets", "tree-sitter-typescript.wasm");
  const hiddenParserAsset = `${parserAsset}.missing`;
  await rename(parserAsset, hiddenParserAsset);
  let parserFailure;
  try {
    parserFailure = run(process.execPath, [cliPath, "index", parserFailureRoot, "--json"], installRoot);
  } finally {
    await rename(hiddenParserAsset, parserAsset);
  }
  assert.equal(parserFailure.status, 5);
  assert.match(parserFailure.stderr, /PARSER_UNAVAILABLE/u);

  const noGitRoot = join(temporaryRoot, "non git repo");
  await mkdir(noGitRoot, { recursive: true });
  await writeFile(join(noGitRoot, "source.ts"), "export const noGit = true;\n", "utf8");
  const noGitEnvironment = { ...process.env, PATH: "", Path: "" };
  mustRun(process.execPath, [cliPath, "index", noGitRoot, "--json"], installRoot, { env: noGitEnvironment });
  const noGitGraph = JSON.parse(mustRun(process.execPath, [cliPath, "graph", "source.ts", noGitRoot, "--json"], installRoot));
  assert.equal(noGitGraph.git.status, "unavailable");

  await mkdir(contentionRoot, { recursive: true });
  await writeFile(join(contentionRoot, "AGENTS.md"), "# Deterministic writer-contention fixture\n", "utf8");
  await writeFile(join(contentionRoot, "release-target.ts"), "export class ReleaseTarget { run() { return true; } }\n", "utf8");
  mustRun(process.execPath, [cliPath, "index", contentionRoot, "--json"], installRoot);
  let latestContentionGeneration = 1;
  for (let iteration = 0; iteration < contentionIterations; iteration += 1) {
    const readyPath = join(temporaryRoot, `mcp-writer-${iteration}.ready`);
    const releasePath = join(temporaryRoot, `mcp-writer-${iteration}.release`);
    const mcpA = createMcpClient(
      process.execPath,
      [mcpBarrierHelperPath, installedPackageRoot, contentionRoot, readyPath, releasePath],
      `contextforge-release-mcp-a-${iteration}`,
    );
    const mcpB = createMcpClient(
      process.execPath,
      [cliPath, "mcp", "--repository", contentionRoot],
      `contextforge-release-mcp-b-${iteration}`,
    );
    try {
      await Promise.all([mcpA.client.connect(mcpA.transport), mcpB.client.connect(mcpB.transport)]);
    } catch (error) {
      await Promise.allSettled([mcpA.client.close(), mcpB.client.close()]);
      const startupPids = [mcpA.transport.pid, mcpB.transport.pid]
        .filter((pid) => typeof pid === "number");
      await Promise.allSettled(startupPids.map((pid) => waitForExit(pid)));
      throw new Error(
        `MCP contention helpers failed to start. A: ${mcpA.stderr.join("")} B: ${mcpB.stderr.join("")}`,
        { cause: error },
      );
    }
    const mcpPids = [mcpA.transport.pid, mcpB.transport.pid];
    assert.ok(mcpPids.every((pid) => typeof pid === "number"));
    const firstIndex = mcpA.client.callTool({ name: "index", arguments: {} });
    let firstResult;
    let secondResult;
    try {
      const barrierOutcome = await Promise.race([
        waitForFile(readyPath, undefined, 30_000, "writer-lock-acquired").then(() => ({ status: "ready" })),
        firstIndex.then(
          () => ({ status: "completed" }),
          (error) => ({ status: "failed", error }),
        ),
      ]);
      if (barrierOutcome.status === "completed") {
        throw new Error("First MCP index completed before its writer-lock barrier was observed.");
      }
      if (barrierOutcome.status === "failed") throw barrierOutcome.error;
      try {
        secondResult = await withTimeout(
          mcpB.client.callTool({ name: "index", arguments: {} }),
          "Competing MCP index",
        );
      } finally {
        await createSignalFile(releasePath, "release\n");
      }
      firstResult = await withTimeout(firstIndex, "Barrier-held MCP index after release");
      assert.notEqual(firstResult.isError, true);
      assert.equal(secondResult.isError, true);
      assert.match(
        secondResult.content.map((item) => item.type === "text" ? item.text : "").join(""),
        /INDEX_BUSY/u,
      );
      latestContentionGeneration = firstResult.structuredContent?.generation;
      assert.equal(latestContentionGeneration, iteration + 2);
    } finally {
      await createSignalFile(releasePath, "release\n");
      await withTimeout(firstIndex, "MCP index cleanup after barrier failure").catch(() => undefined);
      await Promise.allSettled([mcpA.client.close(), mcpB.client.close()]);
      await Promise.all(mcpPids.map((pid) => waitForExit(pid)));
    }
    assert.equal(mcpA.stderr.join(""), "");
    assert.equal(mcpB.stderr.join(""), "");
  }
  const contentionHealth = sqliteHealth(join(contentionRoot, ".contextforge", "index.sqlite"));
  assert.deepEqual(contentionHealth.integrity, ["ok"]);
  assert.deepEqual(contentionHealth.foreignKeys, []);
  assert.equal(contentionHealth.building, 0);
  assert.equal(contentionHealth.state.generation, latestContentionGeneration);
  mustRun(process.execPath, [cliPath, "search", task, contentionRoot, "--json"], installRoot);
  mustRun(process.execPath, [cliPath, "pack", task, contentionRoot, "--budget", String(budget), "--json"], installRoot);

  await mkdir(soakRoot, { recursive: true });
  await writeFile(join(soakRoot, "main.ts"), "export class SoakTarget { run() { return true; } }\n", "utf8");
  mustRun(process.execPath, [cliPath, "index", soakRoot, "--json"], installRoot);
  const soak = createMcpClient(
    process.execPath,
    [cliPath, "mcp", "--repository", soakRoot],
    "contextforge-release-soak",
  );
  await soak.client.connect(soak.transport);
  const soakPid = soak.transport.pid;
  assert.equal(typeof soakPid, "number");
  const initialProcess = processObservation(soakPid);
  let peakRssBytes = initialProcess.rssBytes;
  let firstSearchResult;
  let firstPackResult;
  const soakStarted = performance.now();
  for (let index = 0; index < soakRequests; index += 1) {
    let result;
    if (index % 20 === 0) {
      result = await soak.client.callTool({ name: "pack", arguments: { task: "SoakTarget.run", budget: 2_000 } });
      const serialized = JSON.stringify(result);
      firstPackResult ??= serialized;
      assert.equal(serialized, firstPackResult);
    } else if (index % 5 === 0) {
      result = await soak.client.callTool({ name: "search", arguments: { task: "SoakTarget.run", limit: 1 } });
      const serialized = JSON.stringify(result);
      firstSearchResult ??= serialized;
      assert.equal(serialized, firstSearchResult);
    } else {
      result = await soak.client.callTool({ name: "status", arguments: {} });
      assert.equal(result.structuredContent?.indexStatus, "CURRENT");
    }
    if (index % 100 === 0) {
      const observation = processObservation(soakPid);
      if (observation.rssBytes !== null) peakRssBytes = Math.max(peakRssBytes ?? 0, observation.rssBytes);
    }
  }
  const soakDurationMs = performance.now() - soakStarted;
  const finalProcess = processObservation(soakPid);
  if (finalProcess.rssBytes !== null) peakRssBytes = Math.max(peakRssBytes ?? 0, finalProcess.rssBytes);
  await soak.client.close();
  assert.equal(soak.stderr.join(""), "");
  await waitForExit(soakPid);

  const finalHealth = sqliteHealth(databasePath);
  const tarballMetadata = await stat(tarballPath);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "1.0",
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    package: { filename: basename(tarballPath), files: pack.entryCount, bytes: tarballMetadata.size },
    scale: {
      generatedFiles: scaleFileCount,
      indexedFiles: finalHealth.counts.files,
      symbols: finalHealth.counts.symbols,
      graphEdges: finalHealth.counts.edges,
      databaseBytes: (await stat(databasePath)).size,
      coldIndexMs: Math.round(coldIndexMs * 100) / 100,
      warmIndexMs: Math.round(warmIndexMs * 100) / 100,
      searchMs: Math.round(searchMs * 100) / 100,
      pack8kMs: Math.round(pack8kMs * 100) / 100,
      pack16kMs: Math.round(pack16kMs * 100) / 100,
    },
    concurrency: {
      indexIndex: "one success, one INDEX_BUSY",
      indexIndexIterations: contentionIterations,
      indexIndexFailures: 0,
      indexSearchGeneration: concurrentSearch.generation,
      indexPackGeneration: concurrentPack.generation,
      multipleMcpServers: "PASS",
    },
    crashRecovery: {
      killedDuringTransaction: true,
      preservedGeneration: afterCrash.state.generation,
      incompleteGenerations: afterCrash.building,
      integrityCheck: afterCrash.integrity,
      foreignKeyProblems: afterCrash.foreignKeys.length,
      recoveredGeneration: recovered.generation,
      recoveryMs: Math.round(recoveryMs * 100) / 100,
    },
    failureHardening: {
      corruptDatabase: "INDEX_CORRUPT",
      futureSchema: "UNSUPPORTED_SCHEMA",
      missingParserAsset: "PARSER_UNAVAILABLE",
      gitUnavailable: "graceful",
      nonGitRepository: "PASS",
    },
    determinism: { searchJson: "PASS", packMarkdown: "PASS", packJson: "PASS", soak: "PASS" },
    soak: {
      requests: soakRequests,
      durationMs: Math.round(soakDurationMs * 100) / 100,
      initialRssBytes: initialProcess.rssBytes,
      peakRssBytes,
      finalRssBytes: finalProcess.rssBytes,
      initialHandles: initialProcess.handles,
      finalHandles: finalProcess.handles,
      orphanProcesses: 0,
    },
  }, null, 2)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
