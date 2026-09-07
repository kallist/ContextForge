import { createInterface } from "node:readline";
import { SqliteCapsuleHistory } from "../../src/adapters/sqlite/sqlite-capsule-history.js";
import { readCapsule } from "../../src/adapters/filesystem/capsule-reader.js";
const [directory, capsuleFile] = process.argv.slice(2);
if (directory === undefined || capsuleFile === undefined) throw new Error("Missing fixture inputs.");
const capsule = await readCapsule(capsuleFile);
const input = createInterface({ input: process.stdin });
process.stdout.write("READY\n");
for await (const line of input) {
  if (line !== "SAVE") throw new Error("Unknown fixture barrier.");
  const store = new SqliteCapsuleHistory(directory);
  try { store.save(capsule); process.stdout.write("SAVED\n"); } finally { store.close(); }
  input.close(); break;
}
