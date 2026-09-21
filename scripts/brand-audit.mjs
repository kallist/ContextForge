import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const git = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8", windowsHide: true });
assert.equal(git.status, 0, git.stderr);

const textFile = /(?:^|\/)(?:[^/]+\.(?:c?js|mjs|ts|tsx|json|md|html|css|svg|yml|yaml|toml)|AGENTS|LICENSE)$/u;
const stale = /ContextForge|contextforge|CONTEXTFORGE|@kallist\/contextforge|kallist\/ContextForge|\/ContextForge\//gu;
const counts = {
  HISTORICAL: 0,
  PROTOCOL_SERIALIZED_COMPATIBILITY: 0,
  LEGACY_PACKAGE_EXECUTABLE: 0,
  OLD_PACKAGE_MIGRATION_DOCUMENTATION: 0,
  BACKWARD_COMPATIBILITY_TEST: 0,
};
const unclassified = [];
const machinePaths = [];
const publicBrandFindings = [];

const publicSurfaces = new Set(["README.md", "README_ZH.md", "site/index.html", "repobound/SKILL.md", "repobound/references/workflows.md", "repobound/references/trust-and-boundaries.md"]);
function stripAllowedPublicLegacy(path, line) {
  const allowed = {
    "README.md": [
      "RepoBound is the new name of ContextForge.",
      "Existing ContextForge releases remain available",
      "The historical `@kallist/contextforge@0.5.0` package remains available but deprecated; it provides the old `contextforge` command.",
      "The historical [`@kallist/contextforge@0.5.0`](https://www.npmjs.com/package/@kallist/contextforge) package remains available but deprecated.",
      "`@kallist/contextforge@0.5.0`",
      "[@kallist/contextforge@0.5.0](https://www.npmjs.com/package/@kallist/contextforge)",
      "MIGRATION_FROM_CONTEXTFORGE.md",
    ],
    "README_ZH.md": ["RepoBound 是原 ContextForge 的新名称。", "既有 ContextForge 发布仍然保留", "`@kallist/contextforge@0.5.0`", "`contextforge` 命令", "MIGRATION_FROM_CONTEXTFORGE.md"],
    "site/index.html": ["<code>@kallist/contextforge@0.5.0</code>", "<code>contextforge</code> command"],
  }[path] ?? (path.startsWith("repobound/references/") ? [".contextforge/history", ".contextforgeignore"] : []);
  return allowed.reduce((value, fragment) => value.replaceAll(fragment, ""), line);
}

function findUnexpectedPublicBrand(path, text) {
  const findings = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    const remainder = stripAllowedPublicLegacy(path, line);
    stale.lastIndex = 0;
    if (stale.test(remainder)) findings.push(`${path}:${index + 1}`);
  }
  return findings;
}

function category(path, line) {
  if (/^(?:docs\/v0\.5\/|docs\/(?:V0\.|BENCHMARK|PHASE|RESULTS|RELEASE_REPORT|RELEASE_NOTES_V0\.[0-4]|REVIEW_EVALUATION)|docs\/adr\/ADR-(?!REPOBOUND)|docs\/assets\/contextforge-|CHANGELOG\.md|CONTEXTFORGE_MASTER_SPEC\.md)/u.test(path)) return "HISTORICAL";
  if (/^(?:README(?:_ZH)?\.md|site\/|docs\/brand\/|docs\/adr\/ADR-REPOBOUND|docs\/AGENT_SKILL\.md|docs\/RELEASE_(?:NOTES_V0\.5\.1|CHECKLIST)\.md)/u.test(path)) return "OLD_PACKAGE_MIGRATION_DOCUMENTATION";
  if (/^(?:package(?:-lock)?\.json)$/u.test(path) && /contextforge/u.test(line)) return "LEGACY_PACKAGE_EXECUTABLE";
  if (/^(?:test\/|scripts\/|\.github\/)/u.test(path)) return "BACKWARD_COMPATIBILITY_TEST";
  if (/^(?:src\/|benchmarks\/|repobound\/|docs\/visual\/|docs\/(?:ARCHITECTURE|PRODUCT_SPEC|CONTEXT_CAPSULE|EXPLAIN_CONTRACT|ENGINEERING_REFERENCE)\.md|AGENTS\.md|CONTRIBUTING\.md)/u.test(path)) return "PROTOCOL_SERIALIZED_COMPATIBILITY";
  return undefined;
}

for (const path of git.stdout.split(/\r?\n/u).filter(Boolean).map((value) => value.replaceAll("\\", "/"))) {
  if (!textFile.test(path)) continue;
  let text;
  try { text = readFileSync(path, "utf8"); } catch { continue; }
  const lines = text.split(/\r?\n/u);
  if (publicSurfaces.has(path)) publicBrandFindings.push(...findUnexpectedPublicBrand(path, text));
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    stale.lastIndex = 0;
    if (!stale.test(line)) continue;
    const classified = category(path, line);
    if (classified) counts[classified] += 1;
    else unclassified.push(`${path}:${index + 1}`);
  }
  if (/^(?:README(?:_ZH)?\.md|CONTRIBUTING\.md|SECURITY\.md|docs\/|repobound\/|site\/)/u.test(path)) {
    for (let index = 0; index < lines.length; index += 1) {
      if (/(?:^|[\s("'`])(?:[A-Za-z]:[\\/]|\/Users\/|\/home\/|\.codex[\\/]|worktrees[\\/])/u.test(lines[index])) machinePaths.push(`${path}:${index + 1}`);
    }
  }
}

const packageDocument = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(packageDocument.name, "@kallist/repobound");
assert.equal(packageDocument.version, "0.5.1");
assert.deepEqual(packageDocument.bin, { repobound: "dist/cli/main.js" });
assert.match(readFileSync("site/index.html", "utf8"), /<title>RepoBound/u);
const readme = readFileSync("README.md", "utf8");
const readmeZh = readFileSync("README_ZH.md", "utf8");
const site = readFileSync("site/index.html", "utf8");
const skill = readFileSync("repobound/SKILL.md", "utf8");
const cli = readFileSync("src/cli/main.ts", "utf8");
const studio = readFileSync("src/adapters/studio/assets/index.html", "utf8");
const mcp = readFileSync("src/adapters/mcp/contextforge-mcp-server.ts", "utf8");
assert.match(readme, /^# RepoBound$/mu);
assert.doesNotMatch(readme, /^#{1,6} .*ContextForge.*$/mu);
assert.match(readmeZh, /^# RepoBound$/mu);
assert.doesNotMatch(readmeZh, /^#{1,6} .*ContextForge.*$/mu);
assert.match(site, /<title>RepoBound —/u);
assert.match(site, /<a class="brand" href="#"><span>RB<\/span> RepoBound<\/a>/u);
assert.doesNotMatch(site, /<(?:title|h1|h2|h3|header|nav)[^>]*>[^<]*ContextForge/iu);
assert.match(skill, /^name: repobound$/mu);
assert.match(cli, /RepoBound — safe repository context discovery/u);
assert.doesNotMatch(cli, /ContextForge —|ContextForge (?:PACK_DIAGNOSTIC|INTERNAL)|Run 'contextforge| {2}contextforge /u);
assert.match(studio, /<title>RepoBound Studio<\/title>/u);
assert.doesNotMatch(studio, /ContextForge Studio|◈ ContextForge|supplied by ContextForge|receive from ContextForge|<footer>ContextForge/u);
assert.match(mcp, /title: "RepoBound Status"/u);
assert.doesNotMatch(mcp, /ContextForge (?:Status|INTERNAL|MCP_PROTOCOL_ERROR|MCP_SHUTDOWN_ERROR|Search)|Build ContextForge|Search ContextForge|current ContextForge index|local ContextForge index|ContextForge token-estimate/u);
assert.deepEqual(findUnexpectedPublicBrand("README.md", "# ContextForge\nUse ContextForge."), ["README.md:1", "README.md:2"], "Brand audit negative control must catch a stale README headline and copy");
assert.deepEqual(findUnexpectedPublicBrand("README.md", "Use ContextForge. Existing ContextForge releases remain available."), ["README.md:1"], "Allowed migration text must not mask stale copy on the same line");
assert.deepEqual(findUnexpectedPublicBrand("repobound/SKILL.md", "name: contextforge"), ["repobound/SKILL.md:1"], "Brand audit negative control must catch a stale Skill identity");
assert.deepEqual(unclassified, [], `Unclassified stale-brand matches:\n${unclassified.join("\n")}`);
assert.deepEqual(machinePaths, [], `Machine path leaks:\n${machinePaths.join("\n")}`);
assert.deepEqual(publicBrandFindings, [], `Unexpected stale public branding:\n${publicBrandFindings.join("\n")}`);

console.log(JSON.stringify({ schemaVersion: "repobound-stale-brand-audit-v1", categories: counts, unexpectedPublicBrand: publicBrandFindings.length, unclassified: unclassified.length, machinePathLeaks: machinePaths.length, negativeControls: 3, passed: true }));
