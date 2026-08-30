import type { ContextRange, RangeReason } from "../context-pack.js";

const REASON_ORDER: readonly RangeReason[] = [
  "WHOLE_FILE",
  "CONFIGURATION_FILE",
  "SYMBOL_RANGE",
  "PARENT_CONTEXT",
  "IMPORT_BLOCK",
  "MARKDOWN_SECTION",
  "LEXICAL_RANGE",
  "SURROUNDING_CONTEXT",
  "BOUNDED_FILE_PREFIX",
];

function orderedReasons(reasons: Iterable<RangeReason>): RangeReason[] {
  const unique = new Set(reasons);
  return REASON_ORDER.filter((reason) => unique.has(reason));
}

export function logicalLines(source: string): string[] {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.length === 0 ? [""] : lines;
}

export function boundedRange(
  startLine: number,
  endLine: number,
  maximumLine: number,
  reasons: readonly RangeReason[],
): ContextRange | null {
  const start = Math.max(1, Math.min(maximumLine, Math.trunc(startLine)));
  const end = Math.max(start, Math.min(maximumLine, Math.trunc(endLine)));
  if (maximumLine < 1 || reasons.length === 0) return null;
  return { startLine: start, endLine: end, reasons: orderedReasons(reasons) };
}

export function mergeContextRanges(ranges: readonly ContextRange[], maximumGap: number): ContextRange[] {
  const sorted = ranges
    .filter((range) => range.startLine >= 1 && range.endLine >= range.startLine)
    .map((range) => ({ ...range, reasons: orderedReasons(range.reasons) }))
    .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
  const merged: ContextRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || range.startLine > previous.endLine + Math.max(0, maximumGap) + 1) {
      merged.push(range);
      continue;
    }
    merged[merged.length - 1] = {
      startLine: previous.startLine,
      endLine: Math.max(previous.endLine, range.endLine),
      reasons: orderedReasons([...previous.reasons, ...range.reasons]),
    };
  }
  return merged;
}

export function sliceContextRange(lines: readonly string[], range: ContextRange): string {
  return lines.slice(range.startLine - 1, range.endLine).join("\n");
}

export function rangeContains(outer: ContextRange, startLine: number, endLine: number): boolean {
  return outer.startLine <= startLine && outer.endLine >= endLine;
}
