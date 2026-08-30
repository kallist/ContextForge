import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

const cliPath = resolve("dist", "cli", "main.js");

function runCli(args: readonly string[], cwd?: string) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8" });
}

test("compiled CLI exposes help and version", () => {
  const help = runCli(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /contextforge map/u);
  const version = runCli(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^0\.1\.0-dev\.0\n$/u);
});

test("compiled CLI maps a repository in text and JSON modes", async (context) => {
  const root = await createTemporaryDirectory("cli");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/main.ts", "export {};\n");
  await writeFixture(root, "README.md", "# CLI fixture\n");

  const text = runCli(["map", root]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /ContextForge Repository Map/u);
  assert.equal(text.stderr, "");

  const json = runCli(["map", root, "--json"]);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(json.stderr, "");
  const parsed = JSON.parse(json.stdout) as { schemaVersion: unknown; entries: { path: string }[] };
  assert.equal(parsed.schemaVersion, "1.0");
  assert.ok(parsed.entries.some((entry: { path: string }) => entry.path === "src/main.ts"));
});

test("compiled CLI defaults map repository to the current directory", async (context) => {
  const root = await createTemporaryDirectory("default-cwd");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "space and 中文.ts", "export {};\n");

  const result = runCli(["map", "--json"], root);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as { entries: { path: string }[] };
  assert.ok(parsed.entries.some((entry) => entry.path === "space and 中文.ts"));
});

test("compiled CLI reports actionable distinct usage and path errors", async (context) => {
  const root = await createTemporaryDirectory("errors");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "not-a-directory.txt", "text\n");

  const invalidArgument = runCli(["unknown"]);
  assert.equal(invalidArgument.status, 2);
  assert.match(invalidArgument.stderr, /USAGE/u);
  assert.equal(invalidArgument.stdout, "");

  const missing = runCli(["map", `${root}-missing`]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /PATH/u);
  assert.equal(missing.stdout, "");

  const file = runCli(["map", resolve(root, "not-a-directory.txt")]);
  assert.equal(file.status, 2);
  assert.match(file.stderr, /not a directory/u);
  assert.equal(file.stdout, "");
});

test("compiled CLI never leaks sensitive-file content to stdout, stderr, or JSON", async (context) => {
  const root = await createTemporaryDirectory("cli-sensitive");
  context.after(() => removeTemporaryDirectory(root));
  const sentinel = "CONTEXTFORGE_TEST_SECRET_DO_NOT_LEAK";
  await writeFixture(root, ".env.local", sentinel);
  await writeFixture(root, "src/main.ts", "export {};\n");

  const text = runCli(["map", root]);
  const json = runCli(["map", root, "--json"]);
  assert.equal(text.status, 0, text.stderr);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(`${text.stdout}${text.stderr}${json.stdout}${json.stderr}`.includes(sentinel), false);
  assert.equal(`${text.stdout}${json.stdout}`.includes(".env.local"), false);
});

test("compiled CLI indexes incrementally and inspects structured active data", async (context) => {
  const root = await createTemporaryDirectory("cli-index");
  context.after(() => removeTemporaryDirectory(root));
  const sentinel = "CONTEXTFORGE_CLI_INDEX_SECRET";
  await writeFixture(root, ".env", sentinel);
  await writeFixture(root, "src/repository.ts", "export const save = () => true;\n");
  await writeFixture(
    root,
    "src/memory.ts",
    'import { save } from "./repository.js";\nexport class MemoryService { finalizeRun() { return save(); } }\n',
  );
  await writeFixture(root, "README.md", "# Fixture\n");

  const first = runCli(["index", root, "--json"]);
  assert.equal(first.status, 0, first.stderr);
  const firstJson = JSON.parse(first.stdout) as {
    schemaVersion: unknown;
    generation: unknown;
    files: { parsed: unknown; reused: unknown };
  };
  assert.equal(firstJson.schemaVersion, "1.0");
  assert.equal(firstJson.generation, 1);
  assert.equal(firstJson.files.parsed, 2);
  assert.equal(firstJson.files.reused, 0);

  const second = runCli(["index", root, "--json"]);
  assert.equal(second.status, 0, second.stderr);
  const secondJson = JSON.parse(second.stdout) as { generation: unknown; files: { parsed: unknown; reused: unknown } };
  assert.equal(secondJson.generation, 2);
  assert.equal(secondJson.files.parsed, 0);
  assert.equal(secondJson.files.reused, 3);

  const inspection = runCli(["inspect", "src/memory.ts", root, "--json"]);
  assert.equal(inspection.status, 0, inspection.stderr);
  const inspected = JSON.parse(inspection.stdout) as {
    schemaVersion: unknown;
    generation: unknown;
    file: {
      relativePath: unknown;
      analysis: {
        language: unknown;
        symbols: { qualifiedName: string }[];
        imports: { moduleSpecifier: string }[];
      };
    };
  };
  assert.equal(inspected.schemaVersion, "1.0");
  assert.equal(inspected.generation, 2);
  assert.equal(inspected.file.relativePath, "src/memory.ts");
  assert.equal(inspected.file.analysis.language, "typescript");
  assert.ok(inspected.file.analysis.symbols.some(({ qualifiedName }) => qualifiedName === "MemoryService.finalizeRun"));
  assert.ok(inspected.file.analysis.imports.some(({ moduleSpecifier }) => moduleSpecifier === "./repository.js"));

  const output = `${first.stdout}${first.stderr}${second.stdout}${second.stderr}${inspection.stdout}${inspection.stderr}`;
  assert.equal(output.includes(sentinel), false);
  const database = await readFile(join(root, ".contextforge", "index.sqlite"));
  assert.equal(database.includes(Buffer.from(sentinel)), false);
  assert.equal(database.includes(Buffer.from("finalizeRun() { return save(); }")), false);
});

test("compiled CLI rejects unsafe inspect paths and missing active indexes", async (context) => {
  const root = await createTemporaryDirectory("cli-inspect-errors");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/main.ts", "export {};\n");
  const missing = runCli(["inspect", "src/main.ts", root, "--json"]);
  assert.equal(missing.status, 8);
  assert.match(missing.stderr, /INDEX_NOT_FOUND/u);
  const unsafe = runCli(["inspect", "../outside.ts", root, "--json"]);
  assert.equal(unsafe.status, 2);
  assert.match(unsafe.stderr, /normalized repository-relative/u);
  const nonCanonical = runCli(["inspect", "src/../src/main.ts", root, "--json"]);
  assert.equal(nonCanonical.status, 2);
  assert.match(nonCanonical.stderr, /normalized repository-relative/u);
});

test("compiled CLI indexes and deterministically inspects repository graph JSON and text", async (context) => {
  const root = await createTemporaryDirectory("cli-graph");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/dependency.ts", "export const dependency = true;\n");
  await writeFixture(root, "src/main.ts", 'import { dependency } from "./dependency.js";\nexport class Main { run() { return dependency; } }\n');
  await writeFixture(root, "tests/main.test.ts", 'import { Main } from "../src/main.js";\nnew Main().run();\n');
  await writeFixture(root, "docs/MAIN_DESIGN.md", "See `src/main.ts` and `Main`.\n");

  const indexed = runCli(["index", root, "--json"]);
  assert.equal(indexed.status, 0, indexed.stderr);
  const summary = JSON.parse(indexed.stdout) as { graph: { edges: number; gitStatus: string } };
  assert.ok(summary.graph.edges >= 3);
  assert.equal(summary.graph.gitStatus, "unavailable");

  const first = runCli(["graph", "src/main.ts", root, "--json"]);
  const second = runCli(["graph", "src/main.ts", root, "--json"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, first.stdout);
  const graph = JSON.parse(first.stdout) as {
    schemaVersion: string;
    file: string;
    imports: { target: string; confidence: number; evidence: string[] }[];
    tests: { target: string }[];
    documentation: { target: string }[];
    symbols: { qualifiedName: string }[];
    symbolParents: { child: string; parent: string }[];
    git: { status: string };
  };
  assert.equal(graph.schemaVersion, "1.0");
  assert.equal(graph.file, "src/main.ts");
  assert.deepEqual(graph.imports.map(({ target }) => target), ["src/dependency.ts"]);
  assert.equal(graph.imports[0]?.confidence, 1);
  assert.ok((graph.imports[0]?.evidence.length ?? 0) > 0);
  assert.deepEqual(graph.tests.map(({ target }) => target), ["tests/main.test.ts"]);
  assert.deepEqual(graph.documentation.map(({ target }) => target), ["docs/MAIN_DESIGN.md"]);
  assert.ok(graph.symbols.some(({ qualifiedName }) => qualifiedName === "Main.run"));
  assert.deepEqual(graph.symbolParents, [{ child: "Main.run", parent: "Main" }]);
  assert.equal(graph.git.status, "unavailable");
  assert.equal(first.stdout.includes(root), false);

  const text = runCli(["graph", "src/main.ts", root]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /ContextForge Repository Graph/u);
  assert.match(text.stdout, /Imported By/u);
  assert.match(text.stdout, /Related Tests/u);
  assert.match(text.stdout, /Git Signals/u);

  const unsafe = runCli(["graph", "../outside.ts", root, "--json"]);
  assert.equal(unsafe.status, 2);
  assert.match(unsafe.stderr, /normalized repository-relative/u);
});

test("compiled installed-path CLI searches in text/JSON, applies limits, reports stale state, and requires an index", async (context) => {
  const root = await createTemporaryDirectory("cli-search");
  const missingRoot = await createTemporaryDirectory("cli-search-missing");
  context.after(() => Promise.all([removeTemporaryDirectory(root), removeTemporaryDirectory(missingRoot)]));
  await writeFixture(root, "src/memory.ts", "export class MemoryService { disableMemory() { return false; } }\n");
  await writeFixture(root, "tests/memory.test.ts", 'import { MemoryService } from "../src/memory.js";\nnew MemoryService();\n');
  await writeFixture(missingRoot, "src/main.ts", "export const main = true;\n");

  const missing = runCli(["search", "main", missingRoot, "--json"]);
  assert.equal(missing.status, 8);
  assert.match(missing.stderr, /INDEX_REQUIRED/u);

  const indexed = runCli(["index", root, "--json"]);
  assert.equal(indexed.status, 0, indexed.stderr);
  const text = runCli(["search", "fix MemoryService disable race", root, "--limit", "1"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /ContextForge Search/u);
  assert.match(text.stdout, /contextforge-structural-v1/u);
  assert.match(text.stdout, /src\/memory\.ts/u);

  const first = runCli(["search", "MemoryService", root, "--limit", "1", "--json"]);
  const second = runCli(["search", "MemoryService", root, "--limit", "1", "--json"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, first.stdout);
  const parsed = JSON.parse(first.stdout) as {
    schemaVersion: string;
    rankingStrategy: string;
    indexStatus: { status: string };
    candidates: { relativePath: string; scoreContributions: unknown[] }[];
  };
  assert.equal(parsed.schemaVersion, "1.0");
  assert.equal(parsed.rankingStrategy, "contextforge-structural-v1");
  assert.equal(parsed.indexStatus.status, "FRESH");
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0]?.relativePath, "src/memory.ts");
  assert.ok((parsed.candidates[0]?.scoreContributions.length ?? 0) > 0);
  assert.equal(first.stdout.includes(root), false);

  await writeFile(join(root, "src", "memory.ts"), 'export const state = "NEW_STALE_LITERAL";\n', "utf8");
  const stale = runCli(["search", "NEW_STALE_LITERAL", root, "--json"]);
  assert.equal(stale.status, 0, stale.stderr);
  const staleJson = JSON.parse(stale.stdout) as { generation: number; indexStatus: { status: string }; diagnostics: string[] };
  assert.equal(staleJson.generation, 1);
  assert.equal(staleJson.indexStatus.status, "STALE");
  assert.ok(staleJson.diagnostics.includes("LEXICAL_SOURCE_STALE"));

  const empty = runCli(["search", "", root]);
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /INVALID_TASK/u);
  const invalidLimit = runCli(["search", "memory", root, "--limit", "0"]);
  assert.equal(invalidLimit.status, 2);
  assert.match(invalidLimit.stderr, /USAGE/u);
});
