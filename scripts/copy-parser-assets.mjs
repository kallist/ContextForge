import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const [destinationArgument, ...extra] = process.argv.slice(2);
if (destinationArgument === undefined || extra.length > 0) {
  throw new Error("Usage: node scripts/copy-parser-assets.mjs <destination>");
}

const source = resolve(import.meta.dirname, "..", "src", "adapters", "parser", "assets");
const destination = resolve(destinationArgument);
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
