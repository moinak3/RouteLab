import { percentile } from "./analysis";
import type { DistinctTaskBucket, Trace, TraceJudgeResult } from "../types";

export type TaskGroupMetrics = {
  averageCostUsd: number;
  averageQualityScore?: number;
  scoredTraceCount: number;
  p95LatencyMs?: number;
};

export function calculateTaskGroupMetrics(
  bucket: Pick<DistinctTaskBucket, "traces" | "trace_count" | "total_cost_usd">,
  traces: Trace[],
  judgeResults: TraceJudgeResult[],
): TaskGroupMetrics {
  const traceIds = new Set(bucket.traces);
  const groupedTraces = traces.filter((trace) => traceIds.has(trace.id));
  const latencies = groupedTraces
    .map((trace) => trace.latency_ms)
    .filter((latency): latency is number => typeof latency === "number" && Number.isFinite(latency));

  const latestJudgeByTrace = new Map<string, TraceJudgeResult>();
  judgeResults.forEach((result) => {
    if (!traceIds.has(result.trace_id)) return;
    const current = latestJudgeByTrace.get(result.trace_id);
    if (!current || result.created_at >= current.created_at) latestJudgeByTrace.set(result.trace_id, result);
  });
  const scores = [...latestJudgeByTrace.values()].map((result) => result.score);

  return {
    averageCostUsd: bucket.trace_count ? bucket.total_cost_usd / bucket.trace_count : 0,
    averageQualityScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : undefined,
    scoredTraceCount: scores.length,
    p95LatencyMs: latencies.length ? percentile(latencies, 0.95) : undefined,
  };
}
