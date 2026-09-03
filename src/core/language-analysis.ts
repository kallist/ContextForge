import { createHash } from "node:crypto";
import { extname } from "node:path";

export const LANGUAGE_ANALYSIS_SCHEMA_VERSION = "1.0";
export const LANGUAGE_ANALYSIS_VERSION = "tree-sitter-v1";

export const SUPPORTED_LANGUAGES = ["javascript", "jsx", "typescript", "tsx", "python"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export type ParserStatus = "parsed" | "degraded" | "unsupported" | "failed";
export type SymbolKind = "function" | "class" | "method" | "interface" | "type" | "enum" | "variable";
export type ImportKind = "import" | "side_effect" | "require" | "dynamic" | "re_export" | "from_import";

export interface SourceRange {
  /** One-based inclusive line. */
  readonly startLine: number;
  /** One-based inclusive line containing the exclusive end position. */
  readonly endLine: number;
  /** One-based UTF-8 byte column. */
  readonly startColumn: number;
  /** One-based exclusive UTF-8 byte column. */
  readonly endColumn: number;
}

export interface AnalyzedSymbol extends SourceRange {
  readonly id: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: SymbolKind;
  readonly relativePath: string;
  readonly parentSymbolId: string | null;
  readonly exported: boolean | null;
  readonly public: boolean | null;
  readonly language: SupportedLanguage;
}

export interface AnalyzedImport extends SourceRange {
  readonly relativePath: string;
  readonly moduleSpecifier: string;
  readonly kind: ImportKind;
  readonly names: readonly string[];
}

export interface AnalysisDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface FileAnalysis {
  readonly schemaVersion: typeof LANGUAGE_ANALYSIS_SCHEMA_VERSION;
  readonly relativePath: string;
  readonly language: SupportedLanguage | null;
  readonly parserStatus: ParserStatus;
  readonly symbols: readonly AnalyzedSymbol[];
  readonly imports: readonly AnalyzedImport[];
  readonly diagnostics: readonly AnalysisDiagnostic[];
}

export interface AnalyzeSourceRequest {
  readonly relativePath: string;
  readonly source: string;
}

export interface LanguageAnalyzer {
  readonly analysisVersion: string;
  initialize(): Promise<{ readonly durationMs: number }>;
  analyze(request: AnalyzeSourceRequest): Promise<FileAnalysis>;
}

export type DirectCallForm = "IDENTIFIER" | "SELF_MEMBER" | "NAMESPACE_MEMBER" | "UNRESOLVED_MEMBER";

export interface AnalyzedDirectCall extends SourceRange {
  readonly calleeName: string;
  readonly receiverName: string | null;
  readonly form: DirectCallForm;
  /** Transient parser-backed rejection of unsafe outer-symbol binding. */
  readonly localBindingGuard?: "SHADOWED" | "UNPROVEN";
}

export interface AnalyzedImportBinding extends SourceRange {
  readonly moduleSpecifier: string;
  readonly importedName: string;
  readonly localName: string;
  readonly kind: "NAMED" | "NAMESPACE";
}

export interface AnalyzedImplementationSyntax extends SourceRange {
  readonly implementationName: string;
  readonly interfaceName: string;
}

export interface RelationshipSyntaxAnalysis {
  readonly relativePath: string;
  readonly language: SupportedLanguage | null;
  readonly parserStatus: ParserStatus;
  readonly calls: readonly AnalyzedDirectCall[];
  readonly importBindings: readonly AnalyzedImportBinding[];
  readonly implementations: readonly AnalyzedImplementationSyntax[];
  readonly diagnostics: readonly AnalysisDiagnostic[];
}

export interface RelationshipSyntaxAnalyzer {
  analyzeRelationships(request: AnalyzeSourceRequest): Promise<RelationshipSyntaxAnalysis>;
}

export function analysisLanguageForPath(relativePath: string): SupportedLanguage | null {
  switch (extname(relativePath).toLowerCase()) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "jsx";
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".py":
      return "python";
    default:
      return null;
  }
}

export function createStableSymbolId(
  relativePath: string,
  kind: SymbolKind,
  qualifiedName: string,
  occurrence: number,
): string {
  const identity = `${relativePath}\u0000${kind}\u0000${qualifiedName}\u0000${occurrence}`;
  return `sym_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

export function unsupportedFileAnalysis(relativePath: string): FileAnalysis {
  return {
    schemaVersion: LANGUAGE_ANALYSIS_SCHEMA_VERSION,
    relativePath,
    language: null,
    parserStatus: "unsupported",
    symbols: [],
    imports: [],
    diagnostics: [],
  };
}
