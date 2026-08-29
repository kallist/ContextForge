import { createHash } from "node:crypto";
import { posix } from "node:path";

import type { IndexedFile } from "./repository-index.js";

export const REPOSITORY_GRAPH_SCHEMA_VERSION = "1.0";
export const REPOSITORY_GRAPH_VERSION = "repository-graph-v1";

export type ImportResolutionStatus = "resolved_internal" | "external" | "unresolved" | "ambiguous" | "unsafe";
export type GraphEdgeKind = "FILE_IMPORTS_FILE" | "TEST_RELATES_TO_FILE" | "DOCUMENT_RELATES_TO_FILE";
export type GraphDerivation = "structural" | "heuristic";

export interface FileGraphNode {
  readonly kind: "FILE";
  readonly id: string;
  readonly relativePath: string;
}

export interface SymbolGraphNode {
  readonly kind: "SYMBOL";
  readonly id: string;
  readonly symbolId: string;
  readonly relativePath: string;
}

export type RepositoryGraphNode = FileGraphNode | SymbolGraphNode;

export interface ResolvedImport {
  readonly sourcePath: string;
  readonly importOrdinal: number;
  readonly moduleSpecifier: string;
  readonly status: ImportResolutionStatus;
  readonly targetPath: string | null;
  readonly candidates: readonly string[];
  readonly evidence: readonly string[];
}

export interface GraphEdge {
  readonly id: string;
  readonly kind: GraphEdgeKind;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly confidence: number;
  readonly derivation: GraphDerivation;
  readonly evidence: readonly string[];
}

export type GitWorkingTreeStatus = "clean" | "modified" | "added" | "deleted" | "untracked" | "renamed" | "conflicted";

export interface GitFileSignal {
  readonly relativePath: string;
  readonly tracked: boolean;
  readonly workingTreeStatus: GitWorkingTreeStatus;
  readonly recentCommitCount: number;
  readonly lastChangedCommit: string | null;
  readonly lastChangedAt: string | null;
}

export interface GitSignalsAvailable {
  readonly status: "available";
  readonly head: string | null;
  readonly branch: string | null;
  readonly recentCommitLimit: number;
  readonly files: readonly GitFileSignal[];
  readonly diagnostic: null;
}

export interface GitSignalsUnavailable {
  readonly status: "unavailable";
  readonly head: null;
  readonly branch: null;
  readonly recentCommitLimit: number;
  readonly files: readonly [];
  readonly diagnostic: string;
}

export type RepositoryGitSignals = GitSignalsAvailable | GitSignalsUnavailable;

export interface RepositoryGraphSnapshot {
  readonly schemaVersion: typeof REPOSITORY_GRAPH_SCHEMA_VERSION;
  readonly version: typeof REPOSITORY_GRAPH_VERSION;
  readonly resolvedImports: readonly ResolvedImport[];
  readonly edges: readonly GraphEdge[];
  readonly git: RepositoryGitSignals;
}

export interface DocumentationSource {
  readonly relativePath: string;
  readonly source: string;
}

export interface GraphBuildPerformance {
  readonly importResolutionMs: number;
  readonly testRelationshipMs: number;
  readonly documentationRelationshipMs: number;
  readonly gitSignalsMs: number;
  readonly totalMs: number;
}

export interface RepositoryGraphBuild {
  readonly graph: RepositoryGraphSnapshot;
  readonly performance: GraphBuildPerformance;
}

export interface GraphRelationshipView {
  readonly target: string;
  readonly kind: GraphEdgeKind;
  readonly confidence: number;
  readonly derivation: GraphDerivation;
  readonly evidence: readonly string[];
}

export interface ImportResolutionView {
  readonly moduleSpecifier: string;
  readonly status: ImportResolutionStatus;
  readonly target: string | null;
  readonly candidates: readonly string[];
  readonly evidence: readonly string[];
}

export interface RepositoryGraphInspection {
  readonly schemaVersion: typeof REPOSITORY_GRAPH_SCHEMA_VERSION;
  readonly generation: number;
  readonly file: string;
  readonly imports: readonly GraphRelationshipView[];
  readonly importedBy: readonly GraphRelationshipView[];
  readonly tests: readonly GraphRelationshipView[];
  readonly documentation: readonly GraphRelationshipView[];
  readonly importResolutions: readonly ImportResolutionView[];
  readonly symbols: IndexedFile["analysis"]["symbols"];
  readonly symbolParents: readonly {
    readonly child: string;
    readonly parent: string;
  }[];
  readonly git: {
    readonly status: "available" | "unavailable";
    readonly head: string | null;
    readonly branch: string | null;
    readonly recentCommitLimit: number;
    readonly file: GitFileSignal | null;
    readonly diagnostic: string | null;
  };
}

export function fileNodeId(relativePath: string): string {
  return `file:${relativePath}`;
}

export function fileGraphNode(relativePath: string): FileGraphNode {
  return { kind: "FILE", id: fileNodeId(relativePath), relativePath };
}

export function symbolGraphNode(symbolId: string, relativePath: string): SymbolGraphNode {
  return { kind: "SYMBOL", id: symbolId, symbolId, relativePath };
}

export function createGraphEdgeId(kind: GraphEdgeKind, sourcePath: string, targetPath: string): string {
  const identity = `${kind}\u0000${fileNodeId(sourcePath)}\u0000${fileNodeId(targetPath)}`;
  return `edge_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

export function createGraphEdge(
  kind: GraphEdgeKind,
  sourcePath: string,
  targetPath: string,
  confidence: number,
  derivation: GraphDerivation,
  evidence: readonly string[],
): GraphEdge {
  return {
    id: createGraphEdgeId(kind, sourcePath, targetPath),
    kind,
    sourcePath,
    targetPath,
    confidence,
    derivation,
    evidence: [...new Set(evidence)].sort(),
  };
}

export function isNormalizedRepositoryPath(value: string): boolean {
  if (value.length === 0 || value.includes("\\")) return false;
  const normalized = posix.normalize(value);
  return (
    normalized === value &&
    normalized !== "." &&
    normalized !== ".." &&
    !normalized.startsWith("../") &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//u.test(normalized)
  );
}

export function compareGraphEdges(left: GraphEdge, right: GraphEdge): number {
  const compare = (first: string, second: string): number => first < second ? -1 : first > second ? 1 : 0;
  return compare(left.kind, right.kind) || compare(left.sourcePath, right.sourcePath) || compare(left.targetPath, right.targetPath) || compare(left.id, right.id);
}

export function unavailableGitSignals(diagnostic: string, recentCommitLimit = 100): GitSignalsUnavailable {
  return {
    status: "unavailable",
    head: null,
    branch: null,
    recentCommitLimit,
    files: [],
    diagnostic,
  };
}
