import type { DistinctTaskBucket, Model, Trace, TraceJudgeResult } from "../types";

export type AskChatLabCommand =
  | { kind: "metrics" }
  | { kind: "coverage" }
  | { kind: "navigate"; destination: "task_groups" | "response_quality" | "review" | "classifier" | "simulations" }
  | { kind: "simulate"; taskGroupQuery: string; modelQuery: string; sampleMode: "percent" | "count"; sampleValue: number }
  | { kind: "help" };

export type AskSimulationRequest = {
  taskGroupId: string;
  taskGroupName: string;
  candidateId: string;
  candidateName: string;
  sampleMode: "percent" | "count";
  sampleValue: number;
};

export type AskSimulationResult = AskSimulationRequest & {
  completedAt: string;
  traceCount: number;
  successfulRequests: number;
  baselineMonthlyCost: number;
  candidateMonthlyCost: number;
  baselineLatencyMs: number;
  candidateLatencyMs: number;
  baselineAverageScore: number;
  candidateAverageScore: number;
  provider: string;
};

const normalize = (value: string) => value
  .toLowerCase()
  .replace(/[^a-z0-9.]+/g, " ")
  .trim();

const tokens = (value: string) => new Set(normalize(value).split(/\s+/).filter((token) => token.length > 1));

function overlapScore(query: string, candidate: string) {
  const normalizedQuery = normalize(query);
  const normalizedCandidate = normalize(candidate);
  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) return 100;
  const queryTokens = tokens(normalizedQuery);
  const candidateTokens = tokens(normalizedCandidate);
  const overlap = [...queryTokens].filter((token) => candidateTokens.has(token)).length;
  return overlap / Math.max(1, queryTokens.size) * 10;
}

export function parseAskChatLabCommand(input: string): AskChatLabCommand {
  const normalized = normalize(input);
  if (!normalized) return { kind: "help" };
  if (/\b(metric|metrics|what s new|what is new|performance|health|snapshot)\b/.test(normalized)) return { kind: "metrics" };
  if (/\b(unsupported|not supported|support for natively|without support|outside coverage|coverage gap|unknown|uncovered)\b/.test(normalized)) return { kind: "coverage" };

  if (/\b(open|show|take me|go to)\b/.test(normalized)) {
    if (/task group/.test(normalized)) return { kind: "navigate", destination: "task_groups" };
    if (/response quality|eval library|evals/.test(normalized)) return { kind: "navigate", destination: "response_quality" };
    if (/review/.test(normalized)) return { kind: "navigate", destination: "review" };
    if (/classifier|classification/.test(normalized)) return { kind: "navigate", destination: "classifier" };
    if (/simulation|routing/.test(normalized)) return { kind: "navigate", destination: "simulations" };
  }

  if (/\b(run|simulate|replay|test)\b/.test(normalized)) {
    const percent = input.match(/(\d+(?:\.\d+)?)\s*%/);
    const count = input.match(/(?:run|simulate|replay|test)\s+(\d+)\s+(?:traces?|requests?|conversations?)/i);
    const throughIndex = input.search(/\b(?:through|using|with)\b/i);
    const taskGroupMatch = input.match(/task\s+group\s+(.+?)(?=\s+(?:through|using|with)\b|$)/i);
    const modelQuery = throughIndex >= 0
      ? input.slice(throughIndex).replace(/^\s*(?:through|using|with)\s+/i, "").split(/\s+(?:and\s+)?(?:give|show|report|summarize|compare)\b/i)[0].trim()
      : "";
    if (taskGroupMatch?.[1] && modelQuery) {
      return {
        kind: "simulate",
        taskGroupQuery: taskGroupMatch[1].trim(),
        modelQuery,
        sampleMode: percent ? "percent" : "count",
        sampleValue: percent ? Math.min(100, Math.max(1, Number(percent[1]))) : Math.max(1, Number(count?.[1] ?? 10)),
      };
    }
  }
  return { kind: "help" };
}

export function resolveTaskGroup(query: string, groups: DistinctTaskBucket[]) {
  return groups
    .map((group) => ({ group, score: overlapScore(query, `${group.bucket_name} ${group.bucket_id} ${Object.values(group.task).join(" ")}`) }))
    .sort((a, b) => b.score - a.score)[0]?.score > 0
    ? groups
      .map((group) => ({ group, score: overlapScore(query, `${group.bucket_name} ${group.bucket_id} ${Object.values(group.task).join(" ")}`) }))
      .sort((a, b) => b.score - a.score)[0].group
    : undefined;
}

export function resolveModel(query: string, models: Model[]) {
  const ranked = models
    .filter((model) => model.deployment_type !== "decision_model")
    .map((model) => ({ model, score: overlapScore(query, `${model.display_name} ${model.id} ${model.pricing_source_model_id ?? ""} ${model.provider} ${model.family}`) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 ? ranked[0].model : undefined;
}

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function resultsForActiveEval(results: TraceJudgeResult[], traceIds: Set<string>, activeEval?: { id: string; version: number }) {
  const workspaceResults = results.filter((result) => traceIds.has(result.trace_id));
  if (!activeEval) return workspaceResults;
  return workspaceResults.filter((result) => (
    result.eval_id === activeEval.id && result.eval_version === activeEval.version
  ) || (!result.eval_id && result.eval_version === undefined));
}

export function workspaceMetricSummary(traces: Trace[], results: TraceJudgeResult[], activeEval?: { id: string; version: number }) {
  const traceIds = new Set(traces.map((trace) => trace.id));
  const matchingResults = resultsForActiveEval(results, traceIds, activeEval);
  const latest = traces.reduce((max, trace) => Math.max(max, Date.parse(trace.timestamp) || 0), 0);
  const recentStart = latest - 7 * 24 * 60 * 60 * 1000;
  const priorStart = recentStart - 7 * 24 * 60 * 60 * 1000;
  const recent = traces.filter((trace) => (Date.parse(trace.timestamp) || 0) > recentStart).length;
  const prior = traces.filter((trace) => {
    const timestamp = Date.parse(trace.timestamp) || 0;
    return timestamp > priorStart && timestamp <= recentStart;
  }).length;
  return {
    total: traces.length,
    recent,
    prior,
    cost: traces.reduce((sum, trace) => sum + (trace.cost_usd ?? 0), 0),
    averageLatencyMs: average(traces.map((trace) => trace.latency_ms ?? 0)),
    scored: matchingResults.length,
    averageScore: average(matchingResults.map((result) => result.score)),
  };
}

export function workspaceCoverageSummary(traces: Trace[], groups: DistinctTaskBucket[], results: TraceJudgeResult[], activeEval?: { id: string; version: number }) {
  const grouped = new Set(groups.flatMap((group) => group.traces));
  const evaluated = new Set(resultsForActiveEval(results, new Set(traces.map((trace) => trace.id)), activeEval).map((result) => result.trace_id));
  const classifierGaps = traces.filter((trace) => !grouped.has(trace.id)
    || Boolean(trace.signature_decision && (
      trace.signature_decision.status !== "matched"
      || trace.signature_decision.routing_action === "fallback_model"
    )));
  const evalGaps = traces.filter((trace) => !evaluated.has(trace.id));
  const reasons = new Map<string, number>();
  classifierGaps.forEach((trace) => {
    const reason = !grouped.has(trace.id)
      ? "No Task Group assignment"
      : trace.signature_decision?.status.replace(/_/g, " ") ?? "Uncertain classifier decision";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  });
  return {
    classifierGaps,
    evalGaps,
    topReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
  };
}

export function selectSimulationTraces(traces: Trace[], group: DistinctTaskBucket, mode: "percent" | "count", value: number) {
  const traceById = new Map(traces.map((trace) => [trace.id, trace]));
  const available = group.traces.map((id) => traceById.get(id)).filter((trace): trace is Trace => Boolean(trace));
  const count = mode === "percent"
    ? Math.max(1, Math.ceil(available.length * Math.min(100, value) / 100))
    : Math.min(available.length, Math.max(1, Math.floor(value)));
  return { available, selected: [...available].sort((a, b) => a.id.localeCompare(b.id)).slice(0, count) };
}
