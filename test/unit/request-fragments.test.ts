import assert from "node:assert/strict";
import test from "node:test";
import { renderContextItem, renderContextMarkdown, type ContextMarkdownInput, type RenderableContextItem } from "../../src/core/context-serialization.js";
import { createRequestFragmentRenderer } from "../../src/core/packing/request-fragments.js";
import { GenericTokenEstimator } from "../../src/core/token-estimation.js";

const item: RenderableContextItem = {
  identity: "file:source.ts", relativePath: "source.ts", role: "PRIMARY_CODE",
  lines: ["export const text = '中文 😀 ````';", "// second range", "// final"],
  ranges: [{ startLine: 1, endLine: 1, reasons: ["SYMBOL_RANGE"] }], language: "typescript", selectionReasons: [], partial: true,
};
const envelope: ContextMarkdownInput = { task: "repair 中文 ```\r\nmetadata", repositoryName: 'repo"name', generation: 1, rankingStrategy: "test", packingStrategy: "contextforge-pack-v2", tokenEstimator: "contextforge-generic-v1", tokenEstimatorVersion: "1.0", requestedBudget: 2000, gitContext: null, items: [] };

test("request fragments preserve full serialization and exact feasibility across options and metadata", () => {
  const cache = createRequestFragmentRenderer();
  const second = { ...item, identity: "file:other.ts", relativePath: "other.ts", role: "TEST" as const };
  const addedRange: RenderableContextItem = { ...item, ranges: [...item.ranges, { startLine: 3, endLine: 3, reasons: ["SYMBOL_RANGE"] }] };
  const mergedRange: RenderableContextItem = { ...item, ranges: [{ startLine: 1, endLine: 3, reasons: ["SYMBOL_RANGE"] }] };
  const estimator = new GenericTokenEstimator();
  for (const items of [[], [item], [item, second], [addedRange, second], [mergedRange], [second, item]]) {
    for (const metadata of [{}, { generation: 2, task: "different task", repositoryName: "next repository" }]) {
      const input = { ...envelope, ...metadata, items };
      const expected = renderContextMarkdown(input);
      const actual = renderContextMarkdown(input, cache.render);
      assert.equal(actual, expected);
      const boundary = estimator.estimate(expected);
      for (const budget of [boundary - 1, boundary, boundary + 1]) {
        assert.equal(estimator.estimate(actual) <= budget, estimator.estimate(expected) <= budget);
      }
    }
  }
  assert.ok(cache.counters.hits > 0);
});

test("cache identities separate files, ranges, source and metadata; requests and generations do not share state", () => {
  const cache = createRequestFragmentRenderer();
  assert.equal(cache.render(item), cache.render(item));
  assert.equal(cache.counters.renders, 1);
  const alternatives: RenderableContextItem[] = [
    { ...item, relativePath: "different.ts" },
    { ...item, ranges: [{ startLine: 2, endLine: 3, reasons: ["LEXICAL_RANGE"] }] },
    { ...item, lines: ["new generation source"] },
    { ...item, language: "python", partial: false },
    { ...item, selectionReasons: [{ kind: "EXACT_SYMBOL", detail: "direct", contribution: 1 }] },
  ];
  for (const changed of alternatives) {
    assert.equal(cache.render(changed), renderContextItem(changed));
    assert.notEqual(cache.render(changed), cache.render(item));
  }
  const next = createRequestFragmentRenderer();
  assert.equal(next.counters.entries, 0);
  assert.equal(next.render(item), renderContextItem(item));
  assert.equal(next.counters.hits, 0);
});

test("cache exhaustion recomputes exactly and bounds retained fragment memory", () => {
  const cache = createRequestFragmentRenderer();
  for (let index = 0; index < 330; index += 1) {
    const candidate = { ...item, relativePath: `source-${index}.ts` };
    assert.equal(cache.render(candidate), renderContextItem(candidate));
  }
  assert.equal(cache.counters.entries, 321);
  const large = { ...item, lines: ["x".repeat(1_048_576)] };
  assert.equal(cache.render(large), renderContextItem(large));
  assert.ok(cache.counters.characters <= 1_048_576);
});
