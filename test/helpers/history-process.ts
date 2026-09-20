import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { SqliteCapsuleHistory } from "../../src/adapters/sqlite/sqlite-capsule-history.js";
import { readCapsule } from "../../src/adapters/filesystem/capsule-reader.js";
import { DatabaseSync, StatementSync } from "node:sqlite";
// Fixture-only, source-free failure diagnostics retain the native SQLite operation.
// eslint-disable-next-line @typescript-eslint/unbound-method -- wrappers explicitly preserve the receiver
const originalExec = DatabaseSync.prototype.exec, originalGet = StatementSync.prototype.get;
const mode = process.argv[4] ?? "normal";
let bootstrapPaused = false;
DatabaseSync.prototype.exec = function (sql: string): void {
  if (mode === "hold-bootstrap" && !bootstrapPaused && sql.startsWith("CREATE TABLE capsules")) {
    bootstrapPaused = true;
    process.stdout.write("BOOTSTRAP_LOCKED\n");
    if (readFileSync(3, "utf8").trim() !== "RELEASE") throw new Error("Missing bootstrap release barrier.");
  }
  if (mode === "observe-bootstrap" && sql === "BEGIN IMMEDIATE") process.stdout.write("BOOTSTRAP_BEGIN\n");
  try { originalExec.call(this, sql); } catch (error) {
    console.error("HISTORY_SQLITE_EXEC", sql, (error as { code?: string; errcode?: number }).code, (error as { errcode?: number }).errcode);
    throw error;
  }
};
StatementSync.prototype.get = new Proxy(originalGet, { apply(target, receiver: StatementSync, args: unknown[]): ReturnType<StatementSync["get"]> {
  try { return Reflect.apply(target, receiver, args) as ReturnType<StatementSync["get"]>; } catch (error) {
    console.error("HISTORY_SQLITE_GET", (error as { code?: string; errcode?: number }).code, (error as { errcode?: number }).errcode);
    throw error;
  }
} });
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
