import { execFile } from "node:child_process";
import { ContextForgeError } from "../../core/errors.js";
import { isNormalizedRepositoryPath } from "../../core/repository-graph.js";
import { isBuiltInIgnored, isSensitivePath } from "../../core/file-policies.js";
import type { ReviewModel } from "../../core/review-model.js";

/** No shell, ref options, external diff drivers, textconv, or unbounded output. */
export class ReviewGitReader {
  private filterOptions: Promise<string[]> | undefined;
  constructor(private readonly root: string) {}
  private invoke(args: string[], maximum: number, allowNoMatch = false): Promise<string> {
    return new Promise((resolve, reject) => {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
      execFile("git", ["--literal-pathspecs", "-c", "core.fsmonitor=false", ...args], { cwd: this.root, env, shell: false, windowsHide: true, encoding: "utf8", timeout: 10_000, maxBuffer: maximum }, (error, stdout, stderr) => {
        if (error !== null && !(allowNoMatch && error.code === 1 && stderr === "")) reject(new ContextForgeError("USAGE", "Git review input could not be read within supported limits. Check the repository and base commit."));
        else resolve(stdout);
      });
    });
  }
  async run(args: string[], maximum = 2 * 1024 * 1024): Promise<string> {
    this.filterOptions ??= this.invoke(["config", "--null", "--name-only", "--get-regexp", "^filter\\."], 64 * 1024, true).then((output) => {
      const names = output.split("\0").filter(Boolean);
      if (names.length > 128 || names.some((n) => !/^filter\.[^=\r\n\0]+\.[a-zA-Z]+$/u.test(n))) throw new ContextForgeError("USAGE", "Unsupported Git filter configuration. Review cannot disable it safely.");
      const filters = [...new Set(names.map((n) => n.slice(0, n.lastIndexOf("."))))].sort();
      return filters.flatMap((f) => ["-c", `${f}.clean=`, "-c", `${f}.process=`, "-c", `${f}.required=false`]);
    });
    const boundedArgs = args[0] === "status" || args[0] === "diff" ? [args[0], "--ignore-submodules=all", ...args.slice(1)] : args;
    return this.invoke(["-c", "submodule.recurse=false", ...await this.filterOptions, ...boundedArgs], maximum);
  }
  async resolve(ref: string): Promise<string> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_./~^@{}-]{0,199}$/u.test(ref) || ref.includes("..") || ref.includes("@{")) throw new ContextForgeError("USAGE", "Invalid review base. Use a local commit hash or branch name.");
    const value = (await this.run(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], 4096)).trim();
    if (!/^[a-f0-9]{40,64}$/u.test(value)) throw new ContextForgeError("USAGE", "Review requires a resolved commit.");
    return value;
  }
  async changes(base: string) {
    const rootPrefix = (await this.run(["rev-parse", "--show-prefix"], 4096)).trim();
    if (rootPrefix !== "") throw new ContextForgeError("USAGE", "Review must be bound to the Git repository root.");
    const output = await this.run(["diff", "--no-ext-diff", "--no-textconv", "--find-renames", "--name-status", "-z", base, "--"]);
    const parts = output.split("\0");
    const changes: { path: string; previousPath: string | null; status: ReviewModel["changes"][number]["status"] }[] = [];
    let excluded = 0;
    for (let i = 0; i < parts.length - 1;) {
      const code = parts[i++] ?? "", first = parts[i++] ?? "";
      const renamed = code.startsWith("R");
      const path = renamed ? parts[i++] ?? "" : first;
      if (!/^(A|M|D|R\d+)$/u.test(code)) throw new ContextForgeError("USAGE", "Unmerged or unsupported Git change. Resolve it before reviewing.");
      if (![first, path].every((p) => isNormalizedRepositoryPath(p) && !isSensitivePath(p) && !isBuiltInIgnored(p))) { excluded++; continue; }
      changes.push({ path, previousPath: renamed ? first : null, status: renamed ? "RENAMED" : code === "A" ? "ADDED" : code === "D" ? "DELETED" : "MODIFIED" });
      if (changes.length > 64) throw new ContextForgeError("USAGE", "Review supports at most 64 changed files. Choose a narrower base.");
    }
    return { changes, excluded, identity: output };
  }
  async ranges(base: string, path: string, previousPath: string | null): Promise<ReviewModel["changes"][number]["ranges"]> {
    const diff = await this.run(["diff", "--no-ext-diff", "--no-textconv", "--unified=0", "--find-renames", base, "--", ...new Set([path, previousPath ?? path])]);
    const ranges = [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gmu)].map((m) => ({ before: { startLine: Number(m[1]), count: Number(m[2] ?? 1) }, after: { startLine: Number(m[3]), count: Number(m[4] ?? 1) } }));
    if (ranges.length > 2048) throw new ContextForgeError("USAGE", "Review changed-range limit exceeded.");
    return ranges;
  }
  async previousSource(base: string, path: string): Promise<string | null> {
    const tree = await this.run(["ls-tree", "-z", base, "--", path], 8192);
    if (!/^100(?:644|755) blob [a-f0-9]+\t/u.test(tree)) return null;
    return this.run(["show", `${base}:${path}`], 1024 * 1024);
  }
}
