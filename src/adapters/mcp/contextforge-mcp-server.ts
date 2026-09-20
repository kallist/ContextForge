import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import type { BoundContextForgeApplication } from "../../composition/contextforge-application.js";
import { ContextForgeError } from "../../core/errors.js";
import { PACK_V1 } from "../../core/packing/pack-v1.js";
import { STRUCTURAL_V1 } from "../../core/ranking/structural-v1.js";
import { MAXIMUM_TASK_BYTES } from "../../core/task-query.js";

const MAXIMUM_DIAGNOSTICS = 20;
const MAXIMUM_DIAGNOSTIC_LENGTH = 500;
const MAXIMUM_ERROR_LENGTH = 1_000;
const MAXIMUM_REASONS_PER_CANDIDATE = 6;
const MAXIMUM_SYMBOLS_PER_CANDIDATE = 10;

export const MCP_SERVER_NAME = "contextforge";
export const MCP_TOOL_NAMES = ["status", "index", "search", "pack"] as const;
export const MCP_SERVER_INSTRUCTIONS = [
  "Use status when index readiness is unknown.",
  "Use index only to explicitly build or refresh RepoBound local index state; it does not modify repository source.",
  "Use search to inspect relevant indexed files and symbols.",
  "Use pack to compile task-relevant repository context under a hard RepoBound token-estimate budget.",
].join(" ");

const taskSchema = z.string()
  .min(1)
  .max(MAXIMUM_TASK_BYTES)
  .refine((value) => value.trim().length > 0, "Task must contain non-whitespace text.")
  .refine((value) => Buffer.byteLength(value, "utf8") <= MAXIMUM_TASK_BYTES, `Task must not exceed ${MAXIMUM_TASK_BYTES} UTF-8 bytes.`);
const diagnosticsSchema = z.array(z.string()).max(MAXIMUM_DIAGNOSTICS);
const indexStateSchema = z.enum(["CURRENT", "STALE", "PARTIAL", "MISSING"]);

const statusOutputSchema = z.object({
  repository: z.string(),
  indexAvailable: z.boolean(),
  generation: z.number().int().nullable(),
  indexSchemaVersion: z.number().int(),
  indexStatus: indexStateSchema,
  rankingStrategy: z.string(),
  packingStrategy: z.string(),
  tokenEstimator: z.string(),
  tokenEstimatorVersion: z.string(),
  diagnostics: diagnosticsSchema,
  omittedDiagnostics: z.number().int().nonnegative(),
}).strict();

const indexOutputSchema = z.object({
  generation: z.number().int().positive(),
  files: z.object({
    indexed: z.number().int().nonnegative(),
    parsed: z.number().int().nonnegative(),
    reused: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    degraded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }).strict(),
  symbols: z.number().int().nonnegative(),
  imports: z.number().int().nonnegative(),
  graphEdges: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  diagnostics: diagnosticsSchema,
  omittedDiagnostics: z.number().int().nonnegative(),
}).strict();

const searchOutputSchema = z.object({
  generation: z.number().int().positive(),
  rankingStrategy: z.string(),
  indexStatus: z.enum(["FRESH", "STALE", "PARTIAL"]),
  candidateCount: z.number().int().nonnegative(),
  candidates: z.array(z.object({
    relativePath: z.string(),
    score: z.number(),
    origin: z.enum(["DIRECT", "EXPANDED", "DIRECT_AND_EXPANDED"]),
    graphDistance: z.number().int().nonnegative().nullable(),
    relevantSymbols: z.array(z.string()).max(MAXIMUM_SYMBOLS_PER_CANDIDATE),
    reasons: z.array(z.string()).max(MAXIMUM_REASONS_PER_CANDIDATE),
  }).strict()).max(STRUCTURAL_V1.cli.maximumLimit),
  diagnostics: diagnosticsSchema,
  omittedDiagnostics: z.number().int().nonnegative(),
}).strict();

const packOutputSchema = z.object({
  generation: z.number().int().positive(),
  indexStatus: z.enum(["FRESH", "STALE", "PARTIAL"]),
  packStatus: z.enum(["COMPLETE", "PARTIAL"]),
  rankingStrategy: z.string(),
  packingStrategy: z.string(),
  tokenEstimator: z.string(),
  tokenEstimatorVersion: z.string(),
  requestedBudget: z.number().int().positive(),
  estimatedTokens: z.number().int().nonnegative(),
  selectedFileCount: z.number().int().nonnegative(),
  selectedRangeCount: z.number().int().nonnegative(),
  selectedItems: z.array(z.object({
    relativePath: z.string(),
    ranges: z.array(z.object({ startLine: z.number().int().positive(), endLine: z.number().int().positive() }).strict()),
  }).strict()).max(PACK_V1.maximumCandidateSources),
  diagnostics: diagnosticsSchema,
  omittedDiagnostics: z.number().int().nonnegative(),
}).strict();

function boundedText(value: string, maximumLength: number): string {
  const safe = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || (code >= 127 && code <= 159)
        ? "�"
        : character;
    })
    .join("");
  return safe.length <= maximumLength ? safe : `${safe.slice(0, maximumLength - 1)}…`;
}

function diagnostics(values: readonly string[]): { diagnostics: string[]; omittedDiagnostics: number } {
  return {
    diagnostics: values.slice(0, MAXIMUM_DIAGNOSTICS).map((value) => boundedText(value, MAXIMUM_DIAGNOSTIC_LENGTH)),
    omittedDiagnostics: Math.max(0, values.length - MAXIMUM_DIAGNOSTICS),
  };
}

function redactRepositoryPath(value: string, rootRealPath: string): string {
  const variants = new Set([rootRealPath, rootRealPath.replaceAll("\\", "/")]);
  let redacted = value;
  for (const variant of variants) {
    if (variant.length > 0) redacted = redacted.replaceAll(variant, "<repository>");
  }
  return redacted;
}

function errorResult(error: unknown, rootRealPath: string): CallToolResult {
  if (error instanceof ContextForgeError) {
    const message = boundedText(redactRepositoryPath(error.message, rootRealPath), MAXIMUM_ERROR_LENGTH);
    return { isError: true, content: [{ type: "text", text: `RepoBound ${error.code}: ${message}` }] };
  }
  return {
    isError: true,
    content: [{ type: "text", text: "RepoBound INTERNAL: An unexpected error occurred." }],
  };
}

async function mappedResult(
  application: BoundContextForgeApplication,
  action: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await action();
  } catch (error) {
    return errorResult(error, application.rootRealPath);
  }
}

export function createContextForgeMcpServer(
  application: BoundContextForgeApplication,
  version: string,
): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version },
    { instructions: MCP_SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "status",
    {
      title: "RepoBound Status",
      description: "Check whether the bound repository has a current RepoBound index.",
      inputSchema: z.object({}).strict(),
      outputSchema: statusOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => mappedResult(application, async () => {
      const status = await application.status();
      const compact = {
        repository: status.repository.name,
        indexAvailable: status.index.available,
        generation: status.index.generation,
        indexSchemaVersion: status.index.schemaVersion,
        indexStatus: status.indexStatus,
        rankingStrategy: status.rankingStrategy,
        packingStrategy: status.packingStrategy,
        tokenEstimator: status.tokenEstimator,
        tokenEstimatorVersion: status.tokenEstimatorVersion,
        ...diagnostics(status.diagnostics),
      };
      return {
        content: [{ type: "text", text: `${JSON.stringify(compact)}\n` }],
        structuredContent: compact,
      };
    }),
  );

  server.registerTool(
    "index",
    {
      title: "Build RepoBound Index",
      description: "Build or refresh the bound repository's local RepoBound index without modifying source files.",
      inputSchema: z.object({}).strict(),
      outputSchema: indexOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async () => mappedResult(application, async () => {
      const summary = await application.index();
      const compact = {
        generation: summary.generation,
        files: summary.files,
        symbols: summary.symbols,
        imports: summary.imports,
        graphEdges: summary.graph.edges,
        durationMs: summary.performance.totalMs,
        ...diagnostics(summary.diagnostics),
      };
      return {
        content: [{ type: "text", text: `${JSON.stringify(compact)}\n` }],
        structuredContent: compact,
      };
    }),
  );

  server.registerTool(
    "search",
    {
      title: "Search RepoBound Index",
      description: "Find files and symbols relevant to a coding task using RepoBound's indexed structural ranking.",
      inputSchema: z.object({
        task: taskSchema,
        limit: z.number().int().min(1).max(STRUCTURAL_V1.cli.maximumLimit).optional(),
      }).strict(),
      outputSchema: searchOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ task, limit }) => mappedResult(application, async () => {
      const execution = await application.search({ task, ...(limit === undefined ? {} : { limit }) });
      const result = execution.result;
      const compact = {
        generation: result.generation,
        rankingStrategy: result.rankingStrategy,
        indexStatus: result.indexStatus.status,
        candidateCount: result.candidates.length,
        candidates: result.candidates.map((candidate) => ({
          relativePath: candidate.relativePath,
          score: candidate.score,
          origin: candidate.origin,
          graphDistance: candidate.graphDistance,
          relevantSymbols: candidate.relevantSymbols
            .slice(0, MAXIMUM_SYMBOLS_PER_CANDIDATE)
            .map((symbol) => boundedText(symbol.qualifiedName, MAXIMUM_DIAGNOSTIC_LENGTH)),
          reasons: candidate.scoreContributions
            .slice(0, MAXIMUM_REASONS_PER_CANDIDATE)
            .map((reason) => boundedText(reason.reason, MAXIMUM_DIAGNOSTIC_LENGTH)),
        })),
        ...diagnostics(result.diagnostics),
      };
      const lines = [
        `RepoBound Search — generation ${compact.generation} — ${compact.indexStatus}`,
        ...compact.candidates.map((candidate, index) => `${index + 1}. ${candidate.relativePath} (${candidate.score.toFixed(2)})`),
      ];
      return {
        content: [{ type: "text", text: `${lines.join("\n")}\n` }],
        structuredContent: compact,
      };
    }),
  );

  server.registerTool(
    "pack",
    {
      title: "Build RepoBound Pack",
      description: "Compile coding-task context from the bound repository into a deterministic hard-budget payload.",
      inputSchema: z.object({
        task: taskSchema,
        budget: z.number().int().min(1).max(PACK_V1.maximumBudget),
      }).strict(),
      outputSchema: packOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ task, budget }) => mappedResult(application, async () => {
      const execution = await application.pack({ task, budget });
      const manifest = execution.manifest;
      const selectedItems = manifest.selectedItems.map((item) => ({
        relativePath: item.relativePath,
        ranges: item.selectedRanges.map(({ startLine, endLine }) => ({ startLine, endLine })),
      }));
      const compact = {
        generation: manifest.generation,
        indexStatus: manifest.indexStatus.status,
        packStatus: manifest.packStatus,
        rankingStrategy: manifest.rankingStrategy,
        packingStrategy: manifest.packingStrategy,
        tokenEstimator: manifest.tokenEstimator,
        tokenEstimatorVersion: manifest.tokenEstimatorVersion,
        requestedBudget: manifest.requestedBudget,
        estimatedTokens: manifest.estimatedPayloadTokens,
        selectedFileCount: selectedItems.length,
        selectedRangeCount: selectedItems.reduce((count, item) => count + item.ranges.length, 0),
        selectedItems,
        ...diagnostics(manifest.diagnostics),
      };
      return {
        content: [{ type: "text", text: execution.markdown }],
        structuredContent: compact,
      };
    }),
  );

  return server;
}

export function serveContextForgeMcpStdio(
  application: BoundContextForgeApplication,
  version: string,
): StdioServerHandle {
  return serveStdio(
    () => createContextForgeMcpServer(application, version),
    {
      onerror: () => {
        process.stderr.write("RepoBound MCP_PROTOCOL_ERROR: The MCP transport reported an error.\n");
      },
    },
  );
}

export function startContextForgeMcpStdio(
  application: BoundContextForgeApplication,
  version: string,
): StdioServerHandle {
  const handle = serveContextForgeMcpStdio(application, version);
  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    void handle.close().catch(() => {
      process.stderr.write("RepoBound MCP_SHUTDOWN_ERROR: The MCP server did not close cleanly.\n");
      process.exitCode = 70;
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  return handle;
}
