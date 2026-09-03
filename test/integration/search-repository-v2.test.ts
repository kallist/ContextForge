import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import test from "node:test";

import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { buildIndex } from "../../src/application/build-index.js";
import { searchRepositoryV2 } from "../../src/application/search-repository-v2.js";
import { RETRIEVAL_V2 } from "../../src/core/ranking/retrieval-v2.js";
import { createTemporaryDirectory, removeTemporaryDirectory, writeFixture } from "../helpers/fixtures.js";

const scanner = new FileSystemRepositoryScanner();
const sourceReader = new FileSystemRepositorySourceReader();
const factory = (rootRealPath: string): SqliteIndexRepository => new SqliteIndexRepository(rootRealPath);

async function prepare(root: string): Promise<void> {
  await writeFixture(root, "src/owner.ts", [
    "export function outerOwner() {",
    "  function innerOwner() {",
    '    return "LEXICAL_OWNER_SENTINEL";',
    "  }",
    "  return innerOwner();",
    "}",
    "",
  ].join("\n"));
  await writeFixture(root, "src/state-store.ts", [
    "export class StateStore {",
    "  commitAtomicOutput() {",
    '    return "transaction writer atomic mutation boundary";',
    "  }",
    "}",
    "",
  ].join("\n"));
  await writeFixture(root, "src/output-publisher.ts", [
    'import { StateStore } from "./state-store.js";',
    "export class OutputPublisher {",
    "  constructor(private store: StateStore) {}",
    "  publishOutput() { return this.store.commitAtomicOutput(); }",
    "}",
    "",
  ].join("\n"));
  await writeFixture(root, "tests/output-publisher.test.ts", [
    'import { OutputPublisher } from "../src/output-publisher.js";',
    "export function concurrent() { return OutputPublisher; }",
    "export function output() { return true; }",
    "export function after() { return true; }",
    "",
  ].join("\n"));
  await writeFixture(root, "scripts/package-smoke.mjs", [
    "export async function run() {",
    '  return "parser assets tarball package smoke";',
    "}",
    "",
  ].join("\n"));
  for (let index = 0; index < 12; index += 1) {
    await writeFixture(root, `src/common-${index}.ts`, `export function run() { return ${index}; }\n`);
  }
  await writeFixture(root, "docs/ADR-006.md", "# Snapshot packing architecture\n\nGeneration-verified source snapshot packing preserves one active generation.\n");
  await writeFixture(root, "src/generic-architecture.ts", "export function generation() {}\nexport function snapshot() {}\nexport function packing() {}\n");
  await writeFixture(root, "src/caller.ts", [
    "export function readOnce() {",
    '  return "RELATIONSHIP_CALLER_SENTINEL";',
    "}",
    "export function readTextFile() {",
    "  return readOnce();",
    "}",
    "",
  ].join("\n"));
  await writeFixture(root, "src/helper.ts", "export function helperTarget() { return true; }\n");
  await writeFixture(root, "src/public-api.ts", [
    'import { helperTarget } from "./helper.js";',
    "export function publicMethod() { return helperTarget(); }",
    "export function unresolved(value: { helperTarget(): boolean }) { return value.helperTarget(); }",
    "",
  ].join("\n"));
  await writeFixture(root, "src/port.ts", "export interface SessionPort { save(): void }\n");
  await writeFixture(root, "src/implementation.ts", [
    'import { SessionPort } from "./port.js";',
    "export class SqlSessionPort implements SessionPort { save(): void {} }",
    "",
  ].join("\n"));
  await writeFixture(root, "src/ambiguous-port.ts", "export interface AmbiguousPort { save(): void }\n");
  await writeFixture(root, "src/ambiguous-port.tsx", "export interface AmbiguousPort { save(): void }\n");
  await writeFixture(root, "src/ambiguous-implementation.ts", [
    'import { AmbiguousPort } from "./ambiguous-port.js";',
    "export class AmbiguousImplementation implements AmbiguousPort { save(): void {} }",
    "",
  ].join("\n"));
  await writeFixture(root, "tests/helper.test.ts", [
    'import { helperTarget } from "../src/helper.js";',
    "export function verifiesHelper() { return helperTarget(); }",
    "",
  ].join("\n"));
  await writeFixture(root, ".env", "RELATIONSHIP_CALLER_SENTINEL=secret\n");
  await buildIndex(scanner, sourceReader, new TreeSitterLanguageAnalyzer(), factory, { repositoryPath: root });
}

function rank(paths: readonly string[], path: string): number {
  const index = paths.indexOf(path);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index + 1;
}

test("Retrieval V2 preserves exact identity, maps verified lexical matches to the narrowest symbol, and is deterministic", async (context) => {
  const root = await createTemporaryDirectory("search-v2-foundation");
  context.after(() => removeTemporaryDirectory(root));
  await prepare(root);

  const exact = await searchRepositoryV2(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "OutputPublisher.publishOutput",
    limit: 100,
  });
  assert.equal(exact.result.rankingStrategy, "contextforge-retrieval-v2");
  assert.equal(exact.result.candidates[0]?.relativePath, "src/output-publisher.ts");
  assert.ok(exact.result.candidates[0]?.directEvidence.some((item) => item.matchKind === "EXACT_QUALIFIED_SYMBOL"));

  const ownership = await searchRepositoryV2(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "fix `LEXICAL_OWNER_SENTINEL`",
    limit: 100,
  });
  const owner = ownership.result.candidates.find((candidate) => candidate.relativePath === "src/owner.ts");
  assert.ok(owner?.directEvidence.some((item) => item.source === "VERIFIED_LEXICAL" && item.location?.startLine === 3));
  assert.ok(owner?.relevantSymbols.some((symbol) => symbol.name === "innerOwner" && symbol.evidence.some((item) => item.source === "SYMBOL_OWNERSHIP")));
  assert.ok(ownership.result.counts.lexicalOwnershipSuccesses > 0);
  assert.deepEqual(ownership.result, (await searchRepositoryV2(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "fix `LEXICAL_OWNER_SENTINEL`",
    limit: 100,
  })).result);
});

test("Retrieval V2 discounts common symbols and keeps structural evidence complementary", async (context) => {
  const root = await createTemporaryDirectory("search-v2-ambiguity");
  context.after(() => removeTemporaryDirectory(root));
  await prepare(root);

  const common = (await searchRepositoryV2(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "fix parser assets package smoke run",
    limit: 100,
  })).result;
  assert.equal(common.candidates[0]?.relativePath, "scripts/package-smoke.mjs");
  const runSignal = common.taskAnalysis.signals.find((signal) => signal.normalized === "run");
  assert.equal(runSignal?.ambiguity, "COLLIDING");
  assert.ok(common.counts.ambiguityDiscounts > 0);
  const unrelatedRunEvidence = common.candidates
    .filter((candidate) => candidate.relativePath.startsWith("src/common-"))
    .flatMap((candidate) => candidate.directEvidence.filter((item) => item.matchKind === "AMBIGUOUS_SYMBOL"));
  assert.ok(unrelatedRunEvidence.length > 0);
  assert.ok(unrelatedRunEvidence.every((item) => item.boundedContribution < RETRIEVAL_V2.weights.exactSymbol));

  const concurrency = (await searchRepositoryV2(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "fix concurrent atomic output transaction writer mutation",
    limit: 100,
  })).result;
  const concurrencyPaths = concurrency.candidates.map((candidate) => candidate.relativePath);
  assert.ok(rank(concurrencyPaths, "src/state-store.ts") < rank(concurrencyPaths, "tests/output-publisher.test.ts"));
  const state = concurrency.candidates.find((candidate) => candidate.relativePath === "src/state-store.ts");
  assert.ok(state?.sourceFamilies.includes("LEXICAL"));
  assert.ok(state !== undefined && (state.expansionEvidence.length === 0 || state.origin === "DIRECT_AND_EXPANDED"));

  const structural = (await searchRepositoryV2(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "OutputPublisher.publishOutput",
    limit: 100,
  })).result;
  const store = structural.candidates.find((candidate) => candidate.relativePath === "src/state-store.ts");
  assert.ok(store?.expansionEvidence.some((item) => item.family === "STRUCTURAL" && item.sourceCandidate === "src/output-publisher.ts"));
  assert.ok((store?.rawScore ?? 0) < (structural.candidates[0]?.rawScore ?? 0));
});

test("Retrieval V2 prefers a directly matched architecture document and preserves stale-source exclusion", async (context) => {
  const root = await createTemporaryDirectory("search-v2-doc-stale");
  context.after(() => removeTemporaryDirectory(root));
  await prepare(root);

  const architecture = (await searchRepositoryV2(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "review snapshot packing architecture active generation",
    limit: 100,
  })).result;
  assert.ok(rank(architecture.candidates.map((candidate) => candidate.relativePath), "docs/ADR-006.md") <= 3);
  assert.equal(architecture.contextPlan.primaryContextRole, "DOCUMENTATION");

  await writeFile(join(root, "src", "owner.ts"), 'export const changed = "NEW_UNINDEXED_V2_LITERAL";\n', "utf8");
  const stale = (await searchRepositoryV2(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "NEW_UNINDEXED_V2_LITERAL",
    limit: 100,
  })).result;
  assert.equal(stale.indexStatus.status, "STALE");
  assert.equal(stale.candidates.some((candidate) => candidate.directEvidence.some((item) => item.matchKind === "VERIFIED_LEXICAL" && item.target.file === "src/owner.ts")), false);
  assert.ok(stale.diagnostics.includes("LEXICAL_SOURCE_STALE"));
});

test("relationship-enabled Retrieval V2 links direct callers, imports, implementations, and tests without admitting excluded files", async (context) => {
  const root = await createTemporaryDirectory("search-v2-relationships");
  context.after(() => removeTemporaryDirectory(root));
  await prepare(root);
  const relationshipAnalyzer = new TreeSitterLanguageAnalyzer();

  const sameFile = (await searchRepositoryV2(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "RELATIONSHIP_CALLER_SENTINEL",
    limit: 100,
    ablation: "RELATION_FULL",
  }, relationshipAnalyzer)).result;
  const callerFile = sameFile.candidates.find((candidate) => candidate.relativePath === "src/caller.ts");
  assert.equal(sameFile.rankingStrategy, "contextforge-retrieval-v2-relations");
  assert.ok(callerFile?.relevantSymbols.some((symbol) => symbol.name === "readTextFile" && symbol.evidence.some((item) => item.matchKind === "CALLER")));
  assert.ok(sameFile.relationships.some((item) => item.type === "SYMBOL_REFERENCES_SYMBOL" && item.source.qualifiedName === "readTextFile" && item.target.qualifiedName === "readOnce" && item.classification === "STRUCTURAL_FACT"));
  assert.equal(sameFile.candidates.some((candidate) => candidate.relativePath === ".env"), false);

  const imported = (await searchRepositoryV2(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "helperTarget",
    limit: 100,
    ablation: "RELATION_FULL",
  }, relationshipAnalyzer)).result;
  const publicApi = imported.candidates.find((candidate) => candidate.relativePath === "src/public-api.ts");
  const testFile = imported.candidates.find((candidate) => candidate.relativePath === "tests/helper.test.ts");
  assert.ok(publicApi?.relevantSymbols.some((symbol) => symbol.name === "publicMethod" && symbol.evidence.some((item) => item.matchKind === "CALLER")));
  assert.ok(testFile?.relevantSymbols.some((symbol) => symbol.name === "verifiesHelper" && symbol.evidence.some((item) => item.matchKind === "TEST_REFERENCE")));
  assert.equal(publicApi?.relevantSymbols.some((symbol) => symbol.name === "unresolved" && symbol.evidence.some((item) => item.matchKind === "CALLER")), false);

  const implementation = (await searchRepositoryV2(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "SessionPort",
    limit: 100,
    ablation: "RELATION_FULL",
  }, relationshipAnalyzer)).result;
  const implementationFile = implementation.candidates.find((candidate) => candidate.relativePath === "src/implementation.ts");
  assert.ok(implementationFile?.relevantSymbols.some((symbol) => symbol.name === "SqlSessionPort" && symbol.evidence.some((item) => item.matchKind === "IMPLEMENTATION")));
  assert.ok(implementation.relationships.some((item) => item.type === "SYMBOL_IMPLEMENTS_SYMBOL" && item.source.qualifiedName === "SqlSessionPort" && item.target.qualifiedName === "SessionPort"));

  const ambiguousImplementation = (await searchRepositoryV2(scanner, sourceReader, factory, {
    repositoryPath: root,
    task: "AmbiguousPort",
    limit: 100,
    ablation: "RELATION_FULL",
  }, relationshipAnalyzer)).result;
  assert.equal(ambiguousImplementation.relationships.some((item) => item.type === "SYMBOL_IMPLEMENTS_SYMBOL" && item.source.qualifiedName === "AmbiguousImplementation"), false);
  assert.ok(ambiguousImplementation.diagnostics.some((item) => item.startsWith("RELATIONSHIP_IMPLEMENTATION_UNRESOLVED:")));
});
