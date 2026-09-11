import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewFixture } from "./review-fixture.mjs";
import { createContextForgeLifecycle } from "../dist/composition/contextforge-lifecycle.js";
import { compileReview } from "../dist/composition/contextforge-review.js";
import { SqliteCapsuleHistory } from "../dist/adapters/sqlite/sqlite-capsule-history.js";
import { startStudio } from "../dist/adapters/studio/studio-server.js";
const root = await realpath(await mkdtemp(join(tmpdir(), "contextforge-review-demo-")));
let history, studio;
try {
  await reviewFixture(root);
  const app = await createContextForgeLifecycle(root); await app.index();
  const result = await compileReview(root, { budget: 1000 });
  history = new SqliteCapsuleHistory(join(root, ".contextforge/history")); history.save(result.capsule);
  studio = await startStudio(app, history);
  console.log(`Review demo: ${studio.url}\nOpen the saved Review Context, inspect ledger and its callers, PIN a dropped candidate, Recompile & compare, then Verify replay. Ctrl+C removes this temporary demo.`);
  await new Promise((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
} finally { await studio?.close(); history?.close(); await rm(root, { recursive: true, force: true }); }
