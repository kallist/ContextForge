import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const target = resolve(process.argv[2] ?? "dist/adapters/studio/assets");
await mkdir(target, { recursive: true });
for (const name of ["index.html", "studio.css", "studio.js"]) await cp(new URL(`../src/adapters/studio/assets/${name}`, import.meta.url), resolve(target, name));
