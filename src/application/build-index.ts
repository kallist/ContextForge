import { basename } from "node:path";
import { performance } from "node:perf_hooks";

import type { RepositoryScanner, ScanOptions } from "./map-repository.js";
import { buildRepositoryGraph } from "./build-repository-graph.js";
import type { GitSignalsReader } from "./git-signals.js";
import type { RepositorySourceReader } from "./repository-source.js";
import {
  LANGUAGE_ANALYSIS_SCHEMA_VERSION,
  analysisLanguageForPath,
  unsupportedFileAnalysis,
  type FileAnalysis,
  type LanguageAnalyzer,
} from "../core/language-analysis.js";
import type {
  IndexedFile,
  IndexRepositoryFactory,
  IndexSummary,
} from "../core/repository-index.js";
import type { RepositoryMapEntry } from "../core/repository-map.js";
import { unavailableGitSignals, type DocumentationSource, type GraphBuildPerformance } from "../core/repository-graph.js";

export interface BuildIndexRequest extends ScanOptions {
  readonly repositoryPath: string;
}

const MAXIMUM_DOCUMENT_GRAPH_FILES = 2_000;
const MAXIMUM_DOCUMENT_GRAPH_BYTES = 16 * 1024 * 1024;

function failedAnalysis(entry: RepositoryMapEntry, diagnosticCode: string): FileAnalysis {
  return {
    schemaVersion: LANGUAGE_ANALYSIS_SCHEMA_VERSION,
    relativePath: entry.path,
    language: analysisLanguageForPath(entry.path),
    parserStatus: analysisLanguageForPath(entry.path) === null ? "unsupported" : "failed",
    symbols: [],
    imports: [],
    diagnostics: [{ code: diagnosticCode, message: "The approved repository entry was not stable readable UTF-8 text during indexing." }],
  };
}

export async function buildIndex(
  scanner: RepositoryScanner,
  sourceReader: RepositorySourceReader,
  analyzer: LanguageAnalyzer,
  repositoryFactory: IndexRepositoryFactory,
  request: BuildIndexRequest,
  gitReader: GitSignalsReader = {
    inspect: () => Promise.resolve(unavailableGitSignals("Git signals reader was not configured.")),
  },
): Promise<IndexSummary> {
  const started = performance.now();
  const rootScan = await scanner.scan(request.repositoryPath, request);
  const repository = repositoryFactory(rootScan.rootRealPath);
  let grammarInitializationMs = 0;
  let parsingMs = 0;
  let reused = 0;
  let parsed = 0;
  let files: IndexedFile[] = [];
  let graphPerformance: GraphBuildPerformance = {
    importResolutionMs: 0,
    testRelationshipMs: 0,
    documentationRelationshipMs: 0,
    gitSignalsMs: 0,
    totalMs: 0,
  };
  let graph = null as Awaited<ReturnType<typeof buildRepositoryGraph>>["graph"] | null;
  let documentationGraphBytes = 0;
  let documentationGraphTruncated = false;
  const activation = await repository.buildAndActivate(analyzer.analysisVersion, async (previous) => {
    const scan = await scanner.scan(request.repositoryPath, request);
    if (scan.rootRealPath !== rootScan.rootRealPath) throw new Error("Repository root changed while acquiring the index writer slot.");
    const previousFiles = new Map(previous?.files.map((file) => [file.relativePath, file]) ?? []);
    const eligibleEntries = scan.entries.filter(
      (entry) => (entry.type === "file" || entry.type === "symlink") && entry.skipReason !== "symlink_directory",
    );

    if (eligibleEntries.some((entry) => entry.content === "text" && analysisLanguageForPath(entry.path) !== null)) {
      grammarInitializationMs = (await analyzer.initialize()).durationMs;
    }

    const nextFiles: IndexedFile[] = [];
    const documentationSources: DocumentationSource[] = [];
    for (const entry of eligibleEntries) {
      if (entry.content !== "text") {
        nextFiles.push({
          relativePath: entry.path,
          category: entry.category,
          contentStatus: entry.content,
          size: entry.size,
          mtimeMs: null,
          contentHash: null,
          analysis: failedAnalysis(entry, "SOURCE_NOT_TEXT"),
        });
        continue;
      }

      const source = await sourceReader.readTextFile(scan.rootRealPath, entry);
      if (source.status !== "read") {
        nextFiles.push({
          relativePath: entry.path,
          category: entry.category,
          contentStatus: "changed",
          size: entry.size,
          mtimeMs: null,
          contentHash: null,
          analysis: failedAnalysis(entry, source.diagnosticCode),
        });
        continue;
      }

      if (entry.category === "documentation") {
        const sourceBytes = Buffer.byteLength(source.source, "utf8");
        if (
          documentationSources.length < MAXIMUM_DOCUMENT_GRAPH_FILES &&
          documentationGraphBytes + sourceBytes <= MAXIMUM_DOCUMENT_GRAPH_BYTES
        ) {
          documentationSources.push({ relativePath: entry.path, source: source.source });
          documentationGraphBytes += sourceBytes;
        } else {
          documentationGraphTruncated = true;
        }
      }

      const old = previousFiles.get(entry.path);
      let analysis: FileAnalysis;
      if (
        old !== undefined &&
        old.contentHash === source.contentHash &&
        previous?.analysisVersion === analyzer.analysisVersion
      ) {
        analysis = old.analysis;
        reused += 1;
      } else if (analysisLanguageForPath(entry.path) === null) {
        analysis = unsupportedFileAnalysis(entry.path);
      } else {
        const parseStarted = performance.now();
        analysis = await analyzer.analyze({ relativePath: entry.path, source: source.source });
        parsingMs += performance.now() - parseStarted;
        parsed += 1;
      }
      nextFiles.push({
        relativePath: entry.path,
        category: entry.category,
        contentStatus: entry.content,
        size: source.size,
        mtimeMs: source.mtimeMs,
        contentHash: source.contentHash,
        analysis,
      });
    }
    files = nextFiles;
    const gitApprovedRelativePaths = [...new Set([
      ...nextFiles.map((file) => file.relativePath),
      ...(previous?.files.map((file) => file.relativePath) ?? []),
    ])].sort();
    const graphBuild = await buildRepositoryGraph(
      scan.rootRealPath,
      nextFiles,
      documentationSources,
      gitReader,
      gitApprovedRelativePaths,
    );
    graph = graphBuild.graph;
    graphPerformance = graphBuild.performance;
    return { analysisVersion: analyzer.analysisVersion, files: nextFiles, graph };
  });
  const totalMs = performance.now() - started;
  const diagnostics = [
    ...(activation.cleanupWarning === null ? [] : [activation.cleanupWarning]),
    ...(documentationGraphTruncated
      ? ["Documentation relationship derivation reached its 2,000-file or 16 MiB work limit; remaining documents stay indexed without document edges."]
      : []),
  ];
  return {
    schemaVersion: "1.0",
    repository: { name: basename(rootScan.rootRealPath), root: "." },
    generation: activation.generation,
    files: {
      indexed: files.length,
      unsupported: files.filter(({ analysis }) => analysis.parserStatus === "unsupported").length,
      degraded: files.filter(({ analysis }) => analysis.parserStatus === "degraded").length,
      failed: files.filter(({ analysis }) => analysis.parserStatus === "failed").length,
      reused,
      parsed,
    },
    symbols: files.reduce((count, file) => count + file.analysis.symbols.length, 0),
    imports: files.reduce((count, file) => count + file.analysis.imports.length, 0),
    graph: {
      resolvedImports: graph?.resolvedImports.length ?? 0,
      edges: graph?.edges.length ?? 0,
      importEdges: graph?.edges.filter((edge) => edge.kind === "FILE_IMPORTS_FILE").length ?? 0,
      testEdges: graph?.edges.filter((edge) => edge.kind === "TEST_RELATES_TO_FILE").length ?? 0,
      documentationEdges: graph?.edges.filter((edge) => edge.kind === "DOCUMENT_RELATES_TO_FILE").length ?? 0,
      gitStatus: graph?.git.status ?? "unavailable",
    },
    performance: {
      totalMs,
      grammarInitializationMs,
      parsingMs,
      sqliteWriteMs: activation.sqliteWriteMs,
      graphTotalMs: graphPerformance.totalMs,
      importResolutionMs: graphPerformance.importResolutionMs,
      testRelationshipMs: graphPerformance.testRelationshipMs,
      documentationRelationshipMs: graphPerformance.documentationRelationshipMs,
      gitSignalsMs: graphPerformance.gitSignalsMs,
      filesPerSecond: totalMs === 0 ? 0 : files.length / (totalMs / 1000),
    },
    diagnostics,
  };
}
