import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync, gunzipSync } from "node:zlib";
import { MAX_CAPSULE_BYTES, parseCapsule, validateCapsule } from "../../core/context-capsule.js";
import { ContextForgeError } from "../../core/errors.js";
import { hasAbsolutePath } from "../../core/capsule-privacy.js";
import type { CapsuleHistory, CapsuleSummary } from "../../application/capsule-history.js";

const MAX_ENTRIES = 2000, MAX_STORED_BYTES = 256 * 1024 * 1024;
function fail(): never { throw new ContextForgeError("HISTORY_ERROR", "Local history is unavailable, corrupt or unsafe. No entry was silently discarded."); }
function checkPath(path: string, directory: boolean, optional = false): void {
  try {
    const s = lstatSync(path);
    if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1)) fail();
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    fail();
  }
}
function safeStorePath(directory: string): string {
  const absolute = resolve(directory), root = parse(absolute).root;
  const ancestors: string[] = [];
  for (let current = absolute; current !== root; current = dirname(current)) ancestors.unshift(current);
  for (const current of ancestors) {
    checkPath(current, true, true);
    mkdirSync(current, { recursive: true, mode: 0o700 });
    checkPath(current, true);
  }
  if (realpathSync(absolute).toLowerCase() !== absolute.toLowerCase()) fail();
  const file = join(absolute, "capsules.sqlite");
  for (const suffix of ["", "-wal", "-shm", "-journal"]) checkPath(file + suffix, false, true);
  return file;
}
function idCheck(id: string): void {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw new ContextForgeError("HISTORY_ERROR", "History ID must be a full Capsule SHA-256.");
}
function summary(row: Record<string, unknown>): CapsuleSummary {
  const r = row as unknown as CapsuleSummary;
  idCheck(r.id);
  if (typeof r.savedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u.test(r.savedAt) || (r.task !== null && (typeof r.task !== "string" || r.task.length > 160 || hasAbsolutePath(r.task))) || ![r.budget, r.tokens, r.selected, r.storedBytes, r.metadataBytes].every((n) => Number.isSafeInteger(n) && n >= 0)) fail();
  return r;
}
const columns = 'id, saved_at AS savedAt, task, budget, tokens, selected, stored_bytes AS storedBytes, metadata_bytes AS metadataBytes';

/** Dedicated source-light store. No source payload or raw task table exists. */
export class SqliteCapsuleHistory implements CapsuleHistory {
  readonly #db: DatabaseSync;
  constructor(directory: string) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(safeStorePath(directory));
      db.enableDefensive(true);
      const version = db.prepare("PRAGMA user_version").get()?.user_version;
      if (version !== 0 && version !== 1) throw new ContextForgeError("UNSUPPORTED_SCHEMA", "Unsupported local history format. Expected history schema 1.");
      db.exec("PRAGMA busy_timeout=750; PRAGMA trusted_schema=OFF; PRAGMA max_page_count=131072;");
      if (version === 0) {
        db.exec("BEGIN IMMEDIATE");
        try {
          const current = db.prepare("PRAGMA user_version").get()?.user_version;
          if (current === 0) {
            if (db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").get()?.count !== 0) fail();
            db.exec("CREATE TABLE capsules (id TEXT PRIMARY KEY, saved_at TEXT NOT NULL, task TEXT, budget INTEGER NOT NULL, tokens INTEGER NOT NULL, selected INTEGER NOT NULL, stored_bytes INTEGER NOT NULL, metadata_bytes INTEGER NOT NULL, body BLOB NOT NULL) STRICT; CREATE INDEX capsule_saved ON capsules(saved_at DESC, id); PRAGMA user_version=1;");
          } else if (current !== 1) throw new ContextForgeError("UNSUPPORTED_SCHEMA", "Unsupported local history format during initialization.");
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
      }
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      if (db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") fail();
      this.#db = db;
    } catch (error) {
      db?.close();
      if (error instanceof ContextForgeError) throw error;
      fail();
    }
  }
  #operation<T>(operation: () => T): T {
    try { return operation(); } catch (error) { if (error instanceof ContextForgeError) throw error; return fail(); }
  }
  save(input: unknown): CapsuleSummary {
    const capsule = validateCapsule(input), json = JSON.stringify(capsule), metadataBytes = Buffer.byteLength(json);
    if (metadataBytes > MAX_CAPSULE_BYTES) throw new ContextForgeError("HISTORY_LIMIT", "Capsule exceeds the 8 MiB history input limit.");
    const body = gzipSync(json);
    return this.#operation(() => {
      this.#db.exec("BEGIN IMMEDIATE");
      try {
        const existing = this.#db.prepare(`SELECT ${columns} FROM capsules WHERE id=?`).get(capsule.capsuleHash);
        if (existing !== undefined) { this.get(capsule.capsuleHash); this.#db.exec("COMMIT"); return summary(existing); }
        const stats = this.stats();
        if (stats.count >= MAX_ENTRIES || stats.storedBytes + body.length > MAX_STORED_BYTES) throw new ContextForgeError("HISTORY_LIMIT", "History capacity reached (2000 Capsules / 256 MiB compressed). Delete or prune entries explicitly.");
        const c = capsule.deterministic;
        this.#db.prepare("INSERT INTO capsules VALUES (?,?,?,?,?,?,?,?,?)").run(capsule.capsuleHash, new Date().toISOString(), c.task.text?.slice(0, 160) ?? null, c.budget.requested, c.budget.estimatedTokens, c.selected.length, body.length, metadataBytes, body);
        const row = this.#db.prepare(`SELECT ${columns} FROM capsules WHERE id=?`).get(capsule.capsuleHash);
        if (row === undefined) fail();
        this.#db.exec("COMMIT");
        return summary(row);
      } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
    });
  }
  list(limit = 30, offset = 0): CapsuleSummary[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > MAX_ENTRIES) throw new ContextForgeError("HISTORY_ERROR", "History queries require limit 1..100 and offset 0..2000.");
    return this.#operation(() => this.#db.prepare(`SELECT ${columns} FROM capsules ORDER BY saved_at DESC, id LIMIT ? OFFSET ?`).all(limit, offset).map(summary));
  }
  get(id: string) {
    idCheck(id);
    return this.#operation(() => {
      const row = this.#db.prepare("SELECT CASE WHEN length(body)<=8388608 THEN body ELSE NULL END AS body, stored_bytes, metadata_bytes FROM capsules WHERE id=?").get(id);
      if (row === undefined) throw new ContextForgeError("HISTORY_MISSING", "No saved Capsule has this identity.");
      if (!(row.body instanceof Uint8Array) || row.body.byteLength !== row.stored_bytes || row.body.byteLength > MAX_CAPSULE_BYTES) fail();
      const bytes = gunzipSync(row.body, { maxOutputLength: MAX_CAPSULE_BYTES });
      if (bytes.byteLength !== row.metadata_bytes) fail();
      const capsule = parseCapsule(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (capsule.capsuleHash !== id) fail();
      return capsule;
    });
  }
  delete(id: string): boolean {
    idCheck(id);
    return this.#operation(() => Number(this.#db.prepare("DELETE FROM capsules WHERE id=?").run(id).changes) === 1);
  }
  prune(keep: number): number {
    if (!Number.isSafeInteger(keep) || keep < 0 || keep > MAX_ENTRIES) throw new ContextForgeError("HISTORY_ERROR", "Prune keep count must be 0..2000.");
    return this.#operation(() => Number(this.#db.prepare("DELETE FROM capsules WHERE id IN (SELECT id FROM capsules ORDER BY saved_at DESC, id LIMIT -1 OFFSET ?)").run(keep).changes));
  }
  stats(): { count: number; storedBytes: number; metadataBytes: number } {
    return this.#operation(() => this.#db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(stored_bytes),0) AS storedBytes, COALESCE(SUM(metadata_bytes),0) AS metadataBytes FROM capsules").get() as unknown as { count: number; storedBytes: number; metadataBytes: number });
  }
  close(): void { this.#db.close(); }
}
