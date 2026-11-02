import type { DistinctTaskBucket, Trace, TraceJudgeResult } from "../types";

export type TaskGroupPerformanceMonth = {
  key: string;
  label: string;
};

export type TaskGroupPerformancePoint = {
  month: TaskGroupPerformanceMonth;
  traceCount: number;
  costTraceCount: number;
  scoredTraceCount: number;
  averageQuality: number | null;
  p95LatencyMs: number | null;
  averageCostUsd: number | null;
};

export type TaskGroupPerformanceSeries = {
  id: string;
  label: string;
  traceCount: number;
  points: TaskGroupPerformancePoint[];
};

const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
const monthLabel = (date: Date) => date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });

const percentile = (values: number[], percentileValue: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
};

function latestScoresByTrace(results: TraceJudgeResult[]) {
  const latest = new Map<string, TraceJudgeResult>();
  results.forEach((result) => {
    const existing = latest.get(result.trace_id);
    if (!existing || Date.parse(result.created_at) >= Date.parse(existing.created_at)) latest.set(result.trace_id, result);
  });
  return latest;
}

export function taskGroupPerformanceHistory(
  traces: Trace[],
  taskGroups: DistinctTaskBucket[],
  traceJudgeResults: TraceJudgeResult[],
) {
  const validTraces = traces.flatMap((trace) => {
    const date = new Date(trace.timestamp);
    if (Number.isNaN(date.getTime())) return [];
    return [{ trace, date, monthKey: monthKey(date) }];
  });
  const months = Array.from(new Map(
    validTraces.map(({ date, monthKey: key }) => [key, { key, label: monthLabel(date) }]),
  ).values()).sort((left, right) => left.key.localeCompare(right.key)).slice(-6);
  const visibleMonths = new Set(months.map((month) => month.key));
  const traceById = new Map(validTraces.map((item) => [item.trace.id, item]));
  const latestScores = latestScoresByTrace(traceJudgeResults);

  const series = taskGroups
    .map((taskGroup): TaskGroupPerformanceSeries => {
      const groupTraceIds = taskGroup.traces.filter((traceId) => traceById.has(traceId));
      return {
        id: taskGroup.bucket_id,
        label: taskGroup.bucket_name,
        traceCount: groupTraceIds.length,
        points: months.map((month) => {
          const monthTraces = groupTraceIds.flatMap((traceId) => {
            const item = traceById.get(traceId);
            return item?.monthKey === month.key ? [item.trace] : [];
          });
          const scores = monthTraces.flatMap((trace) => {
            const score = latestScores.get(trace.id)?.score;
            return score === undefined ? [] : [score];
          });
          const latencies = monthTraces.flatMap((trace) => trace.latency_ms === undefined ? [] : [trace.latency_ms]);
          const costs = monthTraces.flatMap((trace) => trace.cost_usd === undefined ? [] : [trace.cost_usd]);
          return {
            month,
            traceCount: monthTraces.length,
            costTraceCount: costs.length,
            scoredTraceCount: scores.length,
            averageQuality: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
            p95LatencyMs: percentile(latencies, .95),
            averageCostUsd: costs.length ? costs.reduce((sum, cost) => sum + cost, 0) / costs.length : null,
          };
        }),
      };
    })
    .filter((item) => item.traceCount > 0)
    .sort((left, right) => right.traceCount - left.traceCount || left.label.localeCompare(right.label));

  return { months, series };
}

export function taskGroupCostSeries(series: TaskGroupPerformanceSeries[], maxNamedGroups = 5) {
  const named = series.slice(0, maxNamedGroups);
  const remainder = series.slice(maxNamedGroups);
  if (!remainder.length) return named;
  return [
    ...named,
    {
      id: "other",
      label: "Other Task Groups",
      traceCount: remainder.reduce((sum, item) => sum + item.traceCount, 0),
      points: named[0]?.points.map((_, monthIndex) => {
        const monthPoints = remainder.map((item) => item.points[monthIndex]).filter((point) => point.traceCount > 0);
        const traceCount = monthPoints.reduce((sum, point) => sum + point.traceCount, 0);
        const costTraceCount = monthPoints.reduce((sum, point) => sum + point.costTraceCount, 0);
        const scoredTraceCount = monthPoints.reduce((sum, point) => sum + point.scoredTraceCount, 0);
        const costPoints = monthPoints.filter((point) => point.averageCostUsd !== null);
        return {
          month: monthPoints[0]?.month ?? named[0].points[monthIndex].month,
          traceCount,
          costTraceCount,
          scoredTraceCount,
          averageQuality: null,
          p95LatencyMs: null,
          averageCostUsd: costTraceCount
            ? costPoints.reduce((sum, point) => sum + (point.averageCostUsd ?? 0) * point.costTraceCount, 0) / costTraceCount
            : null,
        };
      }) ?? [],
    },
  ];
}
