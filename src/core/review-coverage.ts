import type { CapsuleCore } from "./context-capsule.js";

export function reviewCoverage(c: CapsuleCore) {
  const review = c.review;
  if (review === undefined) return null;
  const paths = new Map(c.files.map((f) => [f.id, f.path]));
  const selected = new Set(c.selected.map((s) => paths.get(c.candidates.find((i) => i.id === s.candidateRef)?.fileRef ?? "")));
  const changedSymbols = review.changes.flatMap((f) => f.symbols.filter((s) => s.change !== "REMOVED").map((s) => ({ path: f.path, ...s })));
  const ranges = c.selected.flatMap((s) => c.ranges.filter((r) => s.rangeRefs.includes(r.id)));
  const missing = changedSymbols.filter((s) => !ranges.some((r) => paths.get(r.fileRef) === s.path && r.startLine <= s.startLine && r.endLine >= s.endLine));
  const categories = [...new Set(review.impact.map((r) => r.type))].sort().map((type) => {
    const links = review.impact.filter((r) => r.type === type);
    const targets = [...new Set(links.flatMap((r) => [r.from, r.to]).filter((p) => !review.changes.some((f) => f.path === p)))];
    return { type, available: targets.length, selected: targets.filter((p) => selected.has(p)).length, dropped: targets.filter((p) => !selected.has(p)), evidence: links.map((r) => r.id) };
  });
  const lints: { code: string; severity: "WARNING" | "INFO"; entities: string[]; evidence: string[]; explanation: string }[] = [];
  if (missing.length) lints.push({ code: "CHANGED_SYMBOL_NOT_REPRESENTED", severity: "WARNING", entities: missing.map((s) => s.path), evidence: missing.map((s) => s.id), explanation: "These changed current symbols are not fully covered by the selected source ranges." });
  for (const category of categories.filter((r) => r.dropped.length)) lints.push({ code: /TEST/u.test(category.type) ? "RELATED_TEST_NOT_SELECTED" : "DIRECT_IMPACT_NOT_SELECTED", severity: "INFO", entities: category.dropped, evidence: category.evidence, explanation: `Recorded ${category.type} context was not retained. Inspect decisions for budget or control reasons.` });
  if (c.budget.budgetDrops) lints.push({ code: "REVIEW_CONTEXT_BUDGET_PRESSURE", severity: "INFO", entities: c.dropped, evidence: c.decisions.filter((d) => ["BUDGET_EXHAUSTED", "GLOBAL_BUDGET"].includes(d.reason)).map((d) => d.id), explanation: "Recorded context candidates were lost to the requested hard budget." });
  const unavailable = review.changes.filter((f) => f.availability !== "VERIFIED");
  if (unavailable.length) lints.push({ code: "HISTORICAL_SOURCE_UNAVAILABLE", severity: "INFO", entities: unavailable.map((f) => f.path), evidence: [], explanation: "Deleted source is metadata only. No historical source recovery or removed-symbol impact is claimed." });
  return { changedFiles: { available: review.changes.length, selected: review.changes.filter((f) => selected.has(f.path)).length }, changedSymbols: { available: changedSymbols.length, represented: changedSymbols.length - missing.length }, categories, excludedChanges: review.excludedChanges, diagnostics: review.diagnostics, lints };
}
