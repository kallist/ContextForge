import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { SqliteIndexRepository, type SqliteIndexWritePoint } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import type { NewIndexGeneration } from "../../src/core/repository-index.js";
import { createTemporaryDirectory, removeTemporaryDirectory } from "../helpers/fixtures.js";

function generation(label: string): NewIndexGeneration {
  const relativePath = `src/${label}.ts`;
  const symbolId = `sym_${label.padEnd(24, "0").slice(0, 24)}`;
  return {
    analysisVersion: "test-analysis-v1",
    files: [
      {
        relativePath,
        category: "source",
        contentStatus: "text",
        size: 20,
        mtimeMs: 1,
        contentHash: label.padEnd(64, "0").slice(0, 64),
        analysis: {
          schemaVersion: "1.0",
          relativePath,
          language: "typescript",
          parserStatus: "parsed",
          diagnostics: [],
          symbols: [
            {
              id: symbolId,
              name: label,
              qualifiedName: label,
              kind: "function",
              relativePath,
              parentSymbolId: null,
              exported: true,
              public: null,
              language: "typescript",
              startLine: 1,
              endLine: 1,
              startColumn: 1,
              endColumn: 20,
            },
          ],
          imports: [
            {
              relativePath,
              moduleSpecifier: "./dependency.js",
              kind: "import",
              names: ["dependency"],
              startLine: 1,
              endLine: 1,
              startColumn: 1,
              endColumn: 20,
            },
          ],
        },
      },
    ],
  };
}

test("creates a real WAL database and activates complete generations", async (context) => {
  const root = await createTemporaryDirectory("sqlite-generation");
  context.after(() => removeTemporaryDirectory(root));
  const repository = new SqliteIndexRepository(root);

  assert.equal(await repository.loadActive(), null);
  const first = await repository.activateGeneration(generation("first"));
  assert.equal(first.generation, 1);
  assert.equal(await repository.journalMode(), "wal");
  const activeFirst = await repository.loadActive();
  assert.equal(activeFirst?.generation, 1);
  assert.equal(activeFirst?.files[0]?.analysis.symbols[0]?.qualifiedName, "first");
  assert.equal(activeFirst?.files[0]?.analysis.imports[0]?.moduleSpecifier, "./dependency.js");

  const second = await repository.activateGeneration(generation("second"));
  assert.equal(second.generation, 2);
  const activeSecond = await repository.loadActive();
  assert.equal(activeSecond?.generation, 2);
  assert.deepEqual(activeSecond?.files.map(({ relativePath }) => relativePath), ["src/second.ts"]);
});

for (const failurePoint of ["after_files", "after_symbols", "before_activation"] as const) {
  test(`rolls back a failed generation at ${failurePoint} and leaves the old active generation`, async (context) => {
    const root = await createTemporaryDirectory(`sqlite-rollback-${failurePoint}`);
    context.after(() => removeTemporaryDirectory(root));
    const stable = new SqliteIndexRepository(root);
    await stable.activateGeneration(generation("stable"));
    const failing = new SqliteIndexRepository(root, {
      testHooks: {
        onWritePoint(point: SqliteIndexWritePoint) {
          if (point === failurePoint) throw new Error(`injected ${point}`);
        },
      },
    });

    await assert.rejects(failing.activateGeneration(generation("failed")), (error: unknown) => {
      return error instanceof Error && error.name === "ContextForgeError" && "code" in error && error.code === "INDEX";
    });
    const active = await stable.loadActive();
    assert.equal(active?.generation, 1);
    assert.equal(active?.files[0]?.relativePath, "src/stable.ts");

    const database = new DatabaseSync(stable.databasePath, { readOnly: true });
    try {
      const row = database.prepare("SELECT COUNT(*) AS count FROM index_generation").get() as { count: number };
      assert.equal(row.count, 1);
    } finally {
      database.close();
    }
  });
}

test("a reader transaction keeps generation N while a writer activates N+1", async (context) => {
  const root = await createTemporaryDirectory("sqlite-reader-writer");
  context.after(() => removeTemporaryDirectory(root));
  const repository = new SqliteIndexRepository(root);
  await repository.activateGeneration(generation("old"));

  const reader = new DatabaseSync(repository.databasePath);
  try {
    reader.exec("BEGIN");
    const before = reader.prepare("SELECT active_generation_id AS id FROM repository_state").get() as { id: number };
    assert.equal(before.id, 1);
    await repository.activateGeneration(generation("new"));
    const during = reader.prepare("SELECT active_generation_id AS id FROM repository_state").get() as { id: number };
    assert.equal(during.id, 1);
    reader.exec("COMMIT");
  } finally {
    reader.close();
  }
  assert.equal((await repository.loadActive())?.generation, 2);
});

test("a second writer fails with INDEX_BUSY after the bounded busy timeout", async (context) => {
  const root = await createTemporaryDirectory("sqlite-writer-writer");
  context.after(() => removeTemporaryDirectory(root));
  const repository = new SqliteIndexRepository(root, { busyTimeoutMs: 25 });
  await repository.activateGeneration(generation("active"));

  const holder = new DatabaseSync(repository.databasePath, { timeout: 25 });
  try {
    holder.exec("BEGIN IMMEDIATE");
    await assert.rejects(repository.activateGeneration(generation("contender")), (error: unknown) => {
      return error instanceof Error && "code" in error && error.code === "INDEX_BUSY";
    });
    holder.exec("ROLLBACK");
  } finally {
    holder.close();
  }
  assert.equal((await repository.loadActive())?.generation, 1);
});
