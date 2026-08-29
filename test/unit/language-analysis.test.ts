import assert from "node:assert/strict";
import { cp, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { createTemporaryDirectory, removeTemporaryDirectory } from "../helpers/fixtures.js";

const analyzer = new TreeSitterLanguageAnalyzer();

test("loads every packaged grammar once with a compatible ABI", async () => {
  const first = await analyzer.initialize();
  const second = await analyzer.initialize();
  assert.ok(first.durationMs >= 0);
  assert.equal(second.durationMs, first.durationMs);
});

test("extracts TypeScript symbols, qualified methods, exports, and imports", async () => {
  const analysis = await analyzer.analyze({
    relativePath: "src/services/memory.ts",
    source: [
      'import base from "./base.js";',
      'import { save as persist } from "../repo.js";',
      'export interface MemoryPort { finalize(): void }',
      'export type Mode = "on" | "off";',
      'export enum State { Ready }',
      'export class MemoryService {',
      '  finalizeRun(): void {}',
      '  private disableMemory(): void {}',
      '}',
      'export const createService = () => new MemoryService();',
      "",
    ].join("\n"),
  });

  assert.equal(analysis.parserStatus, "parsed");
  assert.deepEqual(
    analysis.symbols.map(({ kind, qualifiedName }) => [kind, qualifiedName]),
    [
      ["interface", "MemoryPort"],
      ["method", "MemoryPort.finalize"],
      ["type", "Mode"],
      ["enum", "State"],
      ["class", "MemoryService"],
      ["method", "MemoryService.finalizeRun"],
      ["method", "MemoryService.disableMemory"],
      ["function", "createService"],
    ],
  );
  const finalize = analysis.symbols.find(({ qualifiedName }) => qualifiedName === "MemoryService.finalizeRun");
  assert.equal(finalize?.startLine, 7);
  assert.equal(finalize?.endLine, 7);
  assert.equal(finalize?.startColumn, 3);
  assert.equal(finalize?.parentSymbolId, analysis.symbols.find(({ name }) => name === "MemoryService")?.id);
  assert.equal(analysis.symbols.find(({ name }) => name === "disableMemory")?.public, false);
  assert.ok(analysis.symbols.every(({ id }) => /^sym_[a-f0-9]{24}$/u.test(id)));
  assert.deepEqual(
    analysis.imports.map(({ moduleSpecifier, kind, names }) => [moduleSpecifier, kind, names]),
    [
      ["./base.js", "import", ["base"]],
      ["../repo.js", "import", ["persist"]],
    ],
  );
});

test("parses TSX and JSX with the intended grammars", async () => {
  const tsx = await analyzer.analyze({
    relativePath: "src/App.tsx",
    source: 'import React from "react";\nexport const App = () => <main>Hello</main>;\n',
  });
  const jsx = await analyzer.analyze({
    relativePath: "src/App.jsx",
    source: 'import "./style.css";\nexport function App() { return <main>Hello</main>; }\n',
  });
  assert.equal(tsx.language, "tsx");
  assert.equal(tsx.parserStatus, "parsed");
  assert.equal(tsx.symbols.find(({ name }) => name === "App")?.kind, "function");
  assert.equal(jsx.language, "jsx");
  assert.equal(jsx.parserStatus, "parsed");
  assert.equal(jsx.imports[0]?.kind, "side_effect");
});

test("extracts JavaScript import, require, dynamic import, class, and methods", async () => {
  const analysis = await analyzer.analyze({
    relativePath: "src/main.js",
    source: [
      'import * as util from "./util.js";',
      'const legacy = require("legacy");',
      'export { thing } from "./thing.js";',
      "export class Runner { run() {} }",
      'async function load() { return import("./lazy.js"); }',
      "",
    ].join("\n"),
  });
  assert.equal(analysis.parserStatus, "parsed");
  assert.ok(analysis.symbols.some(({ qualifiedName }) => qualifiedName === "Runner.run"));
  assert.deepEqual(
    analysis.imports.map(({ moduleSpecifier, kind }) => [moduleSpecifier, kind]),
    [
      ["./util.js", "import"],
      ["legacy", "require"],
      ["./thing.js", "re_export"],
      ["./lazy.js", "dynamic"],
    ],
  );
});

test("extracts Python qualified symbols and structured imports", async () => {
  const analysis = await analyzer.analyze({
    relativePath: "app/service.py",
    source: [
      "import os",
      "import pkg.tools as tools",
      "from app.models import User, Account as AccountModel",
      "",
      "class UserService:",
      "    def create_user(self):",
      "        return User()",
      "",
      "def helper():",
      "    return None",
      "",
    ].join("\n"),
  });
  assert.equal(analysis.parserStatus, "parsed");
  assert.deepEqual(
    analysis.symbols.map(({ kind, qualifiedName }) => [kind, qualifiedName]),
    [
      ["class", "UserService"],
      ["method", "UserService.create_user"],
      ["function", "helper"],
    ],
  );
  assert.deepEqual(
    analysis.imports.map(({ moduleSpecifier, kind, names }) => [moduleSpecifier, kind, names]),
    [
      ["os", "import", []],
      ["pkg.tools", "import", ["tools"]],
      ["app.models", "from_import", ["User", "AccountModel"]],
    ],
  );
});

test("keeps one-based line ranges correct across CRLF, LF, and Unicode", async () => {
  const crlf = await analyzer.analyze({
    relativePath: "src/unicode.ts",
    source: "const 标签 = 1;\r\nclass 服务 {\r\n  方法(): void {}\r\n}\r\n",
  });
  const method = crlf.symbols.find(({ name }) => name === "方法");
  assert.equal(method?.startLine, 3);
  assert.equal(method?.endLine, 3);
  assert.equal(method?.startColumn, 3);
  assert.equal(method?.qualifiedName, "服务.方法");

  const lf = await analyzer.analyze({ relativePath: "script.py", source: "def café():\n    return 1\n" });
  assert.equal(lf.symbols[0]?.startLine, 1);
  assert.equal(lf.symbols[0]?.endLine, 2);
});

test("degrades malformed supported source without discarding recovered structure", async () => {
  const typescript = await analyzer.analyze({
    relativePath: "broken.ts",
    source: "export class StillVisible { method( { return 1; }\n",
  });
  const python = await analyzer.analyze({
    relativePath: "broken.py",
    source: "class StillVisible:\n    def method(self)\n        pass\n",
  });
  for (const analysis of [typescript, python]) {
    assert.equal(analysis.parserStatus, "degraded");
    assert.ok(analysis.diagnostics.some(({ code }) => code === "PARSE_SYNTAX_ERROR"));
    assert.ok(analysis.symbols.some(({ name }) => name === "StillVisible"));
  }
});

test("serializes concurrent same-language parses through the cached parser", async () => {
  const concurrent = new TreeSitterLanguageAnalyzer();
  const [left, right] = await Promise.all([
    concurrent.analyze({ relativePath: "left.ts", source: "export function left() {}\n" }),
    concurrent.analyze({ relativePath: "right.ts", source: "export class Right { run() {} }\n" }),
  ]);
  assert.equal(left.symbols[0]?.qualifiedName, "left");
  assert.ok(right.symbols.some(({ qualifiedName }) => qualifiedName === "Right.run"));
});

test("keeps symbol identity stable when unrelated leading lines move the declaration", async () => {
  const original = await analyzer.analyze({ relativePath: "stable.ts", source: "export function stable() {}\n" });
  const shifted = await analyzer.analyze({ relativePath: "stable.ts", source: "// unrelated\n\nexport function stable() {}\n" });
  assert.equal(original.symbols[0]?.id, shifted.symbols[0]?.id);
  assert.notEqual(original.symbols[0]?.startLine, shifted.symbols[0]?.startLine);
});

test("returns unsupported without initializing or fabricating structure", async () => {
  const analysis = await new TreeSitterLanguageAnalyzer().analyze({ relativePath: "README.md", source: "# Title" });
  assert.equal(analysis.parserStatus, "unsupported");
  assert.equal(analysis.language, null);
  assert.deepEqual(analysis.symbols, []);
  assert.deepEqual(analysis.imports, []);
});

test("fails clearly when a required packaged grammar is corrupted", async (context) => {
  const root = await createTemporaryDirectory("corrupt-grammar");
  context.after(() => removeTemporaryDirectory(root));
  await cp(new URL("../../src/adapters/parser/assets/", import.meta.url), root, { recursive: true });
  await writeFile(new URL("tree-sitter-javascript.wasm", pathToFileURL(`${root}/`)), "corrupt", "utf8");
  const corrupted = new TreeSitterLanguageAnalyzer(pathToFileURL(`${root}/`));
  await assert.rejects(corrupted.initialize(), (error: unknown) => {
    return error instanceof Error && "code" in error && error.code === "PARSER_UNAVAILABLE";
  });
});
