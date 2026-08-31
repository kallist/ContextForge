import assert from "node:assert/strict";
import test from "node:test";

import { Client, InMemoryTransport, type CallToolResult } from "@modelcontextprotocol/client";

import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { ReadOnlyGitSignalsReader } from "../../src/adapters/git/git-signals-reader.js";
import { createContextForgeMcpServer } from "../../src/adapters/mcp/contextforge-mcp-server.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildContextPack } from "../../src/application/build-context-pack.js";
import { buildIndex } from "../../src/application/build-index.js";
import { getRepositoryStatus } from "../../src/application/get-repository-status.js";
import type { RepositorySourceReader, SourceFileRead } from "../../src/application/repository-source.js";
import { searchRepository } from "../../src/application/search-repository.js";
import type { BoundContextForgeApplication } from "../../src/composition/contextforge-application.js";
import type { AnalyzeSourceRequest, FileAnalysis, LanguageAnalyzer } from "../../src/core/language-analysis.js";
import type { RepositoryMapEntry } from "../../src/core/repository-map.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

function structured(result: CallToolResult): Record<string, unknown> {
  assert.ok(result.structuredContent);
  return result.structuredContent as Record<string, unknown>;
}

class GateSourceReader implements RepositorySourceReader {
  readonly #delegate = new FileSystemRepositorySourceReader();
  #armed = false;
  #startedResolve: (() => void) | null = null;
  #releaseResolve: (() => void) | null = null;
  #started: Promise<void> = Promise.resolve();
  #release: Promise<void> = Promise.resolve();

  arm(): void {
    this.#armed = true;
    this.#started = new Promise((resolveStarted) => { this.#startedResolve = resolveStarted; });
    this.#release = new Promise((resolveRelease) => { this.#releaseResolve = resolveRelease; });
  }

  waitUntilStarted(): Promise<void> {
    return this.#started;
  }

  release(): void {
    this.#releaseResolve?.();
  }

  async readTextFile(rootRealPath: string, entry: RepositoryMapEntry): Promise<SourceFileRead> {
    if (this.#armed) {
      this.#armed = false;
      this.#startedResolve?.();
      await this.#release;
    }
    return this.#delegate.readTextFile(rootRealPath, entry);
  }
}

class GateAnalyzer implements LanguageAnalyzer {
  readonly #delegate = new TreeSitterLanguageAnalyzer();
  readonly analysisVersion = this.#delegate.analysisVersion;
  #armed = false;
  #startedResolve: (() => void) | null = null;
  #releaseResolve: (() => void) | null = null;
  #started: Promise<void> = Promise.resolve();
  #release: Promise<void> = Promise.resolve();

  arm(): void {
    this.#armed = true;
    this.#started = new Promise((resolveStarted) => { this.#startedResolve = resolveStarted; });
    this.#release = new Promise((resolveRelease) => { this.#releaseResolve = resolveRelease; });
  }

  waitUntilStarted(): Promise<void> {
    return this.#started;
  }

  release(): void {
    this.#releaseResolve?.();
  }

  async initialize(): Promise<{ readonly durationMs: number }> {
    if (this.#armed) {
      this.#armed = false;
      this.#startedResolve?.();
      await this.#release;
    }
    return this.#delegate.initialize();
  }

  analyze(request: AnalyzeSourceRequest): Promise<FileAnalysis> {
    return this.#delegate.analyze(request);
  }
}

async function connectApplication(application: BoundContextForgeApplication) {
  const server = createContextForgeMcpServer(application, "0.1.0-test");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "contextforge-concurrency-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

async function expectResolvesBeforeRelease<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => {
      reject(new Error(`${label} did not run concurrently.`));
    }, 5_000)),
  ]);
}

test("MCP search and pack retain generation N while a concurrent index activates N+1", async (context) => {
  const root = await createTemporaryDirectory("mcp-snapshot");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/main.ts", "export class SnapshotService { read() { return true; } }\n");
  await writeFixture(root, "tests/main.test.ts", 'import { SnapshotService } from "../src/main.js";\nnew SnapshotService().read();\n');

  const scanner = new FileSystemRepositoryScanner();
  const normalReader = new FileSystemRepositorySourceReader();
  const gateReader = new GateSourceReader();
  const analyzer = new TreeSitterLanguageAnalyzer();
  const gitReader = new ReadOnlyGitSignalsReader();
  const factory = (repositoryRoot: string): SqliteIndexRepository => new SqliteIndexRepository(repositoryRoot, { busyTimeoutMs: 25 });
  const first = await buildIndex(scanner, normalReader, analyzer, factory, { repositoryPath: root }, gitReader);
  assert.equal(first.generation, 1);

  const application: BoundContextForgeApplication = {
    rootRealPath: root,
    status: () => getRepositoryStatus(scanner, normalReader, factory, root),
    index: () => buildIndex(scanner, normalReader, analyzer, factory, { repositoryPath: root }, gitReader),
    search: (request) => searchRepository(scanner, gateReader, factory, { ...request, repositoryPath: root }),
    pack: (request) => buildContextPack(scanner, gateReader, factory, { ...request, repositoryPath: root }),
  };
  const connection = await connectApplication(application);
  context.after(() => connection.close().catch(() => undefined));

  const [parallelSearchOne, parallelSearchTwo] = await Promise.all([
    connection.client.callTool({ name: "search", arguments: { task: "SnapshotService.read", limit: 2 } }),
    connection.client.callTool({ name: "search", arguments: { task: "SnapshotService.read", limit: 2 } }),
  ]);
  assert.equal(structured(parallelSearchOne).generation, 1);
  assert.equal(structured(parallelSearchTwo).generation, 1);
  const [parallelSearch, parallelPack] = await Promise.all([
    connection.client.callTool({ name: "search", arguments: { task: "SnapshotService.read", limit: 2 } }),
    connection.client.callTool({ name: "pack", arguments: { task: "SnapshotService.read", budget: 4_000 } }),
  ]);
  assert.equal(structured(parallelSearch).generation, 1);
  assert.equal(structured(parallelPack).generation, 1);
  const [parallelPackOne, parallelPackTwo] = await Promise.all([
    connection.client.callTool({ name: "pack", arguments: { task: "SnapshotService.read", budget: 4_000 } }),
    connection.client.callTool({ name: "pack", arguments: { task: "SnapshotService.read", budget: 4_000 } }),
  ]);
  assert.equal(structured(parallelPackOne).generation, 1);
  assert.equal(structured(parallelPackTwo).generation, 1);

  gateReader.arm();
  const searchPromise = connection.client.callTool({ name: "search", arguments: { task: "SnapshotService.read", limit: 2 } });
  await gateReader.waitUntilStarted();
  let indexTwo: CallToolResult;
  try {
    indexTwo = await expectResolvesBeforeRelease(
      connection.client.callTool({ name: "index", arguments: {} }),
      "index during search",
    );
  } finally {
    gateReader.release();
  }
  assert.equal(structured(indexTwo).generation, 2);
  const searchOne = await searchPromise;
  assert.equal(structured(searchOne).generation, 1);
  const searchTwo = await connection.client.callTool({ name: "search", arguments: { task: "SnapshotService.read", limit: 2 } });
  assert.equal(structured(searchTwo).generation, 2);

  gateReader.arm();
  const packPromise = connection.client.callTool({ name: "pack", arguments: { task: "SnapshotService.read", budget: 4_000 } });
  await gateReader.waitUntilStarted();
  let indexThree: CallToolResult;
  try {
    indexThree = await expectResolvesBeforeRelease(
      connection.client.callTool({ name: "index", arguments: {} }),
      "index during pack",
    );
  } finally {
    gateReader.release();
  }
  assert.equal(structured(indexThree).generation, 3);
  const packTwo = await packPromise;
  assert.equal(structured(packTwo).generation, 2);
  const packThree = await connection.client.callTool({ name: "pack", arguments: { task: "SnapshotService.read", budget: 4_000 } });
  assert.equal(structured(packThree).generation, 3);

  await connection.close();
});

test("concurrent MCP index calls preserve INDEX_BUSY and leave the server healthy", async (context) => {
  const root = await createTemporaryDirectory("mcp-index-busy");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/main.ts", "export const main = true;\n");
  const scanner = new FileSystemRepositoryScanner();
  const reader = new FileSystemRepositorySourceReader();
  const analyzer = new GateAnalyzer();
  const gitReader = new ReadOnlyGitSignalsReader();
  const factory = (repositoryRoot: string): SqliteIndexRepository => new SqliteIndexRepository(repositoryRoot, { busyTimeoutMs: 25 });
  await buildIndex(scanner, reader, analyzer, factory, { repositoryPath: root }, gitReader);
  const application: BoundContextForgeApplication = {
    rootRealPath: root,
    status: () => getRepositoryStatus(scanner, reader, factory, root),
    index: () => buildIndex(scanner, reader, analyzer, factory, { repositoryPath: root }, gitReader),
    search: (request) => searchRepository(scanner, reader, factory, { ...request, repositoryPath: root }),
    pack: (request) => buildContextPack(scanner, reader, factory, { ...request, repositoryPath: root }),
  };
  const connection = await connectApplication(application);
  context.after(() => connection.close().catch(() => undefined));

  analyzer.arm();
  const firstIndex = connection.client.callTool({ name: "index", arguments: {} });
  await analyzer.waitUntilStarted();
  let secondIndex: CallToolResult;
  try {
    secondIndex = await expectResolvesBeforeRelease(
      connection.client.callTool({ name: "index", arguments: {} }),
      "competing index",
    );
  } finally {
    analyzer.release();
  }
  assert.equal(secondIndex.isError, true);
  assert.match(secondIndex.content.map((item) => item.type === "text" ? item.text : "").join(""), /INDEX_BUSY/u);
  assert.equal(structured(await firstIndex).generation, 2);
  const status = await connection.client.callTool({ name: "status", arguments: {} });
  assert.equal(structured(status).indexStatus, "CURRENT");
  assert.equal(structured(status).generation, 2);

  await connection.close();
});
