import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { deriveSymbolRelationshipsV2 } from "../../src/core/derive-symbol-relationships-v2.js";
import type { IndexedFile } from "../../src/core/repository-index.js";
import type { ResolvedImport } from "../../src/core/repository-graph.js";

const analyzer = new TreeSitterLanguageAnalyzer();
const outer = "export function helper() { return 1; }\n";

async function derive(source: string, relativePath = "src/sample.ts", imported = false) {
  const sources = [{ relativePath, source }, ...(imported ? [{ relativePath: "src/helper.ts", source: outer }] : [])];
  const files: IndexedFile[] = await Promise.all(sources.map(async (request) => ({
    relativePath: request.relativePath,
    category: "source",
    contentStatus: "text",
    size: Buffer.byteLength(request.source),
    mtimeMs: 1,
    contentHash: createHash("sha256").update(request.source).digest("hex"),
    analysis: await analyzer.analyze(request),
  })));
  const syntax = await Promise.all(sources.map((request) => analyzer.analyzeRelationships(request)));
  assert.ok(syntax.every((item) => item.parserStatus === "parsed"), JSON.stringify(syntax));
  const imports: ResolvedImport[] = files.flatMap((file) => file.analysis.imports.map((item, importOrdinal) => ({
    sourcePath: file.relativePath, importOrdinal, moduleSpecifier: item.moduleSpecifier,
    status: "resolved_internal", targetPath: "src/helper.ts", candidates: ["src/helper.ts"], evidence: ["test unique import"],
  })));
  return { ...deriveSymbolRelationshipsV2(files, syntax, imports, 1), syntax };
}

const negatives = [
  ["parameter", "export function caller(helper: () => number) { return helper(); }"],
  ["const", "export function caller() { const helper = () => 2; return helper(); }"],
  ["let TDZ", "export function caller() { helper(); let helper = () => 2; }"],
  ["var hoisting out of block", "export function caller() { helper(); if (true) { var helper = () => 2; } }"],
  ["local function", "export function caller() { helper(); function helper() { return 2; } }"],
  ["local class TDZ", "export function caller() { helper(); class helper {} }"],
  ["arrow parameter", "export const caller = (helper: () => number) => helper();"],
  ["single arrow parameter", "export const caller = helper => helper();"],
  ["destructured parameter", "export function caller({ helper }: any) { return helper(); }"],
  ["destructured local alias", "export function caller(obj: any) { const { method: helper } = obj; return helper(); }"],
  ["array rest binding", "export function caller(obj: any) { const [other, ...helper] = obj; return helper(); }"],
  ["catch parameter", "export function caller() { try {} catch (helper) { helper(); } }"],
  ["enclosing nested scope", "export function caller(helper: any) { function inner() { helper(); } return inner(); }"],
  ["for-of binding", "export function caller(xs: any) { for (const helper of xs) { helper(); } }"],
  ["switch lexical binding", "export function caller(x: any) { switch (x) { case 1: helper(); break; case 2: let helper; } }"],
  ["runtime enum", "export function caller() { enum helper { X } helper(); }"],
  ["named function expression", "export function caller() { const other = function helper() { return helper(); }; return other(); }"],
  ["named class expression", "export function caller() { const other = class helper { method() { helper(); } }; }"],
  ["static-block var", "export class C { static { helper(); var helper; } }"],
  ["nested destructuring default", "export function caller({ x: { helper = () => 2 } }: any) { helper(); }"],
] as const;

for (const [name, body] of negatives) {
  test(`bare caller rejects outer target shadowed by ${name}`, async () => {
    const result = await derive(outer + body);
    assert.equal(result.relationships.some((item) => item.target.qualifiedName === "helper"), false);
    assert.ok(result.diagnostics.some((item) => item.startsWith("RELATIONSHIP_CALL_SHADOWED:")));
  });
}

for (const [name, body] of negatives.slice(0, 2)) {
  test(`bare imported caller rejects ${name} shadow`, async () => {
    const result = await derive('import { helper } from "./helper.js";\n' + body, "src/sample.ts", true);
    assert.equal(result.relationships.some((item) => item.target.file === "src/helper.ts"), false);
  });
}

test("block shadow does not suppress the valid call outside the block", async () => {
  const result = await derive(outer + [
    "export function caller(flag: boolean) {",
    "  if (flag) { const helper = () => 2; helper(); }",
    "  return helper();",
    "}",
  ].join("\n"));
  const relation = result.relationships.find((item) => item.target.qualifiedName === "helper");
  assert.equal(relation?.provenance.location?.startLine, 4);
  assert.equal(relation.confidence, "EXACT");
});

test("unshadowed direct, imported and type-only names preserve exact caller facts", async () => {
  for (const body of [
    "export function caller() { return helper(); }",
    "export function caller() { interface helper {} return helper(); }",
    "export function caller() { type helper = number; return helper(); }",
    "export function caller() { const { helper: renamed } = {} as any; return helper(); }",
    "export function caller() { const unrelated = (helper: any) => helper(); return helper(); }",
    "export function caller() { class Other {} return helper(); }",
    "export function caller() { try {} catch (helper) {} return helper(); }",
    "export function caller(this: object) { return helper(); }",
  ]) {
    for (const imported of [false, true]) {
      const result = await derive((imported ? 'import { helper } from "./helper.js";\n' : outer) + body, "src/sample.ts", imported);
      const relation = result.relationships.find((item) => item.source.qualifiedName === "caller" && item.target.qualifiedName === "helper");
      assert.equal(relation?.classification, "STRUCTURAL_FACT", body);
      assert.equal(relation.confidence, "EXACT");
    }
  }
});

test("this method and namespace members are not shadowed by local property-name bindings", async () => {
  const result = await derive('import * as api from "./helper.js";\nexport class Service { helper() {} caller(helper: any) { this.helper(); api.helper(); } }', "src/sample.ts", true);
  assert.ok(result.relationships.some((item) => item.target.qualifiedName === "Service.helper"));
  assert.ok(result.relationships.some((item) => item.target.file === "src/helper.ts"));
});

test("recursive bare calls retain existing self-edge omission without becoming unresolved", async () => {
  const result = await derive("export function helper() { return helper(); }");
  assert.equal(result.syntax[0]?.calls.length, 1);
  assert.deepEqual(result.relationships, []);
  assert.deepEqual(result.diagnostics, []);
  const expression = await derive("export const helper = function helper() { return helper(); };");
  assert.deepEqual(expression.diagnostics, []);
});

test("JavaScript, JSX and TSX parameter shadowing uses the same guard", async () => {
  for (const extension of ["js", "jsx", "tsx"]) {
    const result = await derive(outer + "export function caller(helper) { return helper(); }", `src/sample.${extension}`);
    assert.deepEqual(result.relationships, []);
  }
});

test("Python function-local bindings shadow through control blocks, not JavaScript block scopes", async () => {
  for (const body of [
    "def caller(helper):\n    return helper()\n",
    "def caller():\n    helper()\n    if True:\n        helper = lambda: 2\n",
    "def caller():\n    def helper():\n        return 2\n    return helper()\n",
    "def caller(xs):\n    for helper in xs:\n        pass\n    return helper()\n",
    "def caller():\n    return (lambda helper: helper())(None)\n",
    "def caller(obj):\n    a, helper = obj\n    return helper()\n",
    "def caller():\n    try:\n        pass\n    except Exception as helper:\n        helper()\n",
    "def caller(xs):\n    [(helper := x) for x in xs]\n    return helper()\n",
  ]) {
    const result = await derive("def helper():\n    return 1\n" + body, "src/sample.py");
    assert.equal(result.relationships.some((item) => item.target.qualifiedName === "helper"), false, body);
  }
  const direct = await derive("def helper():\n    return 1\ndef caller():\n    return helper()\n", "src/sample.py");
  assert.equal(direct.relationships[0]?.confidence, "EXACT");
  const member = await derive("class Service:\n    def helper(self):\n        pass\n    def caller(self, helper):\n        self.helper()\n", "src/sample.py");
  assert.equal(member.relationships[0]?.target.qualifiedName, "Service.helper");
});

test("Python comprehension locals and class attributes do not shadow an outer bare call", async () => {
  const result = await derive("def helper():\n    return 1\ndef caller(xs):\n    [helper() for helper in xs]\n    return helper()\nclass C:\n    helper = 2\n    def method(self):\n        return helper()\n", "src/sample.py");
  assert.deepEqual(result.relationships.map((item) => item.provenance.location?.startLine).sort((a, b) => (a ?? 0) - (b ?? 0)), [5, 9]);
});

test("unproven binding environments fail closed with a bounded partial diagnostic", async () => {
  const python = await derive("def helper():\n    return 1\ndef caller(obj):\n    match obj:\n        case {\"helper\": helper}:\n            return helper()\n", "src/sample.py");
  assert.deepEqual(python.relationships, []);
  assert.ok(python.diagnostics.includes("SHADOW_DETECTION_PARTIAL:1"));
  const javascript = await derive(outer + "export function caller(obj) { with (obj) { helper(); } }", "src/sample.js");
  assert.deepEqual(javascript.relationships, []);
  assert.ok(javascript.diagnostics.includes("SHADOW_DETECTION_PARTIAL:1"));
  const escaped = await derive(outer + "export function caller(hel\\u0070er: any) { helper(); }");
  assert.deepEqual(escaped.relationships, []);
  assert.ok(escaped.diagnostics.includes("SHADOW_DETECTION_PARTIAL:1"));
});

test("many call sites reuse complete scopes without losing late TDZ bindings or call order", async () => {
  const repetitions = 128;
  const result = await derive(outer + [
    "export function caller() {",
    ...Array.from({ length: repetitions }, () => "  helper();"),
    "  {",
    ...Array.from({ length: repetitions }, () => "    helper();"),
    "    let helper: any;",
    "  }",
    "  return helper();",
    "}",
  ].join("\n"));
  const calls = result.syntax[0]?.calls ?? [];
  assert.equal(calls.length, repetitions * 2 + 1);
  assert.equal(calls.filter((call) => call.localBindingGuard === "SHADOWED").length, repetitions);
  assert.ok(calls.slice(0, repetitions).every((call) => call.localBindingGuard === undefined));
  assert.equal(calls.at(-1)?.localBindingGuard, undefined);
  assert.deepEqual(calls.map((call) => call.startLine), [...calls.map((call) => call.startLine)].sort((a, b) => a - b));
  assert.equal(result.relationships.length, 1);
  assert.equal(result.relationships[0]?.provenance.location?.startLine, 3);
});
