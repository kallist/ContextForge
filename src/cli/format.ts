import type { RepositoryMap } from "../core/repository-map.js";
import type { IndexedFileInspection, IndexSummary } from "../core/repository-index.js";
import type { RepositoryGraphInspection } from "../core/repository-graph.js";
import type { SearchResult } from "../core/task-retrieval.js";

const MAXIMUM_TEXT_ENTRIES = 200;

function terminalText(value: string, maximumLength = 500): string {
  const safe = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || (code >= 127 && code <= 159) ? " " : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  return safe.length <= maximumLength ? safe : `${safe.slice(0, maximumLength)}… [display truncated]`;
}

export function formatJson(map: RepositoryMap): string {
  return `${JSON.stringify(map, null, 2)}\n`;
}

export function formatText(map: RepositoryMap): string {
  const lines = [
    "RepoBound Repository Map",
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
    "RepoBound Index",
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
    `Resolved imports: ${summary.graph.resolvedImports}`,
    `Graph edges: ${summary.graph.edges}`,
    `  Import edges: ${summary.graph.importEdges}`,
    `  Test edges: ${summary.graph.testEdges}`,
    `  Documentation edges: ${summary.graph.documentationEdges}`,
    `Git signals: ${summary.graph.gitStatus}`,
    "",
    `Duration: ${summary.performance.totalMs.toFixed(1)} ms`,
    `Grammar initialization: ${summary.performance.grammarInitializationMs.toFixed(1)} ms`,
    `Parsing: ${summary.performance.parsingMs.toFixed(1)} ms`,
    `SQLite write: ${summary.performance.sqliteWriteMs.toFixed(1)} ms`,
    `Graph build: ${summary.performance.graphTotalMs.toFixed(1)} ms`,
    `  Import resolution: ${summary.performance.importResolutionMs.toFixed(1)} ms`,
    `  Test relationships: ${summary.performance.testRelationshipMs.toFixed(1)} ms`,
    `  Documentation relationships: ${summary.performance.documentationRelationshipMs.toFixed(1)} ms`,
    `  Git signals: ${summary.performance.gitSignalsMs.toFixed(1)} ms`,
    `Throughput: ${summary.performance.filesPerSecond.toFixed(1)} files/sec`,
  ];
  if (summary.diagnostics.length > 0) {
    lines.push("", "Diagnostics");
    for (const diagnostic of summary.diagnostics) lines.push(`  ${diagnostic}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatGraphJson(inspection: RepositoryGraphInspection): string {
  return `${JSON.stringify(inspection, null, 2)}\n`;
}

export function formatSearchJson(result: SearchResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatSearchText(result: SearchResult): string {
  const indexSummary = result.indexStatus.status === "FRESH"
    ? "FRESH"
    : result.indexStatus.status === "PARTIAL"
      ? "PARTIAL (working-tree verification reached its bounded scan limit)"
      : `STALE (${result.indexStatus.changedFiles} changed: ${result.indexStatus.addedFiles} added, ${result.indexStatus.deletedFiles} deleted)`;
  const lines = [
    "RepoBound Search",
    "",
    "Task",
    terminalText(result.task),
    "",
    `Repository: ${terminalText(result.repository.name)}`,
    `Generation: ${result.generation}`,
    `Strategy: ${result.rankingStrategy}`,
    `Index: ${indexSummary}`,
  ];
  if (result.indexStatus.lexicalSkippedFiles > 0) {
    lines.push(`Lexical evidence skipped: ${result.indexStatus.lexicalSkippedFiles} file(s)`);
  }
  if (result.diagnostics.length > 0) lines.push(`Diagnostics: ${result.diagnostics.join(", ")}`);
  lines.push("", "Candidates");
  if (result.candidates.length === 0) lines.push("  (no supported candidates; refine the task with a path, symbol, identifier, or error literal)");
  result.candidates.forEach((candidate, index) => {
    lines.push(
      "",
      `${index + 1}. ${terminalText(candidate.relativePath)}`,
      `   ${candidate.rawScore.toFixed(2)} points · ${candidate.origin}`,
    );
    for (const contribution of candidate.scoreContributions.slice(0, 6)) {
      lines.push(`   +${contribution.value.toFixed(2)} ${terminalText(contribution.reason)}`);
    }
    if (candidate.scoreContributions.length > 6) {
      lines.push(`   … ${candidate.scoreContributions.length - 6} more contribution(s) in --json output`);
    }
    if (candidate.relevantSymbols.length > 0) {
      lines.push("", "   Relevant symbols");
      for (const symbol of candidate.relevantSymbols.slice(0, 10)) lines.push(`   - ${terminalText(symbol.qualifiedName)}`);
    }
  });
  return `${lines.join("\n")}\n`;
}

export function formatGraphText(inspection: RepositoryGraphInspection): string {
  const lines = ["RepoBound Repository Graph", "", inspection.file, "", "Imports"];
  if (inspection.imports.length === 0) lines.push("  (none)");
  for (const item of inspection.imports) lines.push(`  → ${item.target}  [${item.confidence.toFixed(2)}; ${item.evidence.join("; ")}]`);
  lines.push("", "Imported By");
  if (inspection.importedBy.length === 0) lines.push("  (none)");
  for (const item of inspection.importedBy) lines.push(`  ← ${item.target}  [${item.confidence.toFixed(2)}; ${item.evidence.join("; ")}]`);
  lines.push("", "Related Tests");
  if (inspection.tests.length === 0) lines.push("  (none)");
  for (const item of inspection.tests) lines.push(`  → ${item.target}  [${item.confidence.toFixed(2)}; ${item.evidence.join("; ")}]`);
  lines.push("", "Related Documentation");
  if (inspection.documentation.length === 0) lines.push("  (none)");
  for (const item of inspection.documentation) lines.push(`  → ${item.target}  [${item.confidence.toFixed(2)}; ${item.evidence.join("; ")}]`);
  lines.push("", "Git Signals", `  Status: ${inspection.git.status}`);
  if (inspection.git.status === "available") {
    lines.push(`  HEAD: ${inspection.git.head ?? "(unborn)"}`, `  Branch: ${inspection.git.branch ?? "(detached)"}`);
    if (inspection.git.file !== null) {
      lines.push(
        `  Working tree: ${inspection.git.file.workingTreeStatus}`,
        `  Recent commit count: ${inspection.git.file.recentCommitCount}`,
        `  Last relevant commit: ${inspection.git.file.lastChangedCommit ?? "(none in bounded window)"}`,
      );
    }
  } else {
    lines.push(`  ${inspection.git.diagnostic ?? "Git signals unavailable."}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatInspectionJson(inspection: IndexedFileInspection): string {
  return `${JSON.stringify(inspection, null, 2)}\n`;
}

export function formatInspectionText(inspection: IndexedFileInspection): string {
  const { file } = inspection;
  const lines = [
    "RepoBound Index Inspection",
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
