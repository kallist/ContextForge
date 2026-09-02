import { createHash } from "node:crypto";

import type { IndexedFile } from "./repository-index.js";
import { normalizeSearchTerm, normalizeTaskQuery, type QuerySignal } from "./task-query.js";

export const TASK_ANALYSIS_SCHEMA_VERSION = "1.0";
export const TASK_ANALYSIS_STRATEGY = "contextforge-task-analysis-v2";
export const MAXIMUM_TASK_CONCEPTS = 16;
export const MAXIMUM_TASK_RISK_SIGNALS = 16;
export const MAXIMUM_TASK_DIAGNOSTICS = 32;

export type TaskAction = "FIX" | "CHANGE" | "REFACTOR" | "TEST" | "REVIEW" | "UNDERSTAND";
export type TaskMode =
  | "EXACT_TARGET"
  | "BEHAVIORAL"
  | "TEST_FAILURE"
  | "CONFIGURATION"
  | "CONCURRENCY"
  | "ARCHITECTURE"
  | "GENERAL";

export type TaskSignalKind =
  | "PATH"
  | "FILE_NAME"
  | "QUALIFIED_SYMBOL"
  | "SYMBOL"
  | "ERROR_IDENTIFIER"
  | "TECHNICAL_LITERAL"
  | "CONFIG_KEY"
  | "NATURAL_TERM"
  | "CJK_TERM";

export type TaskConcept =
  | "STATE_MUTATION"
  | "CONCURRENCY"
  | "TRANSACTION_OR_LOCK"
  | "CONFIGURATION"
  | "TEST_BEHAVIOR"
  | "API_BOUNDARY"
  | "DOCUMENTATION"
  | "PACKAGING"
  | "STALE_SOURCE";

export type TaskRiskKind = "CONCURRENCY" | "STALE_SOURCE" | "CONFIGURATION_VALIDATION" | "PUBLIC_CONTRACT";
export type SignalAmbiguity = "UNKNOWN" | "UNIQUE" | "COLLIDING";

export interface TaskSignal {
  readonly id: string;
  readonly kind: TaskSignalKind;
  readonly value: string;
  readonly normalized: string;
  readonly provenance: "EXPLICIT" | "DERIVED";
  readonly derivedFrom: string | null;
  readonly specificity: "EXACT" | "TECHNICAL" | "GENERAL";
  readonly ambiguity: SignalAmbiguity;
  readonly repositoryMatches: number;
  readonly lowValue: boolean;
}

export interface TaskRiskSignal {
  readonly kind: TaskRiskKind;
  readonly evidence: readonly TaskConcept[];
  readonly detail: string;
}

export interface TaskAnalysis {
  readonly schemaVersion: typeof TASK_ANALYSIS_SCHEMA_VERSION;
  readonly strategy: typeof TASK_ANALYSIS_STRATEGY;
  /** Request-scoped untrusted input. It is never persisted by ContextForge. */
  readonly task: string;
  readonly action: TaskAction;
  readonly mode: TaskMode;
  readonly signals: readonly TaskSignal[];
  readonly concepts: readonly TaskConcept[];
  readonly riskSignals: readonly TaskRiskSignal[];
  readonly diagnostics: readonly string[];
}

const TECHNICAL_KINDS = new Set<TaskSignalKind>([
  "PATH",
  "FILE_NAME",
  "QUALIFIED_SYMBOL",
  "SYMBOL",
  "ERROR_IDENTIFIER",
  "TECHNICAL_LITERAL",
  "CONFIG_KEY",
]);

const CONFIG_CONTEXT = /\b(?:config(?:uration)?|setting|schema|default|manifest|environment|env(?:ironment)?|ttl|timeout)\b|配置|设置|默认|环境/iu;
const CONFIG_KEY_SHAPE = /^(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[a-z][a-z0-9]*(?:[.-][a-z0-9_-]+)+)$/u;
const QUOTED_VALUE = /(["'`])([^"'`\r\n]{1,256})\1/gu;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function signalId(signal: Omit<TaskSignal, "id" | "ambiguity" | "repositoryMatches">): string {
  const identity = [signal.kind, signal.normalized, signal.provenance, signal.derivedFrom ?? ""].join("\u0000");
  return `task_signal_${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
}

function quotedValues(task: string): ReadonlySet<string> {
  return new Set([...task.matchAll(QUOTED_VALUE)].flatMap((match) => match[2] === undefined ? [] : [normalizeSearchTerm(match[2])]));
}

function v2Kind(signal: QuerySignal, task: string): TaskSignalKind {
  switch (signal.kind) {
    case "PATH": return "PATH";
    case "FILE_NAME": return "FILE_NAME";
    case "QUALIFIED_IDENTIFIER": return "QUALIFIED_SYMBOL";
    case "IDENTIFIER": return "SYMBOL";
    case "ERROR_LITERAL": return CONFIG_CONTEXT.test(task) && CONFIG_KEY_SHAPE.test(signal.value) ? "CONFIG_KEY" : "ERROR_IDENTIFIER";
    case "CODE_LITERAL":
    case "DOTTED_IDENTIFIER":
    case "NUMBER_LITERAL": return CONFIG_CONTEXT.test(task) && CONFIG_KEY_SHAPE.test(signal.value) ? "CONFIG_KEY" : "TECHNICAL_LITERAL";
    case "CJK_TERM": return "CJK_TERM";
    case "NATURAL_TERM": return "NATURAL_TERM";
  }
}

function actionFor(task: string): TaskAction {
  if (/\b(?:fix|repair|resolve|correct|bug|failure|failing|race|stale|revert)\b|修复|解决|错误|失败|竞态/iu.test(task)) return "FIX";
  if (/\b(?:refactor|rename|restructure|extract)\b|重构|重命名/iu.test(task)) return "REFACTOR";
  if (/\b(?:review|audit|assess|inspect)\b|审查|审核|评审/iu.test(task)) return "REVIEW";
  if (/\b(?:understand|explain|investigate|analy[sz]e|trace)\b|理解|解释|分析|调查/iu.test(task)) return "UNDERSTAND";
  if (/\b(?:test|spec|coverage|assert|regression)\b|测试|回归/iu.test(task)) return "TEST";
  return "CHANGE";
}

function conceptsFor(task: string): TaskConcept[] {
  const rules: readonly [TaskConcept, RegExp][] = [
    ["STATE_MUTATION", /\b(?:state|store|persist|write|mutat|update|save|delete)\w*\b|状态|持久化|写入|更新/iu],
    ["CONCURRENCY", /\b(?:concurren|race|parallel|atomic|thread|process|lock)\w*\b|并发|竞态|原子|锁/iu],
    ["TRANSACTION_OR_LOCK", /\b(?:transaction|BEGIN\s+IMMEDIATE|SELECT\s+FOR\s+UPDATE|mutex|semaphore|lock)\b|事务|锁/iu],
    ["CONFIGURATION", CONFIG_CONTEXT],
    ["TEST_BEHAVIOR", /\b(?:test|spec|assert|fixture|mock|regression|failing)\w*\b|测试|断言|夹具|回归|失败/iu],
    ["API_BOUNDARY", /\b(?:API|endpoint|route|controller|request|response|contract|CLI|MCP)\b|接口|端点|路由|契约/iu],
    ["DOCUMENTATION", /\b(?:architecture|ADR|design|document|README|specification)\b|架构|文档|设计|规范/iu],
    ["PACKAGING", /\b(?:package|publish|tarball|npm|asset|bundle|distribution)\w*\b|打包|发布|资产/iu],
    ["STALE_SOURCE", /\b(?:stale|snapshot|generation|hash\s*mismatch|out[- ]of[- ]date)\b|陈旧|快照|代次|哈希不匹配/iu],
  ];
  return rules.filter(([, pattern]) => pattern.test(task)).map(([concept]) => concept).slice(0, MAXIMUM_TASK_CONCEPTS);
}

function modeFor(task: string, concepts: readonly TaskConcept[], signals: readonly TaskSignal[]): TaskMode {
  if (/\b(?:test|spec)\b.{0,32}\b(?:fail|failure|broken|error)\w*\b|\b(?:fail|failure|broken)\w*\b.{0,32}\b(?:test|spec)\b|测试.{0,12}(?:失败|错误)/iu.test(task)) return "TEST_FAILURE";
  if (concepts.includes("CONCURRENCY") || concepts.includes("TRANSACTION_OR_LOCK")) return "CONCURRENCY";
  if (concepts.includes("CONFIGURATION")) return "CONFIGURATION";
  if (concepts.includes("DOCUMENTATION")) return "ARCHITECTURE";
  if (signals.some((signal) => signal.specificity === "EXACT" || signal.kind === "PATH" || signal.kind === "QUALIFIED_SYMBOL")) return "EXACT_TARGET";
  if (signals.some((signal) => !signal.lowValue && signal.specificity !== "GENERAL")) return "BEHAVIORAL";
  return "GENERAL";
}

function risksFor(concepts: readonly TaskConcept[]): TaskRiskSignal[] {
  const risks: TaskRiskSignal[] = [];
  if (concepts.includes("CONCURRENCY") || concepts.includes("TRANSACTION_OR_LOCK")) {
    risks.push({ kind: "CONCURRENCY", evidence: concepts.filter((item) => item === "CONCURRENCY" || item === "TRANSACTION_OR_LOCK"), detail: "Concurrent mutation or transaction behavior is explicit in the task." });
  }
  if (concepts.includes("STALE_SOURCE")) {
    risks.push({ kind: "STALE_SOURCE", evidence: ["STALE_SOURCE"], detail: "Snapshot or stale-source behavior is explicit in the task." });
  }
  if (concepts.includes("CONFIGURATION")) {
    risks.push({ kind: "CONFIGURATION_VALIDATION", evidence: ["CONFIGURATION"], detail: "Configuration defaults, validation, or consumption may define behavior." });
  }
  if (concepts.includes("API_BOUNDARY")) {
    risks.push({ kind: "PUBLIC_CONTRACT", evidence: ["API_BOUNDARY"], detail: "A public adapter or contract boundary is explicit in the task." });
  }
  return risks.slice(0, MAXIMUM_TASK_RISK_SIGNALS);
}

export function analyzeTask(rawTask: string): TaskAnalysis {
  const query = normalizeTaskQuery(rawTask);
  const quoted = quotedValues(rawTask);
  const signals = query.signals.map((signal): TaskSignal => {
    const kind = v2Kind(signal, rawTask);
    const specificity = quoted.has(signal.normalized)
      ? "EXACT"
      : TECHNICAL_KINDS.has(kind)
        ? "TECHNICAL"
        : "GENERAL";
    const base = {
      kind,
      value: signal.value,
      normalized: signal.normalized,
      provenance: signal.source,
      derivedFrom: signal.derivedFrom,
      specificity,
      lowValue: signal.lowValue,
    } as const;
    return { id: signalId(base), ...base, ambiguity: "UNKNOWN", repositoryMatches: 0 };
  });
  const concepts = conceptsFor(rawTask);
  const diagnostics = [
    ...(query.diagnostics.lowInformation ? ["TASK_LOW_INFORMATION"] : []),
    ...(query.diagnostics.controlCharacters > 0 ? ["TASK_CONTROL_CHARACTERS_REMOVED"] : []),
  ].sort(compareText).slice(0, MAXIMUM_TASK_DIAGNOSTICS);
  return {
    schemaVersion: TASK_ANALYSIS_SCHEMA_VERSION,
    strategy: TASK_ANALYSIS_STRATEGY,
    task: rawTask,
    action: actionFor(rawTask),
    mode: modeFor(rawTask, concepts, signals),
    signals,
    concepts,
    riskSignals: risksFor(concepts),
    diagnostics,
  };
}

function repositoryMatches(signal: TaskSignal, files: readonly IndexedFile[]): number {
  let matches = 0;
  const add = (): void => { matches = Math.min(257, matches + 1); };
  for (const file of files) {
    if (signal.kind === "PATH" && normalizeSearchTerm(file.relativePath) === signal.normalized) add();
    if (signal.kind === "FILE_NAME" && normalizeSearchTerm(file.relativePath.split("/").at(-1) ?? "") === signal.normalized) add();
    for (const symbol of file.analysis.symbols) {
      if (signal.kind === "QUALIFIED_SYMBOL" && normalizeSearchTerm(symbol.qualifiedName) === signal.normalized) add();
      if ((signal.kind === "SYMBOL" || signal.kind === "NATURAL_TERM") && normalizeSearchTerm(symbol.name) === signal.normalized) add();
    }
  }
  return matches;
}

export function resolveTaskAnalysisAmbiguity(analysis: TaskAnalysis, files: readonly IndexedFile[]): TaskAnalysis {
  const signals = analysis.signals.map((signal): TaskSignal => {
    const matches = repositoryMatches(signal, files);
    return {
      ...signal,
      ambiguity: matches === 0 ? "UNKNOWN" : matches === 1 ? "UNIQUE" : "COLLIDING",
      repositoryMatches: matches,
    };
  });
  const collisions = signals.filter((signal) => signal.ambiguity === "COLLIDING").length;
  const diagnostics = [...analysis.diagnostics, ...(collisions > 0 ? [`TASK_SIGNAL_COLLISIONS:${collisions}`] : [])]
    .sort(compareText)
    .slice(0, MAXIMUM_TASK_DIAGNOSTICS);
  return { ...analysis, signals, diagnostics };
}
