import type { ActiveEvalConfig } from "./evalRegistry";
import {
  evalRunBatches,
  runEvalBatchPool,
  runEvalOnTraces,
  type EvalRunMode,
} from "./evalLifecycle";
import { replayFromJudgedRuns, type ReplayResult } from "./simulations";
import type { CandidateRun, Trace, TraceJudgeResult } from "../types";

async function scorePopulation({
  workspaceId,
  activeEval,
  mode,
  traces,
  signal,
}: {
  workspaceId: string;
  activeEval: ActiveEvalConfig;
  mode: EvalRunMode;
  traces: Trace[];
  signal?: AbortSignal;
}) {
  if (!traces.length) return [];
  const results: TraceJudgeResult[] = [];
  const errors: Array<{ traceId: string; error: string }> = [];
  await runEvalBatchPool(evalRunBatches(traces), async (batch) => runEvalOnTraces({
    workspaceId,
    definition: activeEval.definition,
    evalVersion: activeEval.version,
    mode,
    traces: batch,
    signal,
  }), (response) => {
    results.push(...response.results);
    errors.push(...response.errors);
  });
  if (errors.length) {
    throw new Error(`${errors.length.toLocaleString()} of ${traces.length.toLocaleString()} ${mode === "simulation_candidate" ? "candidate" : "baseline"} responses could not be evaluated. ${errors[0].error}`);
  }
  if (results.length !== traces.length) {
    throw new Error(`The judge scored ${results.length.toLocaleString()} of ${traces.length.toLocaleString()} ${mode === "simulation_candidate" ? "candidate" : "baseline"} responses.`);
  }
  return results;
}

export async function evaluateLiveReplay({
  workspaceId,
  activeEval,
  traces,
  runs,
  existingBaselineResults,
  signal,
}: {
  workspaceId: string;
  activeEval: ActiveEvalConfig;
  traces: Trace[];
  runs: CandidateRun[];
  existingBaselineResults: TraceJudgeResult[];
  signal?: AbortSignal;
}): Promise<{ result: ReplayResult; baselineResults: TraceJudgeResult[] }> {
  const traceIds = new Set(traces.map((trace) => trace.id));
  const matchingBaseline = existingBaselineResults.filter((result) =>
    traceIds.has(result.trace_id)
    && result.eval_id === activeEval.definition.id
    && result.eval_version === activeEval.version,
  );
  const matchingByTraceId = new Map(matchingBaseline.map((result) => [result.trace_id, result]));
  const missingBaselineTraces = traces.filter((trace) => !matchingByTraceId.has(trace.id));
  const sourceByTraceId = new Map(traces.map((trace) => [trace.id, trace]));
  const candidateTraces = runs
    .filter((run) => run.status === "success")
    .map((run) => {
      const source = sourceByTraceId.get(run.trace_id);
      if (!source) throw new Error(`Candidate response ${run.id} does not have a matching source trace.`);
      return {
        ...source,
        model: run.selected_model ?? run.candidate_model,
        response_text: run.response_text,
        output_tokens: run.output_tokens,
        total_tokens: source.input_tokens + run.output_tokens,
        latency_ms: run.latency_ms,
        cost_usd: run.cost_usd,
        status: "success" as const,
      };
    });

  const [newBaselineResults, candidateResults] = await Promise.all([
    scorePopulation({ workspaceId, activeEval, mode: "simulation_baseline", traces: missingBaselineTraces, signal }),
    scorePopulation({ workspaceId, activeEval, mode: "simulation_candidate", traces: candidateTraces, signal }),
  ]);
  const baselineResults = [...matchingBaseline, ...newBaselineResults];
  const result = replayFromJudgedRuns(traces, runs, candidateResults, {
    eval_id: activeEval.definition.id,
    eval_name: activeEval.definition.name,
    eval_version: activeEval.version,
    judge_model: activeEval.definition.model,
  });
  return { result, baselineResults };
}
