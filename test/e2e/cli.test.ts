import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
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
