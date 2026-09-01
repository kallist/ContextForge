import assert from "node:assert/strict";
import test from "node:test";

import { fuseCandidateEvidenceV2 } from "../../src/core/candidate-fusion-v2.js";
import type { IndexedFile } from "../../src/core/repository-index.js";
import { createCandidateEvidenceV2, type CandidateEvidenceInputV2 } from "../../src/core/task-retrieval-v2.js";

function indexedFile(): IndexedFile {
  return {
    relativePath: "src/service.ts",
    category: "source",
    contentStatus: "text",
    size: 100,
    mtimeMs: 1,
    contentHash: "a".repeat(64),
    analysis: {
      schemaVersion: "1.0",
      relativePath: "src/service.ts",
      language: "typescript",
      parserStatus: "parsed",
      imports: [],
      diagnostics: [],
      symbols: [{
        id: "sym_service",
        name: "saveValue",
        qualifiedName: "Service.saveValue",
        kind: "method",
        relativePath: "src/service.ts",
        parentSymbolId: null,
        exported: true,
        public: true,
        language: "typescript",
        startLine: 2,
        endLine: 4,
        startColumn: 1,
        endColumn: 2,
      }],
    },
  };
}

function evidence(overrides: Partial<CandidateEvidenceInputV2> = {}) {
  return createCandidateEvidenceV2({
    source: "VERIFIED_LEXICAL",
    family: "LEXICAL",
    target: { file: "src/service.ts", symbolId: null },
    taskSignalId: "task_signal_save",
    matchKind: "VERIFIED_LEXICAL",
    confidence: 1,
    derivation: "VERIFIED_SOURCE",
    location: { startLine: 3, endLine: 3 },
    sourceCandidate: null,
    relationshipId: null,
    graphDistance: 0,
    ambiguity: "UNIQUE",
    rawFeature: 1,
    boundedContribution: 40,
    explanation: "verified lexical evidence",
    ...overrides,
  });
}

test("Candidate Fusion deduplicates canonical files while preserving families and symbol provenance deterministically", () => {
  const lexical = evidence();
  const identity = evidence({ source: "IDENTITY", family: "IDENTITY", matchKind: "EXACT_SYMBOL", target: { file: "src/service.ts", symbolId: "sym_service" }, boundedContribution: 150, derivation: "STRUCTURAL", location: { startLine: 2, endLine: 4 }, explanation: "exact symbol" });
  const ownership = evidence({ source: "SYMBOL_OWNERSHIP", family: "SYMBOL", matchKind: "LEXICAL_SYMBOL_OWNERSHIP", target: { file: "src/service.ts", symbolId: "sym_service" }, boundedContribution: 44, derivation: "STRUCTURAL", explanation: "owning symbol" });
  const first = fuseCandidateEvidenceV2([indexedFile()], [lexical, lexical, identity, ownership], 7);
  const second = fuseCandidateEvidenceV2([indexedFile()], [ownership, identity, lexical], 7);
  assert.deepEqual(first, second);
  assert.equal(first.candidates.length, 1);
  assert.deepEqual(first.candidates[0]?.sourceFamilies, ["IDENTITY", "LEXICAL", "SYMBOL"]);
  assert.equal(first.candidates[0]?.relevantSymbols[0]?.qualifiedName, "Service.saveValue");
  assert.equal(first.candidates[0]?.directEvidence.length, 3);
  assert.ok(first.candidates[0]?.scoreContributions.some((item) => item.kind === "SOURCE_FAMILY_AGREEMENT"));
  assert.equal(JSON.stringify(first).includes("return value"), false);
});

test("Candidate Fusion rejects entities outside the selected snapshot and bounds repeated evidence", () => {
  const repeated = Array.from({ length: 80 }, (_, index) => evidence({
    taskSignalId: `signal_${index}`,
    location: { startLine: index + 1, endLine: index + 1 },
    rawFeature: index,
  }));
  const outside = evidence({ target: { file: "../outside.ts", symbolId: null } });
  const result = fuseCandidateEvidenceV2([indexedFile()], [...repeated, outside], 1);
  assert.equal(result.rejectedEvidence, 1);
  assert.ok(result.capEvents > 0);
  assert.ok((result.candidates[0]?.directEvidence.length ?? 0) <= 64);
});
