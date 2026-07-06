import Papa from "papaparse";
import type { FineTuneSignal, GoldenDataset, GoldenDatasetCalibration, GoldenDatasetCalibrationRow, GoldenDatasetRow, Trace, TraceJudgeResult } from "../types";

export const EXTRA_CONTEXT_TOKEN_THRESHOLD = 1200;
const STABLE_PATTERN_MIN_TRACES = 6;
const TOKEN_CHARS = 4;

const normalizeCell = (value: unknown) => {
  if (value === undefined || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    if (trimmed.toLowerCase() === "true") return true;
    if (trimmed.toLowerCase() === "false") return false;
    return trimmed;
  }
  return value as GoldenDatasetRow[string];
};

export function parseGoldenDatasetCsv(text: string, name: string, now = new Date()): GoldenDataset {
  const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), normalizeCell(value)]).filter(([key]) => key)),
  ) as GoldenDatasetRow[];
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (!rows.length) throw new Error("CSV must include at least one data row.");
  if (!columns.length) throw new Error("CSV must include headers.");
  return {
    id: `golden_${now.getTime()}`,
    name,
    created_at: now.toISOString(),
    row_count: rows.length,
    columns,
    rows,
  };
}

export function updateGoldenDatasetCell(dataset: GoldenDataset, rowIndex: number, column: string, value: string): GoldenDataset {
  const rows = dataset.rows.map((row, index) => index === rowIndex ? { ...row, [column]: normalizeCell(value) } : row);
  return { ...dataset, rows, row_count: rows.length, columns: Array.from(new Set([...dataset.columns, column])) };
}

const simulatedGoldenColumns = ["trace_id", "task_type", "model", "prompt", "agent_answer", "human_answer", "human_passed", "human_score", "human_severity", "human_rationale"];
const simulatedGoldenTaskTypes = ["customer_support_responses", "rag_grounded_answers", "policy_compliance_reasoning", "document_review_legal_analysis"];

const humanOverride = (judge: TraceJudgeResult, index: number) => {
  if (index % 13 === 0) return { passed: !judge.passed, score: judge.passed ? .5 : 1, severity: judge.passed ? "major" : "" };
  if (index % 17 === 0) return { passed: false, score: .5, severity: "major" };
  return { passed: judge.passed, score: judge.score, severity: judge.severity ?? "" };
};

export function createSimulatedGoldenDataset(traces: Trace[], judgeResults: TraceJudgeResult[], now = new Date("2026-06-24T00:00:00.000Z")): GoldenDataset {
  const judgeByTraceId = new Map(judgeResults.map((result) => [result.trace_id, result]));
  const selected = simulatedGoldenTaskTypes.flatMap((taskType) =>
    traces.filter((trace) => trace.metadata?.task_type === taskType).slice(0, 8),
  );
  const rows = selected.map((trace, index): GoldenDatasetRow => {
    const judge = judgeByTraceId.get(trace.id);
    const human = judge ? humanOverride(judge, index) : { passed: true, score: 1, severity: "" };
    return {
      trace_id: trace.id,
      task_type: String(trace.metadata?.task_type ?? ""),
      model: trace.model,
      prompt: trace.prompt_text,
      agent_answer: trace.response_text ?? "",
      human_answer: String(trace.metadata?._internal_reference ?? trace.response_text ?? ""),
      human_passed: human.passed,
      human_score: human.score,
      human_severity: human.severity,
      human_rationale: human.passed
        ? "Human reviewer marked this answer acceptable against the expected support outcome."
        : "Human reviewer marked this answer insufficient because it misses a required fact, policy constraint, or safe escalation.",
    };
  });
  return {
    id: "golden_routelab_simulated",
    name: "routelab-simulated-golden-dataset.csv",
    created_at: now.toISOString(),
    row_count: rows.length,
    columns: simulatedGoldenColumns,
    rows,
  };
}

const readString = (row: GoldenDatasetRow, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
};

const readNumber = (row: GoldenDatasetRow, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
};

const readBoolean = (row: GoldenDatasetRow, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value > 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "pass", "passed", "yes", "1"].includes(normalized)) return true;
      if (["false", "fail", "failed", "no", "0"].includes(normalized)) return false;
    }
  }
  return undefined;
};

const readSeverity = (row: GoldenDatasetRow) => {
  const severity = readString(row, ["human_severity", "severity", "expected_severity"]).toLowerCase();
  return severity === "minor" || severity === "major" || severity === "critical" ? severity : undefined;
};

const pct = (numerator: number, denominator: number) => denominator ? numerator / denominator * 100 : 0;

export function calibrateGoldenDataset(dataset: GoldenDataset | undefined, traces: Trace[], judgeResults: TraceJudgeResult[]): GoldenDatasetCalibration {
  const traceById = new Map(traces.map((trace) => [trace.id, trace]));
  const judgeByTraceId = new Map(judgeResults.map((result) => [result.trace_id, result]));
  const rows = (dataset?.rows ?? []).map((row): GoldenDatasetCalibrationRow | null => {
    const traceId = readString(row, ["trace_id", "id"]);
    if (!traceId) return null;
    const trace = traceById.get(traceId);
    const judge = judgeByTraceId.get(traceId);
    const humanScore = readNumber(row, ["human_score", "score", "expected_score"]);
    const humanPassed = readBoolean(row, ["human_passed", "passed", "expected_passed", "label"]);
    const humanSeverity = readSeverity(row);
    const humanAnswer = readString(row, ["human_answer", "reference_answer", "gold_answer"]);
    const agentAnswer = readString(row, ["agent_answer", "response", "actual_answer"]) || trace?.response_text || "";
    const agreement = humanPassed === undefined || judge === undefined ? undefined : humanPassed === judge.passed;
    return {
      trace_id: traceId,
      prompt: readString(row, ["prompt", "prompt_text"]) || trace?.prompt_text || "",
      agent_answer: agentAnswer,
      human_answer: humanAnswer || String(trace?.metadata?._internal_reference ?? ""),
      human_passed: humanPassed,
      human_score: humanScore,
      human_severity: humanSeverity,
      judge_passed: judge?.passed,
      judge_score: judge?.score,
      judge_severity: judge?.severity,
      judge_rationale: judge?.rationale,
      agreement,
      score_delta: humanScore === undefined || judge === undefined ? undefined : judge.score - humanScore,
    };
  }).filter((row): row is GoldenDatasetCalibrationRow => row !== null);

  const comparable = rows.filter((row) => row.human_passed !== undefined && row.judge_passed !== undefined);
  const scoreComparable = rows.filter((row) => row.score_delta !== undefined);
  const severityComparable = rows.filter((row) => row.human_severity && row.judge_severity);
  const disagreements = comparable.filter((row) => row.agreement === false);
  return {
    matched_rows: rows.length,
    coverage_pct: pct(rows.filter((row) => row.judge_passed !== undefined).length, dataset?.row_count ?? 0),
    agreement_rate: pct(comparable.filter((row) => row.agreement).length, comparable.length),
    false_pass_rate: pct(comparable.filter((row) => row.human_passed === false && row.judge_passed === true).length, comparable.length),
    false_fail_rate: pct(comparable.filter((row) => row.human_passed === true && row.judge_passed === false).length, comparable.length),
    avg_score_delta: scoreComparable.length ? scoreComparable.reduce((sum, row) => sum + Math.abs(row.score_delta ?? 0), 0) / scoreComparable.length : 0,
    severity_agreement_rate: pct(severityComparable.filter((row) => row.human_severity === row.judge_severity).length, severityComparable.length),
    disagreements,
    rows,
  };
}

export function analyzeFineTuneOpportunity(traces: Trace[], thresholdTokens = EXTRA_CONTEXT_TOKEN_THRESHOLD): FineTuneSignal {
  const contextHeavy = traces.filter((trace) => {
    const prompt = trace.prompt_text.toLowerCase();
    const estimatedContextTokens = Math.max(trace.input_tokens, Math.ceil(trace.prompt_text.length / TOKEN_CHARS));
    const hasExtraContext = /few-shot|few shot|example|examples|instruction|instructions|context \[|retrieved context|policy/.test(prompt);
    return hasExtraContext && estimatedContextTokens >= thresholdTokens;
  });
  const stablePatterns = new Map<string, number>();
  contextHeavy.forEach((trace) => {
    const key = String(trace.metadata?.task_type ?? trace.workflow_role ?? trace.model ?? "unknown");
    stablePatterns.set(key, (stablePatterns.get(key) ?? 0) + 1);
  });
  const stablePatternCount = [...stablePatterns.values()].filter((count) => count >= STABLE_PATTERN_MIN_TRACES).length;
  const avgContextTokens = contextHeavy.length ? Math.round(contextHeavy.reduce((sum, trace) => sum + Math.max(trace.input_tokens, Math.ceil(trace.prompt_text.length / TOKEN_CHARS)), 0) / contextHeavy.length) : 0;
  const shouldSuggest = contextHeavy.length >= STABLE_PATTERN_MIN_TRACES && stablePatternCount > 0;
  return {
    should_suggest: shouldSuggest,
    threshold_tokens: thresholdTokens,
    matching_traces: contextHeavy.length,
    total_traces: traces.length,
    stable_pattern_count: stablePatternCount,
    estimated_context_tokens: avgContextTokens,
    reason: shouldSuggest
      ? `${contextHeavy.length} traces repeatedly include extra context above ${thresholdTokens.toLocaleString()} tokens across ${stablePatternCount} stable pattern${stablePatternCount === 1 ? "" : "s"}. Fine-tuning could move instructions and examples into weights and reduce token cost.`
      : `No stable context-heavy pattern currently exceeds ${thresholdTokens.toLocaleString()} tokens often enough to recommend fine-tuning.`,
  };
}
