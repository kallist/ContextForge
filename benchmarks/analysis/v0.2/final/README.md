# Final V0.2 evidence

Evaluated source: `0f864bd5fadd4990958b82613968c17f3c6960e7`. This directory supplements earlier experiments without replacing the frozen V1 references or initial failed Pack V2 history.

- `quality-results-v0.2.json`: the single final 720-case run; original evaluator metadata and case objects preserved.
- `aggregate-results-v0.2.json`: all-budget macro metrics, retrieval cutoffs, existing groups, preserved successes and separate task W/T/L dimensions. Precision's one-percentage-point descriptive band does not change raw metrics; raw deltas are retained.
- `diagnostics-v0.2.json`: compact projection of two identical 51 MB source-free diagnostic runs, preserving per-payload hashes, required identity/rank/retention, selected ranges, drops and required candidate classification. Full trace hash is recorded; no source body is retained.
- `performance-results-v0.2.json`: original three-repetition, 36-sample same-run performance output. Timing remains separate from deterministic quality evidence.
- `candidate-decision-v0.2.json`: explicit experimental choice and public-default decision with all-budget evidence and artifact hashes.
- `failure-matrix-v0.2.json`: all-budget C required misses, distinguishing pre-Pack absence from packing loss. Other-budget subcauses are not invented from 8K traces.
- `retention-v0.2.json`: all-budget pre-Pack-present entity retention and C/B task retention wins/ties/losses.
- `qualification-hardening.json`: existing implementation's installed-package qualification before the release version bump; package version is therefore 0.1.1 at this checkpoint.
- `integrity-manifest.json`: hashes of frozen inputs, production/evaluator files and the evidence above, including the exact historical 720-case object digest.

`node scripts/release-evidence-check.mjs` independently verifies the inventory, V1 reference identity, case count, aggregates, 19/0, budget and selected performance gate. Regenerate quality/performance/diagnostics with existing npm benchmark commands; filenames still use v0.2-04 to avoid changing evaluator semantics. Compare case objects separately from commit provenance metadata. Do not repeat the full run just to obtain a more favorable timing or quality result.

Interpretation and claims: `docs/V0.2_FINAL_EVALUATION.md`. External publication gates: `docs/V0.2_RELEASE_REPORT.md` and the published release closeout.
