import { ContextForgeError } from "./errors.js";

export const TASK_QUERY_SCHEMA_VERSION = "1.0";
export const TASK_QUERY_VERSION = "task-query-v1";
export const MAXIMUM_TASK_BYTES = 16 * 1024;
export const MAXIMUM_QUERY_SIGNALS = 256;

export type QuerySignalKind =
  | "NATURAL_TERM"
  | "IDENTIFIER"
  | "QUALIFIED_IDENTIFIER"
  | "PATH"
  | "FILE_NAME"
  | "ERROR_LITERAL"
  | "CODE_LITERAL"
  | "DOTTED_IDENTIFIER"
  | "NUMBER_LITERAL"
  | "CJK_TERM";

export interface QuerySignal {
  readonly kind: QuerySignalKind;
  readonly value: string;
  readonly normalized: string;
  readonly source: "EXPLICIT" | "DERIVED";
  readonly derivedFrom: string | null;
  readonly lowValue: boolean;
}

export interface TaskQuery {
  readonly schemaVersion: typeof TASK_QUERY_SCHEMA_VERSION;
  readonly queryVersion: typeof TASK_QUERY_VERSION;
  readonly rawTask: string;
  readonly byteLength: number;
  readonly signals: readonly QuerySignal[];
  readonly diagnostics: {
    readonly lowInformation: boolean;
    readonly controlCharacters: number;
  };
}

const LOW_VALUE_TERMS = new Set([
  "a",
  "an",
  "bug",
  "change",
  "could",
  "fix",
  "make",
  "please",
  "should",
  "the",
  "this",
  "update",
]);

const FILE_EXTENSIONS = new Set([
  "cjs", "css", "cts", "html", "ini", "java", "js", "json", "jsx", "md", "mjs", "mts", "py", "rb", "rs",
  "scss", "sh", "sql", "toml", "ts", "tsx", "txt", "xml", "yaml", "yml",
]);

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const GENERAL_TOKEN = /[\p{L}\p{N}_$@.-]+/gu;
const PATH_TOKEN = /(?:[\p{L}\p{N}_$@.-]+[\\/])+(?:[\p{L}\p{N}_$@.-]+)/gu;
const QUOTED_TOKEN = /(["'`])([^"'`\r\n]{1,256})\1/gu;
const TECHNICAL_PHRASE = /\b(?:BEGIN\s+IMMEDIATE|SELECT\s+FOR\s+UPDATE)\b/giu;

function unsafeControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || (code >= 127 && code <= 159);
}

function compareSignals(left: QuerySignal, right: QuerySignal): number {
  const compare = (first: string, second: string): number => first < second ? -1 : first > second ? 1 : 0;
  return (
    compare(left.normalized, right.normalized) ||
    compare(left.kind, right.kind) ||
    compare(left.source, right.source) ||
    compare(left.derivedFrom ?? "", right.derivedFrom ?? "")
  );
}

export function normalizeSearchTerm(value: string): string {
  return value.replaceAll("\\", "/").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function decomposeIdentifier(value: string): string[] {
  const compoundSegments = value
    .split(/[\s_./\\:@$-]+/u)
    .map((part) => normalizeSearchTerm(part))
    .filter((part) => part.length > 0);
  const separated = value
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, "$1 $2")
    .replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, "$1 $2");
  const components = separated
    .split(/[\s_./\\:@$-]+/u)
    .map((part) => normalizeSearchTerm(part))
    .filter((part) => part.length > 0);
  return [...new Set([...compoundSegments, ...components])];
}

function naturalVariants(value: string): string[] {
  if (!/^[a-z]{5,}$/u.test(value)) return [];
  const variants: string[] = [];
  if (value.endsWith("ing") && value.length > 6) {
    const stem = value.slice(0, -3);
    variants.push(stem, `${stem}e`);
  }
  if (value.endsWith("ied") && value.length > 5) variants.push(`${value.slice(0, -3)}y`);
  else if (value.endsWith("ed") && value.length > 5) variants.push(value.slice(0, -2), value.slice(0, -1));
  if (value.endsWith("ies") && value.length > 5) variants.push(`${value.slice(0, -3)}y`);
  else if (value.endsWith("es") && value.length > 5) variants.push(value.slice(0, -2), value.slice(0, -1));
  else if (value.endsWith("s") && value.length > 4) variants.push(value.slice(0, -1));
  return [...new Set(variants.filter((item) => item.length >= 3))];
}

function classifyToken(value: string): QuerySignalKind | null {
  const normalized = normalizeSearchTerm(value);
  if (normalized.length === 0) return null;
  if (CJK.test(value)) return "CJK_TERM";
  if (/^\d{3,}$/u.test(value)) return "NUMBER_LITERAL";
  if (/^(?:HTTP_\d{3}|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)$/u.test(value)) return "ERROR_LITERAL";
  if (/^(?:true|false|null|undefined)$/iu.test(value)) return "CODE_LITERAL";
  if (value.includes("/") || value.includes("\\")) return "PATH";
  if (value.includes(".")) {
    const extension = value.split(".").at(-1)?.toLowerCase() ?? "";
    if (FILE_EXTENSIONS.has(extension)) return "FILE_NAME";
    return /[\p{Lu}_-]/u.test(value) ? "QUALIFIED_IDENTIFIER" : "DOTTED_IDENTIFIER";
  }
  if (/[_-]/u.test(value) || /[\p{Ll}\p{N}][\p{Lu}]/u.test(value) || /^[\p{Lu}][\p{L}\p{N}]*[\p{Ll}]/u.test(value)) {
    return "IDENTIFIER";
  }
  return "NATURAL_TERM";
}

export function normalizeTaskQuery(rawTask: string): TaskQuery {
  const byteLength = Buffer.byteLength(rawTask, "utf8");
  if (byteLength > MAXIMUM_TASK_BYTES) {
    throw new ContextForgeError("TASK_TOO_LARGE", `Task input exceeds the ${MAXIMUM_TASK_BYTES}-byte limit.`);
  }
  const characters = [...rawTask];
  const controlCharacters = characters.filter(unsafeControl).length;
  const safeForNormalization = characters.map((character) => unsafeControl(character) ? " " : character).join("");
  if (safeForNormalization.trim().length === 0) {
    throw new ContextForgeError("INVALID_TASK", "Search task must contain non-whitespace text.");
  }

  const signals = new Map<string, QuerySignal>();
  const addSignal = (value: string, kind: QuerySignalKind, source: QuerySignal["source"], derivedFrom: string | null): void => {
    const normalized = normalizeSearchTerm(value);
    if (normalized.length === 0 || normalized.length > 256) return;
    const signal: QuerySignal = {
      kind,
      value: value.trim(),
      normalized,
      source,
      derivedFrom,
      lowValue: LOW_VALUE_TERMS.has(normalized),
    };
    const key = `${kind}\u0000${normalized}\u0000${source}`;
    const previous = signals.get(key);
    if (previous === undefined || (previous.derivedFrom ?? "") > (derivedFrom ?? "")) signals.set(key, signal);
  };

  const explicitTokens = new Map<string, { value: string; kind: QuerySignalKind }>();
  const collect = (value: string, kind: QuerySignalKind | null): void => {
    if (kind === null) return;
    explicitTokens.set(`${kind}\u0000${normalizeSearchTerm(value)}`, { value, kind });
  };
  for (const match of safeForNormalization.matchAll(TECHNICAL_PHRASE)) collect(match[0], "CODE_LITERAL");
  for (const match of safeForNormalization.matchAll(PATH_TOKEN)) collect(match[0], "PATH");
  for (const match of safeForNormalization.matchAll(QUOTED_TOKEN)) {
    const value = match[2];
    if (value !== undefined) collect(value, classifyToken(value) ?? "CODE_LITERAL");
  }
  for (const match of safeForNormalization.matchAll(GENERAL_TOKEN)) collect(match[0], classifyToken(match[0]));

  for (const { value, kind } of explicitTokens.values()) {
    addSignal(value, kind, "EXPLICIT", null);
    const full = normalizeSearchTerm(value);
    for (const component of decomposeIdentifier(value)) {
      if (component !== full && (component.length >= 2 || CJK.test(component))) {
        addSignal(component, CJK.test(component) ? "CJK_TERM" : "IDENTIFIER", "DERIVED", value);
      }
    }
    if (kind === "NATURAL_TERM") {
      for (const variant of naturalVariants(full)) addSignal(variant, "NATURAL_TERM", "DERIVED", value);
    }
  }

  const orderedSignals = [...signals.values()].sort(compareSignals);
  if (orderedSignals.length > MAXIMUM_QUERY_SIGNALS) {
    throw new ContextForgeError("INVALID_TASK", `Task produces more than ${MAXIMUM_QUERY_SIGNALS} distinct retrieval signals; make it more specific.`);
  }
  return {
    schemaVersion: TASK_QUERY_SCHEMA_VERSION,
    queryVersion: TASK_QUERY_VERSION,
    rawTask,
    byteLength,
    signals: orderedSignals,
    diagnostics: {
      lowInformation: !orderedSignals.some((signal) => !signal.lowValue && signal.normalized.length >= 2),
      controlCharacters,
    },
  };
}
