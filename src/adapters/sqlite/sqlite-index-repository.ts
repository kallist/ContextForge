import { mkdir, stat } from "node:fs/promises";
import { join, parse } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { ContextForgeError } from "../../core/errors.js";
import {
  INDEX_SCHEMA_VERSION,
  type GenerationActivationResult,
  type IndexedFile,
  type IndexRepository,
  type NewIndexGeneration,
  type RepositoryIndexSnapshot,
} from "../../core/repository-index.js";
import type { FileAnalysis, ParserStatus, SupportedLanguage } from "../../core/language-analysis.js";
import {
  REPOSITORY_GRAPH_SCHEMA_VERSION,
  REPOSITORY_GRAPH_VERSION,
  createGraphEdgeId,
  isNormalizedRepositoryPath,
  unavailableGitSignals,
  type GitWorkingTreeStatus,
  type GraphDerivation,
  type GraphEdgeKind,
  type ImportResolutionStatus,
  type RepositoryGraphSnapshot,
} from "../../core/repository-graph.js";
import type { ContentStatus, FileCategory } from "../../core/repository-map.js";

const DEFAULT_BUSY_TIMEOUT_MS = 750;

export type SqliteIndexWritePoint =
  | "after_files"
  | "after_symbols"
  | "after_resolved_imports"
  | "after_test_relationships"
  | "after_documentation_relationships"
  | "before_activation";

export interface SqliteIndexTestHooks {
  onWritePoint?(point: SqliteIndexWritePoint): void | Promise<void>;
}

export interface SqliteIndexRepositoryOptions {
  readonly busyTimeoutMs?: number;
  /** Deterministic failure/concurrency seam for tests; normal construction omits it. */
  readonly testHooks?: SqliteIndexTestHooks;
}

interface GenerationRow {
  readonly id: number;
  readonly analysis_version: string;
  readonly completed_at: string;
  readonly graph_version: string | null;
}

interface FileRow {
  readonly relative_path: string;
  readonly category: string;
  readonly content_status: string;
  readonly size: number | null;
  readonly mtime_ms: number | null;
  readonly content_hash: string | null;
  readonly language: string | null;
  readonly parser_status: string;
  readonly diagnostics_json: string;
}

interface SymbolRow {
  readonly file_path: string;
  readonly symbol_id: string;
  readonly name: string;
  readonly qualified_name: string;
  readonly kind: string;
  readonly parent_symbol_id: string | null;
  readonly exported: number | null;
  readonly is_public: number | null;
  readonly language: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly start_column: number;
  readonly end_column: number;
}

interface ImportRow {
  readonly file_path: string;
  readonly module_specifier: string;
  readonly kind: string;
  readonly names_json: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly start_column: number;
  readonly end_column: number;
}

interface ResolvedImportRow {
  readonly source_file_path: string;
  readonly import_ordinal: number;
  readonly module_specifier: string;
  readonly status: string;
  readonly target_path: string | null;
  readonly candidates_json: string;
  readonly evidence_json: string;
}

interface GraphEdgeRow {
  readonly edge_id: string;
  readonly kind: string;
  readonly source_path: string;
  readonly target_path: string;
  readonly confidence: number;
  readonly derivation: string;
  readonly evidence_json: string;
}

interface GitRepositoryRow {
  readonly status: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly recent_commit_limit: number;
  readonly diagnostic: string | null;
}

interface GitFileRow {
  readonly file_path: string;
  readonly tracked: number;
  readonly working_tree_status: string;
  readonly recent_commit_count: number;
  readonly last_changed_commit: string | null;
  readonly last_changed_at: string | null;
}

function booleanFromSql(value: number | null): boolean | null {
  return value === null ? null : value === 1;
}

function booleanToSql(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function isSqliteBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /database is (locked|busy)/iu.test(error.message) || /SQLITE_BUSY/u.test(error.message);
}

function isSqliteCorrupt(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /SQLITE_(CORRUPT|NOTADB)|database disk image is malformed|file is not a database/iu.test(error.message);
}

function asIndexError(error: unknown): ContextForgeError {
  if (error instanceof ContextForgeError) return error;
  if (isSqliteBusy(error)) {
    return new ContextForgeError("INDEX_BUSY", "Another ContextForge index writer holds the repository database lock.", {
      cause: error,
    });
  }
  if (isSqliteCorrupt(error)) {
    return new ContextForgeError(
      "INDEX_CORRUPT",
      "The local ContextForge index is corrupt or is not a SQLite database. Remove .contextforge/index.sqlite and run 'contextforge index' again.",
      { cause: error },
    );
  }
  return new ContextForgeError("INDEX", "The durable repository index operation failed.", { cause: error });
}

function parseJsonArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) throw new Error("Invalid index JSON array.");
  return parsed;
}

function asDiagnostics(value: string): FileAnalysis["diagnostics"] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("Invalid diagnostics in index.");
  return parsed.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new Error("Invalid diagnostic row in index.");
    }
    const record = item as Record<string, unknown>;
    const code = record["code"];
    const message = record["message"];
    if (typeof code !== "string" || typeof message !== "string") throw new Error("Invalid diagnostic row in index.");
    return { code, message };
  });
}

function databaseExists(path: string): Promise<boolean> {
  return stat(path).then(
    (metadata) => metadata.isFile(),
    (error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false;
      throw error;
    },
  );
}

export class SqliteIndexRepository implements IndexRepository {
  readonly #stateDirectory: string;
  readonly #databasePath: string;
  readonly #busyTimeoutMs: number;
  readonly #testHooks: SqliteIndexTestHooks | undefined;

  constructor(rootRealPath: string, options: SqliteIndexRepositoryOptions = {}) {
    if (process.platform === "win32" && parse(rootRealPath).root.startsWith("\\\\")) {
      throw new ContextForgeError("INDEX", "SQLite WAL index storage is not supported on a UNC network path.");
    }
    this.#stateDirectory = join(rootRealPath, ".contextforge");
    this.#databasePath = join(this.#stateDirectory, "index.sqlite");
    this.#busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    this.#testHooks = options.testHooks;
  }

  get databasePath(): string {
    return this.#databasePath;
  }

  #openDatabase(): DatabaseSync {
    const database = new DatabaseSync(this.#databasePath, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      timeout: this.#busyTimeoutMs,
      defensive: true,
    });
    try {
      database.enableLoadExtension(false);
      database.enableDefensive(true);
      database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA trusted_schema = OFF;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = ${this.#busyTimeoutMs};
        PRAGMA journal_size_limit = 67108864;
        PRAGMA wal_autocheckpoint = 1000;
      `);
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  #initializeSchema(database: DatabaseSync): void {
    const existingStateTable = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'repository_state'")
      .get();
    if (existingStateTable !== undefined) {
      const existingState = database.prepare("SELECT schema_version FROM repository_state WHERE singleton_id = 1").get() as
        | { schema_version?: unknown }
        | undefined;
      if (
        existingState === undefined ||
        (existingState.schema_version !== 1 && existingState.schema_version !== INDEX_SCHEMA_VERSION)
      ) {
        throw new ContextForgeError(
          "UNSUPPORTED_SCHEMA",
          "The local ContextForge index schema is unsupported by this version. Use the ContextForge version that created it or rebuild .contextforge/index.sqlite.",
        );
      }
    }
    const mode = database.prepare("PRAGMA journal_mode = WAL").get() as { journal_mode?: unknown } | undefined;
    if (mode?.journal_mode !== "wal") throw new Error("SQLite did not activate WAL mode.");
    database.exec(`
      CREATE TABLE IF NOT EXISTS repository_state (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        schema_version INTEGER NOT NULL,
        active_generation_id INTEGER NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS index_generation (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('BUILDING', 'COMPLETE')),
        analysis_version TEXT NOT NULL,
        graph_version TEXT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT NULL,
        file_count INTEGER NOT NULL DEFAULT 0,
        symbol_count INTEGER NOT NULL DEFAULT 0,
        import_count INTEGER NOT NULL DEFAULT 0,
        resolved_import_count INTEGER NOT NULL DEFAULT 0,
        graph_edge_count INTEGER NOT NULL DEFAULT 0,
        git_file_signal_count INTEGER NOT NULL DEFAULT 0
      ) STRICT;

      CREATE TABLE IF NOT EXISTS indexed_file (
        generation_id INTEGER NOT NULL,
        relative_path TEXT NOT NULL,
        category TEXT NOT NULL,
        content_status TEXT NOT NULL,
        size INTEGER NULL,
        mtime_ms REAL NULL,
        content_hash TEXT NULL,
        language TEXT NULL,
        parser_status TEXT NOT NULL CHECK (parser_status IN ('parsed', 'degraded', 'unsupported', 'failed')),
        diagnostics_json TEXT NOT NULL,
        PRIMARY KEY (generation_id, relative_path),
        FOREIGN KEY (generation_id) REFERENCES index_generation(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS symbol (
        generation_id INTEGER NOT NULL,
        symbol_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        qualified_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        parent_symbol_id TEXT NULL,
        exported INTEGER NULL CHECK (exported IN (0, 1)),
        is_public INTEGER NULL CHECK (is_public IN (0, 1)),
        language TEXT NOT NULL,
        start_line INTEGER NOT NULL CHECK (start_line >= 1),
        end_line INTEGER NOT NULL CHECK (end_line >= start_line),
        start_column INTEGER NOT NULL CHECK (start_column >= 1),
        end_column INTEGER NOT NULL CHECK (end_column >= 1),
        PRIMARY KEY (generation_id, symbol_id),
        FOREIGN KEY (generation_id, file_path) REFERENCES indexed_file(generation_id, relative_path) ON DELETE CASCADE,
        FOREIGN KEY (generation_id, parent_symbol_id) REFERENCES symbol(generation_id, symbol_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS import_record (
        generation_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        module_specifier TEXT NOT NULL,
        kind TEXT NOT NULL,
        names_json TEXT NOT NULL,
        start_line INTEGER NOT NULL CHECK (start_line >= 1),
        end_line INTEGER NOT NULL CHECK (end_line >= start_line),
        start_column INTEGER NOT NULL CHECK (start_column >= 1),
        end_column INTEGER NOT NULL CHECK (end_column >= 1),
        PRIMARY KEY (generation_id, file_path, ordinal),
        FOREIGN KEY (generation_id, file_path) REFERENCES indexed_file(generation_id, relative_path) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS resolved_import (
        generation_id INTEGER NOT NULL,
        source_file_path TEXT NOT NULL,
        import_ordinal INTEGER NOT NULL,
        module_specifier TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('resolved_internal', 'external', 'unresolved', 'ambiguous', 'unsafe')),
        target_path TEXT NULL,
        candidates_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        PRIMARY KEY (generation_id, source_file_path, import_ordinal),
        FOREIGN KEY (generation_id, source_file_path, import_ordinal)
          REFERENCES import_record(generation_id, file_path, ordinal) ON DELETE CASCADE,
        FOREIGN KEY (generation_id, target_path)
          REFERENCES indexed_file(generation_id, relative_path)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS graph_edge (
        generation_id INTEGER NOT NULL,
        edge_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('FILE_IMPORTS_FILE', 'TEST_RELATES_TO_FILE', 'DOCUMENT_RELATES_TO_FILE')),
        source_path TEXT NOT NULL,
        target_path TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        derivation TEXT NOT NULL CHECK (derivation IN ('structural', 'heuristic')),
        evidence_json TEXT NOT NULL,
        PRIMARY KEY (generation_id, edge_id),
        UNIQUE (generation_id, kind, source_path, target_path),
        FOREIGN KEY (generation_id, source_path) REFERENCES indexed_file(generation_id, relative_path) ON DELETE CASCADE,
        FOREIGN KEY (generation_id, target_path) REFERENCES indexed_file(generation_id, relative_path) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS git_repository_signal (
        generation_id INTEGER PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('available', 'unavailable')),
        head TEXT NULL,
        branch TEXT NULL,
        recent_commit_limit INTEGER NOT NULL CHECK (recent_commit_limit >= 0),
        diagnostic TEXT NULL,
        FOREIGN KEY (generation_id) REFERENCES index_generation(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS git_file_signal (
        generation_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        tracked INTEGER NOT NULL CHECK (tracked IN (0, 1)),
        working_tree_status TEXT NOT NULL CHECK (working_tree_status IN ('clean', 'modified', 'added', 'deleted', 'untracked', 'renamed', 'conflicted')),
        recent_commit_count INTEGER NOT NULL CHECK (recent_commit_count >= 0),
        last_changed_commit TEXT NULL,
        last_changed_at TEXT NULL,
        PRIMARY KEY (generation_id, file_path),
        FOREIGN KEY (generation_id) REFERENCES index_generation(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS symbol_file_lookup ON symbol(generation_id, file_path, start_line);
      CREATE INDEX IF NOT EXISTS symbol_name_lookup ON symbol(generation_id, name);
      CREATE INDEX IF NOT EXISTS import_file_lookup ON import_record(generation_id, file_path, ordinal);
      CREATE INDEX IF NOT EXISTS resolved_import_target_lookup ON resolved_import(generation_id, target_path);
      CREATE INDEX IF NOT EXISTS graph_edge_outgoing_lookup ON graph_edge(generation_id, source_path, kind, target_path);
      CREATE INDEX IF NOT EXISTS graph_edge_incoming_lookup ON graph_edge(generation_id, target_path, kind, source_path);

      INSERT INTO repository_state(singleton_id, schema_version, active_generation_id)
      VALUES (1, ${INDEX_SCHEMA_VERSION}, NULL)
      ON CONFLICT(singleton_id) DO NOTHING;
    `);
    const generationColumns = database.prepare("PRAGMA table_info(index_generation)").all() as unknown as { name: string }[];
    const columnNames = new Set(generationColumns.map(({ name }) => name));
    if (!columnNames.has("graph_version")) database.exec("ALTER TABLE index_generation ADD COLUMN graph_version TEXT NULL");
    if (!columnNames.has("resolved_import_count")) database.exec("ALTER TABLE index_generation ADD COLUMN resolved_import_count INTEGER NOT NULL DEFAULT 0");
    if (!columnNames.has("graph_edge_count")) database.exec("ALTER TABLE index_generation ADD COLUMN graph_edge_count INTEGER NOT NULL DEFAULT 0");
    if (!columnNames.has("git_file_signal_count")) database.exec("ALTER TABLE index_generation ADD COLUMN git_file_signal_count INTEGER NOT NULL DEFAULT 0");
    const state = database.prepare("SELECT schema_version FROM repository_state WHERE singleton_id = 1").get() as
      | { schema_version?: unknown }
      | undefined;
    if (state?.schema_version === 1 && INDEX_SCHEMA_VERSION === 2) {
      database.prepare("UPDATE repository_state SET schema_version = ? WHERE singleton_id = 1").run(INDEX_SCHEMA_VERSION);
    } else if (state?.schema_version !== INDEX_SCHEMA_VERSION) {
      throw new ContextForgeError(
        "UNSUPPORTED_SCHEMA",
        "The local ContextForge index schema is unsupported by this version. Use the ContextForge version that created it or rebuild .contextforge/index.sqlite.",
      );
    }
  }

  async #prepareDatabase(): Promise<DatabaseSync> {
    await mkdir(this.#stateDirectory, { recursive: true });
    const database = this.#openDatabase();
    try {
      this.#initializeSchema(database);
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  #readActiveSnapshot(database: DatabaseSync): RepositoryIndexSnapshot | null {
    const repositoryState = database.prepare("SELECT schema_version FROM repository_state WHERE singleton_id = 1").get() as
      | { schema_version: number }
      | undefined;
    if (repositoryState === undefined || (repositoryState.schema_version !== 1 && repositoryState.schema_version !== INDEX_SCHEMA_VERSION)) {
      throw new ContextForgeError(
        "UNSUPPORTED_SCHEMA",
        "The local ContextForge index schema is unsupported by this version. Use the ContextForge version that created it or rebuild .contextforge/index.sqlite.",
      );
    }
    const generationColumns = database.prepare("PRAGMA table_info(index_generation)").all() as unknown as { name: string }[];
    const hasGraphVersion = generationColumns.some(({ name }) => name === "graph_version");
    const generation = database
      .prepare(`
        SELECT g.id, g.analysis_version, g.completed_at, ${hasGraphVersion ? "g.graph_version" : "NULL AS graph_version"}
        FROM repository_state r
        JOIN index_generation g ON g.id = r.active_generation_id
        WHERE r.singleton_id = 1 AND g.status = 'COMPLETE'
      `)
      .get() as GenerationRow | undefined;
    if (generation === undefined) return null;
    const files = database
      .prepare(`
        SELECT relative_path, category, content_status, size, mtime_ms, content_hash,
               language, parser_status, diagnostics_json
        FROM indexed_file WHERE generation_id = ? ORDER BY relative_path
      `)
      .all(generation.id) as unknown as FileRow[];
    const symbols = database
      .prepare(`
        SELECT file_path, symbol_id, name, qualified_name, kind, parent_symbol_id, exported, is_public,
               language, start_line, end_line, start_column, end_column
        FROM symbol WHERE generation_id = ? ORDER BY file_path, start_line, start_column, symbol_id
      `)
      .all(generation.id) as unknown as SymbolRow[];
    const imports = database
      .prepare(`
        SELECT file_path, module_specifier, kind, names_json, start_line, end_line, start_column, end_column
        FROM import_record WHERE generation_id = ? ORDER BY file_path, ordinal
      `)
      .all(generation.id) as unknown as ImportRow[];
    let graph: RepositoryGraphSnapshot | null = null;
    if (generation.graph_version !== null) {
      if (generation.graph_version !== REPOSITORY_GRAPH_VERSION) throw new Error("Unsupported repository graph version.");
      const resolvedImports = database
        .prepare(`
          SELECT source_file_path, import_ordinal, module_specifier, status, target_path, candidates_json, evidence_json
          FROM resolved_import WHERE generation_id = ? ORDER BY source_file_path, import_ordinal
        `)
        .all(generation.id) as unknown as ResolvedImportRow[];
      const edgeRows = database
        .prepare(`
          SELECT edge_id, kind, source_path, target_path, confidence, derivation, evidence_json
          FROM graph_edge WHERE generation_id = ? ORDER BY kind, source_path, target_path, edge_id
        `)
        .all(generation.id) as unknown as GraphEdgeRow[];
      const gitRepository = database
        .prepare(`
          SELECT status, head, branch, recent_commit_limit, diagnostic
          FROM git_repository_signal WHERE generation_id = ?
        `)
        .get(generation.id) as GitRepositoryRow | undefined;
      if (gitRepository === undefined) throw new Error("Repository graph is missing its Git availability record.");
      const gitFiles = database
        .prepare(`
          SELECT file_path, tracked, working_tree_status, recent_commit_count, last_changed_commit, last_changed_at
          FROM git_file_signal WHERE generation_id = ? ORDER BY file_path
        `)
        .all(generation.id) as unknown as GitFileRow[];
      graph = {
        schemaVersion: REPOSITORY_GRAPH_SCHEMA_VERSION,
        version: REPOSITORY_GRAPH_VERSION,
        resolvedImports: resolvedImports.map((item) => ({
          sourcePath: item.source_file_path,
          importOrdinal: item.import_ordinal,
          moduleSpecifier: item.module_specifier,
          status: item.status as ImportResolutionStatus,
          targetPath: item.target_path,
          candidates: parseJsonArray(item.candidates_json),
          evidence: parseJsonArray(item.evidence_json),
        })),
        edges: edgeRows.map((edge) => ({
          id: edge.edge_id,
          kind: edge.kind as GraphEdgeKind,
          sourcePath: edge.source_path,
          targetPath: edge.target_path,
          confidence: edge.confidence,
          derivation: edge.derivation as GraphDerivation,
          evidence: parseJsonArray(edge.evidence_json),
        })),
        git:
          gitRepository.status === "available"
            ? {
                status: "available",
                head: gitRepository.head,
                branch: gitRepository.branch,
                recentCommitLimit: gitRepository.recent_commit_limit,
                files: gitFiles.map((file) => ({
                  relativePath: file.file_path,
                  tracked: file.tracked === 1,
                  workingTreeStatus: file.working_tree_status as GitWorkingTreeStatus,
                  recentCommitCount: file.recent_commit_count,
                  lastChangedCommit: file.last_changed_commit,
                  lastChangedAt: file.last_changed_at,
                })),
                diagnostic: null,
              }
            : unavailableGitSignals(gitRepository.diagnostic ?? "Git signals were unavailable.", gitRepository.recent_commit_limit),
      };
    }

    const symbolsByFile = Map.groupBy(symbols, (row) => row.file_path);
    const importsByFile = Map.groupBy(imports, (row) => row.file_path);
    const indexedFiles: IndexedFile[] = files.map((file) => ({
      relativePath: file.relative_path,
      category: file.category as FileCategory,
      contentStatus: file.content_status as ContentStatus,
      size: file.size,
      mtimeMs: file.mtime_ms,
      contentHash: file.content_hash,
      analysis: {
        schemaVersion: "1.0",
        relativePath: file.relative_path,
        language: file.language as SupportedLanguage | null,
        parserStatus: file.parser_status as ParserStatus,
        diagnostics: asDiagnostics(file.diagnostics_json),
        symbols: (symbolsByFile.get(file.relative_path) ?? []).map((symbol) => ({
          id: symbol.symbol_id,
          name: symbol.name,
          qualifiedName: symbol.qualified_name,
          kind: symbol.kind as FileAnalysis["symbols"][number]["kind"],
          relativePath: file.relative_path,
          parentSymbolId: symbol.parent_symbol_id,
          exported: booleanFromSql(symbol.exported),
          public: booleanFromSql(symbol.is_public),
          language: symbol.language as SupportedLanguage,
          startLine: symbol.start_line,
          endLine: symbol.end_line,
          startColumn: symbol.start_column,
          endColumn: symbol.end_column,
        })),
        imports: (importsByFile.get(file.relative_path) ?? []).map((imported) => ({
          relativePath: file.relative_path,
          moduleSpecifier: imported.module_specifier,
          kind: imported.kind as FileAnalysis["imports"][number]["kind"],
          names: parseJsonArray(imported.names_json),
          startLine: imported.start_line,
          endLine: imported.end_line,
          startColumn: imported.start_column,
          endColumn: imported.end_column,
        })),
      },
    }));
    return {
      generation: generation.id,
      analysisVersion: generation.analysis_version,
      completedAt: generation.completed_at,
      files: indexedFiles,
      graph,
    };
  }

  async loadActive(): Promise<RepositoryIndexSnapshot | null> {
    try {
      if (!(await databaseExists(this.#databasePath))) return null;
    } catch (error) {
      throw asIndexError(error);
    }
    let database: DatabaseSync | undefined;
    try {
      database = this.#openDatabase();
      database.exec("BEGIN");
      const snapshot = this.#readActiveSnapshot(database);
      database.exec("COMMIT");
      return snapshot;
    } catch (error) {
      try {
        database?.exec("ROLLBACK");
      } catch {
        // Preserve the original read failure.
      }
      throw asIndexError(error);
    } finally {
      database?.close();
    }
  }

  async activateGeneration(generation: NewIndexGeneration): Promise<GenerationActivationResult> {
    return this.buildAndActivate(generation.analysisVersion, () => Promise.resolve(generation));
  }

  async buildAndActivate(
    analysisVersion: string,
    builder: (previous: RepositoryIndexSnapshot | null) => Promise<NewIndexGeneration>,
  ): Promise<GenerationActivationResult> {
    let database: DatabaseSync | undefined;
    let committedGeneration: number | undefined;
    let sqliteWriteMs: number | undefined;
    try {
      database = await this.#prepareDatabase();
      database.exec("BEGIN IMMEDIATE");
      const next = database.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM index_generation").get() as { id: number };
      const generationId = next.id;
      const now = new Date().toISOString();
      database
        .prepare("INSERT INTO index_generation(id, status, analysis_version, created_at) VALUES (?, 'BUILDING', ?, ?)")
        .run(generationId, analysisVersion, now);
      const previous = this.#readActiveSnapshot(database);
      const generation = await builder(previous);
      if (generation.analysisVersion !== analysisVersion) throw new Error("Generation analysis version changed during build.");
      const sqliteWriteStarted = performance.now();

      const insertFile = database.prepare(`
        INSERT INTO indexed_file(
          generation_id, relative_path, category, content_status, size, mtime_ms, content_hash,
          language, parser_status, diagnostics_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const file of generation.files) {
        insertFile.run(
          generationId,
          file.relativePath,
          file.category,
          file.contentStatus,
          file.size,
          file.mtimeMs,
          file.contentHash,
          file.analysis.language,
          file.analysis.parserStatus,
          JSON.stringify(file.analysis.diagnostics),
        );
      }
      await this.#testHooks?.onWritePoint?.("after_files");

      const insertSymbol = database.prepare(`
        INSERT INTO symbol(
          generation_id, symbol_id, file_path, name, qualified_name, kind, parent_symbol_id,
          exported, is_public, language, start_line, end_line, start_column, end_column
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const file of generation.files) {
        for (const symbol of file.analysis.symbols) {
          const values: SQLInputValue[] = [
            generationId,
            symbol.id,
            file.relativePath,
            symbol.name,
            symbol.qualifiedName,
            symbol.kind,
            symbol.parentSymbolId,
            booleanToSql(symbol.exported),
            booleanToSql(symbol.public),
            symbol.language,
            symbol.startLine,
            symbol.endLine,
            symbol.startColumn,
            symbol.endColumn,
          ];
          insertSymbol.run(...values);
        }
      }
      await this.#testHooks?.onWritePoint?.("after_symbols");

      const insertImport = database.prepare(`
        INSERT INTO import_record(
          generation_id, file_path, ordinal, module_specifier, kind, names_json,
          start_line, end_line, start_column, end_column
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let importCount = 0;
      let symbolCount = 0;
      for (const file of generation.files) {
        symbolCount += file.analysis.symbols.length;
        file.analysis.imports.forEach((imported, ordinal) => {
          insertImport.run(
            generationId,
            file.relativePath,
            ordinal,
            imported.moduleSpecifier,
            imported.kind,
            JSON.stringify(imported.names),
            imported.startLine,
            imported.endLine,
            imported.startColumn,
            imported.endColumn,
          );
          importCount += 1;
        });
      }

      const graph = generation.graph;
      let resolvedImportCount = 0;
      let graphEdgeCount = 0;
      let gitFileSignalCount = 0;
      if (graph !== undefined) {
        if (graph.schemaVersion !== REPOSITORY_GRAPH_SCHEMA_VERSION || graph.version !== REPOSITORY_GRAPH_VERSION) {
          throw new Error("Generation repository graph version is unsupported.");
        }
        const filePaths = new Set(generation.files.map((file) => file.relativePath));
        const filesByPath = new Map(generation.files.map((file) => [file.relativePath, file]));
        const previousFilePaths = new Set(previous?.files.map((file) => file.relativePath) ?? []);
        const importsByIdentity = new Map<string, FileAnalysis["imports"][number]>();
        for (const file of generation.files) {
          file.analysis.imports.forEach((imported, ordinal) => importsByIdentity.set(`${file.relativePath}\u0000${ordinal}`, imported));
        }
        if (graph.resolvedImports.length !== importsByIdentity.size) throw new Error("Every raw import must have exactly one resolution record.");
        const insertResolvedImport = database.prepare(`
          INSERT INTO resolved_import(
            generation_id, source_file_path, import_ordinal, module_specifier, status,
            target_path, candidates_json, evidence_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const resolutionIdentities = new Set<string>();
        for (const resolved of graph.resolvedImports) {
          const identity = `${resolved.sourcePath}\u0000${resolved.importOrdinal}`;
          const rawImport = importsByIdentity.get(identity);
          if (rawImport === undefined || resolutionIdentities.has(identity)) throw new Error("Resolved import does not match one unique raw import.");
          if (rawImport.moduleSpecifier !== resolved.moduleSpecifier) throw new Error("Resolved import changed the raw module specifier.");
          if (!isNormalizedRepositoryPath(resolved.sourcePath)) throw new Error("Resolved import source path is invalid.");
          if (resolved.targetPath !== null && !filePaths.has(resolved.targetPath)) throw new Error("Resolved import target is not in this generation.");
          if (resolved.status === "resolved_internal" && resolved.targetPath === null) throw new Error("Internal import is missing its target.");
          if (resolved.status !== "resolved_internal" && resolved.targetPath !== null) throw new Error("Non-internal import cannot have a graph target.");
          if (resolved.candidates.some((candidate) => !filePaths.has(candidate))) throw new Error("Import candidate is not in this generation.");
          if (resolved.status === "resolved_internal" && (resolved.candidates.length !== 1 || resolved.candidates[0] !== resolved.targetPath)) {
            throw new Error("Internal import must have exactly its resolved target as candidate.");
          }
          if (resolved.status === "ambiguous" && resolved.candidates.length < 2) throw new Error("Ambiguous import requires multiple candidates.");
          if (resolved.status !== "resolved_internal" && resolved.status !== "ambiguous" && resolved.candidates.length !== 0) {
            throw new Error("External, unresolved, and unsafe imports cannot retain internal candidates.");
          }
          insertResolvedImport.run(
            generationId,
            resolved.sourcePath,
            resolved.importOrdinal,
            resolved.moduleSpecifier,
            resolved.status,
            resolved.targetPath,
            JSON.stringify(resolved.candidates),
            JSON.stringify(resolved.evidence),
          );
          resolutionIdentities.add(identity);
          resolvedImportCount += 1;
        }
        await this.#testHooks?.onWritePoint?.("after_resolved_imports");

        const insertGraphEdge = database.prepare(`
          INSERT INTO graph_edge(
            generation_id, edge_id, kind, source_path, target_path, confidence, derivation, evidence_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const resolvedImportPairs = new Set(
          graph.resolvedImports
            .filter((item) => item.status === "resolved_internal" && item.targetPath !== null)
            .map((item) => `${item.sourcePath}\u0000${item.targetPath ?? ""}`),
        );
        for (const kind of ["FILE_IMPORTS_FILE", "TEST_RELATES_TO_FILE", "DOCUMENT_RELATES_TO_FILE"] as const) {
          for (const edge of graph.edges.filter((candidate) => candidate.kind === kind)) {
            if (!filePaths.has(edge.sourcePath) || !filePaths.has(edge.targetPath)) throw new Error("Graph edge references a file outside this generation.");
            if (edge.id !== createGraphEdgeId(edge.kind, edge.sourcePath, edge.targetPath)) throw new Error("Graph edge identity is not stable.");
            if (edge.confidence < 0 || edge.confidence > 1 || edge.evidence.length === 0) throw new Error("Graph edge evidence is invalid.");
            if (
              edge.kind === "FILE_IMPORTS_FILE" &&
              (edge.derivation !== "structural" || edge.confidence !== 1 || !resolvedImportPairs.has(`${edge.sourcePath}\u0000${edge.targetPath}`))
            ) {
              throw new Error("Import edge must be a structural fact backed by a resolved import.");
            }
            if (edge.kind === "TEST_RELATES_TO_FILE" && filesByPath.get(edge.sourcePath)?.category !== "test") {
              throw new Error("Test relationship source must be an indexed test file.");
            }
            if (edge.kind === "DOCUMENT_RELATES_TO_FILE" && filesByPath.get(edge.sourcePath)?.category !== "documentation") {
              throw new Error("Documentation relationship source must be an indexed documentation file.");
            }
            insertGraphEdge.run(
              generationId,
              edge.id,
              edge.kind,
              edge.sourcePath,
              edge.targetPath,
              edge.confidence,
              edge.derivation,
              JSON.stringify(edge.evidence),
            );
            graphEdgeCount += 1;
          }
          if (kind === "TEST_RELATES_TO_FILE") await this.#testHooks?.onWritePoint?.("after_test_relationships");
          if (kind === "DOCUMENT_RELATES_TO_FILE") await this.#testHooks?.onWritePoint?.("after_documentation_relationships");
        }

        if (
          (graph.git.status === "unavailable" &&
            (graph.git.files.length !== 0 || graph.git.head !== null || graph.git.branch !== null || graph.git.diagnostic.length === 0)) ||
          (graph.git.status === "available" && graph.git.diagnostic !== null)
        ) {
          throw new Error("Git availability record is inconsistent.");
        }
        database.prepare(`
          INSERT INTO git_repository_signal(generation_id, status, head, branch, recent_commit_limit, diagnostic)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          generationId,
          graph.git.status,
          graph.git.head,
          graph.git.branch,
          graph.git.recentCommitLimit,
          graph.git.diagnostic,
        );
        const insertGitFile = database.prepare(`
          INSERT INTO git_file_signal(
            generation_id, file_path, tracked, working_tree_status, recent_commit_count,
            last_changed_commit, last_changed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const file of graph.git.files) {
          if (!isNormalizedRepositoryPath(file.relativePath)) throw new Error("Git file signal path is invalid.");
          if (
            !filePaths.has(file.relativePath) &&
            (file.workingTreeStatus !== "deleted" || !previousFilePaths.has(file.relativePath))
          ) {
            throw new Error("Only a deleted file from the previous safe generation may lack a current file node.");
          }
          insertGitFile.run(
            generationId,
            file.relativePath,
            file.tracked ? 1 : 0,
            file.workingTreeStatus,
            file.recentCommitCount,
            file.lastChangedCommit,
            file.lastChangedAt,
          );
          gitFileSignalCount += 1;
        }
      }

      const actual = database
        .prepare(`
          SELECT
            (SELECT COUNT(*) FROM indexed_file WHERE generation_id = ?) AS files,
            (SELECT COUNT(*) FROM symbol WHERE generation_id = ?) AS symbols,
            (SELECT COUNT(*) FROM import_record WHERE generation_id = ?) AS imports,
            (SELECT COUNT(*) FROM resolved_import WHERE generation_id = ?) AS resolved_imports,
            (SELECT COUNT(*) FROM graph_edge WHERE generation_id = ?) AS graph_edges,
            (SELECT COUNT(*) FROM git_file_signal WHERE generation_id = ?) AS git_files
        `)
        .get(generationId, generationId, generationId, generationId, generationId, generationId) as {
          files: number;
          symbols: number;
          imports: number;
          resolved_imports: number;
          graph_edges: number;
          git_files: number;
        };
      if (
        actual.files !== generation.files.length ||
        actual.symbols !== symbolCount ||
        actual.imports !== importCount ||
        actual.resolved_imports !== resolvedImportCount ||
        actual.graph_edges !== graphEdgeCount ||
        actual.git_files !== gitFileSignalCount
      ) {
        throw new Error("Generation validation count mismatch.");
      }
      const foreignKeyProblems = database.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeyProblems.length > 0) throw new Error("Generation failed foreign-key validation.");

      await this.#testHooks?.onWritePoint?.("before_activation");
      const completedAt = new Date().toISOString();
      database
        .prepare(`
          UPDATE index_generation
          SET status = 'COMPLETE', completed_at = ?, file_count = ?, symbol_count = ?, import_count = ?,
              graph_version = ?, resolved_import_count = ?, graph_edge_count = ?, git_file_signal_count = ?
          WHERE id = ? AND status = 'BUILDING'
        `)
        .run(
          completedAt,
          generation.files.length,
          symbolCount,
          importCount,
          graph?.version ?? null,
          resolvedImportCount,
          graphEdgeCount,
          gitFileSignalCount,
          generationId,
        );
      database.prepare("UPDATE repository_state SET active_generation_id = ? WHERE singleton_id = 1").run(generationId);
      database.exec("COMMIT");
      committedGeneration = generationId;
      sqliteWriteMs = performance.now() - sqliteWriteStarted;
    } catch (error) {
      if (database !== undefined) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // No transaction may have started, or SQLite already rolled it back.
        }
      }
      throw asIndexError(error);
    } finally {
      database?.close();
    }

    if (committedGeneration === undefined || sqliteWriteMs === undefined) {
      throw new ContextForgeError("INDEX", "Index activation did not commit.");
    }
    let cleanupWarning: string | null = null;
    try {
      await this.#cleanupOldGenerations(committedGeneration);
    } catch {
      cleanupWarning = "The new generation is active, but cleanup of older inactive generations was deferred.";
    }
    return { generation: committedGeneration, sqliteWriteMs, cleanupWarning };
  }

  async #cleanupOldGenerations(activeGeneration: number): Promise<void> {
    const database = await this.#prepareDatabase();
    try {
      database.exec("BEGIN IMMEDIATE");
      const previous = database
        .prepare("SELECT MAX(id) AS id FROM index_generation WHERE status = 'COMPLETE' AND id < ?")
        .get(activeGeneration) as { id: number | null };
      if (previous.id === null) {
        database.prepare("DELETE FROM index_generation WHERE id <> ?").run(activeGeneration);
      } else {
        database.prepare("DELETE FROM index_generation WHERE id NOT IN (?, ?)").run(activeGeneration, previous.id);
      }
      database.exec("COMMIT");
      database.exec("PRAGMA wal_checkpoint(PASSIVE)");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve cleanup failure for the caller to report as a warning.
      }
      throw error;
    } finally {
      database.close();
    }
  }

  async journalMode(): Promise<string> {
    let database: DatabaseSync | undefined;
    try {
      database = await this.#prepareDatabase();
      const row = database.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
      return row.journal_mode;
    } catch (error) {
      throw asIndexError(error);
    } finally {
      database?.close();
    }
  }
}
