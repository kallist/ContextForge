import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { readCapsule } from "../adapters/filesystem/capsule-reader.js";
import { FileSystemOutputArtifactWriter } from "../adapters/filesystem/output-artifact-writer.js";
import { SqliteCapsuleHistory } from "../adapters/sqlite/sqlite-capsule-history.js";
import { startStudio } from "../adapters/studio/studio-server.js";
import { createContextForgeLifecycle } from "../composition/contextforge-lifecycle.js";
import { inspectReplay, recompileContext, verifyReplay } from "../application/context-lifecycle.js";
import { contextCoverage } from "../core/context-coverage.js";
import { diffContexts, renderContextDiff } from "../core/context-diff.js";
import { normalizeControls } from "../core/context-controls.js";
import { ContextForgeError } from "../core/errors.js";

export const LIFECYCLE_HELP = `
Context lifecycle (V1 remains the public default):
  repobound history list [--store <directory>] [--limit 30] [--offset 0]
  repobound history save <capsule-file> [--store <directory>]
  repobound history show|delete <sha256> [--store <directory>]
  repobound history prune --keep <count> [--store <directory>]
  repobound replay <file-or-id> [--verify --repository <path>] [--task <original>]
  repobound diff <before-file-or-id> <after-file-or-id> [--json]
  repobound coverage <file-or-id> [--json]
  repobound recompile <file-or-id> --controls <json-file> [--budget <n>]
      [--repository <path>] [--task <original>] [--out <context.md>] [--store <directory>]
  repobound studio [--repository <path>] [--store <directory>] [--port <n>]

History defaults to .contextforge/history under the bound repository/current directory.
Replay without --verify is offline inspection; verification never restores old source bytes.
Recompile saves a new source-light Capsule; --out explicitly exports source context.
Studio serves one repository on IPv4 loopback. Keep its private capability URL local.
`;
const commands = new Set(["history", "replay", "diff", "coverage", "recompile", "studio"]);
export async function runLifecycle(argv: readonly string[], workingDirectory: string): Promise<number | null> {
  if (!commands.has(argv[0] ?? "")) return null;
  let parsed;
  try { parsed = parseArgs({ args: [...argv], allowPositionals: true, strict: true, options: {
    help: { type: "boolean" }, json: { type: "boolean" }, store: { type: "string" }, repository: { type: "string" },
    verify: { type: "boolean" }, task: { type: "string" }, budget: { type: "string" }, controls: { type: "string" },
    out: { type: "string" }, limit: { type: "string" }, offset: { type: "string" }, keep: { type: "string" }, port: { type: "string" },
  } }); } catch { throw new ContextForgeError("USAGE", "Invalid lifecycle arguments. Run repobound history --help."); }
  if (parsed.values.help) { process.stdout.write(LIFECYCLE_HELP); return 0; }
  const [command, first, second, ...extra] = parsed.positionals;
  if (extra.length > 0 || (second !== undefined && command !== "history" && command !== "diff")) throw new ContextForgeError("USAGE", "Too many lifecycle positional arguments.");
  const v = parsed.values, repository = resolve(workingDirectory, v.repository ?? ".");
  let boundRoot = repository;
  const allowed: Record<string, string[]> = {
    history: ["store", "json", "limit", "offset", "keep"], replay: ["store", "json", "verify", "repository", "task"],
    diff: ["store", "json"], coverage: ["store", "json"], recompile: ["store", "json", "repository", "task", "budget", "controls", "out"], studio: ["store", "repository", "port"],
  };
  if (Object.keys(v).some((key) => !allowed[command ?? ""]?.includes(key))) throw new ContextForgeError("USAGE", "An option is not supported by this lifecycle command.");
  let store: SqliteCapsuleHistory | undefined;
  let keepOpen = false;
  const history = () => store ??= new SqliteCapsuleHistory(resolve(workingDirectory, v.store ?? resolve(boundRoot, ".contextforge/history")));
  const load = (value: string | undefined) => {
    if (value === undefined) throw new ContextForgeError("USAGE", "A Capsule file or full history ID is required.");
    return /^[a-f0-9]{64}$/u.test(value) ? Promise.resolve(history().get(value)) : readCapsule(resolve(workingDirectory, value));
  };
  const print = (value: unknown): void => { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); };
  try {
    if (command === "studio") {
      if (first !== undefined) throw new ContextForgeError("USAGE", "Use --repository to bind Studio.");
      const app = await createContextForgeLifecycle(repository);
      boundRoot = app.rootRealPath;
      const studio = await startStudio(app, history(), Number(v.port ?? 0));
      keepOpen = true;
      process.stdout.write(`RepoBound Studio: ${studio.url}\nLocal capability URL; source payloads are not persisted. Press Ctrl+C to stop.\n`);
      let closing = false;
      const close = (): void => { if (closing) return; closing = true; void studio.close().finally(() => { store?.close(); store = undefined; }); };
      process.once("SIGINT", close); process.once("SIGTERM", close);
      return 0;
    }
    if (command === "history") {
      if (first === "list" && second === undefined) print({ entries: history().list(Number(v.limit ?? 30), Number(v.offset ?? 0)), stats: history().stats() });
      else if (first === "save" && second !== undefined) print(history().save(await readCapsule(resolve(workingDirectory, second))));
      else if (first === "show" && second !== undefined) print(history().get(second));
      else if (first === "delete" && second !== undefined) print({ deleted: history().delete(second) });
      else if (first === "prune" && second === undefined && v.keep !== undefined) print({ deleted: history().prune(Number(v.keep)) });
      else throw new ContextForgeError("USAGE", "Use history list, save, show, delete or prune --keep.");
    } else if (command === "coverage") print(contextCoverage(await load(first)));
    else if (command === "diff") { const diff = diffContexts(await load(first), await load(second)); if (v.json) print(diff); else process.stdout.write(renderContextDiff(diff)); }
    else if (command === "replay") {
      const capsule = await load(first);
      if (!v.verify) { if (v.repository !== undefined || v.task !== undefined) throw new ContextForgeError("USAGE", "Repository/task options require explicit --verify."); print(inspectReplay(capsule)); }
      else {
        const replay = await verifyReplay(await createContextForgeLifecycle(repository), capsule, v.task); print(replay.result);
        return ["EXACT_MATCH", "PAYLOAD_MATCH_PROVENANCE_CHANGED"].includes(replay.result.status) ? 0 : 19;
      }
    } else if (command === "recompile") {
      if (v.controls === undefined) throw new ContextForgeError("USAGE", "Recompile requires --controls JSON file (use [] for budget-only what-if).");
      const handle = await open(resolve(workingDirectory, v.controls), constants.O_RDONLY | constants.O_NONBLOCK);
      let controls;
      try {
        const stat = await handle.stat(); if (!stat.isFile() || stat.size > 64 * 1024) throw new ContextForgeError("CONTROL_CONFLICT", "Control input must be a regular file of at most 64 KiB.");
        const buffer = Buffer.alloc(64 * 1024 + 1); let length = 0;
        while (length < buffer.length) { const chunk = await handle.read(buffer, length, buffer.length - length, length); if (!chunk.bytesRead) break; length += chunk.bytesRead; }
        if (length > 64 * 1024) throw new ContextForgeError("CONTROL_CONFLICT", "Control input exceeds 64 KiB.");
        controls = normalizeControls(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length))) as unknown);
      } catch { throw new ContextForgeError("CONTROL_CONFLICT", "Unable to parse bounded control input."); } finally { await handle.close(); }
      const result = await recompileContext(await createContextForgeLifecycle(repository), await load(first), { controls, ...(v.task === undefined ? {} : { task: v.task }), ...(v.budget === undefined ? {} : { budget: Number(v.budget) }) });
      if (v.out !== undefined) await new FileSystemOutputArtifactWriter().writeExclusive(resolve(workingDirectory, v.out), result.execution.markdown);
      history().save(result.capsule); print({ capsule: result.capsule, coverage: result.coverage, diff: result.diff });
    }
    return 0;
  } finally { if (!keepOpen) store?.close(); }
}
