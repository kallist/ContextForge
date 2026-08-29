import { extname } from "node:path";

import type { FileCategory } from "./repository-map.js";

const BUILT_IN_IGNORED_SEGMENTS = new Set([
  ".git",
  ".contextforge",
  ".next",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
  "venv",
]);

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".a",
  ".avi",
  ".bin",
  ".bmp",
  ".class",
  ".dll",
  ".dmg",
  ".doc",
  ".docx",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".otf",
  ".pdf",
  ".png",
  ".pyc",
  ".so",
  ".tar",
  ".tiff",
  ".ttf",
  ".wasm",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".xz",
  ".zip",
]);

const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  [".c", "C"],
  [".cc", "C++"],
  [".cpp", "C++"],
  [".cs", "C#"],
  [".css", "CSS"],
  [".go", "Go"],
  [".h", "C"],
  [".hpp", "C++"],
  [".html", "HTML"],
  [".java", "Java"],
  [".js", "JavaScript"],
  [".jsx", "JavaScript"],
  [".json", "JSON"],
  [".kt", "Kotlin"],
  [".md", "Markdown"],
  [".mdx", "Markdown"],
  [".mjs", "JavaScript"],
  [".mts", "TypeScript"],
  [".php", "PHP"],
  [".ps1", "PowerShell"],
  [".py", "Python"],
  [".rb", "Ruby"],
  [".rs", "Rust"],
  [".scss", "SCSS"],
  [".sh", "Shell"],
  [".sql", "SQL"],
  [".swift", "Swift"],
  [".toml", "TOML"],
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".txt", "Text"],
  [".xml", "XML"],
  [".yaml", "YAML"],
  [".yml", "YAML"],
]);

const CONFIGURATION_NAMES = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  "biome.json",
  "cargo.toml",
  "composer.json",
  "deno.json",
  "eslint.config.js",
  "eslint.config.mjs",
  "go.mod",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "pyproject.toml",
  "requirements.txt",
  "tsconfig.json",
  "vite.config.js",
  "vite.config.ts",
  "yarn.lock",
]);

function pathSegments(path: string): string[] {
  return path.toLowerCase().split("/");
}

export function compareNormalizedPaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isBuiltInIgnored(path: string): boolean {
  return pathSegments(path).some((segment) => BUILT_IN_IGNORED_SEGMENTS.has(segment));
}

export function isSensitivePath(path: string): boolean {
  return pathSegments(path).some((segment) => {
    if (segment === ".env" || segment.startsWith(".env.")) return true;
    if (segment === "id_rsa") return true;
    if (segment.startsWith("credentials") || segment.startsWith("secrets")) return true;
    return segment.endsWith(".pem") || segment.endsWith(".key");
  });
}

export function isKnownBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.has(extname(path).toLowerCase());
}

export function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;

  let suspicious = 0;
  for (const byte of bytes) {
    if (byte === 0) return true;
    const allowedControl = byte === 9 || byte === 10 || byte === 13 || byte === 12 || byte === 8;
    if (byte < 32 && !allowedControl) suspicious += 1;
  }
  return suspicious / bytes.length > 0.1;
}

export function detectLanguage(path: string): string | null {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (name === "dockerfile") return "Dockerfile";
  if (name === "makefile") return "Makefile";
  return LANGUAGE_BY_EXTENSION.get(extname(name).toLowerCase()) ?? null;
}

export function classifyFile(path: string): FileCategory {
  const lower = path.toLowerCase();
  const segments = pathSegments(path);
  const name = segments.at(-1) ?? "";
  const extension = extname(name);

  if (isKnownBinaryPath(path)) return "binary_asset";
  if (
    segments.some((segment) => segment === "generated" || segment === "gen") ||
    name.includes(".generated.") ||
    name.endsWith(".min.js") ||
    name.endsWith(".min.css")
  ) {
    return "generated";
  }
  if (segments.some((segment) => segment === "deps" || segment === "external" || segment === "third_party")) {
    return "dependency";
  }
  if (
    segments.some((segment) => segment === "test" || segment === "tests" || segment === "__tests__") ||
    /\.(test|spec)\.[^.]+$/u.test(name) ||
    /^test_.*\.py$/u.test(name) ||
    /_test\.py$/u.test(name)
  ) {
    return "test";
  }
  if (
    segments.includes("docs") ||
    /^(readme|agents|contributing|changelog|license)(\.|$)/u.test(name) ||
    extension === ".md" ||
    extension === ".mdx"
  ) {
    return "documentation";
  }
  if (
    CONFIGURATION_NAMES.has(name) ||
    name.startsWith("tsconfig.") ||
    name.startsWith("eslint.config.") ||
    lower.startsWith(".github/") ||
    extension === ".json" ||
    extension === ".yaml" ||
    extension === ".yml" ||
    extension === ".toml"
  ) {
    return "configuration";
  }
  return detectLanguage(path) === null ? "unknown" : "source";
}

export function isOversized(size: number, maximumBytes: number): boolean {
  return size > maximumBytes;
}
