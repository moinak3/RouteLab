import { calculateCost, getModel, isModelEnabled, modelCatalog } from "./catalog";
import { evaluateTrace } from "./evaluators";
import type { CandidateRun, EvalResult, Trace, DistinctTaskBucket } from "../types";

export type SimulationSummary = {
  baseline_cost_usd: number; simulated_cost_usd: number; estimated_savings_usd: number; estimated_savings_pct: number;
  baseline_avg_latency_ms: number; simulated_avg_latency_ms: number; latency_delta_pct: number; average_quality_score: number;
  pass_rate: number; severe_failure_rate: number; escalation_rate?: number;
};
export type ReplayResult = { runs: CandidateRun[]; evals: EvalResult[]; summary: SimulationSummary };
export const MONTHLY_MULTIPLIER = 30;
const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const summarize = (traces: Trace[], runs: CandidateRun[], evals: EvalResult[], escalationRate?: number): SimulationSummary => {
  const baseline = traces.reduce((sum, trace) => sum + (trace.cost_usd ?? 0), 0);
  const simulated = runs.reduce((sum, run) => sum + run.cost_usd, 0);
  const baseLatency = avg(traces.map((trace) => trace.latency_ms ?? 0));
  const simLatency = avg(runs.map((run) => run.latency_ms));
  return {
    baseline_cost_usd: baseline, simulated_cost_usd: simulated, estimated_savings_usd: baseline - simulated,
    estimated_savings_pct: baseline ? (baseline - simulated) / baseline * 100 : 0,
    baseline_avg_latency_ms: baseLatency, simulated_avg_latency_ms: simLatency,
    latency_delta_pct: baseLatency ? (simLatency - baseLatency) / baseLatency * 100 : 0,
    average_quality_score: avg(evals.map((item) => item.score)), pass_rate: evals.filter((item) => item.passed).length / (evals.length || 1),
    severe_failure_rate: evals.filter((item) => item.severity === "critical").length / (evals.length || 1), escalation_rate: escalationRate,
  };
};
export function costOnly(traces: Trace[], candidateId: string, buckets: DistinctTaskBucket[] = []) {
  const candidate = getModel(candidateId)!;
  const tracesById = new Map(traces.map((trace) => [trace.id, trace]));
  const baseline = traces.reduce((sum, trace) => sum + (trace.cost_usd ?? 0), 0);
  const simulated = traces.reduce((sum, trace) => sum + calculateCost(trace.input_tokens, trace.output_tokens, candidate), 0);
  const byDistinctTask = buckets.map((bucket) => {
    const selected = bucket.traces.map((id) => tracesById.get(id)).filter((trace): trace is Trace => Boolean(trace));
    const actual = selected.reduce((sum, trace) => sum + (trace.cost_usd ?? 0), 0);
    const next = selected.reduce((sum, trace) => sum + calculateCost(trace.input_tokens, trace.output_tokens, candidate), 0);
    return { distinct_task_bucket_id: bucket.bucket_id, savings: actual - next };
  });
  return { baseline_cost_usd: baseline, simulated_cost_usd: simulated, estimated_savings_usd: baseline - simulated, estimated_savings_pct: (baseline - simulated) / baseline * 100, byDistinctTask };
}
export function mockGenerate(trace: Trace, modelId: string): CandidateRun {
  const model = getModel(modelId)!;
  const strong = model.quality_tier === "strong";
  const easy = trace.metadata?.mock_difficulty === "easy";
  const expected = String(trace.metadata?.expected_answer ?? trace.response_text ?? "");
  const response = strong || easy ? expected : "[FAIL_MAJOR] Incomplete candidate answer";
  // Mock responses are short markers, so preserve historical volume for realistic pricing.
  const outputTokens = trace.output_tokens;
  const seed = [...`${trace.id}:${modelId}`].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const latency = trace.metadata?.mock_slow_candidate && modelId === "deepseek-r1" ? 6500 + seed % 300 : model.default_latency_ms + seed % 120;
  return { id: `run_${trace.id}_${modelId}`, trace_id: trace.id, candidate_model: modelId, response_text: response, input_tokens: trace.input_tokens, output_tokens: outputTokens, latency_ms: latency, cost_usd: calculateCost(trace.input_tokens, outputTokens, model), status: "success" };
}
export function replay(traces: Trace[], candidateId: string): ReplayResult {
  const runs = traces.map((trace) => mockGenerate(trace, candidateId));
  const evals = runs.map((run, index): EvalResult => ({ id: `eval_${run.id}`, trace_id: run.trace_id, candidate_run_id: run.id, ...evaluateTrace(traces[index], run.response_text) }));
  return { runs, evals, summary: summarize(traces, runs, evals) };
}
export function cascade(traces: Trace[], primaryId: string, fallbackId: string): ReplayResult {
  const primary = replay(traces, primaryId);
  const runs: CandidateRun[] = []; const evals: EvalResult[] = []; let escalations = 0;
  traces.forEach((trace, index) => {
    if (primary.evals[index].passed) { runs.push(primary.runs[index]); evals.push(primary.evals[index]); return; }
    escalations++;
    const fallback = mockGenerate(trace, fallbackId);
    fallback.latency_ms += primary.runs[index].latency_ms;
    fallback.cost_usd += primary.runs[index].cost_usd;
    const evaluation: EvalResult = { id: `eval_${fallback.id}`, trace_id: trace.id, candidate_run_id: fallback.id, ...evaluateTrace(trace, fallback.response_text) };
    runs.push(fallback); evals.push(evaluation);
  });
  return { runs, evals, summary: summarize(traces, runs, evals, escalations / traces.length) };
}
export function familyCascade(traces: Trace[], selectedModelId: string): ReplayResult {
  const selected = getModel(selectedModelId);
  const tierOrder = { cheapest: 0, mid: 1, top: 2 };
  const familyModels = modelCatalog
    .filter((model) => model.family === selected?.family && isModelEnabled(model))
    .sort((a, b) => tierOrder[a.family_tier] - tierOrder[b.family_tier]);
  const models = familyModels.length ? familyModels : [getModel(selectedModelId)!];
  const runs: CandidateRun[] = []; const evals: EvalResult[] = []; let escalations = 0;
  traces.forEach((trace) => {
    let accumulatedCost = 0; let accumulatedLatency = 0;
    for (let index = 0; index < models.length; index++) {
      const run = mockGenerate(trace, models[index].id);
      accumulatedCost += run.cost_usd; accumulatedLatency += run.latency_ms;
      const evaluation: EvalResult = { id: `eval_${run.id}`, trace_id: trace.id, candidate_run_id: run.id, ...evaluateTrace(trace, run.response_text) };
      if (evaluation.passed || index === models.length - 1) {
        run.cost_usd = accumulatedCost; run.latency_ms = accumulatedLatency;
        runs.push(run); evals.push(evaluation); break;
      }
      escalations++;
    }
  });
  return { runs, evals, summary: summarize(traces, runs, evals, escalations / Math.max(traces.length, 1)) };
}
export function monthlyDistinctTaskBreakdown(traces: Trace[], buckets: DistinctTaskBucket[], candidateId: string, strategy: "direct" | "cascade" | "family_cascade", fallbackId = "claude-opus-4.8") {
  const tracesById = new Map(traces.map((trace) => [trace.id, trace]));
  return buckets.map((bucket) => {
    const selected = bucket.traces.map((id) => tracesById.get(id)).filter((trace): trace is Trace => Boolean(trace));
    const result = strategy === "direct" ? replay(selected, candidateId) : strategy === "family_cascade" ? familyCascade(selected, candidateId) : cascade(selected, candidateId, fallbackId);
    return {
      distinct_task_bucket_id: bucket.bucket_id,
      name: bucket.bucket_name,
      current_monthly_cost_usd: result.summary.baseline_cost_usd * MONTHLY_MULTIPLIER,
      simulated_monthly_cost_usd: result.summary.simulated_cost_usd * MONTHLY_MULTIPLIER,
      monthly_savings_usd: result.summary.estimated_savings_usd * MONTHLY_MULTIPLIER,
    };
  });
}
