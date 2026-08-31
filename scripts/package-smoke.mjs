import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const repositoryRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "contextforge-package-smoke-"));
const installRoot = join(temporaryRoot, "install");
const fixtureRoot = join(temporaryRoot, "fixture repo");
const npmCliPath = process.env.npm_execpath;
if (typeof npmCliPath !== "string" || npmCliPath.length === 0) {
  throw new Error("Package smoke must be started through npm so its CLI entry is available.");
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: process.env });
  if (result.status !== 0) {
    const spawnDetail = result.error instanceof Error ? result.error.message : "";
    throw new Error(
      [`Command failed: ${command} ${args.join(" ")}`, spawnDetail, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout;
}

async function packageFiles(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await packageFiles(join(root, entry.name), relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files.sort();
}

async function runMcpFlow(installedCliPath, repositoryPath) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [installedCliPath, "mcp", "--repository", repositoryPath],
    cwd: installRoot,
    stderr: "pipe",
  });
  const stderr = [];
  transport.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));
  const client = new Client(
    { name: "contextforge-package-smoke", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await client.connect(transport);
    if (client.getNegotiatedProtocolVersion() !== "2026-07-28") {
      throw new Error("Installed MCP server did not negotiate the expected modern protocol revision.");
    }
    const tools = await client.listTools();
    if (tools.tools.map(({ name }) => name).join(",") !== "status,index,search,pack") {
      throw new Error("Installed MCP server did not expose the expected bounded tool surface.");
    }
    const status = await client.callTool({ name: "status", arguments: {} });
    if (status.structuredContent?.indexStatus !== "CURRENT") {
      throw new Error("Installed MCP status tool did not observe the CLI-created index.");
    }
    const index = await client.callTool({ name: "index", arguments: {} });
    if (index.structuredContent?.generation !== 2) {
      throw new Error("Installed MCP index tool did not refresh the fixture generation.");
    }
    const search = await client.callTool({ name: "search", arguments: { task: "Smoke.run", limit: 1 } });
    if (search.structuredContent?.candidates?.[0]?.relativePath !== "src/main.ts") {
      throw new Error("Installed MCP search tool did not retrieve the expected fixture file.");
    }
    const pack = await client.callTool({ name: "pack", arguments: { task: "Smoke.run", budget: 2_000 } });
    const markdown = pack.content.find(({ type }) => type === "text")?.text;
    if (typeof markdown !== "string" || !markdown.startsWith("# ContextForge Context Pack\n") || !markdown.includes("src/main.ts")) {
      throw new Error("Installed MCP pack tool did not return the expected Context Markdown payload.");
    }
    const publicOutput = JSON.stringify({ tools, status, index, search, pack });
    if (publicOutput.includes("CONTEXTFORGE_PACKAGE_MCP_SECRET") || publicOutput.includes(repositoryPath)) {
      throw new Error("Installed MCP flow exposed secret content or an absolute repository path.");
    }
  } finally {
    await client.close();
  }
  if (stderr.join("") !== "") throw new Error(`Installed MCP server emitted stderr: ${stderr.join("")}`);
}

try {
  await mkdir(installRoot, { recursive: true });
  await mkdir(join(fixtureRoot, "src"), { recursive: true });
  await writeFile(join(installRoot, "package.json"), '{"name":"contextforge-smoke","private":true}', "utf8");
  await writeFile(
    join(fixtureRoot, "src", "main.ts"),
    'import { ready } from "./ready.js";\nexport class Smoke { run() { return ready; } }\n',
    "utf8",
  );
  await writeFile(join(fixtureRoot, "src", "ready.ts"), "export const ready = true;\n", "utf8");
  await writeFile(join(fixtureRoot, ".env.local"), "CONTEXTFORGE_PACKAGE_MCP_SECRET", "utf8");

  const packedOutput = run(
    process.execPath,
    [npmCliPath, "pack", "--json", "--pack-destination", temporaryRoot],
    repositoryRoot,
  );
  const packed = JSON.parse(packedOutput);
  if (
    packed[0]?.files?.some(({ path }) =>
      !(
        path === "package.json" ||
        path === "LICENSE" ||
        path === "README.md" ||
        path.startsWith("dist/")
      )
    ) === true
  ) {
    throw new Error("npm pack included a file outside the release allowlist.");
  }
  const packageFile = packed[0]?.filename;
  if (typeof packageFile !== "string") throw new Error("npm pack did not report a package filename.");
  const tarballPath = join(temporaryRoot, packageFile);

  run(process.execPath, [npmCliPath, "install", "--no-audit", "--no-fund", tarballPath], installRoot);
  const help = run(process.execPath, [npmCliPath, "exec", "--", "contextforge", "--help"], installRoot);
  if (!help.includes("contextforge map")) throw new Error("Installed CLI help is incomplete.");
  const version = run(process.execPath, [npmCliPath, "exec", "--", "contextforge", "--version"], installRoot).trim();
  const jsonOutput = run(
    process.execPath,
    [npmCliPath, "exec", "--", "contextforge", "map", fixtureRoot, "--json"],
    installRoot,
  );
  const map = JSON.parse(jsonOutput);
  if (map.schemaVersion !== "1.0" || map.entries?.[0]?.path !== "src") {
    throw new Error("Installed CLI did not produce the expected Repository Map.");
  }

  const indexOutput = run(
    process.execPath,
    [npmCliPath, "exec", "--", "contextforge", "index", fixtureRoot, "--json"],
    installRoot,
  );
  const index = JSON.parse(indexOutput);
  if (index.schemaVersion !== "1.0" || index.files?.parsed !== 2 || index.symbols < 2) {
    throw new Error("Installed CLI did not parse and index the fixture repository.");
  }
  const inspectOutput = run(
    process.execPath,
    [npmCliPath, "exec", "--", "contextforge", "inspect", "src/main.ts", fixtureRoot, "--json"],
    installRoot,
  );
  const inspection = JSON.parse(inspectOutput);
  if (
    inspection.file?.analysis?.symbols?.some((symbol) => symbol.qualifiedName === "Smoke.run") !== true ||
    inspection.file?.analysis?.imports?.some((record) => record.moduleSpecifier === "./ready.js") !== true
  ) {
    throw new Error("Installed CLI could not inspect packaged-parser output from SQLite.");
  }
  const graphOutput = run(
    process.execPath,
    [npmCliPath, "exec", "--", "contextforge", "graph", "src/main.ts", fixtureRoot, "--json"],
    installRoot,
  );
  const graph = JSON.parse(graphOutput);
  if (
    graph.imports?.some((edge) => edge.target === "src/ready.ts" && edge.confidence === 1) !== true ||
    graph.importResolutions?.some((record) => record.moduleSpecifier === "./ready.js" && record.status === "resolved_internal") !== true
  ) {
    throw new Error("Installed CLI could not inspect the packaged Repository Graph.");
  }
  const searchOutput = run(
    process.execPath,
    [npmCliPath, "exec", "--", "contextforge", "search", "Smoke.run", fixtureRoot, "--limit", "1", "--json"],
    installRoot,
  );
  const search = JSON.parse(searchOutput);
  if (
    search.rankingStrategy !== "contextforge-structural-v1" ||
    search.indexStatus?.status !== "FRESH" ||
    search.candidates?.[0]?.relativePath !== "src/main.ts" ||
    search.candidates?.[0]?.relevantSymbols?.some((symbol) => symbol.qualifiedName === "Smoke.run") !== true
  ) {
    throw new Error("Installed CLI could not retrieve and explain packaged Search results.");
  }
  const contextMarkdown = run(
    process.execPath,
    [npmCliPath, "exec", "--", "contextforge", "pack", "Smoke.run", fixtureRoot, "--budget", "2000"],
    installRoot,
  );
  if (!contextMarkdown.startsWith("# ContextForge Context Pack\n") || !contextMarkdown.includes("src/main.ts")) {
    throw new Error("Installed CLI could not compile the packaged Context Markdown payload.");
  }
  const contextManifestOutput = run(
    process.execPath,
    [npmCliPath, "exec", "--", "contextforge", "pack", "Smoke.run", fixtureRoot, "--budget", "2000", "--json"],
    installRoot,
  );
  const contextManifest = JSON.parse(contextManifestOutput);
  if (
    contextManifest.packingStrategy !== "contextforge-pack-v1" ||
    contextManifest.tokenEstimator !== "contextforge-generic-v1" ||
    contextManifest.tokenEstimatorVersion !== "1.0" ||
    contextManifest.estimatedPayloadTokens > contextManifest.requestedBudget ||
    contextManifest.selectedItems?.some((item) => item.relativePath === "src/main.ts") !== true
  ) {
    throw new Error("Installed CLI could not produce a valid hard-budget Context Manifest.");
  }

  const installedCliPath = join(installRoot, "node_modules", "contextforge", "dist", "cli", "main.js");
  await runMcpFlow(installedCliPath, fixtureRoot);

  const packageDocument = JSON.parse(await readFile(join(installRoot, "node_modules", "contextforge", "package.json"), "utf8"));
  if (packageDocument.bin?.contextforge !== "dist/cli/main.js") throw new Error("Installed package bin contract is missing.");
  if (version !== packageDocument.version) throw new Error("Installed CLI version differs from package metadata.");
  for (const installScript of ["preinstall", "install", "postinstall", "prepare"]) {
    if (packageDocument.scripts?.[installScript] !== undefined) {
      throw new Error(`Installed package unexpectedly defines ${installScript}.`);
    }
  }
  const installedPackageRoot = join(installRoot, "node_modules", "contextforge");
  const installedFiles = await packageFiles(installedPackageRoot);
  if (installedFiles.some((path) => /(^|\/)(?:test|benchmarks|scripts)(\/|$)|(^|\/)\.env(?:\..*)?$/u.test(path))) {
    throw new Error("Installed package contains development, benchmark, script, or secret-path files.");
  }
  const suspiciousPattern = /C:\\+Users\\+|C:\/Users\/|\/Users\/[^/]+\/|\/home\/[^/]+\/|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|\.codex[\\/]+worktrees|Acodex work/u;
  for (const relativePath of installedFiles.filter((path) => /\.(?:js|map|json|md|d\.ts)$/u.test(path))) {
    const content = await readFile(join(installedPackageRoot, ...relativePath.split("/")), "utf8");
    if (suspiciousPattern.test(content)) throw new Error(`Installed package contains suspicious private metadata in ${relativePath}.`);
  }
  const parserAssetRoot = join(
    installRoot,
    "node_modules",
    "contextforge",
    "dist",
    "adapters",
    "parser",
    "assets",
  );
  for (const asset of [
    "web-tree-sitter.wasm",
    "tree-sitter-javascript.wasm",
    "tree-sitter-typescript.wasm",
    "tree-sitter-tsx.wasm",
    "tree-sitter-python.wasm",
    "grammar-manifest.json",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    await access(join(parserAssetRoot, asset));
  }
  process.stdout.write("Package smoke passed: npm pack, fresh install, packaged WASM parsers, CLI flows, and the official-client MCP stdio flow.\n");
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
