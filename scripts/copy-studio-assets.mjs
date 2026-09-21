import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const target = resolve(process.argv[2] ?? "dist/adapters/studio/assets");
await mkdir(target, { recursive: true });
await cp(new URL("../src/adapters/studio/assets/", import.meta.url), target, { recursive: true });
