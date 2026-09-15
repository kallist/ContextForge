import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const npmCliPath = process.env.npm_execpath;
if (typeof npmCliPath !== "string" || npmCliPath.length === 0) {
  throw new Error("Release check must be started through npm.");
}

const evidenceCheck = spawnSync(process.execPath, [resolve(repositoryRoot, "scripts", "release-evidence-check.mjs")], {
  cwd: repositoryRoot, env: process.env, stdio: "inherit", windowsHide: true,
});
if (evidenceCheck.error !== undefined) throw evidenceCheck.error;
if (evidenceCheck.status !== 0) process.exit(evidenceCheck.status ?? 1);

const commands = [
  "lint",
  "typecheck",
  "test",
  "build",
  "smoke",
  "package:smoke",
  "release:hardening",
  "benchmark:validate",
  "benchmark:smoke",
];

for (const script of commands) {
  process.stdout.write(`\n=== npm run ${script} ===\n`);
  const result = spawnSync(process.execPath, [npmCliPath, "run", script], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const packageDocument = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
const releaseBlockers = [];
let licensePresent = true;
try {
  await access(resolve(repositoryRoot, "LICENSE"));
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") licensePresent = false;
  else throw error;
}
if (packageDocument.license === "UNLICENSED" || !licensePresent) releaseBlockers.push("LICENSE_DECISION_REQUIRED");
if (packageDocument.private === true) releaseBlockers.push("PUBLICATION_DISABLED");
if (packageDocument.name !== "@kallist/contextforge") releaseBlockers.push("PACKAGE_IDENTITY_INCORRECT");
if (packageDocument.version !== "0.5.0") releaseBlockers.push("PACKAGE_VERSION_INCORRECT");
if (packageDocument.bin?.contextforge !== "dist/cli/main.js") releaseBlockers.push("CLI_BIN_INCORRECT");
if (typeof packageDocument.version !== "string" || packageDocument.version.includes("-dev.")) {
  releaseBlockers.push("VERSION_FINALIZATION_REQUIRED");
}
for (const document of [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "docs/RELEASE_CHECKLIST.md",
  "docs/RELEASE_NOTES_V0.5.0.md",
  "docs/V0.2_FINAL_EVALUATION.md",
  "docs/V0.2_RELEASE_REPORT.md",
]) {
  await access(resolve(repositoryRoot, document));
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: "1.0",
  technicalValidation: "PASS",
  publicationPerformed: false,
  publishDryRun: packageDocument.private === true ? "NOT ELIGIBLE: package is private" : "NOT RUN BY RELEASE CHECK",
  releaseReady: releaseBlockers.length === 0,
  releaseBlockers,
}, null, 2)}\n`);
if (releaseBlockers.length > 0) process.exitCode = 1;
