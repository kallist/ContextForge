import assert from "node:assert/strict";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { mapRepository } from "../../src/application/map-repository.js";
import { formatJson, formatText } from "../../src/cli/format.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

test("rejects a real directory symlink or Windows junction that escapes the repository", async (context) => {
  const parent = await createTemporaryDirectory("boundary");
  context.after(() => removeTemporaryDirectory(parent));
  const repository = join(parent, "repository");
  const outside = join(parent, "outside");
  const sentinel = "CONTEXTFORGE_OUTSIDE_REPOSITORY_SENTINEL";
  await writeFixture(repository, "src/main.ts", "export {};\n");
  await writeFixture(outside, "outside-secret.txt", sentinel);
  try {
    await symlink(outside, join(repository, "escape"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    assert.fail(`Security capability unavailable: could not create the required link fixture (${detail})`);
  }

  const map = await mapRepository(
    new FileSystemRepositoryScanner(),
    { repositoryPath: repository },
    "test-version",
  );
  assert.equal(map.entries.some((entry) => entry.path.startsWith("escape")), false);
  assert.equal(map.exclusions.find(({ reason }) => reason === "symlink_escape")?.count, 1);
  assert.equal(`${formatJson(map)}${formatText(map)}`.includes(sentinel), false);
});

test("does not traverse an internal directory link or loop", async (context) => {
  const repository = await createTemporaryDirectory("loop");
  context.after(() => removeTemporaryDirectory(repository));
  await writeFixture(repository, "real/file.ts", "export {};\n");
  await symlink(join(repository, "real"), join(repository, "real-link"), process.platform === "win32" ? "junction" : "dir");

  const map = await mapRepository(
    new FileSystemRepositoryScanner(),
    { repositoryPath: repository },
    "test-version",
  );
  const link = map.entries.find((entry) => entry.path === "real-link");
  assert.equal(link?.type, "symlink");
  assert.equal(link?.skipReason, "symlink_directory");
  assert.equal(map.entries.some((entry) => entry.path === "real-link/file.ts"), false);
});

test("hides a safe-looking junction whose resolved target has a sensitive name", async (context) => {
  const repository = await createTemporaryDirectory("sensitive-link");
  context.after(() => removeTemporaryDirectory(repository));
  const sentinel = "CONTEXTFORGE_LINKED_SECRET_SENTINEL";
  await writeFixture(repository, "secrets-vault/value.txt", sentinel);
  await symlink(
    join(repository, "secrets-vault"),
    join(repository, "safe-looking-link"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const map = await mapRepository(
    new FileSystemRepositoryScanner(),
    { repositoryPath: repository },
    "test-version",
  );
  assert.equal(map.entries.some((entry) => entry.path.startsWith("safe-looking-link")), false);
  assert.equal(`${formatJson(map)}${formatText(map)}`.includes(sentinel), false);
  assert.equal(map.exclusions.find(({ reason }) => reason === "sensitive")?.count, 2);
});
