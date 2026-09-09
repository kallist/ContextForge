import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Internal release-hardening child process. This script is excluded from the npm package.
const [packageRoot, repositoryPath, readyPath, releasePath] = process.argv.slice(2);
const load = (relativePath) => import(pathToFileURL(join(packageRoot, relativePath)).href);
const [
  { FileSystemRepositoryScanner },
  { FileSystemRepositorySourceReader },
  { ReadOnlyGitSignalsReader },
  { TreeSitterLanguageAnalyzer },
  { SqliteIndexRepository },
  { buildContextPack },
  { buildIndex },
  { getRepositoryStatus },
  { searchRepository },
  { startContextForgeMcpStdio },
] = await Promise.all([
  load("dist/adapters/filesystem/repository-scanner.js"),
  load("dist/adapters/filesystem/repository-source-reader.js"),
  load("dist/adapters/git/git-signals-reader.js"),
  load("dist/adapters/parser/tree-sitter-language-analyzer.js"),
  load("dist/adapters/sqlite/sqlite-index-repository.js"),
  load("dist/application/build-context-pack.js"),
  load("dist/application/build-index.js"),
  load("dist/application/get-repository-status.js"),
  load("dist/application/search-repository.js"),
  load("dist/adapters/mcp/contextforge-mcp-server.js"),
]);

const scanner = new FileSystemRepositoryScanner();
const sourceReader = new FileSystemRepositorySourceReader();
const analyzer = new TreeSitterLanguageAnalyzer();
const gitReader = new ReadOnlyGitSignalsReader();
let barrierUsed = false;
const repositoryFactory = (rootRealPath) => new SqliteIndexRepository(rootRealPath, {
  testHooks: {
    async onWritePoint(point) {
      if (barrierUsed || point !== "after_files") return;
      barrierUsed = true;
      // after_files is invoked inside buildAndActivate only after BEGIN IMMEDIATE succeeds.
      await writeFile(readyPath, "writer-lock-held\n", { encoding: "utf8", flag: "wx" });
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        try {
          await access(releasePath);
          return;
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      }
      throw new Error("Timed out while holding the writer lock for the contention barrier.");
    },
  },
});
const binding = await scanner.scan(repositoryPath);
const rootRealPath = binding.rootRealPath;
const application = {
  rootRealPath,
  status: () => getRepositoryStatus(scanner, sourceReader, repositoryFactory, rootRealPath),
  index: () => buildIndex(scanner, sourceReader, analyzer, repositoryFactory, { repositoryPath: rootRealPath }, gitReader),
  search: (request) => searchRepository(scanner, sourceReader, repositoryFactory, { ...request, repositoryPath: rootRealPath }),
  pack: (request) => buildContextPack(scanner, sourceReader, repositoryFactory, { ...request, repositoryPath: rootRealPath }),
};
startContextForgeMcpStdio(application, "0.3.0-release-hardening");
