import { basename } from "node:path";

import type { RepositoryScanner } from "./map-repository.js";
import type { RepositorySourceReader } from "./repository-source.js";
import { searchRepository } from "./search-repository.js";
import { PACKING_STRATEGY } from "../core/context-pack.js";
import { INDEX_SCHEMA_VERSION, type IndexRepositoryFactory } from "../core/repository-index.js";
import { RANKING_STRATEGY, type SearchIndexStatus } from "../core/task-retrieval.js";
import { GENERIC_TOKEN_ESTIMATOR_ID, GENERIC_TOKEN_ESTIMATOR_VERSION } from "../core/token-estimation.js";

export const REPOSITORY_STATUS_SCHEMA_VERSION = "1.0";

export interface RepositoryStatus {
  readonly schemaVersion: typeof REPOSITORY_STATUS_SCHEMA_VERSION;
  readonly repository: { readonly name: string; readonly root: "." };
  readonly index: {
    readonly available: boolean;
    readonly generation: number | null;
    readonly schemaVersion: number;
  };
  readonly indexStatus: "CURRENT" | "STALE" | "PARTIAL" | "MISSING";
  readonly verification: SearchIndexStatus | null;
  readonly rankingStrategy: typeof RANKING_STRATEGY;
  readonly packingStrategy: typeof PACKING_STRATEGY;
  readonly tokenEstimator: typeof GENERIC_TOKEN_ESTIMATOR_ID;
  readonly tokenEstimatorVersion: typeof GENERIC_TOKEN_ESTIMATOR_VERSION;
  readonly diagnostics: readonly string[];
}

export async function getRepositoryStatus(
  scanner: RepositoryScanner,
  sourceReader: RepositorySourceReader,
  repositoryFactory: IndexRepositoryFactory,
  repositoryPath: string,
): Promise<RepositoryStatus> {
  const scan = await scanner.scan(repositoryPath);
  const active = await repositoryFactory(scan.rootRealPath).loadActive();
  const base = {
    schemaVersion: REPOSITORY_STATUS_SCHEMA_VERSION,
    repository: { name: basename(scan.rootRealPath), root: "." as const },
    rankingStrategy: RANKING_STRATEGY,
    packingStrategy: PACKING_STRATEGY,
    tokenEstimator: GENERIC_TOKEN_ESTIMATOR_ID,
    tokenEstimatorVersion: GENERIC_TOKEN_ESTIMATOR_VERSION,
  } as const;
  if (active === null) {
    return {
      ...base,
      index: { available: false, generation: null, schemaVersion: INDEX_SCHEMA_VERSION },
      indexStatus: "MISSING",
      verification: null,
      diagnostics: ["INDEX_MISSING"],
    };
  }
  if (active.graph === null) {
    return {
      ...base,
      index: { available: true, generation: active.generation, schemaVersion: INDEX_SCHEMA_VERSION },
      indexStatus: "STALE",
      verification: null,
      diagnostics: ["INDEX_REQUIRES_REFRESH"],
    };
  }

  // A low-information query intentionally produces no candidates while reusing
  // Search's bounded, generation-verified source freshness semantics.
  const execution = await searchRepository(scanner, sourceReader, repositoryFactory, {
    repositoryPath: scan.rootRealPath,
    task: "the",
    limit: 1,
  });
  const verification = execution.result.indexStatus;
  return {
    ...base,
    index: { available: true, generation: execution.result.generation, schemaVersion: INDEX_SCHEMA_VERSION },
    indexStatus: verification.status === "FRESH" ? "CURRENT" : verification.status,
    verification,
    diagnostics: execution.result.diagnostics.filter((diagnostic) => diagnostic !== "QUERY_LOW_INFORMATION"),
  };
}
