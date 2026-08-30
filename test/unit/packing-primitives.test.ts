import assert from "node:assert/strict";
import test from "node:test";

import { fencedBlock } from "../../src/core/context-serialization.js";
import { parseMarkdownSections, selectMarkdownSectionRanges } from "../../src/core/packing/markdown-sections.js";
import { mergeContextRanges } from "../../src/core/packing/ranges.js";

test("range merging handles overlap, containment, duplicates, nearby gaps, and unsorted input", () => {
  assert.deepEqual(mergeContextRanges([], 3), []);
  const merged = mergeContextRanges([
    { startLine: 145, endLine: 200, reasons: ["SURROUNDING_CONTEXT"] },
    { startLine: 100, endLine: 160, reasons: ["SYMBOL_RANGE"] },
    { startLine: 100, endLine: 160, reasons: ["SYMBOL_RANGE"] },
    { startLine: 204, endLine: 220, reasons: ["IMPORT_BLOCK"] },
    { startLine: 230, endLine: 240, reasons: ["LEXICAL_RANGE"] },
  ], 3);
  assert.deepEqual(merged, [
    {
      startLine: 100,
      endLine: 220,
      reasons: ["SYMBOL_RANGE", "IMPORT_BLOCK", "SURROUNDING_CONTEXT"],
    },
    { startLine: 230, endLine: 240, reasons: ["LEXICAL_RANGE"] },
  ]);
});

test("Markdown sections ignore headings inside backtick and tilde fences", () => {
  const lines = [
    "# Design",
    "intro",
    "```md",
    "## Not a heading",
    "```",
    "## Concurrency",
    "use a lock",
    "~~~~",
    "# Also not a heading",
    "~~~~",
    "## Storage",
    "durable",
  ];
  const sections = parseMarkdownSections(lines);
  assert.deepEqual(sections.map((section) => section.heading), ["Design", "Concurrency", "Storage"]);
  assert.deepEqual(selectMarkdownSectionRanges(lines, ["concurrency"], 1), [
    { startLine: 6, endLine: 10, reasons: ["MARKDOWN_SECTION"] },
  ]);
});

test("serializer chooses a fence longer than every source backtick run and normalizes CRLF", () => {
  const rendered = fencedBlock("const three = '```';\r\nconst four = '````';", "ts");
  assert.match(rendered, /^`````ts\n/u);
  assert.match(rendered, /\n`````$/u);
  assert.equal(rendered.includes("\r"), false);
});
