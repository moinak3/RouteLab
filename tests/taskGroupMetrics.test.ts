import { describe, expect, it } from "vitest";
import { calculateTaskGroupMetrics } from "../src/core/taskGroupMetrics";
import type { DistinctTaskBucket, Trace, TraceJudgeResult } from "../src/types";

const bucket = {
  traces: ["trace_1", "trace_2", "trace_3", "trace_4"],
  trace_count: 4,
  total_cost_usd: 0.4,
} as Pick<DistinctTaskBucket, "traces" | "trace_count" | "total_cost_usd">;

const trace = (id: string, latency_ms?: number): Trace => ({
  id,
  timestamp: "2026-11-01T00:00:00.000Z",
  model: "openai/test",
  messages: [],
  prompt_text: id,
  response_text: "response",
  input_tokens: 10,
  output_tokens: 5,
  total_tokens: 15,
  latency_ms,
  cost_usd: 0.1,
  status: "success",
});

const judge = (id: string, trace_id: string, score: number, created_at: string): TraceJudgeResult => ({
  id,
  trace_id,
  evaluator_type: "quality",
  score,
  passed: score >= 0.8,
  rationale: "Measured result",
  created_at,
});

describe("task group table metrics", () => {
  it("calculates average cost, latest per-trace quality, and p95 latency", () => {
    const metrics = calculateTaskGroupMetrics(
      bucket,
      [trace("trace_1", 100), trace("trace_2", 200), trace("trace_3", 300), trace("trace_4", 1000), trace("outside", 9000)],
      [
        judge("old", "trace_1", 0.2, "2026-10-01T00:00:00.000Z"),
        judge("new", "trace_1", 0.8, "2026-11-01T00:00:00.000Z"),
        judge("second", "trace_2", 0.6, "2026-11-01T00:00:00.000Z"),
        judge("outside", "outside", 1, "2026-11-01T00:00:00.000Z"),
      ],
    );

    expect(metrics.averageCostUsd).toBeCloseTo(0.1);
    expect(metrics.averageQualityScore).toBeCloseTo(0.7);
    expect(metrics.scoredTraceCount).toBe(2);
    expect(metrics.p95LatencyMs).toBe(1000);
  });

  it("reports missing quality and latency without inventing values", () => {
    const metrics = calculateTaskGroupMetrics(bucket, [], []);
    expect(metrics.averageQualityScore).toBeUndefined();
    expect(metrics.p95LatencyMs).toBeUndefined();
  });
});
