import type { CandidateEvidence, EvidenceFamily, ScoreContribution } from "../task-retrieval.js";
import { RANKING_STRATEGY } from "../task-retrieval.js";

export const STRUCTURAL_V1 = {
  strategy: RANKING_STRATEGY,
  weights: {
    exactQualifiedSymbol: 120,
    exactPath: 110,
    exactSymbol: 100,
    exactBasename: 82,
    exactTechnicalLexical: 58,
    symbolComponent: 42,
    importModule: 34,
    pathComponent: 30,
    sourceLexicalFirst: 28,
    sourceLexicalSecond: 8,
    sourceLexicalThird: 4,
    gitDirty: 2,
    gitRecencyMaximum: 3,
  },
  familyCaps: {
    IDENTITY: 150,
    LEXICAL: 120,
    STRUCTURAL: 65,
    GIT: 5,
  } satisfies Record<EvidenceFamily, number>,
  perQuerySignalLexicalCap: 50,
  retrieval: {
    perSignalCandidateLimit: 32,
    primaryCandidateLimit: 200,
    maximumLexicalCandidates: 120,
    maximumSignalsPerLexicalFile: 32,
    maximumDirectEvidencePerCandidate: 64,
    maximumRelevantSymbolsPerCandidate: 32,
    maximumLexicalFiles: 10_000,
    maximumLexicalBytes: 64 * 1024 * 1024,
  },
  expansion: {
    maximumPrimarySeeds: 24,
    maximumDepth: 2,
    maximumNeighborsPerNode: 24,
    globalExpandedCandidateLimit: 128,
    finalCandidateLimit: 256,
    maximumExpansionEvidencePerCandidate: 32,
    distanceDecay: [1, 0.58, 0.34] as const,
    relationFactors: {
      FILE_IMPORTS_FILE: 0.72,
      FILE_IMPORTED_BY: 0.52,
      TEST_RELATION: 0.78,
      DOCUMENT_RELATION: 0.38,
    },
    inheritedScoreFactor: 0.32,
  },
  cli: {
    defaultLimit: 20,
    maximumLimit: 100,
  },
} as const;

function compareEvidence(left: CandidateEvidence, right: CandidateEvidence): number {
  const familyOrder: Record<EvidenceFamily, number> = { IDENTITY: 0, LEXICAL: 1, STRUCTURAL: 2, GIT: 3 };
  const compare = (first: string, second: string): number => first < second ? -1 : first > second ? 1 : 0;
  return (
    familyOrder[left.family] - familyOrder[right.family] ||
    right.weight - left.weight ||
    compare(left.kind, right.kind) ||
    compare(left.querySignal ?? "", right.querySignal ?? "") ||
    compare(left.target, right.target) ||
    compare(left.sourceCandidate ?? "", right.sourceCandidate ?? "")
  );
}

export function evidenceIdentity(evidence: CandidateEvidence): string {
  return [
    evidence.kind,
    evidence.family,
    evidence.querySignal ?? "",
    evidence.target,
    evidence.graphDistance,
    evidence.sourceCandidate ?? "",
  ].join("\u0000");
}

export function deduplicateEvidence(evidence: readonly CandidateEvidence[]): CandidateEvidence[] {
  const byIdentity = new Map<string, CandidateEvidence>();
  for (const item of evidence) {
    const identity = evidenceIdentity(item);
    const previous = byIdentity.get(identity);
    if (previous === undefined || item.weight > previous.weight) byIdentity.set(identity, item);
  }
  return [...byIdentity.values()].sort(compareEvidence);
}

export function scoreEvidence(evidence: readonly CandidateEvidence[]): {
  readonly rawScore: number;
  readonly contributions: readonly ScoreContribution[];
} {
  const remaining = new Map<EvidenceFamily, number>(
    Object.entries(STRUCTURAL_V1.familyCaps) as [EvidenceFamily, number][],
  );
  const contributions: ScoreContribution[] = [];
  const lexicalRemainingBySignal = new Map<string, number>();
  for (const item of deduplicateEvidence(evidence)) {
    const available = remaining.get(item.family) ?? 0;
    const signalAvailable = item.family === "LEXICAL"
      ? lexicalRemainingBySignal.get(item.querySignal ?? "") ?? STRUCTURAL_V1.perQuerySignalLexicalCap
      : Number.POSITIVE_INFINITY;
    const value = Math.max(0, Math.min(available, signalAvailable, item.weight));
    if (value <= 0) continue;
    remaining.set(item.family, available - value);
    if (item.family === "LEXICAL") lexicalRemainingBySignal.set(item.querySignal ?? "", signalAvailable - value);
    contributions.push({ kind: item.kind, family: item.family, value, reason: item.detail });
  }
  const rawScore = contributions.reduce((sum, item) => sum + item.value, 0);
  return { rawScore, contributions };
}

export function hubDamping(degree: number): number {
  if (degree <= 1) return 1;
  return Math.min(1, Math.log2(3) / Math.log2(2 + degree));
}

export function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
