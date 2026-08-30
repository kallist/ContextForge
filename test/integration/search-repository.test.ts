import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildIndex } from "../../src/application/build-index.js";
import type { RepositorySourceReader } from "../../src/application/repository-source.js";
import { searchRepository } from "../../src/application/search-repository.js";
import { ContextForgeError } from "../../src/core/errors.js";
import type { ScoreContribution } from "../../src/core/task-retrieval.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

const scanner = new FileSystemRepositoryScanner();
const sourceReader = new FileSystemRepositorySourceReader();

function factory(root: string): SqliteIndexRepository {
  return new SqliteIndexRepository(root);
}

async function createRankingFixture(root: string): Promise<void> {
  await writeFixture(root, "src/common.ts", "export const shared = true;\n");
  await writeFixture(
    root,
    "src/services/memory-service.ts",
    [
      'import { shared } from "../common.js";',
      "export class MemoryService {",
      "  disableMemory() { return false; }",
      '  finalizeRun() { if (!shared) throw new Error("INDEX_BUSY"); return true; }',
      "  writeMemory() { return shared; }",
      "}",
      "",
    ].join("\n"),
  );
  await writeFixture(
    root,
    "src/runtime/run-finalizer.ts",
    'import { MemoryService } from "../services/memory-service.js";\nexport const finalizeRun = (memory: MemoryService) => memory.finalizeRun();\n',
  );
  await writeFixture(root, "tests/test-utils.ts", "export const fixture = true;\n");
  await writeFixture(
    root,
    "tests/memory-race.test.ts",
    'import { MemoryService } from "../src/services/memory-service.js";\nimport { fixture } from "./test-utils.js";\nnew MemoryService().disableMemory(); void fixture;\n',
  );
  for (let index = 0; index < 36; index += 1) {
    await writeFixture(
      root,
      `src/features/feature-${index}.ts`,
      `import { shared } from "../common.js";\nexport const feature${index} = shared;\n`,
    );
    await writeFixture(
      root,
      `tests/feature-${index}.test.ts`,
      `import { fixture } from "./test-utils.js";\nexport const test${index} = fixture;\n`,
    );
  }
  await writeFixture(root, "src/user/service.ts", "export class UserService {}\n");
  await writeFixture(root, "src/admin/user/service.ts", "export class AdminUserService {}\n");
  await writeFixture(root, "src/auth/user/service.ts", "export class AuthUserService {}\n");
  await writeFixture(root, "docs/MEMORY_DESIGN.md", "# Memory design\n\nSee `src/services/memory-service.ts` and `MemoryService`.\n");
  await writeFixture(
    root,
    "README.md",
    ["# Repository", "memory overview", ...Array.from({ length: 36 }, (_, index) => `src/features/feature-${index}.ts`), ""].join("\n"),
  );
  await writeFixture(root, "src/unrelated/payment.ts", "export class PaymentGateway {}\n");
  await writeFixture(root, ".env.local", "CONTEXTFORGE_SEARCH_SECRET_SENTINEL=never-output\n");
}

function rankOf(paths: readonly string[], path: string): number {
  const index = paths.indexOf(path);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index + 1;
}

function contributionSum(contributions: readonly ScoreContribution[]): number {
  return contributions.reduce((sum, contribution) => sum + contribution.value, 0);
}

test("real index search ranks identity, lexical, graph, test, documentation, and hub-aware candidates deterministically", async (context) => {
  const root = await createTemporaryDirectory("search-ranking");
  context.after(() => removeTemporaryDirectory(root));
  await createRankingFixture(root);
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });

  const exactSymbol = (await searchRepository(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "MemoryService",
  })).result;
  assert.equal(exactSymbol.candidates[0]?.relativePath, "src/services/memory-service.ts");
  assert.ok(exactSymbol.candidates[0]?.directEvidence.some((item) => item.kind === "EXACT_SYMBOL"));

  const qualified = (await searchRepository(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "MemoryService.finalizeRun",
    limit: 100,
  })).result;
  assert.equal(qualified.candidates[0]?.relativePath, "src/services/memory-service.ts");
  assert.ok(qualified.candidates[0]?.relevantSymbols.some((symbol) => symbol.qualifiedName === "MemoryService.finalizeRun"));
  assert.ok(qualified.candidates[0]?.directEvidence.some((item) => item.kind === "EXACT_QUALIFIED_SYMBOL"));
  assert.ok(Math.abs(contributionSum(qualified.candidates[0]?.scoreContributions ?? []) - (qualified.candidates[0]?.rawScore ?? 0)) < 1e-9);

  const literal = (await searchRepository(scanner, sourceReader, factory, { repositoryPath: root, task: "INDEX_BUSY" })).result;
  assert.equal(literal.candidates[0]?.relativePath, "src/services/memory-service.ts");
  assert.ok(literal.candidates[0]?.directEvidence.some((item) => item.kind === "SOURCE_LEXICAL"));

  const naturalExecution = await searchRepository(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "fix the race where disabling memory still lets a run write a memory record",
    limit: 100,
  });
  const natural = naturalExecution.result;
  const paths = natural.candidates.map((candidate) => candidate.relativePath);
  assert.ok(rankOf(paths, "src/services/memory-service.ts") <= 2);
  assert.ok(paths.includes("src/runtime/run-finalizer.ts"));
  assert.ok(paths.includes("tests/memory-race.test.ts"));
  assert.ok(paths.includes("docs/MEMORY_DESIGN.md"));
  assert.ok(rankOf(paths, "tests/memory-race.test.ts") < rankOf(paths, "tests/test-utils.ts"));
  assert.ok(rankOf(paths, "src/services/memory-service.ts") < rankOf(paths, "src/common.ts"));
  assert.ok(rankOf(paths, "docs/MEMORY_DESIGN.md") < rankOf(paths, "README.md"));
  assert.equal(paths.includes("src/unrelated/payment.ts"), false);
  assert.equal(natural.rankingStrategy, "contextforge-structural-v1");
  assert.equal(natural.indexStatus.status, "FRESH");
  assert.equal(JSON.stringify(natural), JSON.stringify((await searchRepository(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "fix the race where disabling memory still lets a run write a memory record",
    limit: 100,
  })).result));
  assert.ok(naturalExecution.performance.totalMs >= 0);

  const exactPath = (await searchRepository(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "src/services/memory-service.ts",
  })).result;
  assert.equal(exactPath.candidates[0]?.relativePath, "src/services/memory-service.ts");

  const exactBasename = (await searchRepository(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "memory-service.ts",
  })).result;
  assert.equal(exactBasename.candidates[0]?.relativePath, "src/services/memory-service.ts");
  assert.ok(exactBasename.candidates[0]?.directEvidence.some((item) => item.kind === "EXACT_BASENAME"));

  const ambiguous = (await searchRepository(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "fix admin user service",
  })).result;
  assert.equal(ambiguous.candidates[0]?.relativePath, "src/admin/user/service.ts");

  const cjk = (await searchRepository(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "修复 MemoryService 在 memory_enabled=false 后的竞态",
  })).result;
  assert.equal(cjk.candidates[0]?.relativePath, "src/services/memory-service.ts");
});

test("cyclic graph expansion terminates without duplicate candidates or repeated edge inflation", async (context) => {
  const root = await createTemporaryDirectory("search-cycle");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/A.ts", 'import { Beta } from "./B.js";\nexport const Alpha = Beta;\n');
  await writeFixture(root, "src/B.ts", 'import "./A.js";\nimport "./C.js";\nexport const Beta = true;\n');
  await writeFixture(root, "src/C.ts", 'import "./B.js";\nexport const Gamma = true;\n');
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  const result = (await searchRepository(scanner, sourceReader, factory, { repositoryPath: root, task: "Alpha" })).result;
  assert.equal(result.candidates[0]?.relativePath, "src/A.ts");
  const paths = result.candidates.map((candidate) => candidate.relativePath);
  assert.deepEqual([...new Set(paths)], paths);
  assert.ok(result.candidates.length <= 3);
  const firstHop = result.candidates.find((candidate) => candidate.relativePath === "src/B.ts");
  const secondHop = result.candidates.find((candidate) => candidate.relativePath === "src/C.ts");
  assert.equal(firstHop?.graphDistance, 1);
  assert.equal(secondHop?.graphDistance, 2);
  assert.ok((firstHop?.expansionEvidence.length ?? 0) <= 2);
  assert.ok(Math.max(...(firstHop?.expansionEvidence.map((item) => item.weight) ?? [0])) > Math.max(...(secondHop?.expansionEvidence.map((item) => item.weight) ?? [0])));
});

test("stale source never contributes lexical evidence and search does not mutate the active generation", async (context) => {
  const root = await createTemporaryDirectory("search-stale");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/service.ts", 'export const status = "OLD_LITERAL";\n');
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  await writeFile(join(root, "src", "service.ts"), 'export const status = "NEW_UNINDEXED_LITERAL";\n', "utf8");
  await writeFixture(root, "src/added.ts", "export const added = true;\n");

  const stale = (await searchRepository(scanner, sourceReader, factory, { repositoryPath: root, task: "NEW_UNINDEXED_LITERAL" })).result;
  assert.equal(stale.generation, 1);
  assert.equal(stale.indexStatus.status, "STALE");
  assert.equal(stale.indexStatus.addedFiles, 1);
  assert.ok(stale.indexStatus.stalePaths.includes("src/service.ts"));
  assert.equal(stale.candidates.some((candidate) => candidate.directEvidence.some((item) => item.kind === "SOURCE_LEXICAL")), false);
  assert.equal((await factory(root).loadActive())?.generation, 1);

  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  const refreshed = (await searchRepository(scanner, sourceReader, factory, { repositoryPath: root, task: "NEW_UNINDEXED_LITERAL" })).result;
  assert.equal(refreshed.generation, 2);
  assert.equal(refreshed.indexStatus.status, "FRESH");
  assert.equal(refreshed.candidates[0]?.relativePath, "src/service.ts");
});

test("a real search keeps generation N while another SQLite connection activates N+1", async (context) => {
  const root = await createTemporaryDirectory("search-snapshot");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/memory.ts", "export class MemoryService {}\n");
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });

  const concurrent = await Promise.all(Array.from({ length: 4 }, () => searchRepository(
    scanner,
    sourceReader,
    factory,
    { repositoryPath: root, task: "MemoryService" },
  )));
  assert.ok(concurrent.every((execution) => execution.result.generation === 1));
  assert.ok(concurrent.every((execution) => JSON.stringify(execution.result) === JSON.stringify(concurrent[0]?.result)));

  let release: (() => void) | undefined;
  let announce: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { announce = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let blocked = false;
  const blockingReader: RepositorySourceReader = {
    async readTextFile(rootRealPath, entry) {
      if (!blocked) {
        blocked = true;
        announce?.();
        await gate;
      }
      return sourceReader.readTextFile(rootRealPath, entry);
    },
  };
  const oldSearch = searchRepository(scanner, blockingReader, factory, { repositoryPath: root, task: "MemoryService" });
  await started;
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  release?.();
  assert.equal((await oldSearch).result.generation, 1);
  assert.equal((await searchRepository(scanner, sourceReader, factory, { repositoryPath: root, task: "MemoryService" })).result.generation, 2);
});

test("search bounds broad candidate sets in a medium synthetic repository", async (context) => {
  const root = await createTemporaryDirectory("search-bounds");
  context.after(() => removeTemporaryDirectory(root));
  for (let index = 0; index < 500; index += 1) {
    await writeFixture(root, `features/service-${index.toString().padStart(4, "0")}.txt`, `service fixture ${index}\n`);
  }
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  const result = (await searchRepository(scanner, sourceReader, factory, { repositoryPath: root, task: "service", limit: 100 })).result;
  assert.ok(result.counts.directCandidates <= 200);
  assert.ok(result.counts.expandedCandidates <= 128);
  assert.ok(result.counts.finalCandidates <= 256);
  assert.ok(result.candidates.length <= 100);
  assert.ok(result.candidates.every((candidate) => candidate.directEvidence.length <= 64));
  assert.ok(result.candidates.every((candidate) => candidate.expansionEvidence.length <= 32));
  assert.ok(result.candidates.every((candidate) => candidate.relevantSymbols.length <= 32));
});

test("missing index and low-information task behavior are explicit", async (context) => {
  const root = await createTemporaryDirectory("search-errors");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/main.ts", "export const main = true;\n");
  await assert.rejects(
    searchRepository(scanner, sourceReader, factory, { repositoryPath: root, task: "main" }),
    (error: unknown) => error instanceof ContextForgeError && error.code === "INDEX_REQUIRED",
  );
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  const low = (await searchRepository(scanner, sourceReader, factory, { repositoryPath: root, task: "fix bug" })).result;
  assert.deepEqual(low.candidates, []);
  assert.ok(low.diagnostics.includes("QUERY_LOW_INFORMATION"));
});
