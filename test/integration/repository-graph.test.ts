import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository, type SqliteIndexWritePoint } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildIndex } from "../../src/application/build-index.js";
import { inspectRepositoryGraph } from "../../src/application/inspect-repository-graph.js";
import type { GraphEdge, ResolvedImport } from "../../src/core/repository-graph.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

const scanner = new FileSystemRepositoryScanner();
const sourceReader = new FileSystemRepositorySourceReader();

function factory(root: string): SqliteIndexRepository {
  return new SqliteIndexRepository(root);
}

function resolutionFor(resolutions: readonly ResolvedImport[], sourcePath: string, moduleSpecifier: string): ResolvedImport {
  const found = resolutions.find((item) => item.sourcePath === sourcePath && item.moduleSpecifier === moduleSpecifier);
  assert.ok(found, `missing resolution for ${sourcePath}: ${moduleSpecifier}`);
  return found;
}

function relation(edges: readonly GraphEdge[], kind: GraphEdge["kind"], sourcePath: string, targetPath: string): GraphEdge | undefined {
  return edges.find((edge) => edge.kind === kind && edge.sourcePath === sourcePath && edge.targetPath === targetPath);
}

test("builds one durable explainable graph for TypeScript, Python, tests, and documentation", async (context) => {
  const root = await createTemporaryDirectory("repository-graph");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/foo.ts", "export const foo = true;\n");
  await writeFixture(root, "src/bar.ts", "export const bar = true;\n");
  await writeFixture(root, "src/dir/index.ts", "export const directory = true;\n");
  await writeFixture(root, "src/ambiguous.ts", "export const ambiguousFile = true;\n");
  await writeFixture(root, "src/ambiguous/index.ts", "export const ambiguousIndex = true;\n");
  await writeFixture(
    root,
    "src/main.ts",
    [
      'import { foo } from "./foo";',
      'import { foo as compiledFoo } from "./foo.js";',
      'import { directory } from "./dir";',
      'import "./ambiguous";',
      'import React from "react";',
      'import "./missing";',
      'import "../../outside/secret.ts";',
      "export const main = foo && compiledFoo && directory && React;",
      "",
    ].join("\n"),
  );
  await writeFixture(root, "src/nested/consumer.ts", 'import { bar } from "../bar";\nexport { bar };\n');
  await writeFixture(root, "web/helper.js", "export const helper = true;\n");
  await writeFixture(root, "web/main.js", 'const helper = require("./helper");\nexport { helper };\n');
  await writeFixture(root, "web/view.jsx", 'import { helper } from "./helper.js";\nexport const View = () => helper;\n');
  await writeFixture(root, "ui/widget.tsx", "export const Widget = () => null;\n");
  await writeFixture(root, "ui/main.tsx", 'import { Widget } from "./widget.js";\nexport const MainWidget = Widget;\n');
  await writeFixture(root, "src/services/memory.ts", "export class MemoryService { finalizeRun() { return true; } }\n");
  await writeFixture(root, "src/services/cache.ts", "export const cache = true;\n");
  await writeFixture(root, "src/auth/user.ts", "export class User {}\n");
  await writeFixture(root, "src/admin/user.ts", "export class User {}\n");
  await writeFixture(root, "tests/memory.test.ts", 'import { MemoryService } from "../src/services/memory.js";\nnew MemoryService();\n');
  await writeFixture(root, "tests/services/cache.test.ts", "export const verifiesCache = true;\n");
  await writeFixture(root, "tests/user.test.ts", "export const unrelatedUserTest = true;\n");
  await writeFixture(root, "tests/external.test.ts", 'import { MemoryService } from "external-memory";\nexport { MemoryService };\n');
  await writeFixture(root, "root_relative.py", "from . import root_sibling\n");
  await writeFixture(root, "root_sibling.py", "VALUE = 1\n");
  await writeFixture(root, "pkg/__init__.py", "\n");
  await writeFixture(root, "pkg/models.py", "class Run:\n    pass\n");
  await writeFixture(root, "pkg/sub/__init__.py", "\n");
  await writeFixture(root, "pkg/sub/sibling.py", "VALUE = 1\n");
  await writeFixture(root, "pkg/dual.py", "VALUE = 1\n");
  await writeFixture(root, "pkg/dual/__init__.py", "VALUE = 2\n");
  await writeFixture(
    root,
    "pkg/sub/service.py",
    [
      "import pkg.models",
      "from pkg import models",
      "from . import sibling",
      "from ..models import Run",
      "import requests",
      "import pkg.missing",
      "import pkg.dual",
      "from ....outside import secret",
      "",
    ].join("\n"),
  );
  await writeFixture(
    root,
    "docs/MEMORY_DESIGN.md",
    "# Memory\n\nSee `src/services/memory.ts` and `MemoryService`. ../../secret.txt must stay outside.\n",
  );
  await writeFixture(root, "docs/UNRELATED.md", "# Completely unrelated prose\n");
  await writeFixture(root, "docs/REFERENCE.md", "`MemoryService` is relevant, while `User` is ambiguous.\n");
  await writeFixture(root, "docs/CACHE_DESIGN.md", "# Cache behavior\n");
  await writeFixture(root, ".env.local", "GRAPH_SECRET_SENTINEL");

  const summary = await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  assert.equal(summary.generation, 1);
  assert.ok(summary.graph.resolvedImports > 0);
  const active = await factory(root).loadActive();
  assert.ok(active?.graph);
  const graph = active.graph;

  assert.equal(resolutionFor(graph.resolvedImports, "src/main.ts", "./foo").status, "resolved_internal");
  assert.equal(resolutionFor(graph.resolvedImports, "src/main.ts", "./foo.js").targetPath, "src/foo.ts");
  assert.equal(resolutionFor(graph.resolvedImports, "src/main.ts", "./dir").targetPath, "src/dir/index.ts");
  assert.equal(resolutionFor(graph.resolvedImports, "src/main.ts", "./ambiguous").status, "ambiguous");
  assert.equal(resolutionFor(graph.resolvedImports, "src/main.ts", "react").status, "external");
  assert.equal(resolutionFor(graph.resolvedImports, "src/main.ts", "./missing").status, "unresolved");
  assert.equal(resolutionFor(graph.resolvedImports, "src/main.ts", "../../outside/secret.ts").status, "unsafe");
  assert.equal(resolutionFor(graph.resolvedImports, "src/nested/consumer.ts", "../bar").targetPath, "src/bar.ts");
  assert.equal(resolutionFor(graph.resolvedImports, "web/main.js", "./helper").targetPath, "web/helper.js");
  assert.equal(resolutionFor(graph.resolvedImports, "web/view.jsx", "./helper.js").targetPath, "web/helper.js");
  assert.equal(resolutionFor(graph.resolvedImports, "ui/main.tsx", "./widget.js").targetPath, "ui/widget.tsx");

  assert.equal(resolutionFor(graph.resolvedImports, "pkg/sub/service.py", "pkg.models").targetPath, "pkg/models.py");
  assert.equal(resolutionFor(graph.resolvedImports, "pkg/sub/service.py", "pkg").targetPath, "pkg/models.py");
  assert.equal(resolutionFor(graph.resolvedImports, "pkg/sub/service.py", ".").targetPath, "pkg/sub/sibling.py");
  assert.equal(resolutionFor(graph.resolvedImports, "pkg/sub/service.py", "..models").targetPath, "pkg/models.py");
  assert.equal(resolutionFor(graph.resolvedImports, "pkg/sub/service.py", "requests").status, "external");
  assert.equal(resolutionFor(graph.resolvedImports, "pkg/sub/service.py", "pkg.missing").status, "unresolved");
  assert.equal(resolutionFor(graph.resolvedImports, "pkg/sub/service.py", "pkg.dual").status, "ambiguous");
  assert.equal(resolutionFor(graph.resolvedImports, "pkg/sub/service.py", "....outside").status, "unsafe");
  assert.equal(resolutionFor(graph.resolvedImports, "root_relative.py", ".").status, "unresolved");

  assert.equal(relation(graph.edges, "FILE_IMPORTS_FILE", "src/main.ts", "src/foo.ts")?.confidence, 1);
  assert.equal(relation(graph.edges, "TEST_RELATES_TO_FILE", "tests/memory.test.ts", "src/services/memory.ts")?.confidence, 1);
  assert.equal(relation(graph.edges, "TEST_RELATES_TO_FILE", "tests/services/cache.test.ts", "src/services/cache.ts")?.confidence, 0.86);
  assert.equal(graph.edges.some((edge) => edge.sourcePath === "tests/user.test.ts" && edge.kind === "TEST_RELATES_TO_FILE"), false);
  assert.equal(graph.edges.some((edge) => edge.sourcePath === "tests/external.test.ts" && edge.kind === "TEST_RELATES_TO_FILE"), false);
  assert.equal(relation(graph.edges, "DOCUMENT_RELATES_TO_FILE", "docs/MEMORY_DESIGN.md", "src/services/memory.ts")?.confidence, 1);
  assert.equal(relation(graph.edges, "DOCUMENT_RELATES_TO_FILE", "docs/REFERENCE.md", "src/services/memory.ts")?.confidence, 0.9);
  assert.equal(relation(graph.edges, "DOCUMENT_RELATES_TO_FILE", "docs/CACHE_DESIGN.md", "src/services/cache.ts")?.confidence, 0.6);
  assert.equal(graph.edges.some((edge) => edge.sourcePath === "docs/REFERENCE.md" && /src\/(?:auth|admin)\/user\.ts/u.test(edge.targetPath)), false);
  assert.equal(graph.edges.some((edge) => edge.sourcePath === "docs/UNRELATED.md" && edge.kind === "DOCUMENT_RELATES_TO_FILE"), false);
  assert.equal(graph.edges.some((edge) => edge.targetPath.includes("secret")), false);

  const inspection = await inspectRepositoryGraph(scanner, factory, root, "src/services/memory.ts");
  assert.deepEqual(inspection.tests.map(({ target }) => target), ["tests/memory.test.ts"]);
  assert.deepEqual(inspection.documentation.map(({ target }) => target), ["docs/MEMORY_DESIGN.md", "docs/REFERENCE.md"]);
  assert.deepEqual(inspection.symbolParents, [{ child: "MemoryService.finalizeRun", parent: "MemoryService" }]);
  assert.deepEqual(inspection, await inspectRepositoryGraph(scanner, factory, root, "src/services/memory.ts"));

  const repeated = await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  assert.equal(repeated.generation, 2);
  const repeatedGraph = (await factory(root).loadActive())?.graph;
  assert.ok(repeatedGraph);
  assert.deepEqual(repeatedGraph.edges, graph.edges);
  assert.deepEqual(repeatedGraph.resolvedImports, graph.resolvedImports);

  const database = await readFile(factory(root).databasePath);
  assert.equal(database.includes(Buffer.from("GRAPH_SECRET_SENTINEL")), false);
  assert.equal(database.includes(Buffer.from("../../secret.txt must stay outside")), false);
  const sqlite = new DatabaseSync(factory(root).databasePath, { readOnly: true });
  try {
    const integrity = sqlite.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    assert.equal(integrity.integrity_check, "ok");
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    sqlite.close();
  }
});

test("incremental graph rebuild removes stale and deleted relationships without reparsing unchanged files", async (context) => {
  const root = await createTemporaryDirectory("incremental-graph");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/A.ts", 'import { B } from "./B.js";\nexport const A = B;\n');
  await writeFixture(root, "src/B.ts", "export const B = true;\n");
  await writeFixture(root, "src/C.ts", "export const C = true;\n");
  await writeFixture(root, "tests/A.test.ts", 'import { A } from "../src/A.js";\nexport { A };\n');

  const first = await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  assert.equal(first.generation, 1);
  await writeFile(join(root, "src", "A.ts"), 'import { C } from "./C.js";\nexport const A = C;\n', "utf8");
  await rm(join(root, "tests", "A.test.ts"));
  await writeFixture(root, "docs/A_DESIGN.md", "See `src/A.ts`.\n");

  const second = await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  assert.equal(second.generation, 2);
  assert.ok(second.files.reused >= 2);
  const graph = (await factory(root).loadActive())?.graph;
  assert.ok(graph);
  assert.ok(relation(graph.edges, "FILE_IMPORTS_FILE", "src/A.ts", "src/C.ts"));
  assert.equal(relation(graph.edges, "FILE_IMPORTS_FILE", "src/A.ts", "src/B.ts"), undefined);
  assert.equal(graph.edges.some((edge) => edge.sourcePath === "tests/A.test.ts"), false);
  assert.ok(relation(graph.edges, "DOCUMENT_RELATES_TO_FILE", "docs/A_DESIGN.md", "src/A.ts"));
});

for (const failurePoint of [
  "after_resolved_imports",
  "after_test_relationships",
  "after_documentation_relationships",
  "before_activation",
] as const) {
  test(`graph build failure at ${failurePoint} leaves the prior active snapshot complete`, async (context) => {
    const root = await createTemporaryDirectory(`graph-rollback-${failurePoint}`);
    context.after(() => removeTemporaryDirectory(root));
    await writeFixture(root, "src/dependency.ts", "export const dependency = true;\n");
    await writeFixture(root, "src/main.ts", 'import { dependency } from "./dependency.js";\nexport { dependency };\n');
    await writeFixture(root, "tests/main.test.ts", 'import "../src/main.js";\n');
    await writeFixture(root, "docs/MAIN_DESIGN.md", "See `src/main.ts`.\n");
    await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });

    const failingFactory = (repositoryRoot: string): SqliteIndexRepository =>
      new SqliteIndexRepository(repositoryRoot, {
        testHooks: {
          onWritePoint(point: SqliteIndexWritePoint) {
            if (point === failurePoint) throw new Error(`injected ${point}`);
          },
        },
      });
    await assert.rejects(
      buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), failingFactory, { repositoryPath: root }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INDEX",
    );
    const active = await factory(root).loadActive();
    assert.equal(active?.generation, 1);
    assert.ok(active?.graph?.edges.some((edge) => edge.sourcePath === "src/main.ts" && edge.targetPath === "src/dependency.ts"));
  });
}
