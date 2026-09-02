import assert from "node:assert/strict";
import test from "node:test";

import { buildContextPlan } from "../../src/core/context-plan-v2.js";
import { unsupportedFileAnalysis } from "../../src/core/language-analysis.js";
import { analyzeTask, resolveTaskAnalysisAmbiguity } from "../../src/core/task-analysis-v2.js";
import type { IndexedFile } from "../../src/core/repository-index.js";

function file(relativePath: string): IndexedFile {
  return {
    relativePath,
    category: relativePath.endsWith(".md") ? "documentation" : "source",
    contentStatus: "text",
    size: 1,
    mtimeMs: 1,
    contentHash: "a".repeat(64),
    analysis: unsupportedFileAnalysis(relativePath),
  };
}

test("TaskAnalysis deterministically extracts action, mode, paths, identifiers, literals, config, CJK, concepts, and risks", () => {
  const taskText = "修复并发配置 `AUTH_SESSION_TTL`，更新 src/auth/session-store.ts 的 SessionStore.revokeSession after test failure";
  const first = analyzeTask(taskText);
  const second = analyzeTask(taskText);
  assert.deepEqual(first, second);
  assert.equal(first.strategy, "contextforge-task-analysis-v2");
  assert.equal(first.action, "FIX");
  assert.equal(first.mode, "TEST_FAILURE");
  assert.ok(first.signals.some((signal) => signal.kind === "PATH" && signal.normalized === "src/auth/session-store.ts"));
  assert.ok(first.signals.some((signal) => signal.kind === "QUALIFIED_SYMBOL" && signal.normalized === "sessionstore.revokesession"));
  assert.ok(first.signals.some((signal) => signal.kind === "CONFIG_KEY" && signal.normalized === "auth_session_ttl" && signal.specificity === "EXACT"));
  assert.ok(first.signals.some((signal) => signal.kind === "CJK_TERM"));
  assert.ok(first.concepts.includes("CONCURRENCY"));
  assert.ok(first.concepts.includes("CONFIGURATION"));
  assert.ok(first.riskSignals.some((risk) => risk.kind === "CONCURRENCY"));
  assert.ok(first.signals.length <= 256);
  assert.ok(first.concepts.length <= 16);
  assert.ok(first.riskSignals.length <= 16);
  assert.ok(first.diagnostics.length <= 32);
});

test("repository collision resolution labels ambiguous basenames without leaking paths into ContextPlan", () => {
  const analysis = analyzeTask("review service.ts architecture");
  const resolved = resolveTaskAnalysisAmbiguity(analysis, [file("src/user/service.ts"), file("src/admin/service.ts"), file("docs/ARCHITECTURE.md")]);
  const service = resolved.signals.find((signal) => signal.normalized === "service.ts");
  assert.equal(service?.ambiguity, "COLLIDING");
  assert.equal(service?.repositoryMatches, 2);
  const plan = buildContextPlan(resolved);
  assert.equal(plan.mode, "ARCHITECTURE");
  assert.equal(plan.primaryContextRole, "DOCUMENTATION");
  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes("src/user/service.ts"), false);
  assert.equal(serialized.includes("src/admin/service.ts"), false);
  assert.ok(plan.sections.every((section) => section.maximumItems <= 6));
});

test("ordinary words remain general signals instead of exact technical symbols", () => {
  const analysis = analyzeTask("run output after concurrent updates");
  for (const word of ["run", "output", "after", "concurrent"]) {
    const signal = analysis.signals.find((item) => item.normalized === word);
    assert.equal(signal?.kind, "NATURAL_TERM");
    assert.equal(signal?.specificity, "GENERAL");
  }
});
