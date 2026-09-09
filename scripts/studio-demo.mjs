import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContextForgeLifecycle } from "../dist/composition/contextforge-lifecycle.js";
import { SqliteCapsuleHistory } from "../dist/adapters/sqlite/sqlite-capsule-history.js";
import { startStudio } from "../dist/adapters/studio/studio-server.js";

const root = await realpath(await mkdtemp(join(tmpdir(), "contextforge-studio-demo-")));
await mkdir(join(root, "src"));
await writeFile(join(root, "AGENTS.md"), "# Ledger project\nPreserve payment idempotency. Verify retry behavior before changing the ledger.\n");
const responsibilities = ["payment", "retry", "idempotency", "validation", "audit", "reporting", "metrics", "export", "reconciliation", "balance", "notification", "migration"];
for (const responsibility of responsibilities) {
  const name = `ledger_${responsibility}`;
  await writeFile(join(root, "src", `${name}.ts`), [
    `// Synthetic demo: ${responsibility} module. This fixture is not a production payment system.`,
    `export function ${name}(entry: { id: string; amount: number; attempt: number }) {`,
    `  const category = '${responsibility}';`, "  const audit = [];",
    ...Array.from({ length: 24 }, (_, step) => `  audit.push({ ledgerId: entry.id, category, step: ${step}, amount: entry.amount });`),
    "  return { ledgerId: entry.id, category, attempt: entry.attempt, audit };", "}", "",
  ].join("\n"));
}
const app = await createContextForgeLifecycle(root);
const history = new SqliteCapsuleHistory(join(root, ".contextforge/history"));
const studio = await startStudio(app, history);
console.log(`ContextForge demo: ${studio.url}\nCompile the default 'fix ledger' task at 2000 tokens. Inspect a dropped file, PIN it, then recompile, compare and verify.\nSynthetic fixture only. Ctrl+C removes this temporary demo and its history.`);
let closing = false;
const close = () => {
  if (closing) return; closing = true;
  void studio.close().then(async () => { history.close(); await rm(root, { recursive: true, force: true }); });
};
process.once("SIGINT", close); process.once("SIGTERM", close);
