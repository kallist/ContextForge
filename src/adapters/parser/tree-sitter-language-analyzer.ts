import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { Language, Parser, type Node as SyntaxNode } from "web-tree-sitter";

import { ContextForgeError } from "../../core/errors.js";
import {
  LANGUAGE_ANALYSIS_SCHEMA_VERSION,
  LANGUAGE_ANALYSIS_VERSION,
  analysisLanguageForPath,
  createStableSymbolId,
  unsupportedFileAnalysis,
  type AnalyzeSourceRequest,
  type AnalyzedImport,
  type AnalyzedSymbol,
  type FileAnalysis,
  type ImportKind,
  type LanguageAnalyzer,
  type SourceRange,
  type SupportedLanguage,
  type SymbolKind,
} from "../../core/language-analysis.js";

type GrammarId = "javascript" | "typescript" | "tsx" | "python";

interface GrammarAsset {
  readonly file: string;
  readonly sha256: string;
  readonly abi: number;
}

const RUNTIME_ASSET: GrammarAsset = {
  file: "web-tree-sitter.wasm",
  sha256: "99fa2281fc4c6da713ccdadce72e81571b032ab9901b751be2d5aa127c843aaf",
  abi: 15,
};

const GRAMMAR_ASSETS: Readonly<Record<GrammarId, GrammarAsset>> = {
  javascript: {
    file: "tree-sitter-javascript.wasm",
    sha256: "163a9ace4029f98a9e7a8e7d0b2e814b8453ae00074f389bc8f6e1ce09e29719",
    abi: 15,
  },
  typescript: {
    file: "tree-sitter-typescript.wasm",
    sha256: "0df5e286c944afd0e3ef1fd6ca973a5b017d7ec3e2d5b08fe0861ed9d6c8d337",
    abi: 15,
  },
  tsx: {
    file: "tree-sitter-tsx.wasm",
    sha256: "d8c62a9dbf83f2c72269697213b29687bc3828745c33c6a097decb249d987831",
    abi: 15,
  },
  python: {
    file: "tree-sitter-python.wasm",
    sha256: "fa16de5f853ef7c5361930979d7c4b91f266a7decfcad3125eebc19e2ecb895b",
    abi: 15,
  },
};

interface ParserSlot {
  readonly parser: Parser;
  tail: Promise<void>;
}

interface PendingSymbol extends SourceRange {
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: SymbolKind;
  readonly parentIndex: number | null;
  readonly exported: boolean | null;
  readonly public: boolean | null;
}

async function verifiedAsset(asset: GrammarAsset, assetUrl: URL): Promise<Uint8Array> {
  const bytes = await readFile(assetUrl);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== asset.sha256) throw new Error(`Checksum mismatch for parser asset ${asset.file}.`);
  return bytes;
}

function grammarForLanguage(language: SupportedLanguage): GrammarId {
  if (language === "javascript" || language === "jsx") return "javascript";
  return language;
}

function rangeOf(node: SyntaxNode): SourceRange {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column + 1,
    endColumn: node.endPosition.column + 1,
  };
}

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text.at(-1);
    if ((first === "\"" || first === "'" || first === "`") && last === first) return text.slice(1, -1);
  }
  return text;
}

function symbolName(node: SyntaxNode): string | null {
  const named = node.childForFieldName("name");
  if (named !== null && named.text.length > 0) return named.text;
  if (node.type === "variable_declarator") return node.namedChild(0)?.text ?? null;
  return null;
}

function javascriptSymbolKind(node: SyntaxNode): SymbolKind | null {
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration":
      return "function";
    case "class_declaration":
    case "abstract_class_declaration":
      return "class";
    case "method_definition":
    case "method_signature":
    case "abstract_method_signature":
      return "method";
    case "interface_declaration":
      return "interface";
    case "type_alias_declaration":
      return "type";
    case "enum_declaration":
      return "enum";
    case "variable_declarator": {
      const value = node.childForFieldName("value");
      return value?.type === "arrow_function" || value?.type === "function_expression" ? "function" : "variable";
    }
    default:
      return null;
  }
}

function pythonSymbolKind(node: SyntaxNode, parent: PendingSymbol | undefined): SymbolKind | null {
  if (node.type === "class_definition") return "class";
  if (node.type === "function_definition") return parent?.kind === "class" ? "method" : "function";
  return null;
}

function javascriptPublic(node: SyntaxNode, name: string, kind: SymbolKind): boolean | null {
  if (kind !== "method") return null;
  if (name.startsWith("#")) return false;
  if (node.namedChildren.some((child) => child.type === "accessibility_modifier" && child.text !== "public")) return false;
  return true;
}

function addSymbols(root: SyntaxNode, language: SupportedLanguage, relativePath: string): AnalyzedSymbol[] {
  const pending: PendingSymbol[] = [];

  function visit(node: SyntaxNode, parentIndex: number | null, exportedContext: boolean): void {
    if (node.type === "export_statement") {
      for (const child of node.namedChildren) visit(child, parentIndex, true);
      return;
    }

    const parent = parentIndex === null ? undefined : pending[parentIndex];
    let kind = language === "python" ? pythonSymbolKind(node, parent) : javascriptSymbolKind(node);
    if (node.type === "variable_declarator" && parent !== undefined) kind = null;
    let childParent = parentIndex;
    if (kind !== null) {
      const name = symbolName(node);
      if (name !== null && name.length > 0) {
        const qualifiedName = parent === undefined ? name : `${parent.qualifiedName}.${name}`;
        const exported = language === "python" ? null : exportedContext;
        const isPublic = language === "python" ? !name.startsWith("_") : javascriptPublic(node, name, kind);
        childParent = pending.length;
        pending.push({
          ...rangeOf(node),
          name,
          qualifiedName,
          kind,
          parentIndex,
          exported,
          public: isPublic,
        });
      }
    }

    for (const child of node.namedChildren) visit(child, childParent, kind === null ? exportedContext : false);
  }

  visit(root, null, false);
  const occurrenceCounts = new Map<string, number>();
  const identifiers: string[] = [];
  for (const symbol of pending) {
    const key = `${symbol.kind}\u0000${symbol.qualifiedName}`;
    const occurrence = occurrenceCounts.get(key) ?? 0;
    occurrenceCounts.set(key, occurrence + 1);
    identifiers.push(createStableSymbolId(relativePath, symbol.kind, symbol.qualifiedName, occurrence));
  }
  return pending.map((symbol, index) => ({
    id: identifiers[index] ?? "",
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind,
    relativePath,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    startColumn: symbol.startColumn,
    endColumn: symbol.endColumn,
    parentSymbolId: symbol.parentIndex === null ? null : (identifiers[symbol.parentIndex] ?? null),
    exported: symbol.exported,
    public: symbol.public,
    language,
  }));
}

function importRecord(
  relativePath: string,
  node: SyntaxNode,
  moduleSpecifier: string,
  kind: ImportKind,
  names: readonly string[],
): AnalyzedImport {
  return { relativePath, moduleSpecifier, kind, names: [...new Set(names)], ...rangeOf(node) };
}

function javascriptImportNames(node: SyntaxNode): string[] {
  const names: string[] = [];
  function visit(child: SyntaxNode): void {
    if (child.type === "import_specifier" || child.type === "export_specifier") {
      const local = child.childForFieldName("alias") ?? child.childForFieldName("name") ?? child.namedChild(0);
      if (local !== null) names.push(local.text);
      return;
    }
    if (child.type === "namespace_import") {
      const local = child.namedChildren.at(-1);
      if (local !== undefined) names.push(`* as ${local.text}`);
      return;
    }
    if (child.type === "identifier" && child.parent?.type === "import_clause") names.push(child.text);
    for (const nested of child.namedChildren) visit(nested);
  }
  visit(node);
  return names;
}

function addJavascriptImports(root: SyntaxNode, relativePath: string): AnalyzedImport[] {
  const imports: AnalyzedImport[] = [];
  function visit(node: SyntaxNode): void {
    if (node.type === "import_statement") {
      const source = node.childForFieldName("source") ?? node.namedChildren.find((child) => child.type === "string");
      if (source !== undefined && source !== null) {
        const names = javascriptImportNames(node);
        imports.push(importRecord(relativePath, node, unquote(source.text), names.length === 0 ? "side_effect" : "import", names));
      }
      return;
    }
    if (node.type === "export_statement") {
      const source = node.childForFieldName("source") ?? node.namedChildren.find((child) => child.type === "string");
      if (source !== undefined && source !== null) {
        imports.push(importRecord(relativePath, node, unquote(source.text), "re_export", javascriptImportNames(node)));
      }
    }
    if (node.type === "call_expression") {
      const callee = node.childForFieldName("function");
      if (callee?.text === "require" || callee?.text === "import") {
        const argumentsNode = node.childForFieldName("arguments");
        const source = argumentsNode?.namedChildren.find((child) => child.type === "string");
        if (source !== undefined) {
          imports.push(importRecord(relativePath, node, unquote(source.text), callee.text === "require" ? "require" : "dynamic", []));
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  }
  visit(root);
  return imports;
}

function addPythonImports(root: SyntaxNode, relativePath: string): AnalyzedImport[] {
  const imports: AnalyzedImport[] = [];
  function visit(node: SyntaxNode): void {
    if (node.type === "import_statement") {
      for (const imported of node.namedChildren) {
        if (imported.type === "aliased_import") {
          const module = imported.childForFieldName("name") ?? imported.namedChild(0);
          const alias = imported.childForFieldName("alias") ?? imported.namedChildren.at(-1);
          if (module !== null) imports.push(importRecord(relativePath, node, module.text, "import", alias === undefined || alias === null ? [] : [alias.text]));
        } else if (imported.type === "dotted_name" || imported.type === "identifier") {
          imports.push(importRecord(relativePath, node, imported.text, "import", []));
        }
      }
      return;
    }
    if (node.type === "import_from_statement") {
      const module = node.childForFieldName("module_name") ?? node.namedChildren[0];
      if (module !== undefined && module !== null) {
        const names: string[] = [];
        for (const imported of node.namedChildren) {
          if (imported.id === module.id) continue;
          if (imported.type === "aliased_import") {
            const alias = imported.childForFieldName("alias") ?? imported.namedChildren.at(-1);
            if (alias !== undefined && alias !== null) names.push(alias.text);
          } else if (imported.type === "dotted_name" || imported.type === "identifier") {
            names.push(imported.text);
          } else if (imported.type === "wildcard_import") {
            names.push("*");
          }
        }
        imports.push(importRecord(relativePath, node, module.text, "from_import", names));
      }
      return;
    }
    for (const child of node.namedChildren) visit(child);
  }
  visit(root);
  return imports;
}

export class TreeSitterLanguageAnalyzer implements LanguageAnalyzer {
  readonly analysisVersion = LANGUAGE_ANALYSIS_VERSION;
  readonly #slots = new Map<GrammarId, ParserSlot>();
  readonly #assetDirectory: URL;
  #initialization: Promise<{ readonly durationMs: number }> | undefined;

  constructor(assetDirectory = new URL("./assets/", import.meta.url)) {
    this.#assetDirectory = assetDirectory;
  }

  #assetUrl(file: string): URL {
    return new URL(file, this.#assetDirectory);
  }

  initialize(): Promise<{ readonly durationMs: number }> {
    this.#initialization ??= this.#initializeInternal();
    return this.#initialization;
  }

  async #initializeInternal(): Promise<{ readonly durationMs: number }> {
    const started = performance.now();
    try {
      await verifiedAsset(RUNTIME_ASSET, this.#assetUrl(RUNTIME_ASSET.file));
      await Parser.init({ locateFile: () => fileURLToPath(this.#assetUrl(RUNTIME_ASSET.file)) });
      await Promise.all(
        (Object.keys(GRAMMAR_ASSETS) as GrammarId[]).map(async (grammarId) => {
          const asset = GRAMMAR_ASSETS[grammarId];
          const bytes = await verifiedAsset(asset, this.#assetUrl(asset.file));
          const language = await Language.load(bytes);
          if (language.abiVersion !== asset.abi) throw new Error(`Unexpected parser ABI for ${grammarId}.`);
          const parser = new Parser();
          parser.setLanguage(language);
          this.#slots.set(grammarId, { parser, tail: Promise.resolve() });
        }),
      );
      return { durationMs: performance.now() - started };
    } catch (error) {
      throw new ContextForgeError(
        "PARSER_UNAVAILABLE",
        "A required packaged Tree-sitter runtime or grammar asset could not be initialized.",
        { cause: error },
      );
    }
  }

  async analyze(request: AnalyzeSourceRequest): Promise<FileAnalysis> {
    const language = analysisLanguageForPath(request.relativePath);
    if (language === null) return unsupportedFileAnalysis(request.relativePath);
    await this.initialize();
    const slot = this.#slots.get(grammarForLanguage(language));
    if (slot === undefined) {
      throw new ContextForgeError("PARSER_UNAVAILABLE", `The packaged ${language} grammar is unavailable.`);
    }

    const previous = slot.tail;
    let release = (): void => undefined;
    slot.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      slot.parser.reset();
      const tree = slot.parser.parse(request.source);
      if (tree === null) {
        return {
          schemaVersion: LANGUAGE_ANALYSIS_SCHEMA_VERSION,
          relativePath: request.relativePath,
          language,
          parserStatus: "failed",
          symbols: [],
          imports: [],
          diagnostics: [{ code: "PARSE_NO_TREE", message: "The parser did not return a syntax tree." }],
        };
      }
      try {
        const root = tree.rootNode;
        return {
          schemaVersion: LANGUAGE_ANALYSIS_SCHEMA_VERSION,
          relativePath: request.relativePath,
          language,
          parserStatus: root.hasError ? "degraded" : "parsed",
          symbols: addSymbols(root, language, request.relativePath),
          imports: language === "python" ? addPythonImports(root, request.relativePath) : addJavascriptImports(root, request.relativePath),
          diagnostics: root.hasError
            ? [{ code: "PARSE_SYNTAX_ERROR", message: "Tree-sitter recovered from one or more syntax errors; extracted structure may be partial." }]
            : [],
        };
      } finally {
        tree.delete();
      }
    } catch {
      return {
        schemaVersion: LANGUAGE_ANALYSIS_SCHEMA_VERSION,
        relativePath: request.relativePath,
        language,
        parserStatus: "failed",
        symbols: [],
        imports: [],
        diagnostics: [{ code: "PARSE_FAILED", message: "The file could not be analyzed by its initialized parser." }],
      };
    } finally {
      slot.parser.reset();
      release();
    }
  }
}
