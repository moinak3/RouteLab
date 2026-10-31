import Papa from "papaparse";
import { goldenEvidenceFieldsFromTrace, goldenEvidenceMatchesTrace } from "./evaluationEvidence";
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

export function adjudicateGoldenDataset(
  dataset: GoldenDataset,
  trace: Trace,
  judge: TraceJudgeResult | undefined,
  humanPassed: boolean,
): GoldenDataset {
  const existingIndex = dataset.rows.findIndex((row) => String(row.trace_id ?? row.id ?? "") === trace.id);
  const humanScore = humanPassed ? 1 : judge?.passed === false ? judge.score : .5;
  const humanSeverity = humanPassed ? null : judge?.severity ?? "major";
  const agreement = judge ? judge.passed === humanPassed : undefined;
  const humanRationale = judge
    ? agreement
      ? `Human reviewer confirmed the automated ${humanPassed ? "pass" : "failure"}.`
      : `Human reviewer overruled the automated ${judge.passed ? "pass" : "failure"} and marked the response ${humanPassed ? "acceptable" : "incorrect or incomplete"}.`
    : `Human reviewer marked the response ${humanPassed ? "acceptable" : "incorrect or incomplete"}.`;
  const row: GoldenDatasetRow = {
    ...(existingIndex >= 0 ? dataset.rows[existingIndex] : {}),
    ...goldenEvidenceFieldsFromTrace(trace),
    trace_id: trace.id,
    task_type: String(trace.metadata?.task_type ?? ""),
    model: trace.model,
    prompt: trace.prompt_text,
    agent_answer: trace.response_text ?? "",
    human_answer: String(trace.metadata?._internal_reference ?? ""),
    human_passed: humanPassed,
    human_score: humanScore,
    human_severity: humanSeverity,
    human_rationale: humanRationale,
  };
  const rows = existingIndex >= 0
    ? dataset.rows.map((existing, index) => index === existingIndex ? row : existing)
    : [...dataset.rows, row];
  const columns = Array.from(new Set([...dataset.columns, ...Object.keys(row)]));
  return { ...dataset, rows, row_count: rows.length, columns };
}

const simulatedGoldenColumns = ["evidence_schema_version", "evaluation_scope", "evidence_fingerprint", "trace_id", "task_type", "model", "user_request", "system_instructions_json", "prior_conversation_json", "available_tools_json", "retrieved_context_json", "execution_spans_json", "tool_calls_json", "tool_results_json", "prompt", "agent_answer", "trajectory_status", "workflow_json", "evidence_metadata_json", "human_answer", "human_passed", "human_score", "human_severity", "human_rationale"];
const simulatedGoldenTaskTypes = ["customer_support_responses", "rag_grounded_answers", "policy_compliance_reasoning", "document_review_legal_analysis"];

const normalizedAnswer = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

const readSeedHumanLabel = (trace: Trace, judge: TraceJudgeResult | undefined) => {
  const passedValue = trace.metadata?._internal_human_passed;
  const scoreValue = Number(trace.metadata?._internal_human_score);
  const severityValue = String(trace.metadata?._internal_human_severity ?? "");
  const rationaleValue = String(trace.metadata?._internal_human_rationale ?? "");
  return {
    passed: typeof passedValue === "boolean" ? passedValue : judge?.passed ?? true,
    score: Number.isFinite(scoreValue) ? scoreValue : judge?.score ?? 1,
    severity: severityValue === "minor" || severityValue === "major" || severityValue === "critical"
      ? severityValue
      : "",
    rationale: rationaleValue || (judge?.passed
      ? "Human reviewer confirmed that the response satisfies the expected outcome."
      : "Human reviewer identified a material error in the response."),
  };
};

export function createSimulatedGoldenDataset(traces: Trace[], judgeResults: TraceJudgeResult[], now = new Date("2026-06-24T00:00:00.000Z")): GoldenDataset {
  const judgeByTraceId = new Map(judgeResults.map((result) => [result.trace_id, result]));
  const selected = simulatedGoldenTaskTypes.flatMap((taskType) =>
    traces.filter((trace) => trace.metadata?.task_type === taskType).slice(0, 8),
  );
  const rows = selected.map((trace): GoldenDatasetRow => {
    const judge = judgeByTraceId.get(trace.id);
    const human = readSeedHumanLabel(trace, judge);
    const agentAnswer = trace.response_text ?? "";
    const humanAnswer = String(trace.metadata?._internal_reference ?? trace.response_text ?? "");
    const answersMatch = normalizedAnswer(agentAnswer) === normalizedAnswer(humanAnswer);
    const humanPassed = answersMatch ? true : human.passed;
    return {
      ...goldenEvidenceFieldsFromTrace(trace),
      trace_id: trace.id,
      task_type: String(trace.metadata?.task_type ?? ""),
      model: trace.model,
      prompt: trace.prompt_text,
      agent_answer: agentAnswer,
      human_answer: humanAnswer,
      human_passed: humanPassed,
      human_score: humanPassed ? 1 : human.score,
      human_severity: humanPassed ? "" : human.severity,
      human_rationale: answersMatch
        ? "Human reviewer confirmed that the candidate response matches the reference answer."
        : human.rationale,
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
    const humanRationale = readString(row, ["human_rationale", "reviewer_rationale", "label_reason"]);
    const humanAnswer = readString(row, ["human_answer", "reference_answer", "gold_answer"]);
    const agentAnswer = readString(row, ["agent_answer", "response", "actual_answer"]) || trace?.response_text || "";
    const evidenceMatch = goldenEvidenceMatchesTrace(row, trace);
    const contradictoryFailure = humanPassed === false
      && Boolean(agentAnswer)
      && Boolean(humanAnswer)
      && normalizedAnswer(agentAnswer) === normalizedAnswer(humanAnswer);
    const dataIssue = evidenceMatch === false
      ? "The evidence snapshot in this golden row no longer matches the trace evidence sent to the judge. Re-export or re-review this row before calibrating."
      : contradictoryFailure
      ? "Human label says fail, but the candidate response and human reference are identical. This row is excluded from calibration until corrected."
      : undefined;
    const agreement = dataIssue || humanPassed === undefined || judge === undefined ? undefined : humanPassed === judge.passed;
    return {
      trace_id: traceId,
      prompt: readString(row, ["user_request", "prompt", "prompt_text"]) || trace?.prompt_text || "",
      agent_answer: agentAnswer,
      human_answer: humanAnswer || String(trace?.metadata?._internal_reference ?? ""),
      evidence_scope: readString(row, ["evaluation_scope"]),
      evidence_fingerprint: readString(row, ["evidence_fingerprint"]),
      evidence_match: evidenceMatch,
      system_instructions: readString(row, ["system_instructions_json"]),
      prior_conversation: readString(row, ["prior_conversation_json"]),
      available_tools: readString(row, ["available_tools_json"]),
      retrieved_context: readString(row, ["retrieved_context_json"]),
      execution_spans: readString(row, ["execution_spans_json"]),
      tool_calls: readString(row, ["tool_calls_json"]),
      tool_results: readString(row, ["tool_results_json"]),
      trajectory_status: readString(row, ["trajectory_status"]),
      workflow: readString(row, ["workflow_json"]),
      human_passed: humanPassed,
      human_score: humanScore,
      human_severity: humanSeverity,
      human_rationale: humanRationale,
      judge_passed: judge?.passed,
      judge_score: judge?.score,
      judge_severity: judge?.severity,
      judge_rationale: judge?.rationale,
      agreement,
      score_delta: dataIssue || humanScore === undefined || judge === undefined ? undefined : judge.score - humanScore,
      data_issue: dataIssue,
    };
  }).filter((row): row is GoldenDatasetCalibrationRow => row !== null);

  const validRows = rows.filter((row) => !row.data_issue);
  const comparable = validRows.filter((row) => row.human_passed !== undefined && row.judge_passed !== undefined);
  const scoreComparable = validRows.filter((row) => row.score_delta !== undefined);
  const severityComparable = validRows.filter((row) => row.human_severity && row.judge_severity);
  const disagreements = comparable.filter((row) => row.agreement === false);
  return {
    matched_rows: rows.length,
    coverage_pct: pct(validRows.filter((row) => row.judge_passed !== undefined).length, dataset?.row_count ?? 0),
    agreement_rate: pct(comparable.filter((row) => row.agreement).length, comparable.length),
    false_pass_rate: pct(comparable.filter((row) => row.human_passed === false && row.judge_passed === true).length, comparable.length),
    false_fail_rate: pct(comparable.filter((row) => row.human_passed === true && row.judge_passed === false).length, comparable.length),
    avg_score_delta: scoreComparable.length ? scoreComparable.reduce((sum, row) => sum + Math.abs(row.score_delta ?? 0), 0) / scoreComparable.length : 0,
    severity_agreement_rate: pct(severityComparable.filter((row) => row.human_severity === row.judge_severity).length, severityComparable.length),
    invalid_rows: rows.length - validRows.length,
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
