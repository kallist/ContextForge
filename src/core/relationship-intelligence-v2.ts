import { createHash } from "node:crypto";

import type { SourceRange } from "./language-analysis.js";
import { isNormalizedRepositoryPath } from "./repository-graph.js";

export const RELATIONSHIP_INTELLIGENCE_V2_VERSION = "contextforge-relationship-intelligence-v2";

export type RelationshipTypeV2 =
  | "SYMBOL_REFERENCES_SYMBOL"
  | "SYMBOL_IMPLEMENTS_SYMBOL"
  | "TEST_REFERENCES_SYMBOL"
  | "TEST_IMPORTS_FILE"
  | "TEST_ASSOCIATED_WITH_FILE"
  | "FILE_DEPENDS_ON_FILE";

export type RelationshipClassificationV2 = "STRUCTURAL_FACT" | "HEURISTIC";
export type RelationshipConfidenceV2 = "EXACT" | "HIGH" | "MEDIUM" | "LOW";

export interface RelationshipEntityV2 {
  readonly file: string;
  readonly symbolId: string | null;
  readonly qualifiedName: string | null;
}

export interface RelationshipEvidenceV2 {
  readonly id: string;
  readonly type: RelationshipTypeV2;
  readonly source: RelationshipEntityV2;
  readonly target: RelationshipEntityV2;
  readonly confidence: RelationshipConfidenceV2;
  readonly classification: RelationshipClassificationV2;
  readonly structuralFact: boolean;
  readonly distance: 1;
  readonly derivation: string;
  readonly provenance: {
    readonly kind: "TRANSIENT_TREE_SITTER" | "GENERATION_GRAPH";
    readonly generation: number;
    readonly location: Pick<SourceRange, "startLine" | "endLine"> | null;
  };
  readonly diagnostics: readonly string[];
}

export interface RelationshipEvidenceInputV2 extends Omit<RelationshipEvidenceV2, "id" | "structuralFact" | "distance" | "diagnostics"> {
  readonly diagnostics?: readonly string[];
}

export function createRelationshipEvidenceV2(input: RelationshipEvidenceInputV2): RelationshipEvidenceV2 {
  if (!isNormalizedRepositoryPath(input.source.file) || !isNormalizedRepositoryPath(input.target.file)) {
    throw new RangeError("Relationship endpoints must use normalized repository-relative paths.");
  }
  if ((input.classification === "STRUCTURAL_FACT") !== (input.confidence === "EXACT")) {
    throw new RangeError("Structural relationship facts must be EXACT and heuristics must use lower confidence.");
  }
  const identity = [
    input.type,
    input.source.file,
    input.source.symbolId ?? "",
    input.target.file,
    input.target.symbolId ?? "",
    input.classification,
    input.derivation,
    input.provenance.kind,
    input.provenance.generation,
  ].join("\u0000");
  return {
    ...input,
    id: `relation_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`,
    structuralFact: input.classification === "STRUCTURAL_FACT",
    distance: 1,
    diagnostics: [...new Set(input.diagnostics ?? [])].sort(compareText),
  };
}

export function compareRelationshipEvidenceV2(left: RelationshipEvidenceV2, right: RelationshipEvidenceV2): number {
  return (
    compareText(left.type, right.type) ||
    compareText(left.source.file, right.source.file) ||
    compareText(left.source.symbolId ?? "", right.source.symbolId ?? "") ||
    compareText(left.target.file, right.target.file) ||
    compareText(left.target.symbolId ?? "", right.target.symbolId ?? "") ||
    compareText(left.id, right.id)
  );
}

export function deduplicateRelationshipEvidenceV2(items: readonly RelationshipEvidenceV2[]): RelationshipEvidenceV2[] {
  const byId = new Map<string, RelationshipEvidenceV2>();
  for (const item of items) {
    const previous = byId.get(item.id);
    if (previous === undefined || compareProvenance(item, previous) < 0) byId.set(item.id, item);
  }
  return [...byId.values()].sort(compareRelationshipEvidenceV2);
}

function compareProvenance(left: RelationshipEvidenceV2, right: RelationshipEvidenceV2): number {
  return (
    (left.provenance.location?.startLine ?? Number.MAX_SAFE_INTEGER) - (right.provenance.location?.startLine ?? Number.MAX_SAFE_INTEGER) ||
    (left.provenance.location?.endLine ?? Number.MAX_SAFE_INTEGER) - (right.provenance.location?.endLine ?? Number.MAX_SAFE_INTEGER) ||
    compareText(left.diagnostics.join("\u0000"), right.diagnostics.join("\u0000"))
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
