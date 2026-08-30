import type { ContextRange } from "../context-pack.js";
import { mergeContextRanges } from "./ranges.js";

export interface MarkdownSection {
  readonly heading: string;
  readonly level: number;
  readonly startLine: number;
  readonly endLine: number;
}

interface Heading {
  readonly text: string;
  readonly level: number;
  readonly line: number;
}

export function parseMarkdownSections(lines: readonly string[]): MarkdownSection[] {
  const headings: Heading[] = [];
  let fenceCharacter: "`" | "~" | null = null;
  let fenceLength = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (fenceCharacter !== null) {
      const closing = line.match(/^\s*([`~]+)\s*$/u)?.[1];
      if (closing !== undefined && closing[0] === fenceCharacter && closing.length >= fenceLength) {
        fenceCharacter = null;
        fenceLength = 0;
      }
      continue;
    }
    const opening = line.match(/^\s*([`~]{3,})/u)?.[1];
    if (opening !== undefined) {
      fenceCharacter = opening[0] === "`" ? "`" : "~";
      fenceLength = opening.length;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      headings.push({ text: heading[2], level: heading[1].length, line: index + 1 });
    }
  }

  const sections: MarkdownSection[] = [];
  const firstHeading = headings[0];
  if (firstHeading === undefined) return [{ heading: "", level: 0, startLine: 1, endLine: Math.max(1, lines.length) }];
  if (firstHeading.line > 1) sections.push({ heading: "", level: 0, startLine: 1, endLine: firstHeading.line - 1 });
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    if (current === undefined) continue;
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= current.level);
    sections.push({
      heading: current.text,
      level: current.level,
      startLine: current.line,
      endLine: (next?.line ?? lines.length + 1) - 1,
    });
  }
  return sections;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, " ").trim();
}

export function selectMarkdownSectionRanges(
  lines: readonly string[],
  signals: readonly string[],
  maximumSections: number,
): ContextRange[] {
  const normalizedSignals = [...new Set(signals.map(normalize).filter((signal) => signal.length >= 2))];
  const sections = parseMarkdownSections(lines);
  const scored = sections.map((section) => {
    const heading = normalize(section.heading);
    const body = normalize(lines.slice(section.startLine - 1, section.endLine).join("\n"));
    const headingMatches = normalizedSignals.filter((signal) => heading.includes(signal)).length;
    const bodyMatches = normalizedSignals.filter((signal) => body.includes(signal)).length;
    return { section, score: headingMatches * 4 + bodyMatches, size: section.endLine - section.startLine + 1 };
  });
  return mergeContextRanges(
    scored
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.size - right.size || left.section.startLine - right.section.startLine)
      .slice(0, maximumSections)
      .map(({ section }) => ({
        startLine: section.startLine,
        endLine: section.endLine,
        reasons: ["MARKDOWN_SECTION"] as const,
      })),
    0,
  );
}
