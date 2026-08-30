import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildIndex } from "../../src/application/build-index.js";
import { searchRepository } from "../../src/application/search-repository.js";
import { formatSearchText } from "../../src/cli/format.js";
import { ContextForgeError } from "../../src/core/errors.js";
import { MAXIMUM_TASK_BYTES } from "../../src/core/task-query.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

test("task input stays data, terminal rendering removes controls, and secret files remain unsearchable", async (context) => {
  const root = await createTemporaryDirectory("search-security");
  context.after(() => removeTemporaryDirectory(root));
  const sentinel = "CONTEXTFORGE_PRIVATE_PASSWORD_SENTINEL";
  await writeFixture(root, ".env.local", `PASSWORD=${sentinel}\n`);
  await writeFixture(root, "src/safe.ts", 'export const message = "ordinary password validation";\n');
  await writeFixture(root, "src/client.generated.ts", 'export const generated = "GENERATED_SENTINEL";\n');
  await writeFixture(root, "external/vendor.ts", 'export const dependency = "DEPENDENCY_SENTINEL";\n');
  await writeFixture(root, "assets/private.png", new Uint8Array([0, 1, 2, 3]));
  await writeFixture(root, "must-remain.txt", "safe\n");
  const scanner = new FileSystemRepositoryScanner();
  const sourceReader = new FileSystemRepositorySourceReader();
  const factory = (repositoryRoot: string): SqliteIndexRepository => new SqliteIndexRepository(repositoryRoot);
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });

  for (const task of ["../../outside/secret", '"; rm -rf .', "--upload-pack=evil"]) {
    const result = (await searchRepository(scanner, sourceReader, factory, { repositoryPath: root, task })).result;
    assert.equal(JSON.stringify(result).includes(sentinel), false);
    assert.equal(JSON.stringify(result).includes(".env.local"), false);
  }
  for (const excludedPath of ["src/client.generated.ts", "external/vendor.ts", "assets/private.png"]) {
    const excluded = (await searchRepository(scanner, sourceReader, factory, { repositoryPath: root, task: excludedPath })).result;
    assert.equal(excluded.candidates.some((candidate) => candidate.relativePath === excludedPath), false);
  }
  await access(join(root, "must-remain.txt"));

  const controlled = (await searchRepository(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "password\u001b[31m\u0007 validation",
  })).result;
  const text = formatSearchText(controlled);
  assert.equal(text.includes("\u001b"), false);
  assert.equal(text.includes("\u0007"), false);
  assert.equal(text.includes(sentinel), false);
  assert.equal(JSON.stringify(controlled).includes(sentinel), false);

  await assert.rejects(
    searchRepository(scanner, sourceReader, factory, { repositoryPath: root, task: "x".repeat(MAXIMUM_TASK_BYTES + 1) }),
    (error: unknown) => error instanceof ContextForgeError && error.code === "TASK_TOO_LARGE",
  );
});
