import type {
  AnalyzedDirectCall,
  AnalyzedImportBinding,
  AnalyzedSymbol,
  RelationshipSyntaxAnalysis,
} from "./language-analysis.js";
import type { IndexedFile } from "./repository-index.js";
import type { ResolvedImport } from "./repository-graph.js";
import {
  createRelationshipEvidenceV2,
  deduplicateRelationshipEvidenceV2,
  type RelationshipEvidenceV2,
} from "./relationship-intelligence-v2.js";
import { findNarrowestOwningSymbolV2 } from "./task-retrieval-v2.js";

export interface SymbolRelationshipDerivationV2 {
  readonly relationships: readonly RelationshipEvidenceV2[];
  readonly diagnostics: readonly string[];
  readonly unresolvedCalls: number;
  readonly ambiguousCalls: number;
  readonly unresolvedImplementations: number;
}

interface ImportTarget {
  readonly binding: AnalyzedImportBinding;
  readonly targetFile: IndexedFile;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function entity(file: IndexedFile, symbol: AnalyzedSymbol) {
  return { file: file.relativePath, symbolId: symbol.id, qualifiedName: symbol.qualifiedName } as const;
}

function uniqueSymbol(file: IndexedFile, predicate: (symbol: AnalyzedSymbol) => boolean): AnalyzedSymbol | null {
  const matches = file.analysis.symbols.filter(predicate);
  return matches.length === 1 ? matches[0] ?? null : null;
}

function resolvedTarget(
  sourcePath: string,
  moduleSpecifier: string,
  resolvedImports: readonly ResolvedImport[],
  fileByPath: ReadonlyMap<string, IndexedFile>,
): IndexedFile | null {
  const matches = resolvedImports.filter((item) =>
    item.sourcePath === sourcePath &&
    item.moduleSpecifier === moduleSpecifier &&
    item.status === "resolved_internal" &&
    item.targetPath !== null,
  );
  const targets = [...new Set(matches.flatMap((item) => item.targetPath === null ? [] : [item.targetPath]))];
  return targets.length === 1 ? fileByPath.get(targets[0] ?? "") ?? null : null;
}

function importTargets(
  file: IndexedFile,
  syntax: RelationshipSyntaxAnalysis,
  resolvedImports: readonly ResolvedImport[],
  fileByPath: ReadonlyMap<string, IndexedFile>,
): ImportTarget[] {
  return syntax.importBindings.flatMap((binding): ImportTarget[] => {
    const targetFile = resolvedTarget(file.relativePath, binding.moduleSpecifier, resolvedImports, fileByPath);
    return targetFile === null ? [] : [{ binding, targetFile }];
  });
}

function directCallTarget(
  file: IndexedFile,
  caller: AnalyzedSymbol,
  call: AnalyzedDirectCall,
  imports: readonly ImportTarget[],
): { readonly file: IndexedFile; readonly symbol: AnalyzedSymbol; readonly derivation: string } | null {
  if (call.form === "SELF_MEMBER") {
    if (caller.parentSymbolId === null) return null;
    const symbol = uniqueSymbol(file, (candidate) =>
      candidate.parentSymbolId === caller.parentSymbolId && candidate.kind === "method" && candidate.name === call.calleeName,
    );
    return symbol === null ? null : { file, symbol, derivation: "same-class self/this direct method call" };
  }

  if (call.form === "IDENTIFIER") {
    const local = uniqueSymbol(file, (candidate) =>
      candidate.parentSymbolId === null && candidate.name === call.calleeName && (candidate.kind === "function" || candidate.kind === "class"),
    );
    if (local !== null) return { file, symbol: local, derivation: "same-file unique direct identifier call" };
    const bindings = imports.filter((item) => item.binding.kind === "NAMED" && item.binding.localName === call.calleeName);
    if (bindings.length !== 1) return null;
    const imported = bindings[0];
    if (imported === undefined) return null;
    const symbol = uniqueSymbol(imported.targetFile, (candidate) =>
      candidate.parentSymbolId === null && candidate.name === imported.binding.importedName,
    );
    return symbol === null ? null : { file: imported.targetFile, symbol, derivation: "uniquely resolved named import direct call" };
  }

  if (call.form === "NAMESPACE_MEMBER" && call.receiverName !== null) {
    const bindings = imports.filter((item) => item.binding.kind === "NAMESPACE" && item.binding.localName === call.receiverName);
    if (bindings.length !== 1) return null;
    const imported = bindings[0];
    if (imported === undefined) return null;
    const symbol = uniqueSymbol(imported.targetFile, (candidate) =>
      candidate.parentSymbolId === null && candidate.name === call.calleeName,
    );
    return symbol === null ? null : { file: imported.targetFile, symbol, derivation: "uniquely resolved namespace import direct call" };
  }

  return null;
}

function implementationTarget(
  file: IndexedFile,
  interfaceName: string,
  imports: readonly ImportTarget[],
): { readonly file: IndexedFile; readonly symbol: AnalyzedSymbol; readonly derivation: string } | null {
  const local = uniqueSymbol(file, (candidate) => candidate.kind === "interface" && candidate.name === interfaceName);
  if (local !== null) return { file, symbol: local, derivation: "same-file TypeScript implements clause" };
  const bindings = imports.filter((item) => item.binding.kind === "NAMED" && item.binding.localName === interfaceName);
  if (bindings.length !== 1) return null;
  const imported = bindings[0];
  if (imported === undefined) return null;
  const symbol = uniqueSymbol(imported.targetFile, (candidate) => candidate.kind === "interface" && candidate.name === imported.binding.importedName);
  return symbol === null ? null : { file: imported.targetFile, symbol, derivation: "uniquely resolved imported TypeScript implements clause" };
}

export function deriveSymbolRelationshipsV2(
  files: readonly IndexedFile[],
  syntaxAnalyses: readonly RelationshipSyntaxAnalysis[],
  resolvedImports: readonly ResolvedImport[],
  generation: number,
): SymbolRelationshipDerivationV2 {
  const fileByPath = new Map(files.map((file) => [file.relativePath, file]));
  const syntaxByPath = new Map(syntaxAnalyses.map((analysis) => [analysis.relativePath, analysis]));
  const relationships: RelationshipEvidenceV2[] = [];
  let unresolvedCalls = 0;
  let ambiguousCalls = 0;
  let unresolvedImplementations = 0;

  for (const file of [...files].sort((left, right) => compareText(left.relativePath, right.relativePath))) {
    const syntax = syntaxByPath.get(file.relativePath);
    if (syntax === undefined || syntax.parserStatus !== "parsed") continue;
    const imports = importTargets(file, syntax, resolvedImports, fileByPath);
    for (const call of syntax.calls) {
      const caller = findNarrowestOwningSymbolV2(file.analysis, call);
      if (caller === null) {
        unresolvedCalls += 1;
        continue;
      }
      const target = directCallTarget(file, caller, call, imports);
      if (target === null) {
        if (call.form === "UNRESOLVED_MEMBER") ambiguousCalls += 1;
        else unresolvedCalls += 1;
        continue;
      }
      if (caller.id === target.symbol.id) continue;
      const testReference = file.category === "test" && target.file.category !== "test";
      relationships.push(createRelationshipEvidenceV2({
        type: testReference ? "TEST_REFERENCES_SYMBOL" : "SYMBOL_REFERENCES_SYMBOL",
        source: entity(file, caller),
        target: entity(target.file, target.symbol),
        confidence: "EXACT",
        classification: "STRUCTURAL_FACT",
        derivation: target.derivation,
        provenance: { kind: "TRANSIENT_TREE_SITTER", generation, location: { startLine: call.startLine, endLine: call.endLine } },
      }));
    }

    for (const implementation of syntax.implementations) {
      const implementationSymbol = uniqueSymbol(file, (candidate) => candidate.kind === "class" && candidate.name === implementation.implementationName);
      const target = implementationTarget(file, implementation.interfaceName, imports);
      if (implementationSymbol === null || target === null) {
        unresolvedImplementations += 1;
        continue;
      }
      relationships.push(createRelationshipEvidenceV2({
        type: "SYMBOL_IMPLEMENTS_SYMBOL",
        source: entity(file, implementationSymbol),
        target: entity(target.file, target.symbol),
        confidence: "EXACT",
        classification: "STRUCTURAL_FACT",
        derivation: target.derivation,
        provenance: { kind: "TRANSIENT_TREE_SITTER", generation, location: { startLine: implementation.startLine, endLine: implementation.endLine } },
      }));
    }
  }

  const diagnostics = [
    ...(unresolvedCalls > 0 ? [`RELATIONSHIP_CALL_UNRESOLVED:${unresolvedCalls}`] : []),
    ...(ambiguousCalls > 0 ? [`RELATIONSHIP_CALL_AMBIGUOUS:${ambiguousCalls}`] : []),
    ...(unresolvedImplementations > 0 ? [`RELATIONSHIP_IMPLEMENTATION_UNRESOLVED:${unresolvedImplementations}`] : []),
  ].sort(compareText);
  return {
    relationships: deduplicateRelationshipEvidenceV2(relationships),
    diagnostics,
    unresolvedCalls,
    ambiguousCalls,
    unresolvedImplementations,
  };
}
