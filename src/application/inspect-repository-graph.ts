import { posix } from "node:path";

import type { RepositoryScanner } from "./map-repository.js";
import { ContextForgeError } from "../core/errors.js";
import {
  REPOSITORY_GRAPH_SCHEMA_VERSION,
  type GraphEdge,
  type GraphRelationshipView,
  type RepositoryGraphInspection,
} from "../core/repository-graph.js";
import type { IndexRepositoryFactory } from "../core/repository-index.js";

function normalizedPath(relativePath: string): string {
  const slashPath = relativePath.replaceAll("\\", "/");
  const normalized = posix.normalize(slashPath);
  if (
    slashPath.length === 0 ||
    normalized !== slashPath ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized)
  ) {
    throw new ContextForgeError("PATH", "Graph path must be a normalized repository-relative path.");
  }
  return normalized;
}

function relationship(edge: GraphEdge, target: string): GraphRelationshipView {
  return {
    target,
    kind: edge.kind,
    confidence: edge.confidence,
    derivation: edge.derivation,
    evidence: edge.evidence,
  };
}

function compareRelationships(left: GraphRelationshipView, right: GraphRelationshipView): number {
  return left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : left.target < right.target ? -1 : left.target > right.target ? 1 : 0;
}

export async function inspectRepositoryGraph(
  scanner: RepositoryScanner,
  repositoryFactory: IndexRepositoryFactory,
  repositoryPath: string,
  relativePath: string,
): Promise<RepositoryGraphInspection> {
  const requestedPath = normalizedPath(relativePath);
  const scan = await scanner.scan(repositoryPath);
  const active = await repositoryFactory(scan.rootRealPath).loadActive();
  if (active === null) throw new ContextForgeError("INDEX_NOT_FOUND", "No active RepoBound index exists for this repository.");
  const file = active.files.find((candidate) => candidate.relativePath === requestedPath);
  if (file === undefined) throw new ContextForgeError("INDEX_NOT_FOUND", `The active index does not contain: ${requestedPath}`);
  if (active.graph === null) throw new ContextForgeError("INDEX_NOT_FOUND", "The active index predates Repository Graph support; run repobound index again.");

  const imports = active.graph.edges
    .filter((edge) => edge.kind === "FILE_IMPORTS_FILE" && edge.sourcePath === requestedPath)
    .map((edge) => relationship(edge, edge.targetPath))
    .sort(compareRelationships);
  const importedBy = active.graph.edges
    .filter((edge) => edge.kind === "FILE_IMPORTS_FILE" && edge.targetPath === requestedPath)
    .map((edge) => relationship(edge, edge.sourcePath))
    .sort(compareRelationships);
  const tests = active.graph.edges
    .filter((edge) => edge.kind === "TEST_RELATES_TO_FILE" && (edge.sourcePath === requestedPath || edge.targetPath === requestedPath))
    .map((edge) => relationship(edge, edge.sourcePath === requestedPath ? edge.targetPath : edge.sourcePath))
    .sort(compareRelationships);
  const documentation = active.graph.edges
    .filter((edge) => edge.kind === "DOCUMENT_RELATES_TO_FILE" && (edge.sourcePath === requestedPath || edge.targetPath === requestedPath))
    .map((edge) => relationship(edge, edge.sourcePath === requestedPath ? edge.targetPath : edge.sourcePath))
    .sort(compareRelationships);
  const symbolById = new Map(file.analysis.symbols.map((symbol) => [symbol.id, symbol]));
  const gitFile = active.graph.git.files.find((signal) => signal.relativePath === requestedPath) ?? null;

  return {
    schemaVersion: REPOSITORY_GRAPH_SCHEMA_VERSION,
    generation: active.generation,
    file: requestedPath,
    imports,
    importedBy,
    tests,
    documentation,
    importResolutions: active.graph.resolvedImports
      .filter((item) => item.sourcePath === requestedPath)
      .map((item) => ({
        moduleSpecifier: item.moduleSpecifier,
        status: item.status,
        target: item.targetPath,
        candidates: item.candidates,
        evidence: item.evidence,
      })),
    symbols: file.analysis.symbols,
    symbolParents: file.analysis.symbols
      .filter((symbol) => symbol.parentSymbolId !== null && symbolById.has(symbol.parentSymbolId))
      .map((symbol) => ({
        child: symbol.qualifiedName,
        parent: symbolById.get(symbol.parentSymbolId ?? "")?.qualifiedName ?? "",
      })),
    git: {
      status: active.graph.git.status,
      head: active.graph.git.head,
      branch: active.graph.git.branch,
      recentCommitLimit: active.graph.git.recentCommitLimit,
      file: gitFile,
      diagnostic: active.graph.git.diagnostic,
    },
  };
}
