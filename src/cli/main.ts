#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { FileSystemRepositoryScanner } from "../adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../adapters/sqlite/sqlite-index-repository.js";
import { buildIndex } from "../application/build-index.js";
import { inspectIndex } from "../application/inspect-index.js";
import { mapRepository } from "../application/map-repository.js";
import { ContextForgeError } from "../core/errors.js";
import {
  formatIndexJson,
  formatIndexText,
  formatInspectionJson,
  formatInspectionText,
  formatJson,
  formatText,
} from "./format.js";

const HELP = `ContextForge — safe repository context discovery

Usage:
  contextforge map [repository] [--json]
  contextforge index [repository] [--json]
  contextforge inspect <relative-path> [repository] [--json]
  contextforge --help
  contextforge --version

Commands:
  map       Discover and classify repository files without emitting file contents.
  index     Analyze safe source files and atomically activate a durable index generation.
  inspect   Read one file's symbols and imports from the active index (no ranking).

Options:
  --json    Emit the selected command's stable JSON contract.
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
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean" },
        json: { type: "boolean" },
        version: { type: "boolean" },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";
    throw usageError(message);
  }

  if (parsed.values.help === true) {
    process.stdout.write(HELP);
    return 0;
  }
  const version = await packageVersion();
  if (parsed.values.version === true) {
    process.stdout.write(`${version}\n`);
    return 0;
  }
  const [command, first, second, ...extra] = parsed.positionals;
  if (extra.length > 0) throw usageError("Too many positional arguments.");
  const scanner = new FileSystemRepositoryScanner();
  const repositoryFactory = (rootRealPath: string): SqliteIndexRepository => new SqliteIndexRepository(rootRealPath);

  if (command === "map") {
    if (second !== undefined) throw usageError("Too many positional arguments.");
    const map = await mapRepository(scanner, { repositoryPath: first ?? workingDirectory }, version);
    process.stdout.write(parsed.values.json === true ? formatJson(map) : formatText(map));
    return 0;
  }
  if (command === "index") {
    if (second !== undefined) throw usageError("Too many positional arguments.");
    const summary = await buildIndex(
      scanner,
      new FileSystemRepositorySourceReader(),
      new TreeSitterLanguageAnalyzer(),
      repositoryFactory,
      { repositoryPath: first ?? workingDirectory },
    );
    process.stdout.write(parsed.values.json === true ? formatIndexJson(summary) : formatIndexText(summary));
    return 0;
  }
  if (command === "inspect") {
    if (first === undefined) throw usageError("The inspect command requires a repository-relative file path.");
    const inspection = await inspectIndex(scanner, repositoryFactory, second ?? workingDirectory, first.replaceAll("\\", "/"));
    process.stdout.write(parsed.values.json === true ? formatInspectionJson(inspection) : formatInspectionText(inspection));
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
