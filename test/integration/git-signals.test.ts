import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  ReadOnlyGitSignalsReader,
  type GitCommandRunner,
} from "../../src/adapters/git/git-signals-reader.js";
import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildIndex } from "../../src/application/build-index.js";
import { createContextForgeApplication } from "../../src/composition/contextforge-application.js";
import { indexReview } from "../../src/composition/contextforge-review.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

function git(root: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: root, encoding: "utf8", windowsHide: true, shell: false }, (error, stdout) => {
      if (error !== null) reject(error instanceof Error ? error : new Error("Git fixture command failed."));
      else resolve(stdout);
    });
  });
}

test("reads bounded real Git history and dirty statuses without changing the worktree", async (context) => {
  const root = await createTemporaryDirectory("git-signals");
  context.after(() => removeTemporaryDirectory(root));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "contextforge@example.invalid"]);
  await git(root, ["config", "user.name", "ContextForge Tests"]);
  await writeFixture(root, "tracked.ts", "export const tracked = 1;\n");
  await writeFixture(root, "deleted.ts", "export const deleted = true;\n");
  await git(root, ["add", "--", "tracked.ts", "deleted.ts"]);
  await git(root, ["commit", "-m", "initial"]);
  await writeFile(join(root, "tracked.ts"), "export const tracked = 2;\n", "utf8");
  await git(root, ["add", "--", "tracked.ts"]);
  await git(root, ["commit", "-m", "second"]);

  await writeFile(join(root, "tracked.ts"), "export const tracked = 3;\n", "utf8");
  await writeFixture(root, "untracked.ts", "export const untracked = true;\n");
  await writeFixture(root, "added.ts", "export const added = true;\n");
  await writeFixture(root, "--upload-pack=not-a-command.ts", "export const safe = true;\n");
  await git(root, ["add", "--", "added.ts"]);
  await rm(join(root, "deleted.ts"));

  const before = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const signals = await new ReadOnlyGitSignalsReader({ recentCommitLimit: 20 }).inspect(root, [
    "--upload-pack=not-a-command.ts",
    "added.ts",
    "deleted.ts",
    "tracked.ts",
    "untracked.ts",
  ]);
  const after = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  assert.equal(after, before);
  assert.equal(signals.status, "available");
  if (signals.status !== "available") return;
  assert.equal(signals.branch, "main");
  assert.match(signals.head ?? "", /^[0-9a-f]{40,64}$/u);
  const byPath = new Map(signals.files.map((file) => [file.relativePath, file]));
  assert.equal(byPath.get("tracked.ts")?.workingTreeStatus, "modified");
  assert.equal(byPath.get("tracked.ts")?.recentCommitCount, 2);
  assert.match(byPath.get("tracked.ts")?.lastChangedCommit ?? "", /^[0-9a-f]{40,64}$/u);
  assert.equal(byPath.get("added.ts")?.workingTreeStatus, "added");
  assert.equal(byPath.get("untracked.ts")?.workingTreeStatus, "untracked");
  assert.equal(byPath.get("deleted.ts")?.workingTreeStatus, "deleted");
  assert.equal(byPath.get("--upload-pack=not-a-command.ts")?.workingTreeStatus, "untracked");
});

test("Git adapter failure degrades to unavailable", async () => {
  const runner: GitCommandRunner = {
    run: () => Promise.reject(new Error("git executable unavailable")),
  };
  const signals = await new ReadOnlyGitSignalsReader({ runner, recentCommitLimit: 7 }).inspect("C:/not-used", ["src/main.ts"]);
  assert.equal(signals.status, "unavailable");
  assert.equal(signals.recentCommitLimit, 7);
  assert.deepEqual(signals.files, []);
});

test("a deleted previously indexed file remains a generation-bound Git signal without becoming a current graph node", async (context) => {
  const root = await createTemporaryDirectory("git-deleted-persistence");
  context.after(() => removeTemporaryDirectory(root));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "contextforge@example.invalid"]);
  await git(root, ["config", "user.name", "ContextForge Tests"]);
  await writeFixture(root, "src/deleted.ts", "export const deleted = true;\n");
  await writeFixture(root, "src/current.ts", "export const current = true;\n");
  await git(root, ["add", "--", "src/deleted.ts", "src/current.ts"]);
  await git(root, ["commit", "-m", "initial"]);
  const factory = (repositoryRoot: string): SqliteIndexRepository => new SqliteIndexRepository(repositoryRoot);
  const dependencies = [
    new FileSystemRepositoryScanner(),
    new FileSystemRepositorySourceReader(),
    new ReadOnlyGitSignalsReader(),
  ] as const;
  await buildIndex(dependencies[0], dependencies[1], new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root }, dependencies[2]);

  await rm(join(root, "src", "deleted.ts"));
  await buildIndex(dependencies[0], dependencies[1], new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root }, dependencies[2]);
  const active = await factory(root).loadActive();
  assert.equal(active?.files.some((file) => file.relativePath === "src/deleted.ts"), false);
  assert.equal(
    active?.graph?.git.files.find((file) => file.relativePath === "src/deleted.ts")?.workingTreeStatus,
    "deleted",
  );
});

test("rename signals are generation-bound and a clean round trip does not retain the obsolete path", async (context) => {
  const root = await createTemporaryDirectory("git-rename-round-trip");
  context.after(() => removeTemporaryDirectory(root));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "contextforge@example.invalid"]);
  await git(root, ["config", "user.name", "ContextForge Tests"]);
  await writeFixture(root, ".gitignore", ".contextforge/\n");
  await writeFixture(root, "src/A.ts", "export const value = 1;\n");
  await git(root, ["add", "--", ".gitignore", "src/A.ts"]);
  await git(root, ["commit", "-m", "initial"]);

  const app = await createContextForgeApplication(root);
  assert.equal((await app.index()).generation, 1);
  await git(root, ["mv", "--", "src/A.ts", "src/B.ts"]);
  const renamed = await new ReadOnlyGitSignalsReader().inspect(root, [".gitignore", "src/A.ts", "src/B.ts"]);
  assert.equal(renamed.status, "available");
  if (renamed.status !== "available") return;
  assert.equal(renamed.files.find((file) => file.relativePath === "src/A.ts")?.workingTreeStatus, "deleted");
  assert.equal(renamed.files.find((file) => file.relativePath === "src/B.ts")?.workingTreeStatus, "renamed");
  assert.equal((await indexReview(root)).generation, 2);

  await git(root, ["mv", "--", "src/B.ts", "src/A.ts"]);
  assert.equal(await git(root, ["status", "--porcelain=v1"]), "");
  assert.equal(await readFile(join(root, "src", "A.ts"), "utf8"), "export const value = 1;\n");

  await assert.doesNotReject(async () => {
    assert.equal((await app.index()).generation, 3);
  });
  assert.equal((await app.status()).indexStatus, "CURRENT");
  const restarted = await createContextForgeApplication(root);
  assert.equal((await restarted.status()).indexStatus, "CURRENT");
  assert.equal((await restarted.index()).generation, 4);

  const active = await new SqliteIndexRepository(root).loadActive();
  assert.deepEqual(active?.files.map((file) => file.relativePath), [".gitignore", "src/A.ts"]);
  assert.deepEqual(active?.graph?.git.files.map((file) => file.relativePath), [".gitignore", "src/A.ts"]);
});

test("public indexing refreshes imports across multiple rename generations without stale path leakage", async (context) => {
  const root = await createTemporaryDirectory("git-rename-generations");
  context.after(() => removeTemporaryDirectory(root));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "contextforge@example.invalid"]);
  await git(root, ["config", "user.name", "ContextForge Tests"]);
  await writeFixture(root, ".gitignore", ".contextforge/\n");
  await writeFixture(root, "src/A.ts", "export const value = 1;\n");
  await writeFixture(root, "src/consumer.ts", "import { value } from './A.js';\nexport const result = value;\n");
  await git(root, ["add", "--", ".gitignore", "src/A.ts", "src/consumer.ts"]);
  await git(root, ["commit", "-m", "initial"]);
  const app = await createContextForgeApplication(root);
  assert.equal((await app.index()).generation, 1);

  for (const [from, to, generation] of [["A", "B", 2], ["B", "C", 3]] as const) {
    await git(root, ["mv", "--", `src/${from}.ts`, `src/${to}.ts`]);
    await writeFile(join(root, "src", "consumer.ts"), `import { value } from './${to}.js';\nexport const result = value;\n`, "utf8");
    assert.equal((await app.index()).generation, generation);
    const active = await new SqliteIndexRepository(root).loadActive();
    assert.equal(active?.graph?.resolvedImports.find((record) => record.sourcePath === "src/consumer.ts")?.targetPath, `src/${to}.ts`);
  }

  await git(root, ["mv", "--", "src/C.ts", "src/A.ts"]);
  await writeFile(join(root, "src", "consumer.ts"), "import { value } from './A.js';\nexport const result = value;\n", "utf8");
  assert.equal(await git(root, ["status", "--porcelain=v1"]), "");
  assert.equal((await app.index()).generation, 4);
  assert.equal((await app.status()).indexStatus, "CURRENT");
  const active = await new SqliteIndexRepository(root).loadActive();
  assert.equal(active?.graph?.resolvedImports.find((record) => record.sourcePath === "src/consumer.ts")?.targetPath, "src/A.ts");
  assert.equal(active?.graph?.git.files.some((file) => file.relativePath === "src/B.ts" || file.relativePath === "src/C.ts"), false);
});
