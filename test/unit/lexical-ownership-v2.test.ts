import assert from "node:assert/strict";
import test from "node:test";

import type { AnalyzedSymbol, FileAnalysis, SourceRange } from "../../src/core/language-analysis.js";
import { findNarrowestOwningSymbolV2 } from "../../src/core/task-retrieval-v2.js";

function symbol(id: string, name: string, range: SourceRange): AnalyzedSymbol {
  return {
    id,
    name,
    qualifiedName: name,
    kind: "function",
    relativePath: "src/owner.ts",
    parentSymbolId: null,
    exported: false,
    public: false,
    language: "typescript",
    ...range,
  };
}

function analysis(parserStatus: FileAnalysis["parserStatus"], symbols: readonly AnalyzedSymbol[]): FileAnalysis {
  return {
    schemaVersion: "1.0",
    relativePath: "src/owner.ts",
    language: parserStatus === "unsupported" ? null : "typescript",
    parserStatus,
    symbols,
    imports: [],
    diagnostics: [],
  };
}

const match = { startLine: 3, endLine: 3, startColumn: 12, endColumn: 20 } as const;

test("lexical ownership chooses the unique narrowest enclosing symbol", () => {
  const outer = symbol("outer", "outer", { startLine: 1, endLine: 8, startColumn: 1, endColumn: 2 });
  const inner = symbol("inner", "inner", { startLine: 2, endLine: 5, startColumn: 3, endColumn: 4 });
  assert.equal(findNarrowestOwningSymbolV2(analysis("parsed", [outer, inner]), match)?.id, "inner");
});

test("lexical ownership fails closed for unsupported parsing, malformed ranges, and ambiguous overlap", () => {
  const valid = symbol("valid", "valid", { startLine: 1, endLine: 6, startColumn: 1, endColumn: 2 });
  assert.equal(findNarrowestOwningSymbolV2(analysis("unsupported", []), match), null);
  assert.equal(findNarrowestOwningSymbolV2(analysis("parsed", [valid]), { ...match, startLine: 0 }), null);
  const malformed = symbol("malformed", "malformed", { startLine: 5, endLine: 2, startColumn: 1, endColumn: 1 });
  assert.equal(findNarrowestOwningSymbolV2(analysis("parsed", [malformed]), match), null);

  const left = symbol("left", "left", { startLine: 1, endLine: 4, startColumn: 1, endColumn: 30 });
  const right = symbol("right", "right", { startLine: 2, endLine: 5, startColumn: 1, endColumn: 30 });
  assert.equal(findNarrowestOwningSymbolV2(analysis("parsed", [left, right]), match), null);
});
