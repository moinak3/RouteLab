import type { Trace } from "../types";

export type DateRange = "7d" | "30d" | "3m" | "6m" | "all";
export type MonthlyBucket = { key: string; label: string; calls: number; spend: number; tokens: number; quality: number; latency: number };

const rangeDays: Record<Exclude<DateRange, "all">, number> = { "7d": 7, "30d": 30, "3m": 90, "6m": 183 };
export function filterTracesByRange(traces: Trace[], range: DateRange) {
  if (range === "all" || !traces.length) return traces;
  const latest = Math.max(...traces.map((trace) => new Date(trace.timestamp).getTime()));
  const cutoff = latest - rangeDays[range] * 86_400_000;
  return traces.filter((trace) => new Date(trace.timestamp).getTime() >= cutoff);
}
export function monthlyBuckets(traces: Trace[]): MonthlyBucket[] {
  const buckets = new Map<string, MonthlyBucket & { latencySamples: number; latencyTotal: number }>();
  traces.forEach((trace) => {
    const date = new Date(trace.timestamp);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key) ?? { key, label: date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }), calls: 0, spend: 0, tokens: 0, quality: 0, latency: 0, latencySamples: 0, latencyTotal: 0 };
    bucket.calls++;
    bucket.spend += trace.cost_usd ?? 0;
    bucket.tokens += trace.total_tokens;
    if (trace.latency_ms !== undefined) {
      bucket.latencySamples++;
      bucket.latencyTotal += trace.latency_ms;
      bucket.latency = bucket.latencyTotal / bucket.latencySamples;
    }
    buckets.set(key, bucket);
  });
  return [...buckets.values()].map(({ latencySamples, latencyTotal, ...bucket }) => bucket).sort((a, b) => a.key.localeCompare(b.key));
}
