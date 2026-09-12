import { execFile } from "node:child_process";

import type { GitSignalsReader } from "../../application/git-signals.js";
import {
  unavailableGitSignals,
  type GitFileSignal,
  type GitWorkingTreeStatus,
  type RepositoryGitSignals,
} from "../../core/repository-graph.js";

const DEFAULT_RECENT_COMMIT_LIMIT = 100;
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

export interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitCommandRunner {
  run(rootRealPath: string, args: readonly string[]): Promise<GitCommandResult>;
}

class ExecFileGitCommandRunner implements GitCommandRunner {
  run(rootRealPath: string, args: readonly string[]): Promise<GitCommandResult> {
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        [...args],
        {
          cwd: rootRealPath,
          encoding: "utf8",
          windowsHide: true,
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: GIT_MAX_BUFFER,
          shell: false,
        },
        (error, stdout, stderr) => {
          if (error !== null) {
            reject(error instanceof Error ? error : new Error("Git command failed."));
            return;
          }
          resolve({ stdout, stderr });
        },
      );
    });
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function workingTreeStatus(code: string): GitWorkingTreeStatus {
  if (code === "??") return "untracked";
  if (code.includes("U") || code === "AA" || code === "DD") return "conflicted";
  if (code.includes("D")) return "deleted";
  if (code.includes("R") || code.includes("C")) return "renamed";
  if (code.includes("A")) return "added";
  return "modified";
}

function parseStatus(output: string, approved: ReadonlySet<string>): Map<string, GitWorkingTreeStatus> {
  const result = new Map<string, GitWorkingTreeStatus>();
  const records = output.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record.length < 4) continue;
    const code = record.slice(0, 2);
    const relativePath = record.slice(3).replaceAll("\\", "/");
    if (approved.has(relativePath)) result.set(relativePath, workingTreeStatus(code));
    if ((code.includes("R") || code.includes("C")) && records[index + 1] !== undefined) {
      const previousPath = records[index + 1]?.replaceAll("\\", "/") ?? "";
      if (code.includes("R") && approved.has(previousPath)) result.set(previousPath, "deleted");
      index += 1;
    }
  }
  return result;
}

interface MutableHistorySignal {
  count: number;
  lastCommit: string | null;
  lastChangedAt: string | null;
}

function parseHistory(output: string, approved: ReadonlySet<string>): Map<string, MutableHistorySignal> {
  const result = new Map<string, MutableHistorySignal>();
  let commit: string | null = null;
  let changedAt: string | null = null;
  for (const rawToken of output.split("\0")) {
    let token = rawToken;
    const recordSeparator = String.fromCharCode(30);
    const unitSeparator = String.fromCharCode(31);
    const headerStart = token.indexOf(recordSeparator);
    if (headerStart >= 0) {
      const headerEnd = token.indexOf("\n", headerStart);
      const rawHeader = token.slice(headerStart + 1, headerEnd < 0 ? token.length : headerEnd);
      const [hash, rawSeconds] = rawHeader.split(unitSeparator);
      commit = hash !== undefined && /^[0-9a-f]{40,64}$/u.test(hash) ? hash : null;
      const seconds = Number(rawSeconds);
      changedAt = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
      token = headerEnd < 0 ? "" : token.slice(headerEnd + 1);
    }
    const relativePath = token.replace(/^\n/u, "").replaceAll("\\", "/");
    if (commit === null || relativePath.length === 0 || !approved.has(relativePath)) continue;
    const signal = result.get(relativePath) ?? { count: 0, lastCommit: null, lastChangedAt: null };
    signal.count += 1;
    signal.lastCommit ??= commit;
    signal.lastChangedAt ??= changedAt;
    result.set(relativePath, signal);
  }
  return result;
}

async function optionalCommand(runner: GitCommandRunner, rootRealPath: string, args: readonly string[]): Promise<string | null> {
  try {
    return (await runner.run(rootRealPath, args)).stdout;
  } catch {
    return null;
  }
}

export class ReadOnlyGitSignalsReader implements GitSignalsReader {
  readonly #runner: GitCommandRunner;
  readonly #recentCommitLimit: number;

  constructor(options: { readonly runner?: GitCommandRunner; readonly recentCommitLimit?: number } = {}) {
    this.#runner = options.runner ?? new ExecFileGitCommandRunner();
    this.#recentCommitLimit = options.recentCommitLimit ?? DEFAULT_RECENT_COMMIT_LIMIT;
  }

  async inspect(rootRealPath: string, approvedRelativePaths: readonly string[]): Promise<RepositoryGitSignals> {
    const approved = new Set(approvedRelativePaths);
    try {
      const repositoryCheck = await this.#runner.run(rootRealPath, ["rev-parse", "--is-inside-work-tree"]);
      if (repositoryCheck.stdout.trim() !== "true") return unavailableGitSignals("The repository is not a Git worktree.", this.#recentCommitLimit);
    } catch {
      return unavailableGitSignals("Git is unavailable or the repository is not a Git worktree.", this.#recentCommitLimit);
    }

    const [headOutput, branchOutput] = await Promise.all([
      optionalCommand(this.#runner, rootRealPath, ["rev-parse", "--verify", "HEAD"]),
      optionalCommand(this.#runner, rootRealPath, ["symbolic-ref", "--short", "-q", "HEAD"]),
    ]);
    let statusOutput: string;
    let trackedOutput: string;
    try {
      [statusOutput, trackedOutput] = await Promise.all([
        this.#runner.run(rootRealPath, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]).then(({ stdout }) => stdout),
        this.#runner.run(rootRealPath, ["ls-files", "-z", "--cached", "--", "."]).then(({ stdout }) => stdout),
      ]);
    } catch {
      return unavailableGitSignals("Git worktree status could not be read safely.", this.#recentCommitLimit);
    }
    const historyOutput = await optionalCommand(this.#runner, rootRealPath, [
      "log",
      "-n",
      String(this.#recentCommitLimit),
      "--format=%x1e%H%x1f%ct",
      "--name-only",
      "-z",
      "--",
      ".",
    ]);
    if (headOutput !== null && historyOutput === null) {
      return unavailableGitSignals("Git history could not be read safely.", this.#recentCommitLimit);
    }

    const dirty = parseStatus(statusOutput, approved);
    const tracked = new Set(
      trackedOutput
        .split("\0")
        .map((path) => path.replaceAll("\\", "/"))
        .filter((path) => approved.has(path)),
    );
    const history = parseHistory(historyOutput ?? "", approved);
    // `approved` includes the previous index generation so an actual deletion can
    // survive scanning. Do not turn a path that exists only in that old generation
    // into a timeless synthetic `clean` signal. Rename sources are recorded above
    // as this generation's explicit deletion side.
    const signaled = new Set([...tracked, ...dirty.keys()]);
    const files: GitFileSignal[] = [...approved]
      .filter((relativePath) => signaled.has(relativePath))
      .sort(compareText)
      .map((relativePath) => {
        const recent = history.get(relativePath);
        const status = dirty.get(relativePath) ?? "clean";
        return {
          relativePath,
          tracked: tracked.has(relativePath) && status !== "untracked",
          workingTreeStatus: status,
          recentCommitCount: recent?.count ?? 0,
          lastChangedCommit: recent?.lastCommit ?? null,
          lastChangedAt: recent?.lastChangedAt ?? null,
        };
      });

    return {
      status: "available",
      head: headOutput?.trim() || null,
      branch: branchOutput?.trim() || null,
      recentCommitLimit: this.#recentCommitLimit,
      files,
      diagnostic: null,
    };
  }
}
