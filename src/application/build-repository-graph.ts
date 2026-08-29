import { performance } from "node:perf_hooks";

import type { GitSignalsReader } from "./git-signals.js";
import {
  deriveDocumentationRelationships,
  deriveTestRelationships,
  importEdges,
  resolveRepositoryImports,
} from "../core/derive-repository-graph.js";
import {
  REPOSITORY_GRAPH_SCHEMA_VERSION,
  REPOSITORY_GRAPH_VERSION,
  compareGraphEdges,
  type DocumentationSource,
  type GraphEdge,
  type RepositoryGraphBuild,
} from "../core/repository-graph.js";
import type { IndexedFile } from "../core/repository-index.js";

export async function buildRepositoryGraph(
  rootRealPath: string,
  files: readonly IndexedFile[],
  documents: readonly DocumentationSource[],
  gitReader: GitSignalsReader,
  gitApprovedRelativePaths: readonly string[] = files.map((file) => file.relativePath),
): Promise<RepositoryGraphBuild> {
  const started = performance.now();
  let stepStarted = performance.now();
  const resolvedImports = resolveRepositoryImports(files);
  const importResolutionMs = performance.now() - stepStarted;

  stepStarted = performance.now();
  const testEdges = deriveTestRelationships(files, resolvedImports);
  const testRelationshipMs = performance.now() - stepStarted;

  stepStarted = performance.now();
  const documentationEdges = deriveDocumentationRelationships(files, documents);
  const documentationRelationshipMs = performance.now() - stepStarted;

  stepStarted = performance.now();
  const git = await gitReader.inspect(rootRealPath, gitApprovedRelativePaths);
  const gitSignalsMs = performance.now() - stepStarted;

  const edgeById = new Map<string, GraphEdge>();
  for (const edge of [...importEdges(resolvedImports), ...testEdges, ...documentationEdges]) {
    const previous = edgeById.get(edge.id);
    edgeById.set(
      edge.id,
      previous === undefined
        ? edge
        : {
            ...edge,
            confidence: Math.max(previous.confidence, edge.confidence),
            derivation: previous.derivation === "structural" || edge.derivation === "structural" ? "structural" : "heuristic",
            evidence: [...new Set([...previous.evidence, ...edge.evidence])].sort(),
          },
    );
  }
  const edges = [...edgeById.values()].sort(compareGraphEdges);
  return {
    graph: {
      schemaVersion: REPOSITORY_GRAPH_SCHEMA_VERSION,
      version: REPOSITORY_GRAPH_VERSION,
      resolvedImports,
      edges,
      git,
    },
    performance: {
      importResolutionMs,
      testRelationshipMs,
      documentationRelationshipMs,
      gitSignalsMs,
      totalMs: performance.now() - started,
    },
  };
}
