import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  classifyFile,
  compareNormalizedPaths,
  detectLanguage,
  isBuiltInIgnored,
  isKnownBinaryPath,
  isOversized,
  isSensitivePath,
  looksBinary,
} from "../../src/core/file-policies.js";
import { createIgnoreLayer, isIgnoredByLayers } from "../../src/core/ignore-rules.js";
import { isWithinRoot, normalizeRelativePath } from "../../src/core/path-safety.js";

test("normalizes paths and compares them without locale-dependent ordering", () => {
  assert.equal(normalizeRelativePath(join("src", "core", "map.ts")), "src/core/map.ts");
  assert.deepEqual(["b", "A", "a"].sort(compareNormalizedPaths), ["A", "a", "b"]);
});

test("enforces canonical repository boundaries", () => {
  const root = resolve("repository");
  assert.equal(isWithinRoot(root, join(root, "src", "main.ts")), true);
  assert.equal(isWithinRoot(root, resolve("repository-neighbor", "secret.txt")), false);
  assert.equal(isWithinRoot(root, root), true);
});

test("matches built-in and sensitive deny policies", () => {
  assert.equal(isBuiltInIgnored("packages/app/node_modules/pkg/index.js"), true);
  assert.equal(isBuiltInIgnored("src/distribution.ts"), false);
  for (const path of [".env", ".env.local", "private.pem", "id_rsa", "credentials.json", "secrets-prod/data.txt"]) {
    assert.equal(isSensitivePath(path), true, path);
  }
  assert.equal(isSensitivePath("src/environment.ts"), false);
});

test("classifies common languages, tests, docs, config, generated files, and binary assets", () => {
  assert.equal(detectLanguage("src/main.ts"), "TypeScript");
  assert.equal(detectLanguage("tool.py"), "Python");
  assert.equal(classifyFile("src/main.ts"), "source");
  assert.equal(classifyFile("src/main.test.ts"), "test");
  assert.equal(classifyFile("tests/test_api.py"), "test");
  assert.equal(classifyFile("docs/guide.md"), "documentation");
  assert.equal(classifyFile("package.json"), "configuration");
  assert.equal(classifyFile("src/client.generated.ts"), "generated");
  assert.equal(classifyFile("logo.png"), "binary_asset");
  assert.equal(classifyFile("mystery.data"), "unknown");
});

test("detects known and content-signaled binary files with bounded bytes", () => {
  assert.equal(isKnownBinaryPath("manual.pdf"), true);
  assert.equal(looksBinary(Uint8Array.from([0x41, 0x00, 0x42])), true);
  assert.equal(looksBinary(new TextEncoder().encode("valid UTF-8 text\n")), false);
});

test("applies the size threshold before content policy", () => {
  assert.equal(isOversized(11, 10), true);
  assert.equal(isOversized(10, 10), false);
});

test("nested ignore layers allow local negation but independent policies remain additive", () => {
  const rootRules = createIgnoreLayer("", "*.log\n!important.log\n");
  const nestedRules = createIgnoreLayer("packages/app", "*.tmp\n!keep.tmp\n");
  assert.equal(isIgnoredByLayers([rootRules], "debug.log", false), true);
  assert.equal(isIgnoredByLayers([rootRules], "important.log", false), false);
  assert.equal(isIgnoredByLayers([nestedRules], "packages/app/drop.tmp", false), true);
  assert.equal(isIgnoredByLayers([nestedRules], "packages/app/keep.tmp", false), false);

  const gitRules = createIgnoreLayer("", "important.tmp\n");
  const contextRules = createIgnoreLayer("", "*.tmp\n!important.tmp\n");
  assert.equal(isIgnoredByLayers([contextRules], "important.tmp", false), false);
  assert.equal(isIgnoredByLayers([gitRules], "important.tmp", false), true);
});
