import assert from "node:assert/strict";
import test from "node:test";

import { ContextForgeError } from "../../src/core/errors.js";
import { MAXIMUM_TASK_BYTES, normalizeTaskQuery } from "../../src/core/task-query.js";

function normalizedSignals(task: string): string[] {
  return normalizeTaskQuery(task).signals.map((signal) => signal.normalized);
}

test("normalizes coding identifiers while retaining exact technical forms", () => {
  const signals = normalizedSignals(
    "MemoryService.finalizeRun memory_enabled run.completed user-auth-service INDEX_BUSY PARSER_UNAVAILABLE BEGIN IMMEDIATE SELECT FOR UPDATE HTTP_409 404",
  );
  for (const expected of [
    "memoryservice.finalizerun",
    "memoryservice",
    "finalizerun",
    "finalize",
    "run",
    "memory_enabled",
    "memory",
    "enabled",
    "run.completed",
    "completed",
    "user-auth-service",
    "user",
    "auth",
    "service",
    "index_busy",
    "parser_unavailable",
    "begin immediate",
    "select for update",
    "http_409",
    "404",
  ]) assert.ok(signals.includes(expected), `missing ${expected}`);
});

test("retains CJK and technical identifiers without promising translation", () => {
  const query = normalizeTaskQuery("修复 MemoryService 在 memory_enabled=false 后的竞态");
  assert.ok(query.signals.some((signal) => signal.kind === "CJK_TERM" && signal.value.includes("修复")));
  assert.ok(query.signals.some((signal) => signal.normalized === "memoryservice"));
  assert.ok(query.signals.some((signal) => signal.normalized === "memory_enabled"));
  assert.ok(query.signals.some((signal) => signal.normalized === "false"));
});

test("coding-aware low-value terms are downweighted rather than deleted", () => {
  const query = normalizeTaskQuery("please fix the timeout rollback lock");
  assert.equal(query.signals.find((signal) => signal.normalized === "fix")?.lowValue, true);
  for (const term of ["timeout", "rollback", "lock"]) {
    assert.equal(query.signals.find((signal) => signal.normalized === term)?.lowValue, false);
  }
  assert.equal(normalizeTaskQuery("fix bug").diagnostics.lowInformation, true);
});

test("rejects empty and over-limit task input without truncating", () => {
  assert.throws(() => normalizeTaskQuery(" \n\t "), (error: unknown) => error instanceof ContextForgeError && error.code === "INVALID_TASK");
  assert.throws(
    () => normalizeTaskQuery("x".repeat(MAXIMUM_TASK_BYTES + 1)),
    (error: unknown) => error instanceof ContextForgeError && error.code === "TASK_TOO_LARGE",
  );
  assert.throws(
    () => normalizeTaskQuery(Array.from({ length: 300 }, (_, index) => `term${index}`).join(" ")),
    (error: unknown) => error instanceof ContextForgeError && error.code === "INVALID_TASK",
  );
});

test("control characters remain data and do not enter normalized signals", () => {
  const query = normalizeTaskQuery("MemoryService\u001b[31m\u0000 timeout");
  assert.equal(query.diagnostics.controlCharacters, 2);
  assert.ok(query.signals.some((signal) => signal.normalized === "memoryservice"));
  assert.equal(query.signals.some((signal) => signal.value.includes("\u001b")), false);
});
