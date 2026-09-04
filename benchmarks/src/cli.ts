import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { runBenchmarkSystem } from "./systems.js";

import { aggregateQualityRun, renderBenchmarkReport } from "./report.js";
import { validateFailureMatrix } from "./failure-matrix.js";
import {
  runPerformanceBenchmark,
  runQualityBenchmark,
  runV1RetrievalDiagnostics,
  runV2RetrievalDiagnostics,
  runV2RelationshipDiagnostics,
  runPlanPackDiagnostics,
  validateDraftDataset,
  validateFormalDataset,
  writeJsonOutput,
} from "./runner.js";

const workspaceRoot = resolve(process.cwd());
const command = process.argv[2] ?? "";

async function writeReport(name: string, content: string): Promise<void> {
  const outputRoot = join(workspaceRoot, ".benchmark-output");
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(outputRoot, name), content, "utf8");
}

switch (command) {
  case "gate-plan-pack": {
    const result = await runPlanPackDiagnostics(workspaceRoot, "GATE");
    await writeJsonOutput(workspaceRoot, "v0.2-04r-8k-gate.json", result);
    process.stdout.write("24-task 8K Pack V2 gate diagnostics completed; inspect quality gates before ablation or full benchmark.\n");
    break;
  }
  case "diagnose-plan-pack": {
    const result = await runPlanPackDiagnostics(workspaceRoot);
    await writeJsonOutput(workspaceRoot, "v0.2-04-plan-pack-diagnostics.json", result);
    process.stdout.write("Plan-aware packing diagnostics and bounded neutral-plan ablation completed.\n");
    break;
  }
  case "draft-validate": {
    const validated = await validateDraftDataset(workspaceRoot);
    process.stdout.write(`Draft validation passed for ${validated.dataset.tasks.length} tasks. Candidate dataset hash: ${validated.hash}\n`);
    break;
  }
  case "validate": {
    const validated = await validateFormalDataset(workspaceRoot);
    await validateFailureMatrix(workspaceRoot, validated.dataset);
    process.stdout.write(`Validated ${validated.dataset.tasks.length} tasks across ${validated.dataset.repositories.length} repositories. Dataset hash: ${validated.hash}\n`);
    break;
  }
  case "smoke": {
    const run = await runQualityBenchmark(workspaceRoot, "SMOKE");
    await writeJsonOutput(workspaceRoot, "smoke-results-v0.2-04.json", run);
    process.stdout.write(`Benchmark smoke passed: ${run.cases.length} case/system/budget results.\n`);
    break;
  }
  case "quality": {
    const run = await runQualityBenchmark(workspaceRoot, "FULL");
    await writeJsonOutput(workspaceRoot, "quality-results-v0.2-04.json", run);
    await writeJsonOutput(workspaceRoot, "aggregate-results-v0.2-04.json", aggregateQualityRun(run));
    await writeReport("benchmark-report-v0.2-04.md", renderBenchmarkReport(run));
    process.stdout.write(`Full quality benchmark passed: ${run.cases.length} raw results.\n`);
    break;
  }
  case "performance": {
    // Optional explicitly supplied trusted benchmark engine, never corpus code.
    const comparisonPath = process.argv[3];
    let preOptimizationRun: typeof runBenchmarkSystem | undefined;
    let preOptimizationModuleSha256: string | undefined;
    if (comparisonPath !== undefined) {
      preOptimizationModuleSha256 = createHash("sha256").update(await readFile(resolve(comparisonPath))).digest("hex");
      const comparison = await import(pathToFileURL(resolve(comparisonPath)).href) as { runBenchmarkSystem?: typeof runBenchmarkSystem };
      if (typeof comparison.runBenchmarkSystem !== "function") throw new Error("Pre-optimization module must export runBenchmarkSystem.");
      preOptimizationRun = comparison.runBenchmarkSystem;
    }
    const result = await runPerformanceBenchmark(workspaceRoot, preOptimizationRun);
    await writeJsonOutput(workspaceRoot, "performance-results.json", comparisonPath === undefined ? result : { ...result as Record<string, unknown>, preOptimizationModuleSha256 });
    process.stdout.write("Performance benchmark completed with three environment-specific repetitions; evaluate the measured guardrail separately.\n");
    break;
  }
  case "diagnose-v1": {
    const result = await runV1RetrievalDiagnostics(workspaceRoot);
    await writeJsonOutput(workspaceRoot, "v0.2-retrieval-diagnostics-v1.json", result);
    process.stdout.write("V1 retrieval diagnostics passed for all frozen tasks.\n");
    break;
  }
  case "diagnose-v2": {
    const result = await runV2RetrievalDiagnostics(workspaceRoot);
    await writeJsonOutput(workspaceRoot, "v0.2-02-retrieval-diagnostics.json", result);
    process.stdout.write("V2 retrieval diagnostics and bounded ablations passed for all frozen tasks.\n");
    break;
  }
  case "diagnose-v2-relations": {
    const result = await runV2RelationshipDiagnostics(workspaceRoot);
    await writeJsonOutput(workspaceRoot, "v0.2-03-relationship-diagnostics.json", result);
    process.stdout.write("V0.2-03 relationship diagnostics and bounded ablations passed for all frozen tasks.\n");
    break;
  }
  case "full": {
    const run = await runQualityBenchmark(workspaceRoot, "FULL");
    await writeJsonOutput(workspaceRoot, "quality-results-v0.2-04.json", run);
    await writeJsonOutput(workspaceRoot, "aggregate-results-v0.2-04.json", aggregateQualityRun(run));
    await writeReport("benchmark-report-v0.2-04.md", renderBenchmarkReport(run));
    process.stdout.write(`Full benchmark quality phase passed: ${run.cases.length} raw results. Run npm run benchmark:performance for timing evidence.\n`);
    break;
  }
  default:
    throw new Error("Usage: benchmark CLI <draft-validate|validate|smoke|quality|performance|diagnose-v1|diagnose-v2|diagnose-v2-relations|gate-plan-pack|diagnose-plan-pack|full>");
}
