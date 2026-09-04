import type { QualityCaseResult, QualityRun, SystemId } from "./types.js";
import { MATCHED_RECALL_TARGETS, QUALITY_BUDGETS, RETRIEVAL_CUTOFFS, SYSTEM_IDS } from "./types.js";
import { minimumActualTokensAtRecall } from "./metrics.js";

type WholeFileSystem = "lexical-full-file-v1" | "structural-full-file-v1";
type ContextSystem = "contextforge-v1" | "contextforge-v2" | "contextforge-v2-relations";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function format(value: number | null): string {
  return value === null ? "N/A" : value.toFixed(3);
}

function mean(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0) / present.length;
}

function cases(run: QualityRun, systemId: SystemId, budget: number): QualityCaseResult[] {
  return run.cases.filter((item) => item.systemId === systemId && item.budget === budget);
}

function taskKey(item: Pick<QualityCaseResult, "repositoryId" | "taskId">): string {
  return `${item.repositoryId}\0${item.taskId}`;
}

function matchedRecall(run: QualityRun, systemId: SystemId, target: number): { reached: number; total: number; meanTokens: number | null } {
  const byTask = new Map<string, QualityCaseResult[]>();
  for (const item of run.cases.filter((candidate) => candidate.systemId === systemId && candidate.requiredSymbolRecall !== null)) {
    const key = taskKey(item);
    byTask.set(key, [...(byTask.get(key) ?? []), item]);
  }
  const tokens: number[] = [];
  for (const values of byTask.values()) {
    const reached = minimumActualTokensAtRecall(values.map((item) => ({ recall: item.requiredSymbolRecall, payloadTokens: item.payloadTokens })), target);
    if (reached !== null) tokens.push(reached);
  }
  return { reached: tokens.length, total: byTask.size, meanTokens: mean(tokens) };
}

function tokensByTask(run: QualityRun, systemId: SystemId, target: number): Map<string, number> {
  const grouped = new Map<string, QualityCaseResult[]>();
  for (const item of run.cases.filter((candidate) => candidate.systemId === systemId && candidate.requiredSymbolRecall !== null)) {
    const key = taskKey(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  const result = new Map<string, number>();
  for (const [key, values] of grouped) {
    const tokens = minimumActualTokensAtRecall(values.map((item) => ({ recall: item.requiredSymbolRecall, payloadTokens: item.payloadTokens })), target);
    if (tokens !== null) result.set(key, tokens);
  }
  return result;
}

function pairedReduction(run: QualityRun, baseline: WholeFileSystem, contextSystem: ContextSystem, target: number): {
  tasks: number;
  baselineMeanTokens: number | null;
  contextforgeMeanTokens: number | null;
  reduction: number | null;
} {
  const baselineTokens = tokensByTask(run, baseline, target);
  const contextTokens = tokensByTask(run, contextSystem, target);
  const pairedBaselineTokens: number[] = [];
  const pairedContextTokens: number[] = [];
  const reductions: number[] = [];
  for (const [key, baselineValue] of baselineTokens) {
    const contextValue = contextTokens.get(key);
    if (contextValue === undefined || baselineValue === 0) continue;
    pairedBaselineTokens.push(baselineValue);
    pairedContextTokens.push(contextValue);
    reductions.push(1 - contextValue / baselineValue);
  }
  return {
    tasks: reductions.length,
    baselineMeanTokens: mean(pairedBaselineTokens),
    contextforgeMeanTokens: mean(pairedContextTokens),
    reduction: mean(reductions),
  };
}

function comparison(run: QualityRun, left: SystemId, right: SystemId, budget: number): { requiredSymbolDelta: number | null; precisionDelta: number | null } {
  const leftCases = cases(run, left, budget);
  const rightCases = cases(run, right, budget);
  const leftRequired = mean(leftCases.map((item) => item.requiredSymbolRecall));
  const rightRequired = mean(rightCases.map((item) => item.requiredSymbolRecall));
  const leftPrecision = mean(leftCases.map((item) => item.goldRangePrecision));
  const rightPrecision = mean(rightCases.map((item) => item.goldRangePrecision));
  return {
    requiredSymbolDelta: leftRequired === null || rightRequired === null ? null : leftRequired - rightRequired,
    precisionDelta: leftPrecision === null || rightPrecision === null ? null : leftPrecision - rightPrecision,
  };
}

function winTieLoss(run: QualityRun, baseline: SystemId, contextSystem: ContextSystem, budget: number): { wins: number; ties: number; losses: number } {
  const baselineByTask = new Map(cases(run, baseline, budget).map((item) => [taskKey(item), item]));
  let wins = 0;
  let ties = 0;
  let losses = 0;
  for (const context of cases(run, contextSystem, budget)) {
    const other = baselineByTask.get(taskKey(context));
    if (other === undefined) continue;
    const contextRequired = context.requiredSymbolRecall ?? -1;
    const otherRequired = other.requiredSymbolRecall ?? -1;
    const contextPrecision = context.goldRangePrecision ?? -1;
    const otherPrecision = other.goldRangePrecision ?? -1;
    if (contextRequired > otherRequired || (contextRequired === otherRequired && contextPrecision > otherPrecision)) wins += 1;
    else if (contextRequired === otherRequired && contextPrecision === otherPrecision) ties += 1;
    else losses += 1;
  }
  return { wins, ties, losses };
}

function breakdownRows(run: QualityRun, dimension: "difficulty" | "taskCategory" | "language"): unknown[] {
  const labels = dimension === "language"
    ? [...new Set(run.cases.flatMap((item) => item.languageTags))].sort()
    : [...new Set(run.cases.map((item) => item[dimension]))].sort();
  return labels.flatMap((label) => SYSTEM_IDS.map((systemId) => {
    const values = run.cases.filter((item) =>
      item.systemId === systemId && item.budget === 8_000 &&
      (dimension === "language" ? item.languageTags.includes(label) : item[dimension] === label),
    );
    return {
      label,
      systemId,
      tasks: values.length,
      requiredFileRecall: mean(values.map((item) => item.requiredFileRecall)),
      requiredSymbolRecall: mean(values.map((item) => item.requiredSymbolRecall)),
      precision: mean(values.map((item) => item.goldRangePrecision)),
    };
  }));
}

export function aggregateQualityRun(run: QualityRun): unknown {
  const fixedBudget = run.manifest.budgets.flatMap((budget) => SYSTEM_IDS.map((systemId) => {
    const values = cases(run, systemId, budget);
    return {
      budget,
      systemId,
      tasks: values.length,
      requiredFileRecall: mean(values.map((item) => item.requiredFileRecall)),
      requiredSymbolRecall: mean(values.map((item) => item.requiredSymbolRecall)),
      symbolRecall: mean(values.map((item) => item.symbolRecall)),
      overallGoldRecall: mean(values.map((item) => item.overallGoldRecall)),
      precision: mean(values.map((item) => item.goldRangePrecision)),
      noiseRatio: mean(values.map((item) => item.noiseRatio)),
      meanPayloadTokens: mean(values.map((item) => item.payloadTokens)),
      meanSerializationOverheadTokens: mean(values.map((item) => item.serializationOverheadTokens)),
    };
  }));
  const retrieval = SYSTEM_IDS.flatMap((systemId) => RETRIEVAL_CUTOFFS.map((cutoff) => {
    const values = cases(run, systemId, run.manifest.budgets[0] ?? 0);
    return {
      systemId,
      cutoff,
      requiredFileRecall: mean(values.map((item) => item.retrieval[String(cutoff)]?.requiredFileRecall ?? null)),
      requiredSymbolRecall: mean(values.map((item) => item.retrieval[String(cutoff)]?.requiredSymbolRecall ?? null)),
    };
  }));
  const matchedRecall = MATCHED_RECALL_TARGETS.flatMap((target) => SYSTEM_IDS.map((systemId) => ({ target, systemId, ...matchedRecallSummary(run, systemId, target) })));
  const tokenReduction = MATCHED_RECALL_TARGETS.flatMap((target) => (["contextforge-v1", "contextforge-v2", "contextforge-v2-relations"] as const).flatMap((contextSystem) =>
    (["lexical-full-file-v1", "structural-full-file-v1"] as const).map((baseline) => ({
      target,
      contextSystem,
      baseline,
      ...pairedReduction(run, baseline, contextSystem, target),
    })),
  ));
  return {
    benchmarkVersion: run.manifest.benchmarkVersion,
    datasetVersion: run.manifest.datasetVersion,
    datasetHash: run.manifest.datasetHash,
    fixedBudget,
    retrieval,
    matchedRecall,
    tokenReduction,
    attributionAt8K: {
      structuralRanking: comparison(run, "structural-full-file-v1", "lexical-full-file-v1", 8_000),
      contextPacking: comparison(run, "contextforge-v1", "structural-full-file-v1", 8_000),
      retrievalV2WithPackV1: comparison(run, "contextforge-v2", "contextforge-v1", 8_000),
      relationshipV2WithPackV1: comparison(run, "contextforge-v2-relations", "contextforge-v2", 8_000),
    },
    winTieLossAt8K: {
      contextforgeV1VersusLexical: winTieLoss(run, "lexical-full-file-v1", "contextforge-v1", 8_000),
      contextforgeV1VersusStructuralFullFile: winTieLoss(run, "structural-full-file-v1", "contextforge-v1", 8_000),
      contextforgeV2VersusV1: winTieLoss(run, "contextforge-v1", "contextforge-v2", 8_000),
      contextforgeV2VersusLexical: winTieLoss(run, "lexical-full-file-v1", "contextforge-v2", 8_000),
      contextforgeV2RelationsVersusV2: winTieLoss(run, "contextforge-v2", "contextforge-v2-relations", 8_000),
    },
    breakdown: {
      language: breakdownRows(run, "language"),
      category: breakdownRows(run, "taskCategory"),
      difficulty: breakdownRows(run, "difficulty"),
    },
  };
}

function matchedRecallSummary(run: QualityRun, systemId: SystemId, target: number): { reached: number; total: number; meanTokens: number | null } {
  return matchedRecall(run, systemId, target);
}

function retrievalTable(run: QualityRun): string[] {
  const lines = ["| System | K | Required file recall | Required symbol recall |", "|---|---:|---:|---:|"];
  for (const systemId of SYSTEM_IDS) {
    const unique = cases(run, systemId, run.manifest.budgets[0] ?? 0);
    for (const cutoff of RETRIEVAL_CUTOFFS.filter((item) => item <= 10)) {
      lines.push(`| ${systemId} | ${cutoff} | ${format(mean(unique.map((item) => item.retrieval[String(cutoff)]?.requiredFileRecall ?? null)))} | ${format(mean(unique.map((item) => item.retrieval[String(cutoff)]?.requiredSymbolRecall ?? null)))} |`);
    }
  }
  return lines;
}

function fixedBudgetTable(run: QualityRun): string[] {
  const lines = ["| Budget | System | Required file | Required symbol | Overall symbol | Overall Gold | Precision | Noise | Mean payload tokens |", "|---:|---|---:|---:|---:|---:|---:|---:|---:|"];
  for (const budget of QUALITY_BUDGETS.filter((item) => run.manifest.budgets.includes(item))) {
    for (const systemId of SYSTEM_IDS) {
      const values = cases(run, systemId, budget);
      lines.push(`| ${budget} | ${systemId} | ${format(mean(values.map((item) => item.requiredFileRecall)))} | ${format(mean(values.map((item) => item.requiredSymbolRecall)))} | ${format(mean(values.map((item) => item.symbolRecall)))} | ${format(mean(values.map((item) => item.overallGoldRecall)))} | ${format(mean(values.map((item) => item.goldRangePrecision)))} | ${format(mean(values.map((item) => item.noiseRatio)))} | ${format(mean(values.map((item) => item.payloadTokens)))} |`);
    }
  }
  return lines;
}

function breakdown(run: QualityRun, field: "difficulty" | "taskCategory"): string[] {
  const labels = [...new Set(run.cases.map((item) => item[field]))].sort();
  const lines = [`| ${field} | System | Required symbol @8K | Precision @8K |`, "|---|---|---:|---:|"];
  for (const label of labels) {
    for (const systemId of SYSTEM_IDS) {
      const values = run.cases.filter((item) => item[field] === label && item.systemId === systemId && item.budget === 8_000);
      lines.push(`| ${label} | ${systemId} | ${format(mean(values.map((item) => item.requiredSymbolRecall)))} | ${format(mean(values.map((item) => item.goldRangePrecision)))} |`);
    }
  }
  return lines;
}

function languageBreakdown(run: QualityRun): string[] {
  const rows = breakdownRows(run, "language") as { label: string; systemId: SystemId; requiredSymbolRecall: number | null; precision: number | null }[];
  return [
    "| Language tag | System | Required symbol @8K | Precision @8K |",
    "|---|---|---:|---:|",
    ...rows.map((row) => `| ${row.label} | ${row.systemId} | ${format(row.requiredSymbolRecall)} | ${format(row.precision)} |`),
  ];
}

export function renderBenchmarkReport(run: QualityRun): string {
  const contextAtEight = cases(run, "contextforge-v2-relations", 8_000);
  const lexicalAtEight = new Map(cases(run, "lexical-full-file-v1", 8_000).map((item) => [taskKey(item), item]));
  const worstAtEight = [...contextAtEight].sort((left, right) => {
    const leftMisses = left.missedRequiredFiles.length + left.missedRequiredSymbols.length;
    const rightMisses = right.missedRequiredFiles.length + right.missedRequiredSymbols.length;
    const leftLexical = lexicalAtEight.get(taskKey(left));
    const rightLexical = lexicalAtEight.get(taskKey(right));
    const leftRequiredDelta = (left.requiredSymbolRecall ?? -1) - (leftLexical?.requiredSymbolRecall ?? -1);
    const rightRequiredDelta = (right.requiredSymbolRecall ?? -1) - (rightLexical?.requiredSymbolRecall ?? -1);
    const leftPrecisionDelta = (left.goldRangePrecision ?? -1) - (leftLexical?.goldRangePrecision ?? -1);
    const rightPrecisionDelta = (right.goldRangePrecision ?? -1) - (rightLexical?.goldRangePrecision ?? -1);
    return rightMisses - leftMisses || leftRequiredDelta - rightRequiredDelta || leftPrecisionDelta - rightPrecisionDelta || compareText(left.taskId, right.taskId);
  });
  const bestAtEight = contextAtEight.filter((context) => {
    const lexical = lexicalAtEight.get(taskKey(context));
    if (lexical === undefined) return false;
    const contextRequired = context.requiredSymbolRecall ?? -1;
    const lexicalRequired = lexical.requiredSymbolRecall ?? -1;
    return contextRequired > lexicalRequired ||
      (contextRequired === lexicalRequired && (context.goldRangePrecision ?? -1) > (lexical.goldRangePrecision ?? -1));
  }).sort((left, right) => {
    const leftLexical = lexicalAtEight.get(taskKey(left));
    const rightLexical = lexicalAtEight.get(taskKey(right));
    const leftRequiredDelta = (left.requiredSymbolRecall ?? -1) - (leftLexical?.requiredSymbolRecall ?? -1);
    const rightRequiredDelta = (right.requiredSymbolRecall ?? -1) - (rightLexical?.requiredSymbolRecall ?? -1);
    const leftPrecisionDelta = (left.goldRangePrecision ?? -1) - (leftLexical?.goldRangePrecision ?? -1);
    const rightPrecisionDelta = (right.goldRangePrecision ?? -1) - (rightLexical?.goldRangePrecision ?? -1);
    return rightRequiredDelta - leftRequiredDelta || rightPrecisionDelta - leftPrecisionDelta || compareText(left.taskId, right.taskId);
  });
  const lines = [
    run.manifest.systems.includes("contextforge-v2-plan-pack")
      ? "# ContextForge V0.2-04 Plan-aware Packing Results"
      : "# ContextForge V0.2-03 Relationship Intelligence Results",
    "",
    `Benchmark: ${run.manifest.benchmarkVersion}`,
    `Evaluation: ${run.manifest.evaluationVersion ?? "legacy-v1"}`,
    `Dataset: ${run.manifest.datasetVersion}`,
    `Dataset hash: ${run.manifest.datasetHash}`,
    `Benchmarked commit: ${run.manifest.contextforgeCommit}`,
    `Mode: ${run.manifest.runMode}`,
    `Tasks: ${run.manifest.taskCount}`,
    `Repositories: ${run.manifest.repositoryCount}`,
    "",
    "Quality metrics are deterministic and source-free. Latency is reported separately.",
    "",
    "## Retrieval",
    "",
    ...retrievalTable(run),
    "",
    "## Fixed-budget quality",
    "",
    ...fixedBudgetTable(run),
    "",
    "## Tokens at matched required-symbol recall",
    "",
    "| Target | System | Tasks reached | Mean actual payload tokens |",
    "|---:|---|---:|---:|",
  ];
  for (const target of MATCHED_RECALL_TARGETS) {
    for (const systemId of SYSTEM_IDS) {
      const matched = matchedRecall(run, systemId, target);
      lines.push(`| ${(target * 100).toFixed(0)}% | ${systemId} | ${matched.reached}/${matched.total} | ${format(matched.meanTokens)} |`);
    }
  }
  lines.push(
    "",
    "## Matched-recall token reduction",
    "",
    "| Target | Context system | Baseline | Paired tasks | Mean baseline tokens | Mean ContextForge tokens | Macro mean reduction |",
    "|---:|---|---|---:|---:|---:|---:|",
  );
  for (const target of MATCHED_RECALL_TARGETS) {
    for (const contextSystem of ["contextforge-v1", "contextforge-v2", "contextforge-v2-relations"] as const) {
      for (const baseline of ["lexical-full-file-v1", "structural-full-file-v1"] as const) {
        const reduction = pairedReduction(run, baseline, contextSystem, target);
        lines.push(`| ${(target * 100).toFixed(0)}% | ${contextSystem} | ${baseline} | ${reduction.tasks} | ${format(reduction.baselineMeanTokens)} | ${format(reduction.contextforgeMeanTokens)} | ${reduction.reduction === null ? "NOT AVAILABLE" : `${(reduction.reduction * 100).toFixed(1)}%`} |`);
      }
    }
  }
  const structuralValue = comparison(run, "structural-full-file-v1", "lexical-full-file-v1", 8_000);
  const packingValue = comparison(run, "contextforge-v1", "structural-full-file-v1", 8_000);
  const retrievalV2Value = comparison(run, "contextforge-v2", "contextforge-v1", 8_000);
  const relationshipValue = comparison(run, "contextforge-v2-relations", "contextforge-v2", 8_000);
  const planPackValue = comparison(run, "contextforge-v2-plan-pack", "contextforge-v2-relations", 8_000);
  const versusLexical = winTieLoss(run, "lexical-full-file-v1", "contextforge-v2-relations", 8_000);
  const versusV1 = winTieLoss(run, "contextforge-v1", "contextforge-v2-relations", 8_000);
  const versusV2 = winTieLoss(run, "contextforge-v2", "contextforge-v2-relations", 8_000);
  lines.push(
    "",
    "Reductions are macro means over paired tasks only; negative values mean ContextForge used more estimated payload tokens. `NOT AVAILABLE` means no paired task reached the target.",
    "",
    "## Attribution at 8K",
    "",
    ...(run.manifest.systems.includes("contextforge-v2-plan-pack") ? [
      `Plan-aware Pack V2 vs identical relationship retrieval + Pack V1 — required-symbol recall delta: ${format(planPackValue.requiredSymbolDelta)}; precision delta: ${format(planPackValue.precisionDelta)}.`,
      "",
    ] : []),
    `Structural ranking vs lexical full-file — required-symbol recall delta: ${format(structuralValue.requiredSymbolDelta)}; precision delta: ${format(structuralValue.precisionDelta)}.`,
    "",
    `ContextForge packing vs structural full-file — required-symbol recall delta: ${format(packingValue.requiredSymbolDelta)}; precision delta: ${format(packingValue.precisionDelta)}.`,
    "",
    `Retrieval V2 + Pack V1 vs ContextForge V1 — required-symbol recall delta: ${format(retrievalV2Value.requiredSymbolDelta)}; precision delta: ${format(retrievalV2Value.precisionDelta)}.`,
    "",
    `Relationship V2 + Pack V1 vs foundation V2 — required-symbol recall delta: ${format(relationshipValue.requiredSymbolDelta)}; precision delta: ${format(relationshipValue.precisionDelta)}.`,
    "",
    `Relationship V2 win/tie/loss vs lexical: ${versusLexical.wins}/${versusLexical.ties}/${versusLexical.losses}.`,
    `Relationship V2 win/tie/loss vs ContextForge V1: ${versusV1.wins}/${versusV1.ties}/${versusV1.losses}.`,
    `Relationship V2 win/tie/loss vs foundation V2: ${versusV2.wins}/${versusV2.ties}/${versusV2.losses}.`,
    "",
    "## Language breakdown",
    "",
    ...languageBreakdown(run),
    "",
    "## Difficulty breakdown",
    "",
    ...breakdown(run, "difficulty"),
    "",
    "## Task-category breakdown",
    "",
    ...breakdown(run, "taskCategory"),
    "",
    "## Worst relationship-enabled ContextForge V2 cases at 8K",
    "",
    "| Task | Required file | Required symbol | Missed required context | Attribution |",
    "|---|---:|---:|---|---|",
  );
  for (const item of worstAtEight.slice(0, 5)) {
    lines.push(`| ${item.taskId} | ${format(item.requiredFileRecall)} | ${format(item.requiredSymbolRecall)} | ${[...item.missedRequiredFiles, ...item.missedRequiredSymbols].join(", ") || "none"} | ${item.failureAttribution.join(", ") || "none"} |`);
  }
  lines.push(
    "",
    "## Notable relationship-enabled V2 wins versus lexical full-file at 8K",
    "",
    "| Task | ContextForge required symbol | Lexical required symbol | ContextForge precision | Lexical precision |",
    "|---|---:|---:|---:|---:|",
  );
  for (const item of bestAtEight.slice(0, 5)) {
    const lexical = lexicalAtEight.get(taskKey(item));
    if (lexical !== undefined) {
      lines.push(`| ${item.taskId} | ${format(item.requiredSymbolRecall)} | ${format(lexical.requiredSymbolRecall)} | ${format(item.goldRangePrecision)} | ${format(lexical.goldRangePrecision)} |`);
    }
  }
  lines.push(
    "",
    "## Integrity and limitations",
    "",
    "- Gold is evaluator-only and was manually authored from repository behavior before the formal score run.",
    "- All systems use the same materialized snapshot, task, estimator, safety boundary, and hard serialized budget.",
    "- `lexical-full-file-v1` uses only task normalization, path/symbol/source lexical evidence, and whole files.",
    "- `structural-full-file-v1` uses production V1 structural ranking and whole files; `contextforge-v1` uses V1 retrieval and Pack V1.",
    "- `contextforge-v2` uses the shared Retrieval V2 application path with unchanged Pack V1 and the unchanged estimator.",
    ...(run.manifest.systems.includes("contextforge-v2-plan-pack") ? ["- `contextforge-v2-plan-pack` uses the same relationship retrieval with experimental Plan-aware Pack V2; public CLI/MCP defaults remain V1."] : []),
    "- `contextforge-v2-relations` adds bounded distance-1 relationship evidence through the same Retrieval V2 fusion/ranking path; it does not claim a complete call graph, test coverage, or sound whole-program impact analysis.",
    "- This finite self/curated dataset may contain self-repository and fixture-authoring bias.",
    "- The generic estimator is not a model tokenizer; no coding agent, LLM judge, network, embedding, or corpus code execution is involved.",
    "- TypeScript aliases, advanced Python imports, pure synonym retrieval, large external repositories, and cross-platform benchmark execution remain limitations or untested paths.",
    "",
  );
  return lines.join("\n");
}
