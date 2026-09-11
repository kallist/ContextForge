import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createContextForgeLifecycle } from "../dist/composition/contextforge-lifecycle.js";
import { compileReview } from "../dist/composition/contextforge-review.js";
import { reviewFixture } from "./review-fixture.mjs";
const datasetText = await readFile(new URL("../benchmarks/review-v1.json", import.meta.url), "utf8");
const dataset = JSON.parse(datasetText), records = [];
for (const scenario of dataset.scenarios) {
  const root = await mkdtemp(join(tmpdir(), "contextforge-review-eval-"));
  try {
    await reviewFixture(root, scenario.id); const app = await createContextForgeLifecycle(root); await app.index();
    for (const budget of dataset.budgets) {
      const a = await compileReview(root, { budget }), b = await compileReview(root, { budget });
      const c = a.capsule.deterministic;
      const impact = [...new Set(a.review.impact.flatMap((r) => [r.from, r.to]).filter((p) => p !== scenario.changed))];
      const selected = c.selected.map((s) => c.files.find((f) => f.id === c.candidates.find((i) => i.id === s.candidateRef)?.fileRef)?.path);
      const hits = scenario.related.filter((p) => impact.includes(p)).length;
      const record = { scenario: scenario.id, budget, changedFile: a.review.changes.some((f) => f.path === scenario.changed), changedSymbol: a.review.changes.some((f) => f.symbols.some((s) => s.name === scenario.symbol)), impactRecall: hits / scenario.related.length, impactPrecision: impact.length ? hits / impact.length : null, retention: scenario.related.filter((p) => selected.includes(p)).length / scenario.related.length, tokens: c.budget.estimatedTokens, deterministic: a.capsule.capsuleHash === b.capsule.capsuleHash && a.markdown === b.markdown, capsuleHash: a.capsule.capsuleHash, missed: scenario.related.filter((p) => !impact.includes(p)), noise: impact.filter((p) => !scenario.related.includes(p)), dropped: scenario.related.filter((p) => !selected.includes(p)), knownUnresolved: scenario.unresolvedRuntimeRelationship, performance: a.reviewPerformance };
      records.push(record); assert.ok(record.deterministic); assert.ok(record.tokens <= budget);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}
const result = { version: dataset.version, datasetHash: createHash("sha256").update(datasetText).digest("hex"), fixtureHash: createHash("sha256").update(await readFile(new URL("./review-fixture.mjs", import.meta.url))).digest("hex"), records, limitations: dataset.limitations };
await mkdir(".benchmark-output", { recursive: true }); await writeFile(".benchmark-output/review-v1.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
