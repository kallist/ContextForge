import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const allowedTargets = new Set(["dist", ".test-dist"]);
const requestedTargets = process.argv.slice(2);
const targets = requestedTargets.length === 0 ? [...allowedTargets] : requestedTargets;

for (const target of targets) {
  if (!allowedTargets.has(target)) {
    throw new Error(`Refusing to clean unsupported target: ${target}`);
  }
  await rm(resolve(target), { force: true, recursive: true });
}
