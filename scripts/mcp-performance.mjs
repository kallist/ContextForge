import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { createContextForgeApplication } from "../dist/composition/contextforge-application.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
const cliPath = resolve(repositoryRoot, "dist", "cli", "main.js");
const task = "fix stale index race during graph activation";
const budget = 8_000;

async function measured(action) {
  const started = performance.now();
  const value = await action();
  return { value, durationMs: performance.now() - started };
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

const direct = await createContextForgeApplication(repositoryRoot);
await direct.index();

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cliPath, "mcp", "--repository", repositoryRoot],
  cwd: repositoryRoot,
  stderr: "pipe",
});
const stderr = [];
transport.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));
const client = new Client(
  { name: "contextforge-performance", version: "1.0.0" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);

try {
  const startup = await measured(() => client.connect(transport));
  const status = await measured(() => client.callTool({ name: "status", arguments: {} }));
  const firstSearch = await measured(() => client.callTool({ name: "search", arguments: { task, limit: 20 } }));
  const warmSearch = await measured(() => client.callTool({ name: "search", arguments: { task, limit: 20 } }));
  const firstPack = await measured(() => client.callTool({ name: "pack", arguments: { task, budget } }));
  const warmPack = await measured(() => client.callTool({ name: "pack", arguments: { task, budget } }));
  const directSearch = await measured(() => direct.search({ task, limit: 20 }));
  const directPack = await measured(() => direct.pack({ task, budget }));
  const mcpMarkdown = warmPack.value.content.find(({ type }) => type === "text")?.text;
  if (mcpMarkdown !== directPack.value.markdown) throw new Error("MCP and direct Pack payloads differ.");
  if (stderr.join("") !== "") throw new Error(`MCP server emitted stderr: ${stderr.join("")}`);

  const metadata = warmPack.value.structuredContent ?? {};
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "1.0",
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    protocolVersion: client.getNegotiatedProtocolVersion(),
    task,
    budget,
    timingsMs: {
      serverStartup: rounded(startup.durationMs),
      status: rounded(status.durationMs),
      firstSearch: rounded(firstSearch.durationMs),
      warmSearch: rounded(warmSearch.durationMs),
      firstPack: rounded(firstPack.durationMs),
      warmPack: rounded(warmPack.durationMs),
      directSearch: rounded(directSearch.durationMs),
      directPack: rounded(directPack.durationMs),
      observedWarmSearchAdapterDifference: rounded(warmSearch.durationMs - directSearch.durationMs),
      observedWarmPackAdapterDifference: rounded(warmPack.durationMs - directPack.durationMs),
    },
    generation: metadata.generation,
    packStatus: metadata.packStatus,
    estimatedTokens: metadata.estimatedTokens,
  }, null, 2)}\n`);
} finally {
  await client.close();
}
