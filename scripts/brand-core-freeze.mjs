import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const base = "edfb3ad7c0780b198bcec742e5f4126111d6e674";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/u).filter(Boolean);
const paths = [...new Set([...git("diff", "--name-only", base, "--", "src", "benchmarks"), ...git("ls-files", "--others", "--exclude-standard", "--", "src", "benchmarks")])];
const brandAllowed = new Set([
  "src/adapters/mcp/contextforge-mcp-server.ts",
  "src/adapters/studio/assets/index.html",
  "src/adapters/sqlite/sqlite-index-repository.ts",
  "src/application/inspect-index.ts",
  "src/application/inspect-repository-graph.ts",
  "src/application/search-repository-v2.ts",
  "src/application/search-repository.ts",
  "src/cli/format.ts",
  "src/cli/lifecycle.ts",
  "src/cli/main.ts",
  "src/cli/review.ts",
  "src/core/explain-context.ts",
]);
const releaseCorrectionAllowed = new Set(["src/adapters/sqlite/sqlite-capsule-history.ts"]);
assert.deepEqual(paths.filter((path) => !brandAllowed.has(path) && !releaseCorrectionAllowed.has(path)), [], "RepoBound migration plus its audited history release correction may not change compiler, ranking, Pack, or benchmark sources");
const auditedPatch = execFileSync("git", ["diff", "--binary", "--no-ext-diff", base, "--", ...[...brandAllowed].sort()], { windowsHide: true });
const auditedPatchSha256 = createHash("sha256").update(auditedPatch).digest("hex");
const historyPatch = execFileSync("git", ["diff", "--binary", "--no-ext-diff", base, "--", ...releaseCorrectionAllowed], { windowsHide: true });
const historyPatchSha256 = createHash("sha256").update(historyPatch).digest("hex");
assert.equal(
  auditedPatchSha256,
  "aefd4440cb38571b25d9a552dc7bdb35852709d2a3787b57dce2e4304b7f581e",
  "The production diff differs from the exact reviewed display-only patch; inspect it before updating this invariant",
);
assert.equal(
  historyPatchSha256,
  "d15bafb77087363f33fd9aab4dff4486fefcb2f9730830a53bf26dfe1e86a8c3",
  "The history correction differs from the exact reviewed bounded-timeout patch; inspect it before updating this invariant",
);
assert.ok(readFileSync("src/core/context-serialization.ts", "utf8").includes("# ContextForge Context Pack"), "Hash-covered legacy Pack heading must remain stable");
console.log(JSON.stringify({ gate: "RepoBound v0.5.1 production and benchmark freeze", base, changedProductionPaths: paths, auditedPatchSha256, historyPatchSha256, compiler: "UNCHANGED", ranking: "UNCHANGED", pack: "UNCHANGED", gold: "UNCHANGED", v2Promotion: "NONE", databaseSchema: "UNCHANGED", mcpTools: "UNCHANGED", passed: true }));
