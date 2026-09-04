import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createContextForgeApplication } from "../../src/composition/contextforge-application.js";
import { validateCapsule } from "../../src/core/context-capsule.js";
import { createCapsuleExplainer } from "../../src/core/explain-context.js";
import { createTemporaryDirectory, removeTemporaryDirectory } from "../helpers/fixtures.js";

test("Capsule observes V1 drops beyond the unchanged presentation cap", async (t) => {
  const root = await createTemporaryDirectory("capsule-drop-cap"); t.after(() => removeTemporaryDirectory(root));
  await mkdir(join(root, "src"));
  for (let i = 0; i < 50; i++) { const name = i < 25 ? "ledger" : "wallet"; await writeFile(join(root, "src", `${name}-${i}.ts`), `export function ${name}${i}() { return ${i}; }\n`); }
  const application = await createContextForgeApplication(root); await application.index();
  const off = await application.pack({ task: "ledger wallet", budget: 2000 });
  const on = await application.pack({ task: "ledger wallet", budget: 2000, captureCapsule: true });
  assert.deepEqual(on.manifest, off.manifest); assert.equal(on.markdown, off.markdown);
  const capsule = validateCapsule(on.capsule), explain = createCapsuleExplainer(capsule);
  assert.ok(capsule.deterministic.dropped.length > on.manifest.droppedCandidates.length);
  for (const subject of capsule.deterministic.dropped) assert.equal(explain({ type: "WHY_DROPPED", subject }).status, "OK");
});
