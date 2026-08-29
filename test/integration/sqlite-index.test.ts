import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { SqliteIndexRepository, type SqliteIndexWritePoint } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import type { NewIndexGeneration } from "../../src/core/repository-index.js";
import {
  REPOSITORY_GRAPH_SCHEMA_VERSION,
  REPOSITORY_GRAPH_VERSION,
  createGraphEdge,
  unavailableGitSignals,
} from "../../src/core/repository-graph.js";
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

function graphGeneration(label: string): NewIndexGeneration {
  const base = generation(label);
  return {
    ...base,
    graph: {
      schemaVersion: REPOSITORY_GRAPH_SCHEMA_VERSION,
      version: REPOSITORY_GRAPH_VERSION,
      resolvedImports: [{
        sourcePath: `src/${label}.ts`,
        importOrdinal: 0,
        moduleSpecifier: "./dependency.js",
        status: "unresolved",
        targetPath: null,
        candidates: [],
        evidence: ["fixture unresolved import"],
      }],
      edges: [],
      git: unavailableGitSignals("Git fixture unavailable."),
    },
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

test("opens a Phase 2 schema safely and marks its active snapshot as graphless until reindex", async (context) => {
  const root = await createTemporaryDirectory("sqlite-phase2-migration");
  context.after(() => removeTemporaryDirectory(root));
  const stateDirectory = join(root, ".contextforge");
  await mkdir(stateDirectory);
  const databasePath = join(stateDirectory, "index.sqlite");
  const legacy = new DatabaseSync(databasePath);
  try {
    legacy.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE repository_state (singleton_id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, active_generation_id INTEGER NULL) STRICT;
      CREATE TABLE index_generation (
        id INTEGER PRIMARY KEY, status TEXT NOT NULL, analysis_version TEXT NOT NULL, created_at TEXT NOT NULL,
        completed_at TEXT NULL, file_count INTEGER NOT NULL DEFAULT 0, symbol_count INTEGER NOT NULL DEFAULT 0,
        import_count INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE indexed_file (
        generation_id INTEGER NOT NULL, relative_path TEXT NOT NULL, category TEXT NOT NULL, content_status TEXT NOT NULL,
        size INTEGER NULL, mtime_ms REAL NULL, content_hash TEXT NULL, language TEXT NULL, parser_status TEXT NOT NULL,
        diagnostics_json TEXT NOT NULL, PRIMARY KEY (generation_id, relative_path)
      ) STRICT;
      CREATE TABLE symbol (
        generation_id INTEGER NOT NULL, symbol_id TEXT NOT NULL, file_path TEXT NOT NULL, name TEXT NOT NULL,
        qualified_name TEXT NOT NULL, kind TEXT NOT NULL, parent_symbol_id TEXT NULL, exported INTEGER NULL,
        is_public INTEGER NULL, language TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL,
        start_column INTEGER NOT NULL, end_column INTEGER NOT NULL, PRIMARY KEY (generation_id, symbol_id)
      ) STRICT;
      CREATE TABLE import_record (
        generation_id INTEGER NOT NULL, file_path TEXT NOT NULL, ordinal INTEGER NOT NULL, module_specifier TEXT NOT NULL,
        kind TEXT NOT NULL, names_json TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL,
        start_column INTEGER NOT NULL, end_column INTEGER NOT NULL, PRIMARY KEY (generation_id, file_path, ordinal)
      ) STRICT;
      INSERT INTO repository_state VALUES (1, 1, 1);
      INSERT INTO index_generation VALUES (1, 'COMPLETE', 'tree-sitter-v1', '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z', 0, 0, 0);
    `);
  } finally {
    legacy.close();
  }

  const repository = new SqliteIndexRepository(root);
  const active = await repository.loadActive();
  assert.equal(active?.generation, 1);
  assert.equal(active?.graph, null);
  let migrated = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const state = migrated.prepare("SELECT schema_version AS version FROM repository_state").get() as { version: number };
    assert.equal(state.version, 1);
  } finally {
    migrated.close();
  }
  await repository.activateGeneration(generation("migrated"));
  migrated = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const state = migrated.prepare("SELECT schema_version AS version FROM repository_state").get() as { version: number };
    assert.equal(state.version, 2);
  } finally {
    migrated.close();
  }
});

test("rejects an invalid dangling graph before activation and preserves the prior graph snapshot", async (context) => {
  const root = await createTemporaryDirectory("sqlite-invalid-graph");
  context.after(() => removeTemporaryDirectory(root));
  const repository = new SqliteIndexRepository(root);
  await repository.activateGeneration(graphGeneration("stable"));
  const invalid = graphGeneration("invalid");
  const invalidGraph = invalid.graph;
  assert.ok(invalidGraph);
  await assert.rejects(
    repository.activateGeneration({
      ...invalid,
      graph: {
        ...invalidGraph,
        edges: [createGraphEdge("FILE_IMPORTS_FILE", "src/invalid.ts", "src/missing.ts", 1, "structural", ["fabricated edge"])],
      },
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INDEX",
  );
  const active = await repository.loadActive();
  assert.equal(active?.generation, 1);
  assert.equal(active?.files[0]?.relativePath, "src/stable.ts");
  assert.deepEqual(active?.graph?.edges, []);
});
