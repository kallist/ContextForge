import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildIndex } from "../../src/application/build-index.js";
import { buildContextPackV2 } from "../../src/application/build-context-pack-v2.js";
import { searchRepositoryV2 } from "../../src/application/search-repository-v2.js";
import { ContextForgeError } from "../../src/core/errors.js";
import { GenericTokenEstimator } from "../../src/core/token-estimation.js";
import { classifyPackCandidate } from "../../src/core/packing/context-plan.js";
import { createCandidateEvidenceV2 } from "../../src/core/task-retrieval-v2.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

const scanner = new FileSystemRepositoryScanner();
const reader = new FileSystemRepositorySourceReader();
const factory = (root: string): SqliteIndexRepository => new SqliteIndexRepository(root);
const estimator = new GenericTokenEstimator();

test("Pack V2 packs source-backed symbol cores, merges overlaps, and verifies exact serialized boundaries", async (t) => {
  const root = await createTemporaryDirectory("pack-v2");
  t.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/service.ts", [
    ...Array.from({ length: 200 }, (_, index) => `// unrelated preamble ${index}`),
    "export class DurableStore {", "  commitValue() {", "    return '中文 ```` boundary';", "  }", "}",
    ...Array.from({ length: 200 }, (_, index) => `// unrelated appendix ${index}`),
  ].join("\n"));
  await buildIndex(scanner, reader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  const task = "fix DurableStore commitValue";
  const search = await searchRepositoryV2(scanner, reader, factory, { repositoryPath: root, task, limit: 64 });
  const candidate = search.result.candidates[0];
  assert.ok(candidate);
  assert.ok(classifyPackCandidate(candidate).strongPrimary);
  const relation = createCandidateEvidenceV2({ source: "RELATIONSHIP", family: "RELATIONSHIP", target: { file: candidate.relativePath, symbolId: null }, taskSignalId: null, matchKind: "CALLER", confidence: 1, derivation: "STRUCTURAL", location: { startLine: 201, endLine: 205 }, sourceCandidate: "seed", relationshipId: "caller-1", graphDistance: 1, ambiguity: "UNIQUE", rawFeature: true, boundedContribution: 1, explanation: "direct caller" });
  const multi = classifyPackCandidate({ ...candidate, expansionEvidence: [relation] });
  assert.ok(multi.roles.includes("PRIMARY") && multi.roles.includes("IMPACT"));
  assert.ok(multi.reasons.some((reason) => reason.role === "IMPACT" && reason.evidenceIds.includes(relation.id)));
  assert.deepEqual(classifyPackCandidate({ ...candidate, category: "test", directEvidence: [], expansionEvidence: [] }).roles, ["VALIDATION"]);
  assert.deepEqual(classifyPackCandidate({ ...candidate, category: "documentation", directEvidence: [], expansionEvidence: [] }).roles, ["SUPPORT"]);
  assert.deepEqual(classifyPackCandidate({ ...candidate, directEvidence: [], expansionEvidence: [] }).roles, ["SUPPORT"]);
  const run = (budget: number) => buildContextPackV2(scanner, reader, factory, { repositoryPath: root, task, budget }, { search: () => Promise.resolve(search) });
  const first = await run(2000);
  assert.deepEqual(first.manifest, (await run(2000)).manifest);
  assert.equal(first.markdown, (await run(2000)).markdown);
  assert.equal(first.manifest.packingStrategy, "contextforge-pack-v2");
  assert.equal(first.manifest.estimatedPayloadTokens, estimator.estimate(first.markdown));
  assert.ok(first.manifest.selectedItems[0]?.relevantSymbols.some((symbol) => symbol.qualifiedName.includes("commitValue")));
  assert.ok(!first.markdown.includes("unrelated preamble 100"));
  assert.equal(first.markdown.split("return '中文").length - 1, 1);
  const ranges = first.manifest.selectedItems[0]?.selectedRanges ?? [];
  assert.ok(ranges.every((range, index) => index === 0 || range.startLine > (ranges[index - 1]?.endLine ?? 0)));
  assert.ok(!JSON.stringify(first.manifest.planDiagnostics).includes("return '中文"));
  const boundary = first.manifest.estimatedPayloadTokens;
  for (const budget of [1, 100, boundary - 1, boundary, boundary + 1, 2000, 32000]) {
    try {
      const output = await run(budget);
      assert.ok(estimator.estimate(output.markdown) <= budget);
      assert.ok(output.manifest.selectedItems.length > 0);
    } catch (error) {
      assert.ok(error instanceof ContextForgeError && error.code === "BUDGET_TOO_SMALL");
      assert.ok(budget < boundary);
    }
  }
});

test("Pack V2 preserves one generation, rejects stale bytes and excluded candidates", async (t) => {
  const root = await createTemporaryDirectory("pack-v2-safety");
  t.after(() => removeTemporaryDirectory(root));
  await writeFixture(root, "src/anchor.ts", "export function durableWrite() { return 1; }\n");
  await writeFixture(root, "src/secondary.ts", "export function durableRead() { return 2; }\n");
  await writeFixture(root, ".env", "PRIVATE_TOKEN=never_in_pack\n");
  await writeFixture(root, ".contextforgeignore", "excluded.ts\n");
  await writeFixture(root, "excluded.ts", "export const durableWrite = 'never_in_pack';\n");
  await buildIndex(scanner, reader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  const task = "durableWrite durableRead";
  const search = await searchRepositoryV2(scanner, reader, factory, { repositoryPath: root, task, limit: 64 });
  await writeFile(join(root, "src/secondary.ts"), "export function durableRead() { return 'CHANGED_SOURCE'; }\n");
  await buildIndex(scanner, reader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
  const request = { repositoryPath: root, task, budget: 4000 };
  const firstCandidate = search.result.candidates[0];
  assert.ok(firstCandidate);
  const forged = { ...search, result: { ...search.result, candidates: [...search.result.candidates, { ...firstCandidate, identity: "file:excluded.ts", relativePath: "excluded.ts" }, { ...firstCandidate, identity: "file:.env", relativePath: ".env" }] } };
  const pack = await buildContextPackV2(scanner, reader, factory, request, { search: () => Promise.resolve(forged) });
  assert.equal(pack.manifest.generation, search.result.generation);
  assert.equal(pack.manifest.packStatus, "PARTIAL");
  assert.ok(pack.manifest.droppedCandidates.some((item) => item.reason === "STALE_SOURCE"));
  assert.ok(pack.manifest.droppedCandidates.some((item) => item.path === ".env" && item.reason === "UNSUPPORTED_CONTENT"));
  assert.ok(!pack.markdown.includes("never_in_pack"));
  assert.ok(!pack.markdown.includes("CHANGED_SOURCE"));
  assert.ok(!JSON.stringify(pack.manifest).includes(root));
  await assert.rejects(buildContextPackV2(scanner, reader, factory, request, { search: () => Promise.resolve({ ...search, result: { ...search.result, generation: search.result.generation + 1 } }) }), (error) => error instanceof ContextForgeError && error.code === "PACK_FAILED");
});
