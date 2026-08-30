import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildContextPack } from "../../src/application/build-context-pack.js";
import { buildIndex } from "../../src/application/build-index.js";
import type { RepositorySourceReader } from "../../src/application/repository-source.js";
import { ContextForgeError } from "../../src/core/errors.js";
import { GenericTokenEstimator, type TokenEstimator } from "../../src/core/token-estimation.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

const scanner = new FileSystemRepositoryScanner();
const sourceReader = new FileSystemRepositorySourceReader();
const factory = (root: string): SqliteIndexRepository => new SqliteIndexRepository(root);
const estimator = new GenericTokenEstimator();

function largeMemorySource(newline = "\n"): string {
  return [
    'import { Store } from "./store.js";',
    "export class MemoryService {",
    ...Array.from({ length: 480 }, (_, index) => `  // unrelated setup ${index}`),
    "  disableMemory() {",
    "    const 中文状态 = '```';",
    "    return new Store().write(中文状态); // 😀",
    "  }",
    ...Array.from({ length: 120 }, (_, index) => `  // unrelated middle ${index}`),
    "  finalizeRun() {",
    "    return new Store().write('complete');",
    "  }",
    ...Array.from({ length: 430 }, (_, index) => `  // unrelated tail ${index}`),
    "}",
    "",
  ].join(newline);
}

async function createPackingFixture(root: string): Promise<void> {
  await writeFixture(root, "AGENTS.md", "# Repository Instructions\n\n## Testing\n\nRun focused tests before the full suite.\n");
  await writeFixture(root, "src/memory-service.ts", largeMemorySource("\r\n"));
  await writeFixture(
    root,
    "src/store.ts",
    "export class Store {\n  write(value: string) { return value.length > 0; }\n}\n",
  );
  await writeFixture(
    root,
    "tests/memory-race.test.ts",
    'import { MemoryService } from "../src/memory-service.js";\nconst service = new MemoryService();\nservice.disableMemory();\nservice.finalizeRun();\n',
  );
  await writeFixture(root, "tests/test-utils.ts", "export const fixture = true;\n");
  await writeFixture(
    root,
    "docs/MEMORY_DESIGN.md",
    [
      "# Memory Design",
      "",
      "```md",
      "## Concurrency is not a real heading here",
      "```",
      "",
      "## Concurrency",
      "",
      "`MemoryService.disableMemory` must coordinate with `src/memory-service.ts` before finalization.",
      "",
      "## Appendix",
      ...Array.from({ length: 500 }, (_, index) => `Generic appendix ${index}.`),
      "",
    ].join("\n"),
  );
  await writeFixture(root, "README.md", "# Generic Repository\n\nUnrelated overview.\n");
}

test("real index/search/pack produces symbol-aware, section-aware, deterministic hard-budget context", async (context) => {
  const root = await createTemporaryDirectory("context-pack");
  context.after(() => removeTemporaryDirectory(root));
  await createPackingFixture(root);
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  const task = "fix MemoryService.disableMemory and MemoryService.finalizeRun concurrency race";

  const first = await buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task, budget: 4_000 });
  const second = await buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task, budget: 4_000 });
  assert.equal(first.markdown, second.markdown);
  assert.equal(JSON.stringify(first.manifest), JSON.stringify(second.manifest));
  assert.equal(first.manifest.estimatedPayloadTokens, estimator.estimate(first.markdown));
  assert.ok(first.manifest.estimatedPayloadTokens <= 4_000);
  assert.equal(first.manifest.generation, 1);
  assert.equal(first.manifest.rankingStrategy, "contextforge-structural-v1");
  assert.equal(first.manifest.packingStrategy, "contextforge-pack-v1");
  assert.equal(first.manifest.tokenEstimator, "contextforge-generic-v1");
  assert.equal(first.manifest.tokenEstimatorVersion, "1.0");
  assert.ok(first.performance.finalVerificationMs >= 0);
  assert.equal(first.markdown.includes("\r"), false);
  assert.match(first.markdown, /````ts\n/u);

  const paths = first.manifest.selectedItems.map((item) => item.relativePath);
  assert.deepEqual([...new Set(paths)], paths);
  const primary = first.manifest.selectedItems.find((item) => item.relativePath === "src/memory-service.ts");
  assert.equal(primary?.role, "PRIMARY_CODE");
  assert.equal(primary?.wholeFile, false);
  assert.ok(primary?.relevantSymbols.some((symbol) => symbol.qualifiedName === "MemoryService.disableMemory"));
  assert.ok(primary?.relevantSymbols.some((symbol) => symbol.qualifiedName === "MemoryService.finalizeRun"));
  assert.ok(primary?.secondaryRoles.includes("DEPENDENCY"));
  assert.ok((primary?.selectedRanges.length ?? 0) >= 2);
  assert.match(first.markdown, /中文状态/u);
  assert.match(first.markdown, /😀/u);
  assert.equal(first.markdown.includes("unrelated setup 20"), false);
  assert.ok(first.manifest.selectedItems.some((item) => item.role === "TEST" && item.relativePath === "tests/memory-race.test.ts"));
  assert.ok(first.manifest.selectedItems.some((item) => item.role === "DEPENDENCY" && item.relativePath === "src/store.ts"));
  assert.ok(first.manifest.selectedItems.some((item) => item.role === "DOCUMENTATION" && item.relativePath === "docs/MEMORY_DESIGN.md"));
  assert.ok(first.manifest.selectedItems.some((item) => item.role === "REPOSITORY_INSTRUCTION" && item.wholeFile));
  assert.equal(paths.includes("README.md"), false);
  assert.equal(paths.includes("tests/test-utils.ts"), false);
  assert.equal(JSON.stringify(first.manifest).includes(root), false);
  assert.equal(first.markdown.includes("Generic appendix 200"), false);

  const larger = await buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task, budget: 8_000 });
  const largest = await buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task, budget: 16_000 });
  for (const execution of [larger, largest]) {
    assert.ok(execution.manifest.estimatedPayloadTokens <= execution.manifest.requestedBudget);
    assert.ok(execution.manifest.selectedItems.some((item) => item.relativePath === "src/memory-service.ts" && item.relevantSymbols.some((symbol) => symbol.qualifiedName === "MemoryService.disableMemory")));
  }
  assert.ok(larger.manifest.selectedItems.length >= first.manifest.selectedItems.length);
  assert.ok(largest.manifest.selectedItems.length >= larger.manifest.selectedItems.length);

  let exactBudget = first.manifest.estimatedPayloadTokens;
  let boundary = first;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    boundary = await buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task, budget: exactBudget });
    if (boundary.manifest.estimatedPayloadTokens === exactBudget) break;
    exactBudget = boundary.manifest.estimatedPayloadTokens;
  }
  assert.equal(boundary.manifest.estimatedPayloadTokens, boundary.manifest.requestedBudget);

  const ample = await buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task, budget: 32_000 });
  assert.equal(ample.manifest.selectedItems.some((item) => item.relativePath === "README.md"), false);
  assert.equal(ample.manifest.selectedItems.some((item) => item.relativePath === "tests/test-utils.ts"), false);
  assert.equal(ample.manifest.unusedBudgetReason, "NO_MORE_USEFUL_CONTEXT");
});

test("exact serialization enforces the hard budget through deterministic reduction", async (context) => {
  const root = await createTemporaryDirectory("pack-reduction");
  context.after(() => removeTemporaryDirectory(root));
  for (let index = 0; index < 8; index += 1) {
    await writeFixture(
      root,
      `src/service-${index}.ts`,
      `export class Service${index} { runService${index}() { return "${"context ".repeat(30)}"; } }\n`,
    );
  }
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  const finalHeavyEstimator: TokenEstimator = {
    id: "test-final-heavy-v1",
    version: "1.0",
    estimate(value) {
      return value.startsWith("# ContextForge Context Pack") ? Math.ceil(value.length / 8) : 1;
    },
  };

  const first = await buildContextPack(
    scanner,
    sourceReader,
    factory,
    { repositoryPath: root, task: "service", budget: 150 },
    finalHeavyEstimator,
  );
  const second = await buildContextPack(
    scanner,
    sourceReader,
    factory,
    { repositoryPath: root, task: "service", budget: 150 },
    finalHeavyEstimator,
  );
  assert.ok(first.performance.reductionIterations > 0);
  assert.ok(first.manifest.estimatedPayloadTokens <= 150);
  assert.equal(first.markdown, second.markdown);
  assert.equal(JSON.stringify(first.manifest), JSON.stringify(second.manifest));
});

test("tiny budgets and missing indexes fail explicitly without emitting a malformed pack", async (context) => {
  const root = await createTemporaryDirectory("pack-errors");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/main.ts", "export const main = true;\n");
  await assert.rejects(
    buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task: "main", budget: 4_000 }),
    (error: unknown) => error instanceof ContextForgeError && error.code === "INDEX_REQUIRED",
  );
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  await assert.rejects(
    buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task: "main", budget: 50 }),
    (error: unknown) => error instanceof ContextForgeError && error.code === "BUDGET_TOO_SMALL" && /minimum estimate/u.test(error.message),
  );
});

test("stale top-candidate bytes never enter generation N and reindex makes the new bytes eligible", async (context) => {
  const root = await createTemporaryDirectory("pack-stale");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/memory.ts", "export class MemoryService { disableMemory() { return false; } }\n");
  await writeFixture(root, "tests/memory.test.ts", 'import { MemoryService } from "../src/memory.js";\nnew MemoryService();\n');
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  const sentinel = "NEW_UNINDEXED_STALE_BYTES";
  await writeFile(join(root, "src", "memory.ts"), `export class MemoryService { disableMemory() { return "${sentinel}"; } }\n`, "utf8");

  const stale = await buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task: "MemoryService.disableMemory", budget: 4_000 });
  assert.equal(stale.manifest.generation, 1);
  assert.equal(stale.manifest.packStatus, "PARTIAL");
  assert.equal(stale.markdown.includes(sentinel), false);
  assert.equal(JSON.stringify(stale.manifest).includes(sentinel), false);
  assert.ok(stale.manifest.droppedCandidates.some((candidate) => candidate.relativePath === "src/memory.ts" && candidate.dropReason === "STALE_SOURCE"));
  assert.equal((await factory(root).loadActive())?.generation, 1);

  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  const refreshed = await buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task: "MemoryService.disableMemory", budget: 4_000 });
  assert.equal(refreshed.manifest.generation, 2);
  assert.match(refreshed.markdown, new RegExp(sentinel, "u"));
});

test("Pack keeps Search generation N while a writer activates generation N+1", async (context) => {
  const root = await createTemporaryDirectory("pack-snapshot");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/main.ts", "export class MainService { run() { return true; } }\n");
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });

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
  const oldPack = buildContextPack(scanner, blockingReader, factory, { repositoryPath: root, task: "MainService.run", budget: 4_000 });
  await started;
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  release?.();
  assert.equal((await oldPack).manifest.generation, 1);
  assert.equal((await buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task: "MainService.run", budget: 4_000 })).manifest.generation, 2);
});

test("large AGENTS is heading-selected honestly and configuration can be the core selected context", async (context) => {
  const root = await createTemporaryDirectory("pack-instructions-config");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(
    root,
    "AGENTS.md",
    [
      "# Instructions",
      "## Security",
      "Keep Main configuration secure.",
      ...Array.from({ length: 900 }, (_, index) => `Main security detail ${index}.`),
      "## Appendix",
      "Unrelated instruction appendix.",
    ].join("\n"),
  );
  await writeFixture(root, "tsconfig.json", '{"compilerOptions":{"strict":true,"baseUrl":"."}}\n');
  await writeFixture(root, "src/main.ts", "export const Main = true;\n");
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });

  const instructions = await buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task: "Main security", budget: 4_000 });
  const instruction = instructions.manifest.selectedItems.find((item) => item.relativePath === "AGENTS.md");
  assert.equal(instruction?.wholeFile, false);
  assert.equal(instruction?.contentStatus, "PARTIAL");
  assert.equal(instructions.manifest.packStatus, "PARTIAL");
  assert.match(instructions.markdown, /Keep Main configuration secure/u);
  assert.equal(instructions.markdown.includes("Main security detail 500"), false);
  assert.equal(instructions.markdown.includes("Unrelated instruction appendix"), false);

  const configuration = await buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task: "fix tsconfig.json TypeScript path configuration", budget: 4_000 });
  assert.ok(configuration.manifest.selectedItems.some((item) => item.relativePath === "tsconfig.json" && item.role === "CONFIGURATION" && item.wholeFile));

  await writeFixture(root, "docs/adr/ADR-007-main-security.md", "# Main Security Decision\n\nMain configuration requires strict path validation.\n");
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  const adr = await buildContextPack(scanner, sourceReader, factory, { repositoryPath: root, task: "Main Security Decision strict path validation", budget: 4_000 });
  assert.ok(adr.manifest.selectedItems.some((item) => item.relativePath === "docs/adr/ADR-007-main-security.md" && item.role === "DOCUMENTATION"));
});
