import { FileSystemRepositoryScanner } from "../adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../adapters/filesystem/repository-source-reader.js";
import { ReadOnlyGitSignalsReader } from "../adapters/git/git-signals-reader.js";
import { TreeSitterLanguageAnalyzer } from "../adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../adapters/sqlite/sqlite-index-repository.js";
import { buildContextPack, type ContextPackRequest } from "../application/build-context-pack.js";
import { buildIndex } from "../application/build-index.js";
import { getRepositoryStatus, type RepositoryStatus } from "../application/get-repository-status.js";
import { searchRepository, type SearchRepositoryExecution, type SearchRepositoryRequest } from "../application/search-repository.js";
import type { ContextPackExecution } from "../core/context-pack.js";
import type { IndexSummary } from "../core/repository-index.js";

export interface BoundContextForgeApplication {
  /** Internal canonical binding; adapters must never serialize this path. */
  readonly rootRealPath: string;
  status(): Promise<RepositoryStatus>;
  index(): Promise<IndexSummary>;
  search(request: Omit<SearchRepositoryRequest, "repositoryPath">): Promise<SearchRepositoryExecution>;
  pack(request: Omit<ContextPackRequest, "repositoryPath">): Promise<ContextPackExecution>;
}

export async function createContextForgeApplication(repositoryPath: string): Promise<BoundContextForgeApplication> {
  const scanner = new FileSystemRepositoryScanner();
  const sourceReader = new FileSystemRepositorySourceReader();
  const analyzer = new TreeSitterLanguageAnalyzer();
  const gitReader = new ReadOnlyGitSignalsReader();
  const repositoryFactory = (rootRealPath: string): SqliteIndexRepository => new SqliteIndexRepository(rootRealPath);
  const binding = await scanner.scan(repositoryPath);
  const rootRealPath = binding.rootRealPath;

  return {
    rootRealPath,
    status: () => getRepositoryStatus(scanner, sourceReader, repositoryFactory, rootRealPath),
    index: () => buildIndex(scanner, sourceReader, analyzer, repositoryFactory, { repositoryPath: rootRealPath }, gitReader),
    search: (request) => searchRepository(scanner, sourceReader, repositoryFactory, { ...request, repositoryPath: rootRealPath }),
    pack: (request) => buildContextPack(scanner, sourceReader, repositoryFactory, { ...request, repositoryPath: rootRealPath }),
  };
}
