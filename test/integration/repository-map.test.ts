import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, parse } from "node:path";
import test from "node:test";

import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { mapRepository, type ScanOptions } from "../../src/application/map-repository.js";
import { formatJson, formatText } from "../../src/cli/format.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

async function mapFixture(root: string, options: ScanOptions = {}) {
  return mapRepository(new FileSystemRepositoryScanner(), { repositoryPath: root, ...options }, "test-version");
}

test("maps and classifies a real non-Git repository", async (context) => {
  const root = await createTemporaryDirectory("normal");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/main.ts", "export const answer = 42;\n");
  await writeFixture(root, "tests/main.test.ts", "export {};\n");
  await writeFixture(root, "docs/guide.md", "# Guide\n");
  await writeFixture(root, "README.md", "# Fixture\n");
  await writeFixture(root, "package.json", "{}\n");
  await writeFixture(root, "bom.txt", Uint8Array.from([0xef, 0xbb, 0xbf, 0x6f, 0x6b]));

  const map = await mapFixture(root);
  assert.equal(map.repository.kind, "directory");
  assert.equal(map.repository.root, ".");
  assert.equal(map.entries.find((entry) => entry.path === "src/main.ts")?.category, "source");
  assert.equal(map.entries.find((entry) => entry.path === "tests/main.test.ts")?.category, "test");
  assert.equal(map.entries.find((entry) => entry.path === "docs/guide.md")?.category, "documentation");
  assert.equal(map.entries.find((entry) => entry.path === "package.json")?.category, "configuration");
  assert.equal(map.entries.find((entry) => entry.path === "bom.txt")?.content, "text");
  assert.equal(map.summary.byLanguage.TypeScript, 2);
  assert.deepEqual(Object.keys(map), ["schemaVersion", "tool", "repository", "summary", "entries", "exclusions"]);
  assert.deepEqual(Object.keys(map.entries.find((entry) => entry.path === "src/main.ts") ?? {}), [
    "path",
    "type",
    "category",
    "language",
    "size",
    "content",
  ]);
  assert.ok(formatText(map).includes("ContextForge Repository Map"));
  assert.doesNotThrow(() => JSON.parse(formatJson(map)));
});

test("discovers the Git root when invoked from a nested directory", async (context) => {
  const root = await createTemporaryDirectory("git-root");
  context.after(() => removeTemporaryDirectory(root));
  await mkdir(join(root, ".git"));
  await writeFixture(root, "src/deep/main.ts", "export {};\n");

  const map = await mapFixture(join(root, "src", "deep"));
  assert.equal(map.repository.kind, "git");
  assert.ok(map.entries.some((entry) => entry.path === "src/deep/main.ts"));
  assert.equal(map.entries.some((entry) => entry.path.startsWith(".git")), false);
});

test("combines built-in, Git, nested Git, and ContextForge ignore rules", async (context) => {
  const root = await createTemporaryDirectory("ignore");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, ".gitignore", "*.log\nimportant.tmp\n");
  await writeFixture(root, ".contextforgeignore", "private/\n*.tmp\n!important.tmp\n");
  await writeFixture(root, "debug.log", "ignored\n");
  await writeFixture(root, "important.tmp", "still ignored by git\n");
  await writeFixture(root, "private/data.ts", "ignored\n");
  await writeFixture(root, "node_modules/pkg/index.js", "ignored\n");
  await writeFixture(root, "dist/output.js", "ignored\n");
  await writeFixture(root, "packages/app/.gitignore", "*.cache\n!keep.cache\n");
  await writeFixture(root, "packages/app/drop.cache", "ignored\n");
  await writeFixture(root, "packages/app/keep.cache", "kept\n");
  await writeFixture(root, "src/main.ts", "kept\n");

  const map = await mapFixture(root);
  const paths = map.entries.map((entry) => entry.path);
  assert.ok(paths.includes("src/main.ts"));
  assert.ok(paths.includes("packages/app/keep.cache"));
  for (const excluded of ["debug.log", "important.tmp", "private", "node_modules", "dist", "packages/app/drop.cache"]) {
    assert.equal(paths.includes(excluded), false, excluded);
  }
  assert.ok(map.exclusions.some(({ reason }) => reason === "ignored_builtin"));
  assert.ok(map.exclusions.some(({ reason }) => reason === "ignored_git"));
  assert.ok(map.exclusions.some(({ reason }) => reason === "ignored_contextforge"));
});

test("handles sensitive, binary, oversized, and malformed files without exposing contents", async (context) => {
  const root = await createTemporaryDirectory("content-policy");
  context.after(() => removeTemporaryDirectory(root));
  const sentinel = "CONTEXTFORGE_TEST_SECRET_DO_NOT_LEAK";
  await writeFixture(root, ".env", sentinel);
  await writeFixture(root, "private.key", sentinel);
  await writeFixture(root, "credentials-prod/config.txt", sentinel);
  await writeFixture(root, "image.unknown", Uint8Array.from([0x89, 0x00, 0x50, 0x4e, 0x47]));
  await writeFixture(root, "large.txt", "x".repeat(33));
  await writeFixture(root, "broken.txt", Uint8Array.from([0xc3, 0x28]));
  await writeFixture(root, "safe.txt", "safe\n");

  const map = await mapFixture(root, { maximumFileBytes: 32 });
  assert.equal(map.entries.find((entry) => entry.path === "image.unknown")?.content, "binary");
  assert.equal(map.entries.find((entry) => entry.path === "large.txt")?.content, "oversized");
  assert.equal(map.entries.find((entry) => entry.path === "broken.txt")?.content, "malformed");
  assert.equal(map.exclusions.find(({ reason }) => reason === "sensitive")?.count, 3);
  const serialized = `${formatJson(map)}${formatText(map)}`;
  assert.equal(serialized.includes(sentinel), false);
  assert.equal(serialized.includes(".env"), false);
  assert.equal(serialized.includes("private.key"), false);
});

test("produces byte-stable JSON for the same repository state", async (context) => {
  const root = await createTemporaryDirectory("determinism");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "zeta.py", "print('z')\n");
  await writeFixture(root, "Alpha.ts", "export {};\n");
  await writeFixture(root, "docs/中文.md", "# 文档\n");

  const first = formatJson(await mapFixture(root));
  const second = formatJson(await mapFixture(root));
  assert.equal(first, second);
  const parsed = JSON.parse(first) as { entries: { path: string }[] };
  const paths = parsed.entries.map((entry) => entry.path);
  assert.deepEqual(paths, [...paths].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
  assert.equal(first.includes("\\"), false);
});

test("rejects volume roots and reports configured traversal limits", async (context) => {
  const root = await createTemporaryDirectory("limits");
  context.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "a.txt", "a\n");
  await writeFixture(root, "b.txt", "b\n");

  await assert.rejects(
    mapFixture(root, { maximumEntries: 1 }),
    (error: unknown) => error instanceof Error && error.name === "ContextForgeError" && error.message.includes("maximum entries"),
  );
  await assert.rejects(
    mapFixture(parse(root).root),
    (error: unknown) => error instanceof Error && error.name === "ContextForgeError" && error.message.includes("filesystem volume"),
  );
});
