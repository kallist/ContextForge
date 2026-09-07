import { FileSystemRepositoryScanner } from "../adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../adapters/filesystem/repository-source-reader.js";
import { TreeSitterLanguageAnalyzer } from "../adapters/parser/tree-sitter-language-analyzer.js";
import { SqliteIndexRepository } from "../adapters/sqlite/sqlite-index-repository.js";
import { buildContextPackV2 } from "../application/build-context-pack-v2.js";
import { verifyRecordedSources, type LifecycleCompiler } from "../application/context-lifecycle.js";
import { ContextForgeError } from "../core/errors.js";
import { createContextForgeApplication, type BoundContextForgeApplication } from "./contextforge-application.js";

/** Add lifecycle capabilities without modifying the frozen public CLI/MCP composition. */
export async function createContextForgeLifecycle(repositoryPath: string): Promise<BoundContextForgeApplication & LifecycleCompiler> {
  const app = await createContextForgeApplication(repositoryPath);
  const scanner = new FileSystemRepositoryScanner(), reader = new FileSystemRepositorySourceReader();
  const analyzer = new TreeSitterLanguageAnalyzer();
  const factory = (root: string) => new SqliteIndexRepository(root);
  return {
    ...app,
    verifySources: (capsule) => verifyRecordedSources(scanner, reader, factory, app.rootRealPath, capsule),
    compile: (request, reference) => {
      const strategy = reference?.deterministic.strategies.pack ?? "contextforge-pack-v1";
      if (strategy === "contextforge-pack-v1") return app.pack(request);
      if (strategy === "contextforge-pack-v2" && request.controlProvenance === undefined) return buildContextPackV2(scanner, reader, factory, { ...request, repositoryPath: app.rootRealPath }, { relationshipAnalyzer: analyzer });
      throw new ContextForgeError("STRATEGY_UNAVAILABLE", "The recorded strategy is unavailable for this operation. Human controls support the public V1 compiler.");
    },
  };
}
