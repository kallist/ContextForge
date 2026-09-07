import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Socket } from "node:net";
import { z } from "zod";
import type { CapsuleHistory } from "../../application/capsule-history.js";
import { inspectReplay, recompileContext, verifyReplay, type LifecycleCompiler } from "../../application/context-lifecycle.js";
import type { BoundContextForgeApplication } from "../../composition/contextforge-application.js";
import { contextControlSchema } from "../../core/context-controls.js";
import { contextCoverage } from "../../core/context-coverage.js";
import { diffContexts } from "../../core/context-diff.js";
import { explainContext, explainQuerySchema } from "../../core/explain-context.js";
import { ContextForgeError } from "../../core/errors.js";
import { hasAbsolutePath } from "../../core/capsule-privacy.js";
import { MAX_CAPSULE_BYTES, validateCapsule } from "../../core/context-capsule.js";

const id = z.string().regex(/^[a-f0-9]{64}$/u);
const task = z.string().min(1).max(16_384), budget = z.number().int().min(1).max(1_000_000);
const requestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("history"), offset: z.number().int().min(0).max(2000).optional() }),
  z.strictObject({ action: z.literal("open"), id }),
  z.strictObject({ action: z.literal("import"), capsule: z.unknown() }),
  z.strictObject({ action: z.literal("compile"), task, budget, refreshIndex: z.boolean() }),
  z.strictObject({ action: z.literal("explain"), id, query: explainQuerySchema }),
  z.strictObject({ action: z.literal("diff"), before: id, after: id }),
  z.strictObject({ action: z.literal("inspect"), id }),
  z.strictObject({ action: z.literal("verify"), id, task: task.optional() }),
  z.strictObject({ action: z.literal("recompile"), id, task: task.optional(), budget, controls: z.array(contextControlSchema).max(32) }),
  z.strictObject({ action: z.literal("delete"), id }),
  z.strictObject({ action: z.literal("prune"), keep: z.number().int().min(0).max(2000) }),
]);
const staticFiles = new Map([["/", ["index.html", "text/html; charset=utf-8"]], ["/studio.css", ["studio.css", "text/css; charset=utf-8"]], ["/studio.js", ["studio.js", "text/javascript; charset=utf-8"]]]);
const MAX_BODY = MAX_CAPSULE_BYTES + 64 * 1024;
function json(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(data));
}
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  if (Number(request.headers["content-length"] ?? 0) > MAX_BODY) throw new ContextForgeError("USAGE", "Studio request exceeds its bounded input limit.");
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY) throw new ContextForgeError("USAGE", "Studio request exceeds its bounded input limit.");
    chunks.push(buffer);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown; }
  catch { throw new ContextForgeError("USAGE", "Studio requires valid UTF-8 JSON."); }
}

export async function startStudio(application: BoundContextForgeApplication & LifecycleCompiler, history: CapsuleHistory, port = 0) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ContextForgeError("USAGE", "Studio port must be 0..65535.");
  const token = randomBytes(32).toString("hex");
  const payloads = new Map<string, string>();
  const remember = (id: string, markdown: string): void => {
    // Metadata/API privacy is stricter than the explicit CLI source-payload boundary.
    if (Buffer.byteLength(markdown) > 8 * 1024 * 1024 || hasAbsolutePath(markdown)) return;
    payloads.set(id, markdown);
    while (payloads.size > 4) { const oldest = payloads.keys().next().value; if (oldest !== undefined) payloads.delete(oldest); }
  };
  const open = (id: string) => { const capsule = history.get(id); return { capsule, coverage: contextCoverage(capsule), payload: payloads.get(id) ?? null, payloadStatus: payloads.has(id) ? "EXACT_EPHEMERAL" : "VERIFY_TO_VIEW_OR_USE_CLI_IF_PATH_BEARING" }; };
  let busy = false, origin = "";
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const handle = async (): Promise<void> => {
      if (request.headers.host !== origin.slice(7) || (request.headers.origin !== undefined && request.headers.origin !== origin) || (request.headers["sec-fetch-site"] !== undefined && !["same-origin", "none"].includes(String(request.headers["sec-fetch-site"])))) { json(response, 403, { code: "ORIGIN_REJECTED" }); return; }
      const file = staticFiles.get(request.url ?? "");
      if (request.method === "GET" && file !== undefined) {
        const [name, mime] = file;
        const bytes = await readFile(new URL(`./assets/${name ?? ""}`, import.meta.url));
        response.writeHead(200, { "Content-Type": mime ?? "application/octet-stream" }); response.end(bytes); return;
      }
      if (request.url !== "/api" || request.method !== "POST") { json(response, 404, { code: "NOT_FOUND" }); return; }
      const authorization = request.headers.authorization ?? "";
      const expected = `Bearer ${token}`;
      if (authorization.length !== expected.length || !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))) { json(response, 403, { code: "CAPABILITY_REQUIRED" }); return; }
      if (request.headers.origin !== origin || request.headers["content-type"] !== "application/json") { json(response, 403, { code: "ORIGIN_REJECTED" }); return; }
      if (busy) { json(response, 409, { code: "STUDIO_BUSY", message: "One operation is already running. Try again after it finishes." }); return; }
      busy = true;
      try {
        const parsed = requestSchema.safeParse(await body(request));
        if (!parsed.success) throw new ContextForgeError("USAGE", "Invalid or unsupported Studio request.");
        const q = parsed.data;
        switch (q.action) {
          case "history": json(response, 200, { entries: history.list(30, q.offset ?? 0), stats: history.stats() }); break;
          case "open": json(response, 200, open(q.id)); break;
          case "import": { const capsule = validateCapsule(q.capsule); history.save(capsule); json(response, 200, open(capsule.capsuleHash)); break; }
          case "compile": {
            if (q.refreshIndex) await application.index();
            const execution = await application.compile({ task: q.task, budget: q.budget, captureCapsule: true });
            const capsule = validateCapsule(execution.capsule); history.save(capsule); remember(capsule.capsuleHash, execution.markdown); json(response, 200, open(capsule.capsuleHash)); break;
          }
          case "explain": json(response, 200, explainContext(history.get(q.id), q.query)); break;
          case "diff": json(response, 200, diffContexts(history.get(q.before), history.get(q.after))); break;
          case "inspect": json(response, 200, inspectReplay(history.get(q.id))); break;
          case "verify": {
            const replay = await verifyReplay(application, history.get(q.id), q.task);
            if (replay.result.payloadMatches === true && replay.execution !== undefined) remember(q.id, replay.execution.markdown);
            json(response, 200, { replay: replay.result, opened: open(q.id) }); break;
          }
          case "recompile": {
            const result = await recompileContext(application, history.get(q.id), { controls: q.controls, budget: q.budget, ...(q.task === undefined ? {} : { task: q.task }) });
            history.save(result.capsule); remember(result.capsule.capsuleHash, result.execution.markdown);
            json(response, 200, { ...open(result.capsule.capsuleHash), diff: result.diff }); break;
          }
          case "delete": payloads.delete(q.id); json(response, 200, { deleted: history.delete(q.id) }); break;
          case "prune": payloads.clear(); json(response, 200, { deleted: history.prune(q.keep) }); break;
        }
      } finally { busy = false; }
    };
    void handle().catch((error: unknown) => {
      if (!response.headersSent) {
        const safeMessage = error instanceof ContextForgeError && ["CONTROL_CONFLICT", "HISTORY_ERROR", "HISTORY_LIMIT", "HISTORY_MISSING", "USAGE", "INVALID_CAPSULE", "BUDGET_TOO_SMALL"].includes(error.code) && !hasAbsolutePath(error.message) ? error.message.slice(0, 512) : "The operation could not complete safely. Check the source/index state or local history. No raw path or stack is exposed.";
        json(response, 400, { code: error instanceof ContextForgeError ? error.code : "STUDIO_ERROR", message: safeMessage });
      }
      else response.end();
    });
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.maxHeadersCount = 32;
  server.maxConnections = 16;
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  const address = server.address();
  if (address === null || typeof address === "string") throw new ContextForgeError("ACCESS", "Studio listener unavailable.");
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, url: `${origin}/#${token}`, close: async (): Promise<void> => { payloads.clear(); for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => { server.close(() => { resolve(); }); }); } };
}
