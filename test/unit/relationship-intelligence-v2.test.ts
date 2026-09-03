import assert from "node:assert/strict";
import test from "node:test";

import { deriveSymbolRelationshipsV2 } from "../../src/core/derive-symbol-relationships-v2.js";
import { expandRelationshipEvidenceV2, graphRelationshipEvidenceV2 } from "../../src/core/relationship-expansion-v2.js";
import { compareRelationshipEvidenceV2, createRelationshipEvidenceV2, deduplicateRelationshipEvidenceV2 } from "../../src/core/relationship-intelligence-v2.js";
import type { IndexedFile } from "../../src/core/repository-index.js";
import type { RankedFileCandidateV2 } from "../../src/core/task-retrieval-v2.js";

function relation(sourceFile: string, sourceSymbol: string, targetFile: string, targetSymbol: string) {
  return createRelationshipEvidenceV2({
    type: "SYMBOL_REFERENCES_SYMBOL",
    source: { file: sourceFile, symbolId: sourceSymbol, qualifiedName: sourceSymbol },
    target: { file: targetFile, symbolId: targetSymbol, qualifiedName: targetSymbol },
    confidence: "EXACT",
    classification: "STRUCTURAL_FACT",
    derivation: "same-file unique direct identifier call",
    provenance: { kind: "TRANSIENT_TREE_SITTER", generation: 3, location: { startLine: 4, endLine: 4 } },
  });
}

function indexed(path: string, symbolId: string): IndexedFile {
  return {
    relativePath: path,
    category: "source",
    contentStatus: "text",
    size: 20,
    mtimeMs: 1,
    contentHash: "a".repeat(64),
    analysis: {
      schemaVersion: "1.0",
      relativePath: path,
      language: "typescript",
      parserStatus: "parsed",
      imports: [],
      diagnostics: [],
      symbols: [{ id: symbolId, name: symbolId, qualifiedName: symbolId, kind: "function", relativePath: path, parentSymbolId: null, exported: true, public: null, language: "typescript", startLine: 1, endLine: 1, startColumn: 1, endColumn: 2 }],
    },
  };
}

function seed(): RankedFileCandidateV2 {
  return {
    identity: "file:src/helper.ts",
    relativePath: "src/helper.ts",
    category: "source",
    language: "typescript",
    origin: "DIRECT",
    directEvidence: [],
    expansionEvidence: [],
    scoreContributions: [],
    score: 200,
    rawScore: 200,
    priorityTier: 1,
    graphDistance: null,
    rankingStrategy: "contextforge-retrieval-v2-relations",
    generation: 3,
    relevantSymbols: [{ identity: "helper", name: "helper", qualifiedName: "helper", kind: "function", startLine: 1, endLine: 1, startColumn: 1, endColumn: 2, evidence: [] }],
    sourceFamilies: ["IDENTITY"],
    taskSignalIds: ["task_signal_helper"],
  };
}

const plan = {
  schemaVersion: "1.0",
  strategy: "contextforge-context-plan-v2",
  mode: "BEHAVIORAL",
  primaryContextRole: "PRIMARY_IMPLEMENTATION",
  sections: [],
  focusSignalIds: [],
  relevantConcepts: [],
  diagnostics: [],
} as const;

test("RelationshipEvidence is deterministic, source-free, repository-relative, and explicit about fact versus heuristic", () => {
  const first = relation("src/caller.ts", "caller", "src/helper.ts", "helper");
  const second = relation("src/caller.ts", "caller", "src/helper.ts", "helper");
  const heuristic = createRelationshipEvidenceV2({
    type: "TEST_ASSOCIATED_WITH_FILE",
    source: { file: "tests/helper.test.ts", symbolId: null, qualifiedName: null },
    target: { file: "src/helper.ts", symbolId: null, qualifiedName: null },
    confidence: "MEDIUM",
    classification: "HEURISTIC",
    derivation: "mirrored test filename",
    provenance: { kind: "GENERATION_GRAPH", generation: 3, location: null },
  });
  assert.deepEqual(first, second);
  assert.equal(first.structuralFact, true);
  assert.equal(heuristic.structuralFact, false);
  assert.equal(first.distance, 1);
  assert.equal(JSON.stringify([first, heuristic]).includes("C:\\"), false);
  assert.deepEqual(deduplicateRelationshipEvidenceV2([heuristic, first, first]), [first, heuristic].sort(compareRelationshipEvidenceV2));
  const repeatedCall = createRelationshipEvidenceV2({
    ...first,
    provenance: { ...first.provenance, location: { startLine: 9, endLine: 9 } },
  });
  assert.equal(repeatedCall.id, first.id);
  assert.deepEqual(deduplicateRelationshipEvidenceV2([repeatedCall, first]), [first]);
  assert.throws(() => createRelationshipEvidenceV2({
    ...heuristic,
    source: { ...heuristic.source, file: "C:/private/helper.test.ts" },
  }), /repository-relative/u);
  assert.throws(() => createRelationshipEvidenceV2({
    ...heuristic,
    confidence: "EXACT",
  }), /lower confidence/u);
});

test("generation graph test links preserve structural and heuristic classifications", () => {
  const relationships = graphRelationshipEvidenceV2([
    {
      id: "edge-exact",
      kind: "TEST_RELATES_TO_FILE",
      sourcePath: "test/helper.test.ts",
      targetPath: "src/helper.ts",
      confidence: 1,
      derivation: "structural",
      evidence: ["test directly imports source file"],
    },
    {
      id: "edge-heuristic",
      kind: "TEST_RELATES_TO_FILE",
      sourcePath: "test/other.test.ts",
      targetPath: "src/other.ts",
      confidence: 0.72,
      derivation: "heuristic",
      evidence: ["unique normalized basename match"],
    },
  ], 3);
  const exact = relationships.find((item) => item.type === "TEST_IMPORTS_FILE");
  const heuristic = relationships.find((item) => item.type === "TEST_ASSOCIATED_WITH_FILE");
  assert.equal(exact?.classification, "STRUCTURAL_FACT");
  assert.equal(exact?.confidence, "EXACT");
  assert.equal(heuristic?.classification, "HEURISTIC");
  assert.equal(heuristic?.confidence, "MEDIUM");
});

test("partial syntax analysis fails closed instead of emitting structural call facts", () => {
  const file = indexed("src/helper.ts", "helper");
  const result = deriveSymbolRelationshipsV2([file], [{
    relativePath: file.relativePath,
    language: "typescript",
    parserStatus: "degraded",
    calls: [{ calleeName: "helper", receiverName: null, form: "IDENTIFIER", startLine: 1, endLine: 1, startColumn: 1, endColumn: 7 }],
    importBindings: [],
    implementations: [],
    diagnostics: [{ code: "PARSE_SYNTAX_ERROR", message: "partial" }],
  }], [], 3);
  assert.deepEqual(result.relationships, []);
});

test("relationship expansion is direct-only, cycle-safe, and caps high-degree callers without duplicate explosion", () => {
  const files = [indexed("src/helper.ts", "helper"), ...Array.from({ length: 30 }, (_, index) => indexed(`src/caller-${index}.ts`, `caller-${index}`))];
  const relationships = files.slice(1).flatMap((file, index) => [
    relation(file.relativePath, file.analysis.symbols[0]?.id ?? "", "src/helper.ts", "helper"),
    ...(index === 0 ? [relation("src/helper.ts", "helper", file.relativePath, file.analysis.symbols[0]?.id ?? "")] : []),
  ]);
  const first = expandRelationshipEvidenceV2([seed()], files, relationships, plan, { references: true, callers: true, implementations: true, tests: true, dependents: true });
  const second = expandRelationshipEvidenceV2([seed()], files, [...relationships].reverse(), plan, { references: true, callers: true, implementations: true, tests: true, dependents: true });
  assert.deepEqual(first, second);
  assert.equal(first.evidence.filter((item) => item.matchKind === "CALLER").length, 8);
  assert.ok(first.fanoutCapEvents > 0);
  assert.ok(first.hubSuppressions > 0);
  assert.ok(first.evidence.every((item) => item.graphDistance === 1));
  assert.equal(new Set(first.evidence.map((item) => item.id)).size, first.evidence.length);
});
