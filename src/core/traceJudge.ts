import type { Trace, TraceJudgeResult } from "../types";

const judgeOutcome = (index: number) => {
  const slot = index % 20;
  if (slot < 14) {
    return {
      score: 1,
      passed: true,
      rationale: "The response fully answers the customer support request with the required facts and no material policy issue.",
    };
  }
  if (slot < 18) {
    return {
      score: .5,
      passed: false,
      severity: "major" as const,
      rationale: "The response partially addresses the request, but it misses a required detail or gives an incomplete support resolution.",
    };
  }
  return {
    score: 0,
    passed: false,
    severity: "critical" as const,
    rationale: "The response does not resolve the customer request and may be unsafe, misleading, or materially incomplete.",
  };
};

export function createTraceJudgeResults(traces: Trace[]): TraceJudgeResult[] {
  return traces.map((trace, index) => ({
    id: `judge_${trace.id}`,
    trace_id: trace.id,
    evaluator_type: "llm_as_judge",
    created_at: trace.timestamp,
    ...judgeOutcome(index),
  }));
}

export const traceJudgeResultsByTraceId = (results: TraceJudgeResult[]) => new Map(results.map((result) => [result.trace_id, result]));
