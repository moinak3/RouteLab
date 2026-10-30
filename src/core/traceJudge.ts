import type { Trace, TraceJudgeResult } from "../types";

const evaluatorIdentity = "trace_quality_llm_judge (gpt-5.5-pro)";

function seededJudgeResult(trace: Trace): TraceJudgeResult | null {
  const metadata = trace.metadata ?? {};
  const passed = metadata._internal_judge_passed;
  const score = metadata._internal_judge_score;
  const rationale = metadata._internal_judge_rationale;
  const severity = metadata._internal_judge_severity;

  if (typeof passed !== "boolean" || typeof score !== "number" || typeof rationale !== "string") return null;
  if (score < 0 || score > 1 || (passed && score < 1) || (!passed && score >= 1)) return null;

  return {
    id: `judge_${trace.id}`,
    trace_id: trace.id,
    evaluator_type: evaluatorIdentity,
    created_at: trace.timestamp,
    score,
    passed,
    rationale,
    severity: severity === "minor" || severity === "major" || severity === "critical" ? severity : undefined,
  };
}

export function createTraceJudgeResults(traces: Trace[]): TraceJudgeResult[] {
  return traces.flatMap((trace) => {
    const result = seededJudgeResult(trace);
    return result ? [result] : [];
  });
}

export const traceJudgeResultsByTraceId = (results: TraceJudgeResult[]) => new Map(results.map((result) => [result.trace_id, result]));
