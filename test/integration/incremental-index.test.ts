import assert from "node:assert/strict";
import { readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildIndex } from "../../src/application/build-index.js";
import type { AnalyzeSourceRequest, FileAnalysis, LanguageAnalyzer } from "../../src/core/language-analysis.js";
import type { RepositorySourceReader } from "../../src/application/repository-source.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

class RecordingAnalyzer implements LanguageAnalyzer {
  readonly delegate = new TreeSitterLanguageAnalyzer();
  readonly analyzedPaths: string[] = [];
  initializationCalls = 0;
  readonly analysisVersion = this.delegate.analysisVersion;

  initialize(): Promise<{ readonly durationMs: number }> {
    this.initializationCalls += 1;
    return this.delegate.initialize();
  }

  analyze(request: AnalyzeSourceRequest): Promise<FileAnalysis> {
    this.analyzedPaths.push(request.relativePath);
    return this.delegate.analyze(request);
  }
}

test("incremental indexing reuses unchanged hashes and creates a complete new snapshot", async (context) => {
  const root = await createTemporaryDirectory("incremental");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "A.ts", "export const A = 1;\n");
  await writeFixture(root, "B.ts", "export const B = 1;\n");
  await writeFixture(root, "C.ts", "export const C = 1;\n");
  const originalB = await stat(join(root, "B.ts"));

  const analyzer = new RecordingAnalyzer();
  const scanner = new FileSystemRepositoryScanner();
  const reader = new FileSystemRepositorySourceReader();
  const factory = (repositoryRoot: string): SqliteIndexRepository => new SqliteIndexRepository(repositoryRoot);
  const first = await buildIndex(scanner, reader, analyzer, factory, { repositoryPath: root });
  assert.equal(first.generation, 1);
  assert.deepEqual(analyzer.analyzedPaths, ["A.ts", "B.ts", "C.ts"]);

  analyzer.analyzedPaths.length = 0;
  await writeFile(join(root, "B.ts"), "export const B = 2;\n", "utf8");
  await utimes(join(root, "B.ts"), originalB.atime, originalB.mtime);
  await rm(join(root, "C.ts"));
  await writeFixture(root, "D.ts", "export const D = 1;\n");

  const second = await buildIndex(scanner, reader, analyzer, factory, { repositoryPath: root });
  assert.equal(second.generation, 2);
  assert.equal(second.files.reused, 1);
  assert.deepEqual(analyzer.analyzedPaths, ["B.ts", "D.ts"]);
  const active = await factory(root).loadActive();
  assert.deepEqual(active?.files.map(({ relativePath }) => relativePath), ["A.ts", "B.ts", "D.ts"]);
  assert.equal(active?.files.find(({ relativePath }) => relativePath === "B.ts")?.analysis.symbols[0]?.name, "B");

  const database = new DatabaseSync(factory(root).databasePath, { readOnly: true });
  try {
    const oldC = database
      .prepare("SELECT COUNT(*) AS count FROM indexed_file WHERE generation_id = 1 AND relative_path = 'C.ts'")
      .get() as { count: number };
    const newC = database
      .prepare("SELECT COUNT(*) AS count FROM indexed_file WHERE generation_id = 2 AND relative_path = 'C.ts'")
      .get() as { count: number };
    assert.equal(oldC.count, 1);
    assert.equal(newC.count, 0);
  } finally {
    database.close();
  }
});

test("runtime state and secrets never enter the active index or database payload", async (context) => {
  const root = await createTemporaryDirectory("index-security");
  context.after(() => removeTemporaryDirectory(root));
  const sentinel = "CONTEXTFORGE_INDEX_SECRET_SENTINEL";
  await writeFixture(root, ".env.local", sentinel);
  await writeFixture(root, "src/main.ts", "export const safe = true;\n");

  const analyzer = new RecordingAnalyzer();
  const factory = (repositoryRoot: string): SqliteIndexRepository => new SqliteIndexRepository(repositoryRoot);
  const dependencies = [new FileSystemRepositoryScanner(), new FileSystemRepositorySourceReader()] as const;
  const first = await buildIndex(dependencies[0], dependencies[1], analyzer, factory, { repositoryPath: root });
  const second = await buildIndex(dependencies[0], dependencies[1], analyzer, factory, { repositoryPath: root });
  assert.equal(first.files.indexed, second.files.indexed);
  const active = await factory(root).loadActive();
  assert.equal(active?.files.some(({ relativePath }) => relativePath.startsWith(".contextforge")), false);
  assert.equal(active?.files.some(({ relativePath }) => relativePath.includes(".env")), false);
  const databaseBytes = await readFile(factory(root).databasePath);
  assert.equal(databaseBytes.includes(Buffer.from(sentinel)), false);
  assert.equal(databaseBytes.includes(Buffer.from("export const safe = true")), false);
});

test("a file that stays unstable after the bounded reader retry is recorded as failed without aborting activation", async (context) => {
  const root = await createTemporaryDirectory("index-unstable");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "stable.ts", "export const stable = true;\n");
  const unstableReader: RepositorySourceReader = {
    readTextFile: () => Promise.resolve({ status: "unstable", diagnosticCode: "SOURCE_CHANGED_DURING_READ" }),
  };
  const factory = (repositoryRoot: string): SqliteIndexRepository => new SqliteIndexRepository(repositoryRoot);
  const summary = await buildIndex(
    new FileSystemRepositoryScanner(),
    unstableReader,
    new RecordingAnalyzer(),
    factory,
    { repositoryPath: root },
  );
  assert.equal(summary.generation, 1);
  assert.equal(summary.files.failed, 1);
  const active = await factory(root).loadActive();
  assert.equal(active?.files[0]?.analysis.parserStatus, "failed");
  assert.equal(active?.files[0]?.analysis.diagnostics[0]?.code, "SOURCE_CHANGED_DURING_READ");
});

test("a competing index command obtains the writer slot before parser initialization", async (context) => {
  const root = await createTemporaryDirectory("index-writer-slot");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "main.ts", "export const main = true;\n");
  const factory = (repositoryRoot: string): SqliteIndexRepository =>
    new SqliteIndexRepository(repositoryRoot, { busyTimeoutMs: 25 });
  await buildIndex(
    new FileSystemRepositoryScanner(),
    new FileSystemRepositorySourceReader(),
    new RecordingAnalyzer(),
    factory,
    { repositoryPath: root },
  );

  const holder = new DatabaseSync(factory(root).databasePath, { timeout: 25 });
  const contender = new RecordingAnalyzer();
  try {
    holder.exec("BEGIN IMMEDIATE");
    await assert.rejects(
      buildIndex(
        new FileSystemRepositoryScanner(),
        new FileSystemRepositorySourceReader(),
        contender,
        factory,
        { repositoryPath: root },
      ),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INDEX_BUSY",
    );
    holder.exec("ROLLBACK");
  } finally {
    holder.close();
  }
  assert.equal(contender.initializationCalls, 0);
  assert.deepEqual(contender.analyzedPaths, []);
  assert.equal((await factory(root).loadActive())?.generation, 1);
});
