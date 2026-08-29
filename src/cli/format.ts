import type { RepositoryMap } from "../core/repository-map.js";

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
