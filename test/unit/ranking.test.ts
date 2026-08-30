import assert from "node:assert/strict";
import test from "node:test";

import { STRUCTURAL_V1, hubDamping, scoreEvidence } from "../../src/core/ranking/structural-v1.js";
import type { CandidateEvidence } from "../../src/core/task-retrieval.js";

function item(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return {
    kind: "SOURCE_LEXICAL",
    family: "LEXICAL",
    querySignal: "memory",
    target: "src/memory.ts",
    weight: 40,
    graphDistance: 0,
    sourceCandidate: null,
    detail: "source lexical: memory",
    ...overrides,
  };
}

test("score contributions reconstruct the raw score after family caps", () => {
  const scored = scoreEvidence([
    item({ weight: 60, querySignal: "memory" }),
    item({ weight: 60, querySignal: "disable" }),
    item({ weight: 60, querySignal: "run" }),
    item({ kind: "GIT_RECENCY", family: "GIT", querySignal: null, weight: 100, detail: "weak Git signal" }),
  ]);
  assert.equal(scored.rawScore, STRUCTURAL_V1.familyCaps.LEXICAL + STRUCTURAL_V1.familyCaps.GIT);
  assert.equal(scored.contributions.reduce((sum, contribution) => sum + contribution.value, 0), scored.rawScore);
});

test("duplicate evidence cannot repeatedly inflate a candidate", () => {
  const repeated = item();
  assert.equal(scoreEvidence([repeated, repeated, repeated]).rawScore, repeated.weight);
});

test("hub damping is deterministic and suppresses high-degree nodes", () => {
  assert.equal(hubDamping(0), 1);
  assert.equal(hubDamping(1), 1);
  assert.ok(hubDamping(10) < hubDamping(2));
  assert.ok(hubDamping(100) < 0.3);
});

test("the complete Git family cannot overtake exact identity evidence", () => {
  const strong = scoreEvidence([
    item({ kind: "EXACT_SYMBOL", family: "IDENTITY", querySignal: "MemoryService", weight: 100, detail: "exact symbol" }),
  ]).rawScore;
  const weakRecent = scoreEvidence([
    item({ weight: 20 }),
    item({ kind: "GIT_DIRTY", family: "GIT", querySignal: null, weight: 2, detail: "dirty" }),
    item({ kind: "GIT_RECENCY", family: "GIT", querySignal: null, weight: 3, detail: "recent" }),
  ]).rawScore;
  assert.ok(strong > weakRecent);
  assert.equal(weakRecent, 25);
});
