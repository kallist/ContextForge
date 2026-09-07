import assert from "node:assert/strict";
import { hasAbsolutePath } from "../../src/core/capsule-privacy.js";
import { isNormalizedRepositoryPath } from "../../src/core/repository-graph.js";

/** Test/evaluation-only value scan. It never emits the offending text. */
export function auditCapsulePrivacy(value: unknown): void {
  const pending: { value: unknown; field: string }[] = [{ value, field: "root" }];
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === undefined) break;
    if (typeof item.value === "string") {
      // Schema-validated structured repository paths are not free-form prose.
      const structuredPath = /(?:\.files\.\d+\.path|\.evidence\.\d+\.sourceCandidate)$/u.test(item.field);
      assert.ok(structuredPath ? isNormalizedRepositoryPath(item.value) : !hasAbsolutePath(item.value), `Capsule privacy violation at ${item.field}`);
    } else if (Array.isArray(item.value)) {
      for (const [index, child] of item.value.entries()) pending.push({ value: child, field: `${item.field}.${index}` });
    } else if (typeof item.value === "object" && item.value !== null) {
      for (const [key, child] of Object.entries(item.value)) pending.push({ value: child, field: `${item.field}.${key}` });
    }
  }
}
