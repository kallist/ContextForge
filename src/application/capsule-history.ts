import type { ContextCapsuleV1 } from "../core/context-capsule.js";

export interface CapsuleSummary {
  id: string;
  savedAt: string;
  task: string | null;
  budget: number;
  tokens: number;
  selected: number;
  storedBytes: number;
  metadataBytes: number;
}
export interface CapsuleHistory {
  save(capsule: unknown): CapsuleSummary;
  list(limit?: number, offset?: number): CapsuleSummary[];
  get(id: string): ContextCapsuleV1;
  delete(id: string): boolean;
  prune(keep: number): number;
  stats(): { count: number; storedBytes: number; metadataBytes: number };
  close(): void;
}
