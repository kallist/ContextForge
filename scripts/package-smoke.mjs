import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

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

try {
  await mkdir(installRoot, { recursive: true });
  await mkdir(join(fixtureRoot, "src"), { recursive: true });
  await writeFile(join(installRoot, "package.json"), '{"name":"contextforge-smoke","private":true}', "utf8");
  await writeFile(join(fixtureRoot, "src", "main.ts"), "export const ready = true;\n", "utf8");

  const packedOutput = run(
    process.execPath,
    [npmCliPath, "pack", "--json", "--pack-destination", temporaryRoot],
    repositoryRoot,
  );
  const packed = JSON.parse(packedOutput);
  const packageFile = packed[0]?.filename;
  if (typeof packageFile !== "string") throw new Error("npm pack did not report a package filename.");
  const tarballPath = join(temporaryRoot, packageFile);

  run(process.execPath, [npmCliPath, "install", "--no-audit", "--no-fund", tarballPath], installRoot);
  const help = run(process.execPath, [npmCliPath, "exec", "--", "contextforge", "--help"], installRoot);
  if (!help.includes("contextforge map")) throw new Error("Installed CLI help is incomplete.");
  const jsonOutput = run(
    process.execPath,
    [npmCliPath, "exec", "--", "contextforge", "map", fixtureRoot, "--json"],
    installRoot,
  );
  const map = JSON.parse(jsonOutput);
  if (map.schemaVersion !== "1.0" || map.entries?.[0]?.path !== "src") {
    throw new Error("Installed CLI did not produce the expected Repository Map.");
  }

  const packageDocument = JSON.parse(await readFile(join(installRoot, "node_modules", "contextforge", "package.json"), "utf8"));
  if (packageDocument.bin?.contextforge !== "dist/cli/main.js") throw new Error("Installed package bin contract is missing.");
  process.stdout.write("Package smoke passed: pack, fresh install, --help, and map --json.\n");
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
