import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTask } from "../../src/core/task-analysis-v2.js";
import { buildPackContextPlan, type CandidateRoles, type PlanRole } from "../../src/core/packing/context-plan.js";
import { PACK_V2, selectPlanAwarePack, type PreparedPackCandidate } from "../../src/core/packing/pack-v2.js";

function candidate(path: string, rank: number, roles: readonly PlanRole[], tokens = 100, classification: Partial<CandidateRoles> = {}): PreparedPackCandidate {
  return { path, rank, classification: { roles, strongPrimary: roles.includes("PRIMARY"), facet: roles.includes("VALIDATION") ? "VALIDATION" : roles.includes("SUPPORT") ? "DOCUMENTATION" : "IMPLEMENTATION", directness: roles.includes("PRIMARY") ? "OWNED_SYMBOL" : "INDIRECT", reasons: [], ...classification }, preferred: 0, options: [{ ranges: [{ startLine: 1, endLine: 5, reasons: ["SYMBOL_RANGE"] }], tokens, wholeFile: false }] };
}
function select(candidates: readonly PreparedPackCandidate[], budget: number, task = "fix transaction race") {
  const byPath = new Map(candidates.map((item) => [item.path, item]));
  return selectPlanAwarePack(candidates, buildPackContextPlan(analyzeTask(task)), budget, (levels) => 50 + [...levels].reduce((sum, [path, level]) => sum + (byPath.get(path)?.options[level]?.tokens ?? 0), 0));
}

test("compact direct implementation survives a large weaker candidate offering only novel support", () => {
  const selectedValidation = candidate("checks/behavior.ts", 1, ["PRIMARY", "VALIDATION", "IMPACT"], 200);
  const directImplementation = candidate("source/action.ts", 2, ["PRIMARY", "IMPACT"], 300);
  const secondaryGuide = candidate("notes/background.md", 9, ["PRIMARY", "SUPPORT"], 1600);
  const result = select([selectedValidation, directImplementation, secondaryGuide], 2000, "fix broken behavior");
  assert.ok(result.levels.has(directImplementation.path), "A fitting higher-ranked direct implementation must not lose to role novelty.");
  assert.ok(result.levels.has(selectedValidation.path));
  assert.ok(!result.levels.has(secondaryGuide.path));
});

test("packing plans reuse task modes/actions and omit task paths, values, and signal IDs", () => {
  for (const task of ["fix transaction race", "test broken assertion", "refactor service", "change configuration defaults", "understand architecture", "something"]) {
    const analysis = analyzeTask(task);
    const plan = buildPackContextPlan(analysis);
    assert.deepEqual(plan, buildPackContextPlan(analysis));
    assert.equal(plan.strategy, "contextforge-pack-plan-v1");
    assert.equal(plan.roles.length, 4);
    assert.deepEqual(plan, buildPackContextPlan({ ...analysis, task: "C:/private/project/secret.ts", signals: [] }));
  }
  assert.equal(buildPackContextPlan(analyzeTask("test failing assertion")).roles.find((item) => item.role === "VALIDATION")?.priority, "REQUIRED");
  assert.equal(buildPackContextPlan(analyzeTask("refactor transaction")).roles.find((item) => item.role === "IMPACT")?.priority, "REQUIRED");
  assert.equal(buildPackContextPlan(analyzeTask("understand architecture")).roles.find((item) => item.role === "SUPPORT")?.priority, "HIGH");
});

test("unused role opportunities are borrowed globally beyond V1's six-primary quota", () => {
  const candidates = Array.from({ length: 10 }, (_, index) => candidate(`source-${index}`, index + 1, ["PRIMARY"]));
  const result = select(candidates, 1100);
  assert.equal(result.levels.size, 10);
  assert.equal(result.drops.length, 0);
  assert.equal(result.events.filter((item) => item.phase === "GLOBAL").length, 9);
});

test("primary survives a test-heavy plan and multi-role context is charged once", () => {
  const candidates = [candidate("test", 1, ["VALIDATION"], 50), candidate("target", 2, ["PRIMARY", "IMPACT"], 200), candidate("support", 3, ["SUPPORT"], 40)];
  const result = select(candidates, 300, "test failure");
  assert.equal(result.anchor, "target");
  assert.deepEqual([...result.levels.keys()], ["target", "test"]);
  assert.equal(result.events.at(-1)?.cumulativeTokens, 300);
  assert.equal(result.drops[0]?.reason, "GLOBAL_BUDGET");
});

test("tiny budgets skip an unfit giant anchor and retain the strongest fitting compact target", () => {
  const result = select([candidate("giant", 1, ["PRIMARY"], 5000), candidate("compact", 2, ["PRIMARY"], 100)], 150);
  assert.equal(result.anchor, "compact");
  assert.equal(result.levels.size, 1);
  assert.equal(select([candidate("compact", 1, ["PRIMARY"], 100)], 149).levels.size, 0);
});

test("safety cap is global, bounded, and distinct from global-budget failure", () => {
  const candidates = Array.from({ length: 30 }, (_, index) => candidate(`source-${index}`, index + 1, ["PRIMARY"]));
  const result = select(candidates, 10000);
  assert.equal(result.levels.size, PACK_V2.maximumFiles);
  assert.ok(result.drops.every((item) => item.reason === "SAFETY_LIMIT"));
});

test("selection is stable under incidental input ordering and increasing budgets preserve the anchor", () => {
  const candidates = [candidate("a", 1, ["PRIMARY"]), candidate("b", 2, ["VALIDATION"]), candidate("c", 3, ["IMPACT"])];
  for (const budget of [149, 150, 151, 250, 350, 10000]) {
    const result = select(candidates, budget);
    assert.deepEqual(result, select([...candidates].reverse(), budget));
    assert.ok(result.events.every((event) => event.cumulativeTokens <= budget));
    if (budget >= 150) assert.ok(result.levels.has("a"));
  }
});

test("large support remains useful once stronger direct context fits", () => {
  const candidates = [candidate("check", 1, ["PRIMARY", "VALIDATION"], 200), candidate("operation", 2, ["PRIMARY", "IMPACT"], 300), candidate("guide", 9, ["PRIMARY", "SUPPORT"], 1600, { directness: "VERIFIED_LEXICAL" })];
  const result = select(candidates, 3000, "fix broken behavior");
  assert.equal(result.levels.size, 3);
  assert.ok(result.events.findIndex((event) => event.path === "operation") < result.events.findIndex((event) => event.path === "guide"));
});

test("test, configuration and documentation targets receive their appropriate facet opportunity", () => {
  const candidates = [
    candidate("operation", 1, ["PRIMARY"], 300),
    candidate("check", 2, ["PRIMARY", "VALIDATION"], 300),
    candidate("settings", 3, ["PRIMARY", "SUPPORT"], 300, { facet: "CONFIGURATION" }),
    candidate("guide", 4, ["PRIMARY", "SUPPORT"], 300),
  ];
  for (const [task, path] of [["test failing assertion", "check"], ["change configuration defaults", "settings"], ["understand architecture", "guide"], ["fix broken behavior", "operation"]]) {
    assert.ok(task && path);
    const result = select(candidates, 350, task);
    assert.equal(result.anchor, path);
    assert.deepEqual([...result.levels.keys()], [path]);
  }
});

test("role novelty breaks equivalent priority and rank ties but never stronger directness", () => {
  const candidates = [candidate("anchor", 1, ["PRIMARY"], 100), candidate("repeated", 2, ["PRIMARY"], 100), candidate("novel", 2, ["PRIMARY", "SUPPORT"], 100)];
  const result = select(candidates, 250, "something");
  assert.deepEqual([...result.levels.keys()], ["anchor", "novel"]);
  const weak = { ...candidates[2]!, classification: { ...candidates[2]!.classification, directness: "VERIFIED_LEXICAL" as const } };
  assert.deepEqual([...select([candidates[0]!, candidates[1]!, weak], 250, "something").levels.keys()], ["anchor", "repeated"]);
});

test("target facet is not satisfied by a different primary facet and is attempted compactly", () => {
  const validation = candidate("check", 1, ["PRIMARY", "IMPACT", "VALIDATION"], 100, { directness: "IDENTITY" });
  const implementation = candidate("operation", 2, ["PRIMARY", "IMPACT", "VALIDATION"], 200, { facet: "IMPLEMENTATION" });
  const expandable = { ...implementation, preferred: 1, options: [...implementation.options, { ranges: [{ startLine: 1, endLine: 50, reasons: ["SYMBOL_RANGE" as const] }], tokens: 9000, wholeFile: false }] };
  const result = select([validation, expandable], 400, "fix broken behavior");
  assert.equal(result.anchor, "check");
  assert.ok(result.events.some((event) => event.path === "operation" && event.phase === "TARGET_OPPORTUNITY"));
  assert.equal(result.levels.get("operation"), 0);
  assert.equal(result.events.at(-1)?.cumulativeTokens, 350);
  assert.equal(select([validation, expandable], 349, "fix broken behavior").drops.find((drop) => drop.path === "operation")?.reason, "GLOBAL_BUDGET");
});

test("2K/4K/8K afford new support without removing the compact direct target", () => {
  const candidates = [candidate("operation", 2, ["PRIMARY"], 600), candidate("check", 1, ["PRIMARY", "VALIDATION"], 200), candidate("guide", 9, ["PRIMARY", "SUPPORT"], 6000, { directness: "VERIFIED_LEXICAL" })];
  for (const budget of [2000, 4000, 8000]) {
    const result = select(candidates, budget, "fix broken behavior");
    assert.ok(result.levels.has("operation"));
    assert.ok(result.events.every((event) => event.cumulativeTokens <= budget));
  }
  assert.ok(select(candidates, 8000, "fix broken behavior").levels.has("guide"));
});
