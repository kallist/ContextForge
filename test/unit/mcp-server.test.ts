import assert from "node:assert/strict";
import test from "node:test";

import { Client, InMemoryTransport, type CallToolResult } from "@modelcontextprotocol/client";

import { createContextForgeMcpServer } from "../../src/adapters/mcp/contextforge-mcp-server.js";
import type { RepositoryStatus } from "../../src/application/get-repository-status.js";
import type { BoundContextForgeApplication } from "../../src/composition/contextforge-application.js";
import { ContextForgeError } from "../../src/core/errors.js";

function structured(result: CallToolResult): Record<string, unknown> {
  assert.ok(result.structuredContent);
  return result.structuredContent as Record<string, unknown>;
}

function text(result: CallToolResult): string {
  return result.content.map((item) => item.type === "text" ? item.text : "").join("");
}

test("MCP tool contracts stay bounded and errors are safe", async () => {
  const privateRoot = "C:\\private workspace\\repository";
  const status: RepositoryStatus = {
    schemaVersion: "1.0",
    repository: { name: "repository", root: "." },
    index: { available: true, generation: 7, schemaVersion: 2 },
    indexStatus: "CURRENT",
    verification: null,
    rankingStrategy: "contextforge-structural-v1",
    packingStrategy: "contextforge-pack-v1",
    tokenEstimator: "contextforge-generic-v1",
    tokenEstimatorVersion: "1.0",
    diagnostics: Array.from({ length: 25 }, (_, index) => `${index}: ${"x".repeat(700)}\u0000`),
  };
  const application: BoundContextForgeApplication = {
    rootRealPath: privateRoot,
    status: () => Promise.resolve(status),
    index: () => Promise.reject(new ContextForgeError("INDEX_BUSY", `Index at ${privateRoot} is busy.`)),
    search: () => Promise.reject(new Error("unexpected private implementation detail")),
    pack: () => Promise.reject(new ContextForgeError("BUDGET_TOO_SMALL", "Budget is too small for a useful Context Pack.")),
  };
  const server = createContextForgeMcpServer(application, "0.1.0-test");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "contextforge-unit-test", version: "1.0.0" });
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(({ name }) => name), ["status", "index", "search", "pack"]);
    assert.match(tools.tools.find(({ name }) => name === "index")?.description ?? "", /local ContextForge index/u);
    assert.match(tools.tools.find(({ name }) => name === "pack")?.description ?? "", /hard-budget/u);

    const boundedStatus = await client.callTool({ name: "status", arguments: {} });
    const statusData = structured(boundedStatus);
    assert.equal((statusData.diagnostics as string[]).length, 20);
    assert.equal(statusData.omittedDiagnostics, 5);
    assert.ok((statusData.diagnostics as string[]).every((diagnostic) => diagnostic.length <= 500 && !diagnostic.includes("\u0000")));

    const busy = await client.callTool({ name: "index", arguments: {} });
    assert.equal(busy.isError, true);
    assert.match(text(busy), /INDEX_BUSY/u);
    assert.match(text(busy), /<repository>/u);
    assert.equal(text(busy).includes(privateRoot), false);
    assert.ok(text(busy).length <= 1_100);

    const unexpected = await client.callTool({ name: "search", arguments: { task: "valid task" } });
    assert.equal(unexpected.isError, true);
    assert.equal(text(unexpected), "ContextForge INTERNAL: An unexpected error occurred.");
    assert.equal(text(unexpected).includes("implementation detail"), false);

    const tiny = await client.callTool({ name: "pack", arguments: { task: "valid task", budget: 1 } });
    assert.equal(tiny.isError, true);
    assert.match(text(tiny), /BUDGET_TOO_SMALL/u);

    const afterErrors = await client.callTool({ name: "status", arguments: {} });
    assert.equal(structured(afterErrors).generation, 7);
  } finally {
    await client.close();
    await server.close();
  }
});
