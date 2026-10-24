import type { Trace, TraceJudgeResult } from "../types";

const hash = (value: string) => [...value].reduce((state, character) => (state * 33 + character.charCodeAt(0)) >>> 0, 5381);

function traceRationale(trace: Trace, passed: boolean) {
  const task = String(trace.metadata?.distinct_task_label ?? trace.metadata?.task_type ?? "this task");
  const account = trace.prompt_text.match(/Account:\s*([^.]+)/)?.[1]?.trim();
  const accountContext = account ? ` for ${account}` : "";
  if (passed) return `The response completes ${task.toLowerCase()}${accountContext}, preserves the required facts, and avoids unsupported actions.`;
  return `${task}${accountContext}: ${String(trace.metadata?._internal_failure_reason ?? "The answer misses a required fact or control.")}`;
}

export function createTraceJudgeResults(traces: Trace[]): TraceJudgeResult[] {
  return traces.map((trace) => {
    const humanPassed = trace.metadata?._internal_baseline_pass !== false;
    const disagreement = hash(trace.id) % 10 === 0;
    const passed = disagreement ? !humanPassed : humanPassed;
    const risk = String(trace.metadata?.risk_level ?? "medium");
    return {
      id: `judge_${trace.id}`,
      trace_id: trace.id,
      evaluator_type: "trace_quality_llm_judge (gpt-5.5-pro)",
      created_at: trace.timestamp,
      score: passed ? 1 : risk === "high" && hash(`${trace.id}:severity`) % 3 === 0 ? 0 : .5,
      passed,
      severity: passed ? undefined : risk === "high" ? "critical" : "major",
      rationale: traceRationale(trace, passed),
    };
  });
}

export const traceJudgeResultsByTraceId = (results: TraceJudgeResult[]) => new Map(results.map((result) => [result.trace_id, result]));
