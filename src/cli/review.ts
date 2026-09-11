import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { compileReview } from "../composition/contextforge-review.js";
import { createContextForgeLifecycle } from "../composition/contextforge-lifecycle.js";
import { FileSystemOutputArtifactWriter } from "../adapters/filesystem/output-artifact-writer.js";
import { canonicalSerialize } from "../core/context-capsule.js";
import { contextCoverage } from "../core/context-coverage.js";
import { ContextForgeError } from "../core/errors.js";

export const REVIEW_HELP = "\nReview Context: contextforge review [repository] [--base HEAD] [--budget 8000] [--refresh-index] [--json] [--capsule file.json] [--out context.md]\nCompares a resolved base to the tracked working tree. Stage new files first.\n";
export async function runReview(argv: readonly string[], cwd: string): Promise<number | null> {
  if (argv[0] !== "review") return null;
  let parsed;
  try { parsed = parseArgs({ args: [...argv.slice(1)], allowPositionals: true, strict: true, options: { base: { type: "string" }, budget: { type: "string" }, json: { type: "boolean" }, capsule: { type: "string" }, out: { type: "string" }, "refresh-index": { type: "boolean" }, help: { type: "boolean" } } }); }
  catch { throw new ContextForgeError("USAGE", "Invalid review options. Run contextforge review --help."); }
  if (parsed.values.help) { process.stdout.write(REVIEW_HELP); return 0; }
  if (parsed.positionals.length > 1) throw new ContextForgeError("USAGE", "Review accepts one repository path.");
  const app = await createContextForgeLifecycle(resolve(cwd, parsed.positionals[0] ?? "."));
  if (parsed.values["refresh-index"]) await app.index();
  const execution = await compileReview(app.rootRealPath, { budget: Number(parsed.values.budget ?? 8000), ...(parsed.values.base === undefined ? {} : { base: parsed.values.base }) });
  const writer = new FileSystemOutputArtifactWriter();
  if (parsed.values.capsule) await writer.writeExclusive(resolve(cwd, parsed.values.capsule), canonicalSerialize(execution.capsule) + "\n");
  if (parsed.values.out) await writer.writeExclusive(resolve(cwd, parsed.values.out), execution.markdown);
  process.stdout.write(parsed.values.json ? JSON.stringify({ capsule: execution.capsule, coverage: contextCoverage(execution.capsule), performance: execution.reviewPerformance }, null, 2) + "\n" : execution.markdown);
  return 0;
}
