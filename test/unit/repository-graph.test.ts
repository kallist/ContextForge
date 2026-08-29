import assert from "node:assert/strict";
import test from "node:test";

import {
  createGraphEdge,
  fileGraphNode,
  isNormalizedRepositoryPath,
  symbolGraphNode,
} from "../../src/core/repository-graph.js";

test("uses deterministic repository-relative File, Symbol, and edge identities", () => {
  assert.deepEqual(fileGraphNode("src/service.ts"), {
    kind: "FILE",
    id: "file:src/service.ts",
    relativePath: "src/service.ts",
  });
  assert.deepEqual(symbolGraphNode("sym_123", "src/service.ts"), {
    kind: "SYMBOL",
    id: "sym_123",
    symbolId: "sym_123",
    relativePath: "src/service.ts",
  });
  const first = createGraphEdge("FILE_IMPORTS_FILE", "src/main.ts", "src/service.ts", 1, "structural", ["direct import"]);
  const repeated = createGraphEdge("FILE_IMPORTS_FILE", "src/main.ts", "src/service.ts", 1, "structural", ["direct import"]);
  assert.deepEqual(repeated, first);
  assert.match(first.id, /^edge_[0-9a-f]{24}$/u);
  assert.equal(first.id.includes("C:"), false);
});

test("rejects absolute, traversing, and non-normalized graph paths", () => {
  assert.equal(isNormalizedRepositoryPath("src/service.ts"), true);
  assert.equal(isNormalizedRepositoryPath("../service.ts"), false);
  assert.equal(isNormalizedRepositoryPath("src/../service.ts"), false);
  assert.equal(isNormalizedRepositoryPath("C:/service.ts"), false);
  assert.equal(isNormalizedRepositoryPath("/service.ts"), false);
  assert.equal(isNormalizedRepositoryPath("src\\service.ts"), false);
});
