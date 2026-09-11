import { FileSystemRepositoryScanner } from "../adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../adapters/sqlite/sqlite-index-repository.js";
import { ReviewGitReader } from "../adapters/git/review-git-reader.js";
import { buildReviewContext, type ReviewRequest } from "../application/build-review-context.js";
import { buildIndex } from "../application/build-index.js";
import { ReadOnlyGitSignalsReader } from "../adapters/git/git-signals-reader.js";

export function compileReview(repositoryPath: string, request: Omit<ReviewRequest, "repositoryPath">) {
  return buildReviewContext(new FileSystemRepositoryScanner(), new FileSystemRepositorySourceReader(), (root) => new SqliteIndexRepository(root), new TreeSitterLanguageAnalyzer(), new ReviewGitReader(repositoryPath), { ...request, repositoryPath });
}

/** Index rename source paths as deletions, satisfying the unchanged generation invariant. */
export function indexReview(repositoryPath: string) {
  const git = new ReviewGitReader(repositoryPath);
  const scanner = new FileSystemRepositoryScanner();
  const reader = new ReadOnlyGitSignalsReader({ runner: { run: async (_root, args) => ({ stdout: await git.run(args[0] === "status" ? ["status", "--no-renames", ...args.slice(1)] : [...args]), stderr: "" }) } });
  const signals = { inspect: async (root: string, approved: readonly string[]) => {
    const result = await reader.inspect(root, approved);
    if (result.status !== "available") return result;
    const current = new Set((await scanner.scan(root)).entries.map((e) => e.path));
    // Removed untracked or newly ignored paths have no Git deletion record.
    // Omit their optional signals instead of inventing clean missing file nodes.
    return { ...result, files: result.files.filter((f) => current.has(f.relativePath) || f.workingTreeStatus === "deleted") };
  } };
  return buildIndex(scanner, new FileSystemRepositorySourceReader(), new TreeSitterLanguageAnalyzer(), (root) => new SqliteIndexRepository(root), { repositoryPath }, signals);
}
