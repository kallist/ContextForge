import assert from "node:assert/strict";
import test from "node:test";

import { validateTokenBudget } from "../../src/application/build-context-pack.js";
import { ContextForgeError } from "../../src/core/errors.js";
import { PACK_V1 } from "../../src/core/packing/pack-v1.js";
import { GENERIC_TOKEN_ESTIMATOR_ID, GenericTokenEstimator } from "../../src/core/token-estimation.js";

const estimator = new GenericTokenEstimator();

test("generic-v1 is deterministic and applies its documented conservative byte formula", () => {
  assert.equal(estimator.id, GENERIC_TOKEN_ESTIMATOR_ID);
  assert.equal(estimator.version, "1.0");
  assert.equal(estimator.estimate(""), 0);
  assert.equal(estimator.estimate("abc"), 2);
  assert.equal(estimator.estimate("a\nb"), 3);
  assert.equal(estimator.estimate("a\r\nb"), estimator.estimate("a\nb"));
  assert.equal(estimator.estimate("中"), 3);
  assert.equal(estimator.estimate("😀"), 3);
  assert.equal(estimator.estimate("MemoryService记忆"), estimator.estimate("MemoryService记忆"));
});

test("generic-v1 handles representative prose, code, JSON, Markdown, config, whitespace, and large input", () => {
  const fixtures = [
    "Fix the race where memory remains enabled after a run.",
    "export class MemoryService { finalizeRun(): boolean { return true; } }",
    "def finalize_run(memory_enabled: bool) -> bool:\n    return memory_enabled\n",
    '{"event":"run.completed","status":409}',
    "# Design\n\n## Concurrency\n\nUse `BEGIN IMMEDIATE`.\n",
    "compilerOptions:\n  strict: true\n",
    "修复 MemoryService 在禁用后仍写入记忆的问题 😀",
    "veryLongIdentifierWithoutAnySeparatorsAtAll1234567890",
    " \t \n\n    \n",
    "const minified=()=>({a:1,b:2,c:[3,4,5]});",
    "x".repeat(2_000_000),
  ];
  for (const fixture of fixtures) {
    const first = estimator.estimate(fixture);
    assert.ok(first > 0);
    assert.equal(estimator.estimate(fixture), first);
  }
});

test("budget validation accepts bounded safe integers and rejects unsafe values", () => {
  validateTokenBudget(1);
  validateTokenBudget(16_000);
  validateTokenBudget(PACK_V1.maximumBudget);
  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
    assert.throws(
      () => {
        validateTokenBudget(invalid);
      },
      (error: unknown) => error instanceof ContextForgeError && error.code === "INVALID_BUDGET",
    );
  }
});
