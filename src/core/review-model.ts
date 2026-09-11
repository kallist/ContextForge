import { z } from "zod";
import { isNormalizedRepositoryPath } from "./repository-graph.js";
import { hasAbsolutePath } from "./capsule-privacy.js";

const path = z.string().max(4096).refine(isNormalizedRepositoryPath);
const text = z.string().max(1024).refine((s) => !hasAbsolutePath(s));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const commit = z.string().regex(/^[a-f0-9]{40,64}$/u);
const range = z.strictObject({ startLine: z.number().int().min(0), count: z.number().int().min(0) });
export const reviewSchema = z.strictObject({
  version: z.literal("contextforge-review-v1"),
  input: z.literal("BASE_TO_WORKTREE"), base: commit, head: commit,
  changeHash: hash,
  changes: z.array(z.strictObject({
    path, previousPath: path.nullable(), status: z.enum(["ADDED", "MODIFIED", "DELETED", "RENAMED"]),
    sourceHash: hash.nullable(), previousSourceHash: hash.nullable(),
    availability: z.enum(["VERIFIED", "DELETED_METADATA_ONLY", "UNAVAILABLE"]),
    ranges: z.array(z.strictObject({ before: range, after: range })).max(2048),
    symbols: z.array(z.strictObject({ id: text, name: text, kind: text, change: z.enum(["ADDED", "MODIFIED", "REMOVED"]), startLine: z.number().int().min(1), endLine: z.number().int().min(1) })).max(1024),
  })).max(64),
  impact: z.array(z.strictObject({
    id: text, from: path, to: path, type: text,
    classification: z.enum(["STRUCTURAL_FACT", "HEURISTIC"]),
    sourceSymbol: text.nullable(), targetSymbol: text.nullable(),
  })).max(1024),
  limits: z.strictObject({ changedFiles: z.literal(64), candidates: z.literal(100), depth: z.literal(1), sourceBytes: z.literal(16777216) }),
  excludedChanges: z.number().int().nonnegative(),
  diagnostics: z.array(z.string().regex(/^[A-Z0-9_]+$/u)).max(64),
});
export type ReviewModel = z.infer<typeof reviewSchema>;
