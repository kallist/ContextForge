import type { IndexedFile } from "./repository-index.js";
import { RETRIEVAL_V2, compareV2Evidence, deduplicateV2Evidence, evidencePriorityTier, scoreV2Evidence } from "./ranking/retrieval-v2.js";
import { RETRIEVAL_V2_STRATEGY, type CandidateEvidenceV2, type RankedFileCandidateV2, type RelevantSymbolV2 } from "./task-retrieval-v2.js";

export interface CandidateFusionResultV2 {
  readonly candidates: readonly RankedFileCandidateV2[];
  readonly rejectedEvidence: number;
  readonly capEvents: number;
}

const SOURCE_CAPS: Readonly<Record<CandidateEvidenceV2["source"], number>> = {
  IDENTITY: 24,
  VERIFIED_LEXICAL: 32,
  SYMBOL_OWNERSHIP: 32,
  FILE_STRUCTURAL: 32,
  TEST_DOCUMENTATION: 32,
  RELATIONSHIP: 32,
  GIT: 4,
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function categoryPriority(file: Pick<IndexedFile, "category">): number {
  switch (file.category) {
    case "source": return 0;
    case "test": return 1;
    case "configuration": return 2;
    case "documentation": return 3;
    default: return 4;
  }
}

function originPriority(origin: RankedFileCandidateV2["origin"]): number {
  switch (origin) {
    case "DIRECT_AND_EXPANDED": return 0;
    case "DIRECT": return 1;
    case "EXPANDED": return 2;
  }
}

export function compareRankedV2(left: RankedFileCandidateV2, right: RankedFileCandidateV2): number {
  return (
    left.priorityTier - right.priorityTier ||
    right.rawScore - left.rawScore ||
    right.taskSignalIds.length - left.taskSignalIds.length ||
    right.sourceFamilies.length - left.sourceFamilies.length ||
    originPriority(left.origin) - originPriority(right.origin) ||
    categoryPriority(left) - categoryPriority(right) ||
    compareText(left.relativePath, right.relativePath)
  );
}

function boundedEvidence(items: readonly CandidateEvidenceV2[]): { readonly evidence: CandidateEvidenceV2[]; readonly capEvents: number } {
  const deduplicated = deduplicateV2Evidence(items);
  const sourceCounts = new Map<CandidateEvidenceV2["source"], number>();
  const accepted: CandidateEvidenceV2[] = [];
  let capEvents = 0;
  for (const item of deduplicated) {
    const count = sourceCounts.get(item.source) ?? 0;
    if (count >= SOURCE_CAPS[item.source] || accepted.length >= RETRIEVAL_V2.retrieval.maximumEvidencePerCandidate) {
      capEvents += 1;
      continue;
    }
    sourceCounts.set(item.source, count + 1);
    accepted.push(item);
  }
  return { evidence: accepted.sort(compareV2Evidence), capEvents };
}

function relevantSymbols(file: IndexedFile, evidence: readonly CandidateEvidenceV2[]): RelevantSymbolV2[] {
  const byId = new Map(file.analysis.symbols.map((symbol) => [symbol.id, symbol]));
  const evidenceById = new Map<string, CandidateEvidenceV2[]>();
  for (const item of evidence) {
    const symbolId = item.target.symbolId;
    if (symbolId === null || !byId.has(symbolId)) continue;
    evidenceById.set(symbolId, [...(evidenceById.get(symbolId) ?? []), item]);
  }
  return [...evidenceById]
    .flatMap(([symbolId, items]): RelevantSymbolV2[] => {
      const symbol = byId.get(symbolId);
      if (symbol === undefined) return [];
      return [{
        identity: symbol.id,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        kind: symbol.kind,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        startColumn: symbol.startColumn,
        endColumn: symbol.endColumn,
        evidence: deduplicateV2Evidence(items).slice(0, RETRIEVAL_V2.retrieval.maximumEvidencePerSymbol),
      }];
    })
    .sort((left, right) => {
      const leftWeight = Math.max(0, ...left.evidence.map((item) => item.boundedContribution));
      const rightWeight = Math.max(0, ...right.evidence.map((item) => item.boundedContribution));
      return rightWeight - leftWeight || compareText(left.qualifiedName, right.qualifiedName) || left.startLine - right.startLine || compareText(left.identity, right.identity);
    })
    .slice(0, RETRIEVAL_V2.retrieval.maximumRelevantSymbolsPerCandidate);
}

export function fuseCandidateEvidenceV2(
  files: readonly IndexedFile[],
  evidence: readonly CandidateEvidenceV2[],
  generation: number,
): CandidateFusionResultV2 {
  const fileByPath = new Map(files.map((file) => [file.relativePath, file]));
  const byFile = new Map<string, CandidateEvidenceV2[]>();
  let rejectedEvidence = 0;
  for (const item of evidence) {
    if (!fileByPath.has(item.target.file)) {
      rejectedEvidence += 1;
      continue;
    }
    byFile.set(item.target.file, [...(byFile.get(item.target.file) ?? []), item]);
  }
  let capEvents = 0;
  const candidates = [...byFile].flatMap(([path, items]): RankedFileCandidateV2[] => {
    const file = fileByPath.get(path);
    if (file === undefined) return [];
    const bounded = boundedEvidence(items);
    capEvents += bounded.capEvents;
    const directItems = bounded.evidence.filter((item) => item.family !== "STRUCTURAL" && item.family !== "RELATIONSHIP");
    const expansionItems = bounded.evidence.filter((item) => item.family === "STRUCTURAL" || item.family === "RELATIONSHIP");
    capEvents += Math.max(0, directItems.length - RETRIEVAL_V2.retrieval.maximumDirectEvidencePerCandidate);
    capEvents += Math.max(0, expansionItems.length - RETRIEVAL_V2.expansion.maximumExpansionEvidencePerCandidate);
    const directEvidence = directItems
      .slice(0, RETRIEVAL_V2.retrieval.maximumDirectEvidencePerCandidate);
    const expansionEvidence = expansionItems
      .slice(0, RETRIEVAL_V2.expansion.maximumExpansionEvidencePerCandidate);
    const allEvidence = [...directEvidence, ...expansionEvidence];
    const scored = scoreV2Evidence(allEvidence);
    const scoringEvidence = allEvidence.filter((item) => item.boundedContribution > 0);
    const direct = directEvidence.some((item) => item.family !== "GIT" && item.boundedContribution > 0);
    const expanded = expansionEvidence.some((item) => item.boundedContribution > 0);
    const origin = direct && expanded ? "DIRECT_AND_EXPANDED" : direct ? "DIRECT" : "EXPANDED";
    const sourceFamilies = [...new Set(scoringEvidence.map((item) => item.family))].sort(compareText);
    const taskSignalIds = [...new Set(allEvidence.flatMap((item) => item.taskSignalId === null ? [] : [item.taskSignalId]))].sort(compareText);
    const graphDistances = expansionEvidence.filter((item) => item.boundedContribution > 0).map((item) => item.graphDistance).filter((distance) => distance > 0);
    return [{
      identity: `file:${path}`,
      relativePath: path,
      category: file.category,
      language: file.analysis.language,
      origin,
      directEvidence,
      expansionEvidence,
      scoreContributions: scored.contributions,
      score: scored.rawScore,
      rawScore: scored.rawScore,
      priorityTier: evidencePriorityTier(scoringEvidence),
      graphDistance: graphDistances.length === 0 ? null : Math.min(...graphDistances),
      rankingStrategy: RETRIEVAL_V2_STRATEGY,
      generation,
      relevantSymbols: relevantSymbols(file, allEvidence),
      sourceFamilies,
      taskSignalIds,
    }];
  }).sort(compareRankedV2);
  return { candidates, rejectedEvidence, capEvents };
}
