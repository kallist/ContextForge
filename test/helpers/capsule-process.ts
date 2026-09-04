import { FileSystemRepositoryScanner } from "../../src/adapters/filesystem/repository-scanner.js";
import { FileSystemRepositorySourceReader } from "../../src/adapters/filesystem/repository-source-reader.js";
import { SqliteIndexRepository } from "../../src/adapters/sqlite/sqlite-index-repository.js";
import { TreeSitterLanguageAnalyzer } from "../../src/adapters/parser/tree-sitter-language-analyzer.js";
import { buildContextPack } from "../../src/application/build-context-pack.js";
import { buildContextPackV2 } from "../../src/application/build-context-pack-v2.js";
import { canonicalSerialize } from "../../src/core/context-capsule.js";

const scanner = new FileSystemRepositoryScanner(), reader = new FileSystemRepositorySourceReader();
const factory = (root: string) => new SqliteIndexRepository(root);
const request = { repositoryPath: process.argv[2] ?? ".", task: "fix Ledger saveValue", budget: 2000, captureCapsule: true };
const result = process.argv[3] === "v2" ? await buildContextPackV2(scanner, reader, factory, request, { relationshipAnalyzer: new TreeSitterLanguageAnalyzer() }) : await buildContextPack(scanner, reader, factory, request);
process.stdout.write(canonicalSerialize({ deterministic: result.capsule?.deterministic, capsuleHash: result.capsule?.capsuleHash }));
