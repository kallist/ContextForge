import type { RepositoryGitSignals } from "../core/repository-graph.js";

export interface GitSignalsReader {
  inspect(rootRealPath: string, approvedRelativePaths: readonly string[]): Promise<RepositoryGitSignals>;
}
