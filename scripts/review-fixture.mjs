import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

export async function reviewFixture(root, scenario = "callers") {
  const write = async (path, text) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); };
  const git = (...args) => execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd: root, windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" } });
  git("init", "-b", "main");
  await write(".gitattributes", "* text eol=lf\n");
  await write("AGENTS.md", "# Review guidance\nInspect behavior, callers and related tests.\n");
  await write("src/ledger.ts", "export function ledger(value: number) {\n  return value + 1;\n}\n");
  for (let i = 0; i < 8; i++) await write(`src/caller${i}.ts`, `import { ledger } from './ledger.js';\nexport function caller${i}(value: number) {\n${Array.from({ length: 18 }, (_, n) => `  const entry${n} = value + ${n};`).join("\n")}\n  return ledger(value);\n}\n`);
  await write("test/ledger.test.ts", "import { ledger } from '../src/ledger.js';\nexport function testLedger() { return ledger(1) === 2; }\n");
  await write("src/contract.ts", "export interface Store { save(): void; }\n");
  await write("src/store.ts", "import { Store } from './contract.js';\nexport class LocalStore implements Store { save() {} }\n");
  await write("src/plugin.ts", "export function plugin(name: string) { return import(name); }\n");
  await write("src/ledger.py", "def ledger(value):\n    return value + 1\n");
  await write("src/python_caller.py", "from .ledger import ledger\ndef caller(value):\n    return ledger(value)\n");
  await write("src/__init__.py", "");
  await write(".env", "REVIEW_SECRET_SENTINEL=never_export\n");
  git("add", "."); git("-c", "user.name=ContextForge fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Frozen review fixture <img src=x onerror=globalThis.injected=true>");
  if (scenario === "interface") await write("src/contract.ts", "export interface Store { save(): void; load(): void; }\n");
  else if (scenario === "python") await write("src/ledger.py", "def ledger(value):\n    return value + 2\n");
  else await write("src/ledger.ts", "export function ledger(value: number) {\n  const markup = '<img src=x onerror=globalThis.injected=true>';\n  return value + 2;\n}\n");
  return { write, git };
}
