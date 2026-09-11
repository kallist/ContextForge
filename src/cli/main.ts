#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { readCapsule } from "../adapters/filesystem/capsule-reader.js";
import { explainContext, explainQuerySchema, renderExplain } from "../core/explain-context.js";
import { validateCapsule } from "../core/context-capsule.js";
import { LIFECYCLE_HELP, runLifecycle } from "./lifecycle.js";
import { REVIEW_HELP, runReview } from "./review.js";

import { FileSystemOutputArtifactWriter } from "../adapters/filesystem/output-artifact-writer.js";
import { FileSystemRepositoryScanner } from "../adapters/filesystem/repository-scanner.js";
import { startContextForgeMcpStdio } from "../adapters/mcp/contextforge-mcp-server.js";
import { SqliteIndexRepository } from "../adapters/sqlite/sqlite-index-repository.js";
import { validateTokenBudget } from "../application/build-context-pack.js";
import { inspectIndex } from "../application/inspect-index.js";
import { inspectRepositoryGraph } from "../application/inspect-repository-graph.js";
import { mapRepository } from "../application/map-repository.js";
import { createContextForgeApplication } from "../composition/contextforge-application.js";
import { ContextForgeError } from "../core/errors.js";
import { STRUCTURAL_V1 } from "../core/ranking/structural-v1.js";
import {
  formatIndexJson,
  formatIndexText,
  formatInspectionJson,
  formatInspectionText,
  formatGraphJson,
  formatGraphText,
  formatJson,
  formatSearchJson,
  formatSearchText,
  formatText,
} from "./format.js";

const HELP = `ContextForge — safe repository context discovery

Usage:
  contextforge map [repository] [--json]
  contextforge index [repository] [--json]
  contextforge inspect <relative-path> [repository] [--json]
  contextforge graph <relative-path> [repository] [--json]
  contextforge search <task> [repository] [--limit <n>] [--json]
  contextforge pack <task> [repository] --budget <tokens> [--json] [--out <path>] [--capsule <path>]
  contextforge explain <capsule> [--query <type>] [--subject <id-or-path>] [--json]
  contextforge mcp [--repository <path>]
  contextforge --help
  contextforge --version

Commands:
  map       Discover and classify repository files without emitting file contents.
  index     Analyze safe source files and atomically activate a durable index generation.
  inspect   Read one file's symbols and imports from the active index (no ranking).
  graph     Inspect one file's structural relationships and Git signals (no ranking).
  search    Retrieve and explain task-relevant ranked candidates from the active index.
  pack      Compile ranked repository context into a deterministic hard-budget payload.
  explain   Inspect recorded compiler decisions offline from a Context Capsule.
  mcp       Serve status, index, search, and pack tools over local MCP stdio.

Options:
  --json    Emit the selected command's stable JSON contract.
  --limit   Limit search output (default ${STRUCTURAL_V1.cli.defaultLimit}, maximum ${STRUCTURAL_V1.cli.maximumLimit}).
  --budget  Required positive token-estimate limit for the final Pack Markdown payload.
  --out     Write the selected Markdown or JSON artifact without overwriting an existing path.
  --capsule Export source-free provenance; payloadHash always identifies Pack Markdown.
  --query   SUMMARY (default), WHY_SELECTED, WHY_DROPPED, WHY_EXCLUDED, BUDGET, STRATEGY.
  --subject Candidate ID, repository-relative path or symbol for an Explain WHY query.
  --repository Bind the MCP server to one repository (default: current directory).
  --help    Show this help.
  --version Show the package version.
`;

async function packageVersion(): Promise<string> {
  const packageDocument = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as {
    version?: unknown;
  };
  if (typeof packageDocument.version !== "string") throw new Error("Package version is unavailable.");
  return packageDocument.version;
}

function usageError(message: string): ContextForgeError {
  return new ContextForgeError("USAGE", `${message}\nRun 'contextforge --help' for usage.`);
}

export async function run(argv: readonly string[], workingDirectory = process.cwd()): Promise<number> {
  const review = await runReview(argv, workingDirectory);
  if (review !== null) return review;
  const lifecycle = await runLifecycle(argv, workingDirectory);
  if (lifecycle !== null) return lifecycle;
  const separatedBudgetIndex = argv.indexOf("--budget");
  const separatedBudget = separatedBudgetIndex < 0 ? undefined : argv[separatedBudgetIndex + 1];
  if (separatedBudget !== undefined && /^-\d/u.test(separatedBudget)) {
    validateTokenBudget(Number(separatedBudget));
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean" },
        json: { type: "boolean" },
        limit: { type: "string" },
        budget: { type: "string" },
        out: { type: "string" },
        repository: { type: "string" },
        version: { type: "boolean" },
        capsule: { type: "string" },
        query: { type: "string" },
        subject: { type: "string" },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";
    throw usageError(message);
  }

  if (parsed.values.help === true) {
    process.stdout.write(HELP + LIFECYCLE_HELP + REVIEW_HELP);
    return 0;
  }
  const version = await packageVersion();
  if (parsed.values.version === true) {
    process.stdout.write(`${version}\n`);
    return 0;
  }
  const [command, first, second, ...extra] = parsed.positionals;
  if (extra.length > 0) throw usageError("Too many positional arguments.");
  if (command !== "pack" && parsed.values.capsule !== undefined) throw usageError("The --capsule option is only valid for pack.");
  if (command !== "explain" && (parsed.values.query !== undefined || parsed.values.subject !== undefined)) throw usageError("The --query and --subject options are only valid for explain.");
  if (command === "explain") {
    if (first === undefined || second !== undefined || parsed.values.limit !== undefined || parsed.values.budget !== undefined || parsed.values.out !== undefined || parsed.values.repository !== undefined) throw usageError("Explain requires one Capsule path and Explain options only.");
    const query = explainQuerySchema.safeParse({ type: parsed.values.query ?? "SUMMARY", ...(parsed.values.subject === undefined ? {} : { subject: parsed.values.subject }) });
    if (!query.success) throw usageError("Invalid Explain query or missing subject.");
    const result = explainContext(await readCapsule(resolve(workingDirectory, first)), query.data);
    process.stdout.write(parsed.values.json === true ? `${JSON.stringify(result, null, 2)}\n` : renderExplain(result));
    return 0;
  }
  const scanner = new FileSystemRepositoryScanner();
  const repositoryFactory = (rootRealPath: string): SqliteIndexRepository => new SqliteIndexRepository(rootRealPath);
  if (command !== "mcp" && parsed.values.repository !== undefined) {
    throw usageError("The --repository option is only valid for mcp.");
  }
  const rejectPackOptions = (): void => {
    if (parsed.values.budget !== undefined || parsed.values.out !== undefined) {
      throw usageError("The --budget and --out options are only valid for pack.");
    }
  };

  if (command === "map") {
    rejectPackOptions();
    if (parsed.values.limit !== undefined) throw usageError("The --limit option is only valid for search.");
    if (second !== undefined) throw usageError("Too many positional arguments.");
    const map = await mapRepository(scanner, { repositoryPath: first ?? workingDirectory }, version);
    process.stdout.write(parsed.values.json === true ? formatJson(map) : formatText(map));
    return 0;
  }
  if (command === "index") {
    rejectPackOptions();
    if (parsed.values.limit !== undefined) throw usageError("The --limit option is only valid for search.");
    if (second !== undefined) throw usageError("Too many positional arguments.");
    const summary = await (await createContextForgeApplication(first ?? workingDirectory)).index();
    process.stdout.write(parsed.values.json === true ? formatIndexJson(summary) : formatIndexText(summary));
    return 0;
  }
  if (command === "inspect") {
    rejectPackOptions();
    if (parsed.values.limit !== undefined) throw usageError("The --limit option is only valid for search.");
    if (first === undefined) throw usageError("The inspect command requires a repository-relative file path.");
    const inspection = await inspectIndex(scanner, repositoryFactory, second ?? workingDirectory, first.replaceAll("\\", "/"));
    process.stdout.write(parsed.values.json === true ? formatInspectionJson(inspection) : formatInspectionText(inspection));
    return 0;
  }
  if (command === "graph") {
    rejectPackOptions();
    if (parsed.values.limit !== undefined) throw usageError("The --limit option is only valid for search.");
    if (first === undefined) throw usageError("The graph command requires a repository-relative file path.");
    const inspection = await inspectRepositoryGraph(scanner, repositoryFactory, second ?? workingDirectory, first.replaceAll("\\", "/"));
    process.stdout.write(parsed.values.json === true ? formatGraphJson(inspection) : formatGraphText(inspection));
    return 0;
  }
  if (command === "search") {
    rejectPackOptions();
    if (first === undefined) throw usageError("The search command requires a coding task.");
    const parsedLimit = parsed.values.limit === undefined ? undefined : Number(parsed.values.limit);
    if (parsedLimit !== undefined && (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > STRUCTURAL_V1.cli.maximumLimit)) {
      throw usageError(`The --limit value must be an integer from 1 to ${STRUCTURAL_V1.cli.maximumLimit}.`);
    }
    const execution = await (await createContextForgeApplication(second ?? workingDirectory)).search({
      task: first,
      ...(parsedLimit === undefined ? {} : { limit: parsedLimit }),
    });
    process.stdout.write(parsed.values.json === true ? formatSearchJson(execution.result) : formatSearchText(execution.result));
    return 0;
  }
  if (command === "pack") {
    if (parsed.values.limit !== undefined) throw usageError("The --limit option is only valid for search.");
    if (first === undefined) throw usageError("The pack command requires a coding task.");
    if (parsed.values.budget === undefined) throw usageError("The pack command requires --budget <tokens>.");
    const budget = Number(parsed.values.budget);
    validateTokenBudget(budget);
    if (parsed.values.capsule !== undefined && parsed.values.out !== undefined && resolve(workingDirectory, parsed.values.capsule) === resolve(workingDirectory, parsed.values.out)) throw usageError("Context and Capsule output paths must differ.");
    const execution = await (await createContextForgeApplication(second ?? workingDirectory)).pack({ task: first, budget, ...(parsed.values.capsule === undefined ? {} : { captureCapsule: true }) });
    const output = parsed.values.json === true
      ? `${JSON.stringify(execution.manifest, null, 2)}\n`
      : execution.markdown;
    if (parsed.values.capsule !== undefined) {
      const capsule = validateCapsule(execution.capsule);
      await new FileSystemOutputArtifactWriter().writeExclusive(resolve(workingDirectory, parsed.values.capsule), `${JSON.stringify(capsule, null, 2)}\n`);
    }
    if (parsed.values.out === undefined) process.stdout.write(output);
    else await new FileSystemOutputArtifactWriter().writeExclusive(resolve(workingDirectory, parsed.values.out), output);
    for (const diagnostic of execution.manifest.diagnostics) {
      process.stderr.write(`ContextForge PACK_DIAGNOSTIC: ${diagnostic}\n`);
    }
    return 0;
  }
  if (command === "mcp") {
    if (first !== undefined || second !== undefined) throw usageError("The mcp command accepts repository binding only through --repository.");
    if (
      parsed.values.json !== undefined ||
      parsed.values.limit !== undefined ||
      parsed.values.budget !== undefined ||
      parsed.values.out !== undefined
    ) {
      throw usageError("The --json, --limit, --budget, and --out options are not valid for mcp.");
    }
    const application = await createContextForgeApplication(parsed.values.repository ?? workingDirectory);
    startContextForgeMcpStdio(application, version);
    return 0;
  }
  throw usageError(command === undefined ? "A command is required." : `Unknown command: ${command}`);
}

async function main(): Promise<void> {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ContextForgeError) {
      process.stderr.write(`ContextForge ${error.code}: ${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    process.stderr.write("ContextForge INTERNAL: An unexpected error occurred.\n");
    process.exitCode = 70;
  }
}

await main();
