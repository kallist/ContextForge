import { z } from "zod";
import { isNormalizedRepositoryPath } from "./repository-graph.js";
import { ContextForgeError } from "./errors.js";

const path = z.string().max(4096).refine(isNormalizedRepositoryPath);
export const contextControlSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("PIN"), path }),
  z.strictObject({ kind: z.literal("EXCLUDE"), path }),
  z.strictObject({ kind: z.literal("PREFER"), path }),
  z.strictObject({ kind: z.literal("FOCUS"), path }),
  z.strictObject({ kind: z.literal("RANGE"), path, startLine: z.number().int().min(1).max(1_000_000), endLine: z.number().int().min(1).max(1_000_000) }),
]);
export type ContextControl = z.infer<typeof contextControlSchema>;
export const controlProvenanceSchema = z.strictObject({
  version: z.literal("contextforge-controls-v1"),
  parentCapsuleHash: z.string().regex(/^[a-f0-9]{64}$/u),
  controls: z.array(contextControlSchema).max(32),
});
export type ControlProvenance = z.infer<typeof controlProvenanceSchema>;

export function normalizeControls(input: unknown): ContextControl[] {
  const parsed = z.array(contextControlSchema).max(32).safeParse(input);
  if (!parsed.success) throw new ContextForgeError("CONTROL_CONFLICT", "Controls must contain at most 32 valid repository-relative targets.");
  const controls = parsed.data.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);
  const seen = new Set<string>();
  for (const c of controls) {
    const key = `${c.kind}:${c.path}`;
    if (seen.has(key) || (c.kind === "RANGE" && c.endLine < c.startLine)) throw new ContextForgeError("CONTROL_CONFLICT", "Duplicate control or invalid range.");
    seen.add(key);
    if (c.path === "AGENTS.md" && !["PIN", "PREFER"].includes(c.kind)) throw new ContextForgeError("CONTROL_CONFLICT", "Root repository instructions cannot be excluded or narrowed.");
    if (c.kind === "EXCLUDE" && controls.some((other) => other.path === c.path && other.kind !== "EXCLUDE")) throw new ContextForgeError("CONTROL_CONFLICT", "Exclude conflicts with another control on the same file.");
  }
  return controls;
}
