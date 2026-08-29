import type { RepositoryMap } from "../core/repository-map.js";
import type { IndexedFileInspection, IndexSummary } from "../core/repository-index.js";

const MAXIMUM_TEXT_ENTRIES = 200;

export function formatJson(map: RepositoryMap): string {
  return `${JSON.stringify(map, null, 2)}\n`;
}

export function formatText(map: RepositoryMap): string {
  const lines = [
    "ContextForge Repository Map",
    "",
    `Repository: ${map.repository.name} (${map.repository.kind})`,
    `Entries: ${map.summary.entries}`,
    `Files: ${map.summary.files}`,
    `Directories: ${map.summary.directories}`,
    `Ignored: ${map.summary.ignored}`,
    `Safety-excluded: ${map.summary.safetyExcluded}`,
    `Binary: ${map.summary.binary}`,
    `Oversized: ${map.summary.oversized}`,
    `Malformed text: ${map.summary.malformedText}`,
    "",
    "Languages",
  ];

  const languages = Object.entries(map.summary.byLanguage);
  if (languages.length === 0) lines.push("  (none detected)");
  else for (const [language, count] of languages) lines.push(`  ${language}: ${count}`);

  lines.push("", `Structure (first ${Math.min(MAXIMUM_TEXT_ENTRIES, map.entries.length)} entries)`);
  for (const entry of map.entries.slice(0, MAXIMUM_TEXT_ENTRIES)) {
    const suffix = entry.type === "directory" ? "/" : "";
    const details = entry.type === "directory" ? entry.type : `${entry.category}, ${entry.content}`;
    lines.push(`  ${entry.path}${suffix}  [${details}]`);
  }
  if (map.entries.length > MAXIMUM_TEXT_ENTRIES) {
    lines.push(`  ... ${map.entries.length - MAXIMUM_TEXT_ENTRIES} more entries omitted from text output; use --json.`);
  }
  if (map.exclusions.length > 0) {
    lines.push("", "Exclusions");
    for (const exclusion of map.exclusions) lines.push(`  ${exclusion.reason}: ${exclusion.count}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatIndexJson(summary: IndexSummary): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}

export function formatIndexText(summary: IndexSummary): string {
  const lines = [
    "ContextForge Index",
    "",
    `Repository: ${summary.repository.name}`,
    `Generation: ${summary.generation}`,
    "",
    `Files: ${summary.files.indexed} indexed`,
    `  Parsed this run: ${summary.files.parsed}`,
    `  Reused: ${summary.files.reused}`,
    `  Unsupported: ${summary.files.unsupported}`,
    `  Degraded: ${summary.files.degraded}`,
    `  Failed: ${summary.files.failed}`,
    `Symbols: ${summary.symbols}`,
    `Imports: ${summary.imports}`,
    "",
    `Duration: ${summary.performance.totalMs.toFixed(1)} ms`,
    `Grammar initialization: ${summary.performance.grammarInitializationMs.toFixed(1)} ms`,
    `Parsing: ${summary.performance.parsingMs.toFixed(1)} ms`,
    `SQLite write: ${summary.performance.sqliteWriteMs.toFixed(1)} ms`,
    `Throughput: ${summary.performance.filesPerSecond.toFixed(1)} files/sec`,
  ];
  if (summary.diagnostics.length > 0) {
    lines.push("", "Diagnostics");
    for (const diagnostic of summary.diagnostics) lines.push(`  ${diagnostic}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatInspectionJson(inspection: IndexedFileInspection): string {
  return `${JSON.stringify(inspection, null, 2)}\n`;
}

export function formatInspectionText(inspection: IndexedFileInspection): string {
  const { file } = inspection;
  const lines = [
    "ContextForge Index Inspection",
    "",
    `Generation: ${inspection.generation}`,
    `File: ${file.relativePath}`,
    `Language: ${file.analysis.language ?? "unsupported"}`,
    `Parser status: ${file.analysis.parserStatus}`,
    "",
    "Symbols",
  ];
  if (file.analysis.symbols.length === 0) lines.push("  (none)");
  for (const symbol of file.analysis.symbols) {
    lines.push(`  ${symbol.kind} ${symbol.qualifiedName} (${symbol.startLine}:${symbol.startColumn}-${symbol.endLine}:${symbol.endColumn})`);
  }
  lines.push("", "Imports");
  if (file.analysis.imports.length === 0) lines.push("  (none)");
  for (const imported of file.analysis.imports) {
    const names = imported.names.length === 0 ? "" : ` [${imported.names.join(", ")}]`;
    lines.push(`  ${imported.kind} ${imported.moduleSpecifier}${names}`);
  }
  if (file.analysis.diagnostics.length > 0) {
    lines.push("", "Diagnostics");
    for (const diagnostic of file.analysis.diagnostics) lines.push(`  ${diagnostic.code}: ${diagnostic.message}`);
  }
  return `${lines.join("\n")}\n`;
}
