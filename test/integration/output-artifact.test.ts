import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { FileSystemOutputArtifactWriter } from "../../src/adapters/filesystem/output-artifact-writer.js";
import { ContextForgeError } from "../../src/core/errors.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

test("atomic output publishes complete bytes outside a repository and refuses overwrite", async (context) => {
  const root = await createTemporaryDirectory("pack-output");
  context.after(() => removeTemporaryDirectory(root));
  const output = join(root, "outside", "context.md");
  await writeFixture(root, "outside/.keep", "");
  const writer = new FileSystemOutputArtifactWriter();
  await writer.writeExclusive(output, "# complete\n");
  assert.equal(await readFile(output, "utf8"), "# complete\n");
  await assert.rejects(
    writer.writeExclusive(output, "replacement"),
    (error: unknown) => error instanceof ContextForgeError && error.code === "OUTPUT_EXISTS",
  );
  assert.equal(await readFile(output, "utf8"), "# complete\n");
});

test("publish failure leaves no final or temporary partial artifact", async (context) => {
  const root = await createTemporaryDirectory("pack-output-failure");
  context.after(() => removeTemporaryDirectory(root));
  const output = join(root, "context.json");
  const writer = new FileSystemOutputArtifactWriter(() => {
    const error = new Error("simulated publish failure") as NodeJS.ErrnoException;
    error.code = "EIO";
    return Promise.reject(error);
  });
  await assert.rejects(
    writer.writeExclusive(output, '{"complete":true}\n'),
    (error: unknown) => error instanceof ContextForgeError && error.code === "OUTPUT_WRITE_FAILED",
  );
  const entries = await readdir(root);
  assert.deepEqual(entries, []);
});

test("missing output parent fails without creating a partial target", async (context) => {
  const root = await createTemporaryDirectory("pack-output-parent");
  context.after(() => removeTemporaryDirectory(root));
  const output = join(root, "missing", "context.md");
  await assert.rejects(
    new FileSystemOutputArtifactWriter().writeExclusive(output, "content"),
    (error: unknown) => error instanceof ContextForgeError && error.code === "OUTPUT_WRITE_FAILED",
  );
});
