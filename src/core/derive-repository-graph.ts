import { posix } from "node:path";

import type { IndexedFile } from "./repository-index.js";
import {
  compareGraphEdges,
  createGraphEdge,
  isNormalizedRepositoryPath,
  type DocumentationSource,
  type GraphEdge,
  type ResolvedImport,
} from "./repository-graph.js";

const JAVASCRIPT_EXTENSION_CANDIDATES = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"] as const;
const DOCUMENT_REFERENCE_LIMIT = 500;
const DOCUMENT_MODULE_EDGE_LIMIT = 20;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function distinctSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function resolution(
  sourcePath: string,
  importOrdinal: number,
  moduleSpecifier: string,
  status: ResolvedImport["status"],
  candidates: readonly string[],
  evidence: readonly string[],
): ResolvedImport {
  const sortedCandidates = distinctSorted(candidates);
  return {
    sourcePath,
    importOrdinal,
    moduleSpecifier,
    status,
    targetPath: status === "resolved_internal" ? (sortedCandidates[0] ?? null) : null,
    candidates: sortedCandidates,
    evidence: distinctSorted(evidence),
  };
}

function javascriptCandidates(basePath: string, filePaths: ReadonlySet<string>): string[] {
  const extension = posix.extname(basePath).toLowerCase();
  const requested: string[] = [];
  if (extension.length === 0) {
    for (const candidateExtension of JAVASCRIPT_EXTENSION_CANDIDATES) {
      requested.push(`${basePath}${candidateExtension}`);
      requested.push(`${basePath}/index${candidateExtension}`);
    }
  } else {
    requested.push(basePath);
    if (extension === ".js") requested.push(`${basePath.slice(0, -3)}.ts`, `${basePath.slice(0, -3)}.tsx`);
    if (extension === ".jsx") requested.push(`${basePath.slice(0, -4)}.tsx`);
    if (extension === ".mjs") requested.push(`${basePath.slice(0, -4)}.mts`);
    if (extension === ".cjs") requested.push(`${basePath.slice(0, -4)}.cts`);
  }
  return distinctSorted(requested.filter((candidate) => filePaths.has(candidate)));
}

function resolveJavascriptImport(
  sourcePath: string,
  importOrdinal: number,
  moduleSpecifier: string,
  filePaths: ReadonlySet<string>,
): ResolvedImport {
  if (!moduleSpecifier.startsWith(".")) {
    if (moduleSpecifier.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(moduleSpecifier)) {
      return resolution(sourcePath, importOrdinal, moduleSpecifier, "unsafe", [], ["absolute module specifier is outside the repository contract"]);
    }
    return resolution(sourcePath, importOrdinal, moduleSpecifier, "external", [], ["non-relative package or unsupported alias import"]);
  }
  const basePath = posix.normalize(posix.join(posix.dirname(sourcePath), moduleSpecifier));
  if (!isNormalizedRepositoryPath(basePath)) {
    return resolution(sourcePath, importOrdinal, moduleSpecifier, "unsafe", [], ["relative import escapes the repository root"]);
  }
  const candidates = javascriptCandidates(basePath, filePaths);
  if (candidates.length === 1) {
    const extension = posix.extname(moduleSpecifier).toLowerCase();
    const evidence = ["repository-local relative import resolved to one indexed file"];
    if (extension === ".js" && candidates[0]?.endsWith(".ts")) evidence.push("NodeNext .js specifier mapped to .ts source");
    if (extension === ".js" && candidates[0]?.endsWith(".tsx")) evidence.push("NodeNext .js specifier mapped to .tsx source");
    return resolution(sourcePath, importOrdinal, moduleSpecifier, "resolved_internal", candidates, evidence);
  }
  if (candidates.length > 1) {
    return resolution(sourcePath, importOrdinal, moduleSpecifier, "ambiguous", candidates, ["multiple indexed files satisfy the relative import"]);
  }
  return resolution(sourcePath, importOrdinal, moduleSpecifier, "unresolved", [], ["no indexed file satisfies the relative import"]);
}

function pythonPackageChainExists(moduleParts: readonly string[], filePaths: ReadonlySet<string>): boolean {
  for (let length = 1; length < moduleParts.length; length += 1) {
    if (!filePaths.has(`${moduleParts.slice(0, length).join("/")}/__init__.py`)) return false;
  }
  return true;
}

function pythonModuleCandidates(moduleParts: readonly string[], filePaths: ReadonlySet<string>): string[] {
  if (moduleParts.length === 0 || moduleParts.some((part) => part.length === 0 || part === "." || part === "..")) return [];
  if (!pythonPackageChainExists(moduleParts, filePaths)) return [];
  const modulePath = moduleParts.join("/");
  return distinctSorted([`${modulePath}.py`, `${modulePath}/__init__.py`].filter((candidate) => filePaths.has(candidate)));
}

function relativePythonBase(sourcePath: string, leadingDots: number): string[] | null {
  const directoryParts = posix.dirname(sourcePath).split("/").filter((part) => part !== ".");
  const levelsUp = leadingDots - 1;
  if (levelsUp > directoryParts.length) return null;
  return directoryParts.slice(0, directoryParts.length - levelsUp);
}

function resolvePythonImport(
  sourceFile: IndexedFile,
  importOrdinal: number,
  moduleSpecifier: string,
  names: readonly string[],
  kind: IndexedFile["analysis"]["imports"][number]["kind"],
  filePaths: ReadonlySet<string>,
): ResolvedImport {
  const leadingDots = moduleSpecifier.match(/^\.+/u)?.[0].length ?? 0;
  let moduleParts: string[];
  let relative = false;
  if (leadingDots > 0) {
    relative = true;
    const sourceDirectory = posix.dirname(sourceFile.relativePath);
    if (sourceDirectory === "." || !filePaths.has(`${sourceDirectory}/__init__.py`)) {
      return resolution(sourceFile.relativePath, importOrdinal, moduleSpecifier, "unresolved", [], ["relative Python import is not inside an indexed regular package"]);
    }
    const base = relativePythonBase(sourceFile.relativePath, leadingDots);
    if (base === null) {
      return resolution(sourceFile.relativePath, importOrdinal, moduleSpecifier, "unsafe", [], ["relative Python import escapes the repository root"]);
    }
    const remainder = moduleSpecifier.slice(leadingDots);
    moduleParts = [...base, ...remainder.split(".").filter(Boolean)];
  } else {
    moduleParts = moduleSpecifier.split(".").filter(Boolean);
  }

  let candidates: string[] = [];
  if (kind === "from_import" && names.length === 1 && names[0] !== "*") {
    const importedModule = pythonModuleCandidates([...moduleParts, names[0] ?? ""], filePaths);
    if (importedModule.length > 0) candidates = importedModule;
  }
  if (candidates.length === 0) candidates = pythonModuleCandidates(moduleParts, filePaths);

  if (candidates.length === 1) {
    return resolution(sourceFile.relativePath, importOrdinal, moduleSpecifier, "resolved_internal", candidates, [
      relative ? "repository-local relative Python import resolved to one module" : "repository-root Python import resolved to one module",
    ]);
  }
  if (candidates.length > 1) {
    return resolution(sourceFile.relativePath, importOrdinal, moduleSpecifier, "ambiguous", candidates, ["multiple indexed Python modules satisfy the import"]);
  }
  if (relative) {
    return resolution(sourceFile.relativePath, importOrdinal, moduleSpecifier, "unresolved", [], ["relative Python module is absent from the indexed package"]);
  }
  const topLevel = moduleParts[0];
  const repositoryOwnsPrefix =
    topLevel !== undefined &&
    [...filePaths].some((path) => path === `${topLevel}.py` || path.startsWith(`${topLevel}/`));
  return resolution(
    sourceFile.relativePath,
    importOrdinal,
    moduleSpecifier,
    repositoryOwnsPrefix ? "unresolved" : "external",
    [],
    [repositoryOwnsPrefix ? "repository package exists but imported module is unresolved" : "Python module has no repository-local package prefix"],
  );
}

export function resolveRepositoryImports(files: readonly IndexedFile[]): ResolvedImport[] {
  const filePaths = new Set(files.map((file) => file.relativePath));
  const resolved: ResolvedImport[] = [];
  for (const file of files) {
    file.analysis.imports.forEach((imported, importOrdinal) => {
      resolved.push(
        file.analysis.language === "python"
          ? resolvePythonImport(file, importOrdinal, imported.moduleSpecifier, imported.names, imported.kind, filePaths)
          : resolveJavascriptImport(file.relativePath, importOrdinal, imported.moduleSpecifier, filePaths),
      );
    });
  }
  return resolved.sort(
    (left, right) => compareText(left.sourcePath, right.sourcePath) || left.importOrdinal - right.importOrdinal,
  );
}

function mergeEdge(edges: Map<string, GraphEdge>, candidate: GraphEdge): void {
  const previous = edges.get(candidate.id);
  if (previous === undefined) {
    edges.set(candidate.id, candidate);
    return;
  }
  edges.set(candidate.id, {
    ...candidate,
    confidence: Math.max(previous.confidence, candidate.confidence),
    derivation: previous.derivation === "structural" || candidate.derivation === "structural" ? "structural" : "heuristic",
    evidence: distinctSorted([...previous.evidence, ...candidate.evidence]),
  });
}

export function importEdges(resolvedImports: readonly ResolvedImport[]): GraphEdge[] {
  return resolvedImports
    .filter((item): item is ResolvedImport & { readonly targetPath: string } => item.status === "resolved_internal" && item.targetPath !== null)
    .map((item) =>
      createGraphEdge("FILE_IMPORTS_FILE", item.sourcePath, item.targetPath, 1, "structural", [
        `resolved import ${JSON.stringify(item.moduleSpecifier)}`,
        ...item.evidence,
      ]),
    )
    .sort(compareGraphEdges);
}

function sourceStem(relativePath: string): string {
  const name = posix.basename(relativePath, posix.extname(relativePath)).toLowerCase();
  return name.replace(/\.(?:test|spec)$/u, "").replace(/^test_/u, "").replace(/_test$/u, "");
}

function structuralDirectory(relativePath: string): string {
  const ignored = new Set(["src", "lib", "app", "test", "tests", "__tests__"]);
  return posix.dirname(relativePath).split("/").filter((segment) => segment !== "." && !ignored.has(segment.toLowerCase())).join("/");
}

function mirroredDirectories(left: string, right: string): boolean {
  const leftDirectory = structuralDirectory(left);
  const rightDirectory = structuralDirectory(right);
  return leftDirectory === rightDirectory ||
    (leftDirectory.length > 0 && rightDirectory.endsWith(`/${leftDirectory}`)) ||
    (rightDirectory.length > 0 && leftDirectory.endsWith(`/${rightDirectory}`));
}

export function deriveTestRelationships(
  files: readonly IndexedFile[],
  resolvedImports: readonly ResolvedImport[],
): GraphEdge[] {
  const edges = new Map<string, GraphEdge>();
  const tests = files.filter((file) => file.category === "test");
  const sources = files.filter((file) => file.category === "source");
  const sourcesByStem = Map.groupBy(sources, (file) => sourceStem(file.relativePath));

  for (const imported of resolvedImports) {
    if (imported.status !== "resolved_internal" || imported.targetPath === null) continue;
    const source = files.find((file) => file.relativePath === imported.sourcePath);
    const target = files.find((file) => file.relativePath === imported.targetPath);
    if (source?.category !== "test" || target?.category !== "source") continue;
    mergeEdge(edges, createGraphEdge("TEST_RELATES_TO_FILE", source.relativePath, target.relativePath, 1, "structural", ["test directly imports source file"]));
  }

  for (const testFile of tests) {
    const candidates = sourcesByStem.get(sourceStem(testFile.relativePath)) ?? [];
    if (candidates.length === 1) {
      const candidate = candidates[0];
      if (candidate !== undefined) {
        const mirrored = mirroredDirectories(testFile.relativePath, candidate.relativePath);
        mergeEdge(
          edges,
          createGraphEdge("TEST_RELATES_TO_FILE", testFile.relativePath, candidate.relativePath, mirrored ? 0.86 : 0.72, "heuristic", [
            "unique normalized basename match",
            ...(mirrored ? ["mirrored test/source directory structure"] : []),
          ]),
        );
      }
    } else if (candidates.length > 1) {
      const mirrored = candidates.filter((candidate) => mirroredDirectories(testFile.relativePath, candidate.relativePath));
      if (mirrored.length === 1 && mirrored[0] !== undefined) {
        mergeEdge(edges, createGraphEdge("TEST_RELATES_TO_FILE", testFile.relativePath, mirrored[0].relativePath, 0.84, "heuristic", [
          "normalized basename match",
          "only candidate with mirrored test/source directory structure",
        ]));
      }
    }
  }

  const symbolFiles = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const symbol of source.analysis.symbols) {
      const paths = symbolFiles.get(symbol.name) ?? new Set<string>();
      paths.add(source.relativePath);
      symbolFiles.set(symbol.name, paths);
    }
  }
  const resolutionByImport = new Map(resolvedImports.map((item) => [`${item.sourcePath}\u0000${item.importOrdinal}`, item]));
  for (const testFile of tests) {
    testFile.analysis.imports.forEach((imported, importOrdinal) => {
      const importResolution = resolutionByImport.get(`${testFile.relativePath}\u0000${importOrdinal}`);
      if (importResolution?.status !== "unresolved" && importResolution?.status !== "ambiguous") return;
      for (const name of imported.names) {
        const paths = symbolFiles.get(name);
        if (paths?.size !== 1) continue;
        const target = [...paths][0];
        if (target !== undefined) {
          mergeEdge(edges, createGraphEdge("TEST_RELATES_TO_FILE", testFile.relativePath, target, 0.68, "heuristic", ["imported name matches one unique indexed source symbol"]));
        }
      }
    });
  }
  return [...edges.values()].sort(compareGraphEdges);
}

function documentModuleTokens(relativePath: string): string[] {
  const basename = posix.basename(relativePath, posix.extname(relativePath)).toLowerCase();
  const ignored = new Set(["adr", "agents", "architecture", "changelog", "contributing", "design", "docs", "license", "readme"]);
  return distinctSorted(basename.split(/[^a-z0-9]+/u).filter((token) => token.length >= 4 && !ignored.has(token)));
}

function pathSegments(relativePath: string): readonly string[] {
  return relativePath.toLowerCase().split(/[/.\\_-]+/u);
}

export function deriveDocumentationRelationships(
  files: readonly IndexedFile[],
  documents: readonly DocumentationSource[],
): GraphEdge[] {
  const edges = new Map<string, GraphEdge>();
  const filePaths = new Set(files.map((file) => file.relativePath));
  const sourceFiles = files.filter((file) => file.category === "source");
  const symbolsByReference = new Map<string, Set<string>>();
  for (const file of sourceFiles) {
    for (const symbol of file.analysis.symbols) {
      for (const reference of [symbol.name, symbol.qualifiedName]) {
        const paths = symbolsByReference.get(reference) ?? new Set<string>();
        paths.add(file.relativePath);
        symbolsByReference.set(reference, paths);
      }
    }
  }

  for (const document of documents) {
    let referenceCount = 0;
    const pathPattern = /(?:^|[\s`'"(])\b((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)(?=$|[\s`'"),:\]])/gmu;
    for (const match of document.source.matchAll(pathPattern)) {
      if (referenceCount >= DOCUMENT_REFERENCE_LIMIT) break;
      referenceCount += 1;
      const referenced = match[1];
      if (referenced === undefined || !isNormalizedRepositoryPath(referenced) || !filePaths.has(referenced)) continue;
      if (referenced === document.relativePath) continue;
      mergeEdge(edges, createGraphEdge("DOCUMENT_RELATES_TO_FILE", document.relativePath, referenced, 1, "structural", ["document contains exact indexed repository path"]));
    }

    const codeReferences = new Set<string>();
    for (const match of document.source.matchAll(/`([^`\r\n]{1,160})`/gu)) {
      const value = match[1];
      if (value !== undefined) codeReferences.add(value);
    }
    const plainPascalReferences = new Set(document.source.match(/\b[A-Z][A-Za-z0-9_$]{3,}(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\b/gu) ?? []);
    for (const [reference, confidence, reason] of [
      ...[...codeReferences].map((value) => [value, 0.9, "document code span matches one unique indexed symbol"] as const),
      ...[...plainPascalReferences].map((value) => [value, 0.82, "document identifier matches one unique indexed symbol"] as const),
    ]) {
      const paths = symbolsByReference.get(reference);
      if (paths?.size !== 1) continue;
      const target = [...paths][0];
      if (target !== undefined) mergeEdge(edges, createGraphEdge("DOCUMENT_RELATES_TO_FILE", document.relativePath, target, confidence, "heuristic", [reason]));
    }

    let moduleEdges = 0;
    for (const token of documentModuleTokens(document.relativePath)) {
      const candidates = sourceFiles.filter((file) => pathSegments(file.relativePath).includes(token));
      if (candidates.length === 0 || candidates.length > DOCUMENT_MODULE_EDGE_LIMIT) continue;
      for (const candidate of candidates) {
        if (moduleEdges >= DOCUMENT_MODULE_EDGE_LIMIT) break;
        mergeEdge(edges, createGraphEdge("DOCUMENT_RELATES_TO_FILE", document.relativePath, candidate.relativePath, 0.6, "heuristic", ["documentation module name matches source path segment"]));
        moduleEdges += 1;
      }
    }
  }
  return [...edges.values()].sort(compareGraphEdges);
}
