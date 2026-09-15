import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const base = "3598256d6b0bf853c280d74c3a6203d5d130eebc";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/).filter(Boolean);
const paths = [...new Set([...git("diff", "--name-only", base, "--", "src", "benchmarks"), ...git("ls-files", "--others", "--exclude-standard", "--", "src", "benchmarks")])];
const allowed = new Set(["src/adapters/studio/assets/index.html", "src/adapters/studio/assets/studio.css", "src/adapters/studio/assets/studio.js"]);
assert.deepEqual(paths.filter((path) => !allowed.has(path)), [], "V0.5 may only change Studio assets within production source; benchmark files are frozen");
console.log(JSON.stringify({ gate: "V0.5 production and benchmark freeze", base, changedProductionPaths: paths, compiler: "UNCHANGED", ranking: "UNCHANGED", gold: "UNCHANGED", mcp: "UNCHANGED", passed: true }));
