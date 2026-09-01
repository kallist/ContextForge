import type { CandidateEvidenceFamily, CandidateEvidenceKindV2, CandidateEvidenceV2, ScoreContributionV2 } from "../task-retrieval-v2.js";
import type { SignalAmbiguity, TaskSignal } from "../task-analysis-v2.js";

export const RETRIEVAL_V2 = {
  strategy: "contextforge-retrieval-v2",
  weights: {
    exactQualifiedSymbol: 180,
    exactPath: 175,
    exactSymbol: 150,
    exactBasename: 135,
    ambiguousSymbol: 30,
    technicalLexical: 82,
    generalLexical: 30,
    lexicalOwnership: 44,
    symbolComponent: 32,
    importModule: 28,
    pathComponent: 24,
    gitDirty: 1,
    gitRecencyMaximum: 2,
  },
  familyCaps: {
    IDENTITY: 190,
    LEXICAL: 120,
    SYMBOL: 64,
    STRUCTURAL: 55,
    GIT: 3,
  } satisfies Record<CandidateEvidenceFamily, number>,
  perTaskSignalCap: 92,
  distinctSignalBonus: 4,
  maximumDistinctSignalBonus: 20,
  independentFamilyBonus: 8,
  maximumIndependentFamilyBonus: 24,
  retrieval: {
    perSignalCandidateLimit: 32,
    primaryCandidateLimit: 200,
    maximumLexicalCandidates: 120,
    maximumSignalsPerLexicalFile: 32,
    maximumEvidencePerCandidate: 96,
    maximumDirectEvidencePerCandidate: 64,
    maximumRelevantSymbolsPerCandidate: 32,
    maximumEvidencePerSymbol: 16,
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
    inheritedScoreFactor: 0.18,
  },
  cli: {
    defaultLimit: 20,
    maximumLimit: 100,
  },
} as const;

const FAMILY_ORDER: Record<CandidateEvidenceFamily, number> = { IDENTITY: 0, LEXICAL: 1, SYMBOL: 2, STRUCTURAL: 3, GIT: 4 };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function roundV2Score(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function ambiguityFactor(ambiguity: SignalAmbiguity, repositoryMatches: number, applyAmbiguity: boolean): number {
  if (!applyAmbiguity) return 1;
  if (ambiguity !== "COLLIDING") return 1;
  return Math.max(0.18, 1 / Math.log2(2 + Math.max(2, repositoryMatches)));
}

export function identityWeight(
  kind: Extract<CandidateEvidenceKindV2, "EXACT_PATH" | "EXACT_BASENAME" | "EXACT_QUALIFIED_SYMBOL" | "EXACT_SYMBOL" | "AMBIGUOUS_SYMBOL" | "SYMBOL_COMPONENT" | "PATH_COMPONENT" | "IMPORT_MODULE">,
  signal: TaskSignal,
  applyAmbiguity: boolean,
): number {
  const base = (() => {
    switch (kind) {
      case "EXACT_PATH": return RETRIEVAL_V2.weights.exactPath;
      case "EXACT_BASENAME": return RETRIEVAL_V2.weights.exactBasename;
      case "EXACT_QUALIFIED_SYMBOL": return RETRIEVAL_V2.weights.exactQualifiedSymbol;
      case "EXACT_SYMBOL": return RETRIEVAL_V2.weights.exactSymbol;
      case "AMBIGUOUS_SYMBOL": return RETRIEVAL_V2.weights.ambiguousSymbol;
      case "SYMBOL_COMPONENT": return RETRIEVAL_V2.weights.symbolComponent;
      case "PATH_COMPONENT": return RETRIEVAL_V2.weights.pathComponent;
      case "IMPORT_MODULE": return RETRIEVAL_V2.weights.importModule;
    }
  })();
  const provenance = signal.provenance === "DERIVED" ? 0.72 : 1;
  return roundV2Score(base * provenance * ambiguityFactor(signal.ambiguity, signal.repositoryMatches, applyAmbiguity));
}

export function lexicalEvidenceWeight(signal: TaskSignal, occurrenceCount: number, applyAmbiguity: boolean): number {
  const base = signal.specificity === "GENERAL" ? RETRIEVAL_V2.weights.generalLexical : RETRIEVAL_V2.weights.technicalLexical;
  const repeated = 1 + (occurrenceCount >= 2 ? 0.16 : 0) + (occurrenceCount >= 3 ? 0.08 : 0);
  const provenance = signal.provenance === "DERIVED" ? 0.72 : 1;
  const ambiguity = signal.specificity === "GENERAL"
    ? ambiguityFactor(signal.ambiguity, signal.repositoryMatches, applyAmbiguity)
    : 1;
  return roundV2Score(base * repeated * provenance * ambiguity);
}

export function compareV2Evidence(left: CandidateEvidenceV2, right: CandidateEvidenceV2): number {
  return (
    FAMILY_ORDER[left.family] - FAMILY_ORDER[right.family] ||
    right.boundedContribution - left.boundedContribution ||
    compareText(left.matchKind, right.matchKind) ||
    compareText(left.taskSignalId ?? "", right.taskSignalId ?? "") ||
    compareText(left.target.symbolId ?? "", right.target.symbolId ?? "") ||
    compareText(left.id, right.id)
  );
}

export function deduplicateV2Evidence(evidence: readonly CandidateEvidenceV2[]): CandidateEvidenceV2[] {
  const byId = new Map<string, CandidateEvidenceV2>();
  for (const item of evidence) {
    const previous = byId.get(item.id);
    if (previous === undefined || item.boundedContribution > previous.boundedContribution) byId.set(item.id, item);
  }
  return [...byId.values()].sort(compareV2Evidence);
}

export function scoreV2Evidence(evidence: readonly CandidateEvidenceV2[]): { readonly rawScore: number; readonly contributions: readonly ScoreContributionV2[] } {
  const remaining = new Map<CandidateEvidenceFamily, number>(Object.entries(RETRIEVAL_V2.familyCaps) as [CandidateEvidenceFamily, number][]);
  const perSignal = new Map<string, number>();
  const contributions: ScoreContributionV2[] = [];
  const deduplicated = deduplicateV2Evidence(evidence);
  for (const item of deduplicated) {
    const familyRemaining = remaining.get(item.family) ?? 0;
    const signalRemaining = item.taskSignalId === null
      ? Number.POSITIVE_INFINITY
      : perSignal.get(item.taskSignalId) ?? RETRIEVAL_V2.perTaskSignalCap;
    const value = Math.max(0, Math.min(familyRemaining, signalRemaining, item.boundedContribution));
    if (value <= 0) continue;
    remaining.set(item.family, familyRemaining - value);
    if (item.taskSignalId !== null) perSignal.set(item.taskSignalId, signalRemaining - value);
    contributions.push({ evidenceId: item.id, kind: item.matchKind, family: item.family, value: roundV2Score(value), reason: item.explanation });
  }
  const directSignals = new Set(deduplicated.filter((item) => item.family !== "STRUCTURAL" && item.family !== "GIT").flatMap((item) => item.taskSignalId === null ? [] : [item.taskSignalId]));
  const signalBonus = Math.min(RETRIEVAL_V2.maximumDistinctSignalBonus, Math.max(0, directSignals.size - 1) * RETRIEVAL_V2.distinctSignalBonus);
  if (signalBonus > 0) contributions.push({ evidenceId: null, kind: "DISTINCT_TASK_SIGNAL_COVERAGE", family: "FUSION", value: signalBonus, reason: `${directSignals.size} distinct task signals contribute bounded direct evidence.` });
  const independentFamilies = new Set(deduplicated
    .filter((item) => item.family !== "GIT")
    .map((item) => item.family === "SYMBOL" ? "LEXICAL" : item.family));
  const familyBonus = Math.min(RETRIEVAL_V2.maximumIndependentFamilyBonus, Math.max(0, independentFamilies.size - 1) * RETRIEVAL_V2.independentFamilyBonus);
  if (familyBonus > 0) contributions.push({ evidenceId: null, kind: "SOURCE_FAMILY_AGREEMENT", family: "FUSION", value: familyBonus, reason: `${independentFamilies.size} independent evidence families agree on this candidate.` });
  return { rawScore: roundV2Score(contributions.reduce((sum, item) => sum + item.value, 0)), contributions };
}

export function evidencePriorityTier(evidence: readonly CandidateEvidenceV2[]): number {
  if (evidence.some((item) => item.matchKind === "EXACT_QUALIFIED_SYMBOL" || item.matchKind === "EXACT_PATH")) return 0;
  if (evidence.some((item) => item.matchKind === "EXACT_SYMBOL" || item.matchKind === "EXACT_BASENAME")) return 1;
  if (evidence.some((item) => (item.matchKind === "LEXICAL_SYMBOL_OWNERSHIP" || item.matchKind === "VERIFIED_LEXICAL") && item.boundedContribution >= 30)) return 2;
  if (evidence.some((item) => item.family === "IDENTITY" || item.family === "LEXICAL" || item.family === "SYMBOL")) return 3;
  if (evidence.some((item) => item.family === "STRUCTURAL")) return 4;
  return 5;
}

export function hubDampingV2(degree: number): number {
  if (degree <= 1) return 1;
  return Math.min(1, Math.log2(3) / Math.log2(2 + degree));
}
