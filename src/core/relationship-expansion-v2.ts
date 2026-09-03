import type { ContextPlan } from "./context-plan-v2.js";
import type { IndexedFile } from "./repository-index.js";
import type { GraphEdge } from "./repository-graph.js";
import { RETRIEVAL_V2, hubDampingV2, roundV2Score } from "./ranking/retrieval-v2.js";
import {
  createRelationshipEvidenceV2,
  deduplicateRelationshipEvidenceV2,
  type RelationshipConfidenceV2,
  type RelationshipEntityV2,
  type RelationshipEvidenceV2,
} from "./relationship-intelligence-v2.js";
import { createCandidateEvidenceV2, type CandidateEvidenceKindV2, type CandidateEvidenceV2, type RankedFileCandidateV2 } from "./task-retrieval-v2.js";

export interface RelationshipFamiliesV2 {
  readonly references: boolean;
  readonly callers: boolean;
  readonly implementations: boolean;
  readonly tests: boolean;
  readonly dependents: boolean;
}

export interface RelationshipExpansionV2 {
  readonly evidence: readonly CandidateEvidenceV2[];
  readonly relationships: readonly RelationshipEvidenceV2[];
  readonly expandedPaths: ReadonlySet<string>;
  readonly fanoutCapEvents: number;
  readonly hubSuppressions: number;
  readonly truncated: boolean;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fileEntity(path: string): RelationshipEntityV2 {
  return { file: path, symbolId: null, qualifiedName: null };
}

export function graphRelationshipEvidenceV2(edges: readonly GraphEdge[], generation: number): RelationshipEvidenceV2[] {
  return deduplicateRelationshipEvidenceV2(edges.flatMap((edge): RelationshipEvidenceV2[] => {
    if (edge.kind === "DOCUMENT_RELATES_TO_FILE") return [];
    const classification = edge.derivation === "structural" ? "STRUCTURAL_FACT" : "HEURISTIC";
    const confidence: RelationshipConfidenceV2 = edge.confidence === 1 ? "EXACT" : edge.confidence >= 0.8 ? "HIGH" : edge.confidence >= 0.6 ? "MEDIUM" : "LOW";
    const type = edge.kind === "FILE_IMPORTS_FILE"
      ? "FILE_DEPENDS_ON_FILE"
      : classification === "STRUCTURAL_FACT" ? "TEST_IMPORTS_FILE" : "TEST_ASSOCIATED_WITH_FILE";
    return [createRelationshipEvidenceV2({
      type,
      source: fileEntity(edge.sourcePath),
      target: fileEntity(edge.targetPath),
      confidence,
      classification,
      derivation: edge.evidence.join("; "),
      provenance: { kind: "GENERATION_GRAPH", generation, location: null },
    })];
  }));
}

function endpointMatches(seed: RankedFileCandidateV2, endpoint: RelationshipEntityV2): boolean {
  if (seed.relativePath !== endpoint.file) return false;
  if (endpoint.symbolId === null) return true;
  return seed.relevantSymbols.some((symbol) => symbol.identity === endpoint.symbolId);
}

function relationDirection(
  relation: RelationshipEvidenceV2,
  seed: RankedFileCandidateV2,
): { readonly target: RelationshipEntityV2; readonly kind: CandidateEvidenceKindV2 } | null {
  const forward = endpointMatches(seed, relation.source);
  const reverse = endpointMatches(seed, relation.target);
  if (!forward && !reverse) return null;
  switch (relation.type) {
    case "SYMBOL_REFERENCES_SYMBOL":
      return forward ? { target: relation.target, kind: "SYMBOL_REFERENCE" } : { target: relation.source, kind: "CALLER" };
    case "TEST_REFERENCES_SYMBOL":
      return forward ? { target: relation.target, kind: "SYMBOL_REFERENCE" } : { target: relation.source, kind: "TEST_REFERENCE" };
    case "SYMBOL_IMPLEMENTS_SYMBOL":
      return forward ? { target: relation.target, kind: "INTERFACE" } : { target: relation.source, kind: "IMPLEMENTATION" };
    case "TEST_IMPORTS_FILE":
      return { target: forward ? relation.target : relation.source, kind: "TEST_IMPORT" };
    case "TEST_ASSOCIATED_WITH_FILE":
      return { target: forward ? relation.target : relation.source, kind: "TEST_ASSOCIATION" };
    case "FILE_DEPENDS_ON_FILE":
      return { target: forward ? relation.target : relation.source, kind: "BOUNDED_DEPENDENT" };
  }
}

function enabled(kind: CandidateEvidenceKindV2, families: RelationshipFamiliesV2): boolean {
  switch (kind) {
    case "SYMBOL_REFERENCE": return families.references;
    case "CALLER": return families.callers;
    case "INTERFACE":
    case "IMPLEMENTATION": return families.implementations;
    case "TEST_REFERENCE":
    case "TEST_IMPORT":
    case "TEST_ASSOCIATION": return families.tests;
    case "BOUNDED_DEPENDENT": return families.dependents;
    default: return false;
  }
}

function confidenceFactor(confidence: RelationshipConfidenceV2): number {
  switch (confidence) {
    case "EXACT": return 1;
    case "HIGH": return 0.86;
    case "MEDIUM": return 0.68;
    case "LOW": return 0.45;
  }
}

function planFactor(kind: CandidateEvidenceKindV2, plan: ContextPlan): number {
  const roles = new Set(plan.sections.filter((section) => section.priority !== "OPTIONAL").map((section) => section.role));
  if ((kind === "TEST_REFERENCE" || kind === "TEST_IMPORT" || kind === "TEST_ASSOCIATION") && roles.has("TEST")) return 1.08;
  if ((kind === "CALLER" || kind === "BOUNDED_DEPENDENT") && roles.has("CALLER_OR_DEPENDENT")) return 1.08;
  return 1;
}

function relationFactor(kind: CandidateEvidenceKindV2): number {
  switch (kind) {
    case "SYMBOL_REFERENCE": return RETRIEVAL_V2.relationships.relationFactors.SYMBOL_REFERENCE;
    case "CALLER": return RETRIEVAL_V2.relationships.relationFactors.CALLER;
    case "INTERFACE": return RETRIEVAL_V2.relationships.relationFactors.INTERFACE;
    case "IMPLEMENTATION": return RETRIEVAL_V2.relationships.relationFactors.IMPLEMENTATION;
    case "TEST_REFERENCE": return RETRIEVAL_V2.relationships.relationFactors.TEST_REFERENCE;
    case "TEST_IMPORT": return RETRIEVAL_V2.relationships.relationFactors.TEST_IMPORT;
    case "TEST_ASSOCIATION": return RETRIEVAL_V2.relationships.relationFactors.TEST_ASSOCIATION;
    case "BOUNDED_DEPENDENT": return RETRIEVAL_V2.relationships.relationFactors.BOUNDED_DEPENDENT;
    default: return 0;
  }
}

function kindCap(kind: CandidateEvidenceKindV2): number {
  if (kind === "CALLER") return RETRIEVAL_V2.relationships.maximumCallersPerSeed;
  if (kind === "TEST_REFERENCE" || kind === "TEST_IMPORT" || kind === "TEST_ASSOCIATION") return RETRIEVAL_V2.relationships.maximumTestsPerSeed;
  if (kind === "INTERFACE" || kind === "IMPLEMENTATION") return RETRIEVAL_V2.relationships.maximumImplementationsPerSeed;
  return RETRIEVAL_V2.relationships.maximumRelationsPerSeed;
}

export function expandRelationshipEvidenceV2(
  primary: readonly RankedFileCandidateV2[],
  files: readonly IndexedFile[],
  relationships: readonly RelationshipEvidenceV2[],
  plan: ContextPlan,
  families: RelationshipFamiliesV2,
): RelationshipExpansionV2 {
  const filePaths = new Set(files.map((file) => file.relativePath));
  const directlyDiscoveredPaths = new Set(primary.map((candidate) => candidate.relativePath));
  const seeds = primary.filter((candidate) => candidate.priorityTier <= 2).slice(0, RETRIEVAL_V2.relationships.maximumSeeds);
  const relationList = deduplicateRelationshipEvidenceV2(relationships);
  const degree = new Map<string, number>();
  for (const relation of relationList) {
    for (const endpoint of [relation.source, relation.target]) {
      const key = `${endpoint.file}\u0000${endpoint.symbolId ?? ""}`;
      degree.set(key, (degree.get(key) ?? 0) + 1);
    }
  }
  const evidence: CandidateEvidenceV2[] = [];
  const usedRelationships = new Map<string, RelationshipEvidenceV2>();
  const expandedPaths = new Set<string>();
  let fanoutCapEvents = 0;
  let hubSuppressions = 0;
  let truncated = false;
  for (const seed of seeds) {
    let seedCount = 0;
    const kindCounts = new Map<CandidateEvidenceKindV2, number>();
    for (const relation of relationList) {
      const direction = relationDirection(relation, seed);
      if (direction === null || !enabled(direction.kind, families) || !filePaths.has(direction.target.file)) continue;
      const kindCount = kindCounts.get(direction.kind) ?? 0;
      if (seedCount >= RETRIEVAL_V2.relationships.maximumRelationsPerSeed || kindCount >= kindCap(direction.kind)) {
        fanoutCapEvents += 1;
        truncated = true;
        continue;
      }
      if (evidence.length >= RETRIEVAL_V2.relationships.maximumTotalEvidence) {
        fanoutCapEvents += 1;
        truncated = true;
        continue;
      }
      const targetKey = `${direction.target.file}\u0000${direction.target.symbolId ?? ""}`;
      const sourceKey = `${endpointMatches(seed, relation.source) ? relation.source.file : relation.target.file}\u0000${endpointMatches(seed, relation.source) ? relation.source.symbolId ?? "" : relation.target.symbolId ?? ""}`;
      const relationshipDegree = Math.max(degree.get(targetKey) ?? 1, degree.get(sourceKey) ?? 1);
      if (relationshipDegree > RETRIEVAL_V2.relationships.hubDegreeThreshold) hubSuppressions += 1;
      const contribution = directlyDiscoveredPaths.has(direction.target.file) ? 0 : Math.min(
        RETRIEVAL_V2.familyCaps.RELATIONSHIP,
        seed.rawScore * RETRIEVAL_V2.relationships.inheritedScoreFactor *
          relationFactor(direction.kind) *
          confidenceFactor(relation.confidence) * hubDampingV2(relationshipDegree) * planFactor(direction.kind, plan),
      );
      const sourceIdentity = relation.source.symbolId === null
        ? seed.relativePath
        : `${seed.relativePath}#${seed.relevantSymbols.find((symbol) => symbol.identity === (endpointMatches(seed, relation.source) ? relation.source.symbolId : relation.target.symbolId))?.qualifiedName ?? "symbol"}`;
      evidence.push(createCandidateEvidenceV2({
        source: "RELATIONSHIP",
        family: "RELATIONSHIP",
        target: { file: direction.target.file, symbolId: direction.target.symbolId },
        taskSignalId: null,
        matchKind: direction.kind,
        confidence: confidenceFactor(relation.confidence),
        derivation: relation.classification === "STRUCTURAL_FACT" ? "STRUCTURAL" : "HEURISTIC",
        location: relation.provenance.location,
        sourceCandidate: sourceIdentity,
        relationshipId: relation.id,
        graphDistance: 1,
        ambiguity: "NOT_APPLICABLE",
        rawFeature: relation.type,
        boundedContribution: roundV2Score(contribution),
        explanation: `${direction.kind.toLowerCase().replaceAll("_", " ")} relates ${direction.target.file}${direction.target.qualifiedName === null ? "" : `#${direction.target.qualifiedName}`} to seed ${sourceIdentity} via ${relation.derivation}.`,
      }));
      usedRelationships.set(relation.id, relation);
      expandedPaths.add(direction.target.file);
      seedCount += 1;
      kindCounts.set(direction.kind, kindCount + 1);
    }
  }
  return {
    evidence,
    relationships: [...usedRelationships.values()].sort((left, right) => compareText(left.id, right.id)),
    expandedPaths,
    fanoutCapEvents,
    hubSuppressions,
    truncated,
  };
}
