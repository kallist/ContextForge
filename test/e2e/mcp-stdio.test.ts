import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { Client, type CallToolResult } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { createContextForgeApplication } from "../../src/composition/contextforge-application.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

const cliPath = resolve("dist", "cli", "main.js");
const MODERN_PROTOCOL_VERSION = "2026-07-28";

function runCli(args: readonly string[], cwd?: string) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8" });
}

interface ConnectedMcp {
  readonly client: Client;
  readonly transport: StdioClientTransport;
  readonly stderr: string[];
  close(): Promise<void>;
}

function structured(result: CallToolResult): Record<string, unknown> {
  assert.ok(result.structuredContent);
  return result.structuredContent as Record<string, unknown>;
}

function text(result: CallToolResult): string {
  return result.content
    .filter((content): content is Extract<typeof content, { type: "text" }> => content.type === "text")
    .map((content) => content.text)
    .join("");
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  assert.equal(processExists(pid), false, `MCP child ${pid} remained alive after client close.`);
}

async function connect(repository: string, modern: boolean): Promise<ConnectedMcp> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "mcp", "--repository", repository],
    cwd: resolve("."),
    stderr: "pipe",
  });
  const stderr: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer | string) => stderr.push(chunk.toString()));
  const client = new Client(
    { name: "contextforge-e2e", version: "1.0.0" },
    modern ? { versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } } } : undefined,
  );
  await client.connect(transport);
  const pid = transport.pid;
  assert.ok(pid);
  return {
    client,
    transport,
    stderr,
    async close() {
      await client.close();
      await waitForProcessExit(pid);
    },
  };
}

test("official client exercises the complete modern MCP stdio workflow", async (context) => {
  const root = await createTemporaryDirectory("mcp stdio 中文");
  context.after(() => removeTemporaryDirectory(root));
  const secret = "CONTEXTFORGE_MCP_SECRET_DO_NOT_LEAK";
  await writeFixture(root, ".env.local", secret);
  await writeFixture(root, "src/dependency.ts", "export const ready = true;\n");
  await writeFixture(
    root,
    "src/main.ts",
    'import { ready } from "./dependency.js";\nexport class AgentRuntime { run() { return ready; } }\n',
  );
  await writeFixture(root, "tests/main.test.ts", 'import { AgentRuntime } from "../src/main.js";\nnew AgentRuntime().run();\n');

  const connection = await connect(root, true);
  context.after(() => connection.close().catch(() => undefined));
  const { client } = connection;
  assert.equal(client.getNegotiatedProtocolVersion(), MODERN_PROTOCOL_VERSION);
  assert.equal(client.getServerVersion()?.name, "contextforge");
  assert.match(client.getInstructions() ?? "", /Use status/u);
  assert.equal(client.getServerCapabilities()?.resources, undefined);
  assert.equal(client.getServerCapabilities()?.prompts, undefined);

  const missing = await client.callTool({ name: "status", arguments: {} });
  assert.equal(structured(missing).indexStatus, "MISSING");

  const invalid = await client.callTool({ name: "search", arguments: { task: "" } });
  assert.equal(invalid.isError, true);
  const huge = await client.callTool({ name: "search", arguments: { task: "x".repeat(20_000) } });
  assert.equal(huge.isError, true);
  const invalidBudget = await client.callTool({ name: "pack", arguments: { task: "valid task", budget: 0 } });
  assert.equal(invalidBudget.isError, true);
  const afterInvalid = await client.callTool({ name: "status", arguments: {} });
  assert.equal(structured(afterInvalid).indexStatus, "MISSING");

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name), ["status", "index", "search", "pack"]);
  for (const tool of tools.tools) {
    assert.ok(tool.outputSchema, `${tool.name} must declare an output schema.`);
    assert.equal(Object.hasOwn(tool.inputSchema.properties ?? {}, "repository"), false);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.annotations?.openWorldHint, false);
  }
  assert.equal(tools.tools.find(({ name }) => name === "index")?.annotations?.readOnlyHint, false);
  assert.equal(tools.tools.find(({ name }) => name === "pack")?.annotations?.readOnlyHint, true);
  await assert.rejects(
    client.callTool({ name: "not_a_contextforge_tool", arguments: {} }),
    /not_a_contextforge_tool not found/u,
  );

  const missingPack = await client.callTool({ name: "pack", arguments: { task: "AgentRuntime.run", budget: 2_000 } });
  assert.equal(missingPack.isError, true);
  assert.match(text(missingPack), /INDEX_REQUIRED/u);

  const indexed = await client.callTool({ name: "index", arguments: {} });
  assert.equal(indexed.isError, undefined);
  assert.equal(structured(indexed).generation, 1);

  const current = await client.callTool({ name: "status", arguments: {} });
  assert.equal(structured(current).indexStatus, "CURRENT");
  assert.equal(structured(current).generation, 1);

  const search = await client.callTool({ name: "search", arguments: { task: "fix AgentRuntime run", limit: 2 } });
  const searchData = structured(search);
  assert.equal(searchData.rankingStrategy, "contextforge-structural-v1");
  assert.equal(searchData.indexStatus, "FRESH");
  const candidates = searchData.candidates as { relativePath: string }[];
  assert.equal(candidates[0]?.relativePath, "src/main.ts");
  const directApplication = await createContextForgeApplication(root);
  const directSearch = await directApplication.search({ task: "fix AgentRuntime run", limit: 2 });
  assert.deepEqual(candidates.map(({ relativePath }) => relativePath), directSearch.result.candidates.map(({ relativePath }) => relativePath));

  const pack = await client.callTool({ name: "pack", arguments: { task: "AgentRuntime.run", budget: 2_000 } });
  assert.match(text(pack), /^# ContextForge Context Pack\n/u);
  assert.match(text(pack), /src\/main\.ts/u);
  const packData = structured(pack);
  assert.equal(packData.packingStrategy, "contextforge-pack-v1");
  assert.equal(packData.tokenEstimator, "contextforge-generic-v1");
  assert.ok(Number(packData.estimatedTokens) <= Number(packData.requestedBudget));
  assert.equal(Object.hasOwn(packData, "markdown"), false);
  assert.equal(Object.hasOwn(packData, "source"), false);
  const directPack = await directApplication.pack({ task: "AgentRuntime.run", budget: 2_000 });
  assert.equal(text(pack), directPack.markdown);
  assert.equal(packData.generation, directPack.manifest.generation);
  assert.equal(packData.estimatedTokens, directPack.manifest.estimatedPayloadTokens);
  assert.deepEqual(
    packData.selectedItems,
    directPack.manifest.selectedItems.map((item) => ({
      relativePath: item.relativePath,
      ranges: item.selectedRanges.map(({ startLine, endLine }) => ({ startLine, endLine })),
    })),
  );
  for (const budget of [4_000, 8_000, 16_000]) {
    const mcpBudgetPack = await client.callTool({ name: "pack", arguments: { task: "AgentRuntime.run", budget } });
    const directBudgetPack = await directApplication.pack({ task: "AgentRuntime.run", budget });
    assert.equal(text(mcpBudgetPack), directBudgetPack.markdown);
    assert.equal(structured(mcpBudgetPack).estimatedTokens, directBudgetPack.manifest.estimatedPayloadTokens);
  }
  const tiny = await client.callTool({ name: "pack", arguments: { task: "AgentRuntime.run", budget: 1 } });
  assert.equal(tiny.isError, true);
  assert.match(text(tiny), /BUDGET_TOO_SMALL/u);
  const malicious = await client.callTool({
    name: "search",
    arguments: { task: ".env.local ../outside.ts; rm -rf repository", limit: 4 },
  });
  assert.equal(JSON.stringify(malicious).includes(secret), false);
  assert.equal(JSON.stringify(malicious).includes(root), false);

  const staleSource = "MCP_NEW_STALE_SOURCE_MUST_NOT_APPEAR";
  await writeFile(join(root, "src", "main.ts"), `export const changed = "${staleSource}";\n`, "utf8");
  const stale = await client.callTool({ name: "status", arguments: {} });
  assert.equal(structured(stale).indexStatus, "STALE");
  const stalePack = await client.callTool({ name: "pack", arguments: { task: "AgentRuntime.run", budget: 2_000 } });
  assert.equal(structured(stalePack).packStatus, "PARTIAL");
  assert.equal(text(stalePack).includes(staleSource), false);

  const reindexed = await client.callTool({ name: "index", arguments: {} });
  assert.equal(structured(reindexed).generation, 2);
  const refreshed = await client.callTool({ name: "status", arguments: {} });
  assert.equal(structured(refreshed).indexStatus, "CURRENT");
  assert.equal(structured(refreshed).generation, 2);

  const publicOutput = JSON.stringify({ tools, missing, invalid, huge, invalidBudget, indexed, current, search, pack, stale, stalePack, reindexed, refreshed });
  assert.equal(publicOutput.includes(secret), false);
  assert.equal(publicOutput.includes(root), false);
  assert.equal(connection.stderr.join("").includes(secret), false);
  assert.equal(connection.stderr.join("").includes(root), false);

  await connection.close();
  assert.equal(connection.stderr.join(""), "");
});

test("official client can use the compatibility initialization flow", async (context) => {
  const root = await createTemporaryDirectory("mcp-legacy");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/main.ts", "export class LegacyService { run() { return true; } }\n");
  const cliIndex = runCli(["index", root, "--json"]);
  assert.equal(cliIndex.status, 0, cliIndex.stderr);
  assert.equal((JSON.parse(cliIndex.stdout) as { generation: number }).generation, 1);
  const connection = await connect(root, false);
  context.after(() => connection.close().catch(() => undefined));
  assert.notEqual(connection.client.getNegotiatedProtocolVersion(), MODERN_PROTOCOL_VERSION);
  const tools = await connection.client.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name), ["status", "index", "search", "pack"]);
  const status = await connection.client.callTool({ name: "status", arguments: {} });
  assert.equal(structured(status).generation, 1);
  const mcpSearch = await connection.client.callTool({ name: "search", arguments: { task: "LegacyService.run", limit: 1 } });
  assert.equal((structured(mcpSearch).candidates as { relativePath: string }[])[0]?.relativePath, "src/main.ts");
  const mcpPack = await connection.client.callTool({ name: "pack", arguments: { task: "LegacyService.run", budget: 2_000 } });
  assert.equal(structured(mcpPack).generation, 1);
  const mcpIndex = await connection.client.callTool({ name: "index", arguments: {} });
  assert.equal(structured(mcpIndex).generation, 2);
  const cliSearch = runCli(["search", "LegacyService.run", root, "--limit", "1", "--json"]);
  assert.equal(cliSearch.status, 0, cliSearch.stderr);
  assert.equal((JSON.parse(cliSearch.stdout) as { generation: number }).generation, 2);
  const cliPack = runCli(["pack", "LegacyService.run", root, "--budget", "2000", "--json"]);
  assert.equal(cliPack.status, 0, cliPack.stderr);
  assert.equal((JSON.parse(cliPack.stdout) as { generation: number }).generation, 2);
  await connection.close();
  assert.equal(connection.stderr.join(""), "");
});

test("CLI and MCP index remain healthy after a durable rename round trip", async (context) => {
  const root = await createTemporaryDirectory("mcp-rename-round-trip");
  context.after(() => removeTemporaryDirectory(root));
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(git("init", "-b", "main").status, 0);
  await writeFixture(root, ".gitignore", ".contextforge/\n");
  await writeFixture(root, "src/A.ts", "export const value = 1;\n");
  assert.equal(git("add", "--", ".gitignore", "src/A.ts").status, 0);
  assert.equal(git("-c", "user.name=MCP fixture", "-c", "user.email=mcp@example.invalid", "commit", "-m", "initial").status, 0);
  assert.equal(runCli(["index", root, "--json"]).status, 0);

  assert.equal(git("mv", "--", "src/A.ts", "src/B.ts").status, 0);
  const renamed = runCli(["index", root, "--json"]);
  assert.equal(renamed.status, 0, renamed.stderr);
  assert.equal((JSON.parse(renamed.stdout) as { generation: number }).generation, 2);
  assert.equal(git("mv", "--", "src/B.ts", "src/A.ts").status, 0);
  assert.equal(git("status", "--porcelain=v1").stdout, "");
  const restored = runCli(["index", root, "--json"]);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal((JSON.parse(restored.stdout) as { generation: number }).generation, 3);

  const connection = await connect(root, true);
  context.after(() => connection.close().catch(() => undefined));
  const status = await connection.client.callTool({ name: "status", arguments: {} });
  assert.equal(structured(status).indexStatus, "CURRENT");
  const indexed = await connection.client.callTool({ name: "index", arguments: {} });
  assert.equal(indexed.isError, undefined);
  assert.equal(structured(indexed).generation, 4);
  await connection.close();
  assert.equal(connection.stderr.join(""), "");
});
