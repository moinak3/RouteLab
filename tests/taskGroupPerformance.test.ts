import { describe, expect, it } from "vitest";
import { taskGroupCostSeries, taskGroupPerformanceHistory } from "../src/core/taskGroupPerformance";
import type { DistinctTaskBucket, Trace, TraceJudgeResult } from "../src/types";

const trace = (id: string, timestamp: string, latency: number, cost: number): Trace => ({
  id, timestamp, model: "test-model", messages: [], prompt_text: id, response_text: "response",
  input_tokens: 10, output_tokens: 5, total_tokens: 15, latency_ms: latency, cost_usd: cost, status: "success",
});
const result = (traceId: string, score: number, createdAt: string): TraceJudgeResult => ({
  id: `${traceId}-${createdAt}`, trace_id: traceId, evaluator_type: "response_quality", score,
  passed: score >= .8, rationale: "Measured", created_at: createdAt,
});
const group = (id: string, traces: string[]): DistinctTaskBucket => ({
  bucket_id: id, bucket_name: `Group ${id}`, traces, trace_count: traces.length, total_cost_usd: 0,
  avg_cost_usd: 0, total_tokens: 0, avg_input_tokens: 0, avg_output_tokens: 0, avg_confidence: 1,
  low_confidence_count: 0, risk_level: "low", customer_facing: true, examples: [],
  task: { task_type: "question_answering", domain: "general", complexity: "low", temporal_context: "single_turn", tool_use: "none", output_uncertainty: "low", output_format: "natural_language", grounding_requirement: "none" },
  evidence: { task_type: [], domain: [], complexity: [], temporal_context: [], tool_use: [], output_uncertainty: [], output_format: [], grounding_requirement: [] },
});

describe("Task Group performance history", () => {
  it("computes monthly quality, P95 latency, and average trace cost from the same assigned traces", () => {
    const traces = [
      trace("a", "2026-09-01T00:00:00.000Z", 100, .01),
      trace("b", "2026-09-02T00:00:00.000Z", 900, .03),
      trace("c", "2026-10-01T00:00:00.000Z", 400, .02),
    ];
    const history = taskGroupPerformanceHistory(traces, [group("one", ["a", "b", "c"])], [
      result("a", .4, "2026-09-03T00:00:00.000Z"),
      result("a", .8, "2026-09-04T00:00:00.000Z"),
      result("b", 1, "2026-09-03T00:00:00.000Z"),
    ]);
    expect(history.months.map((month) => month.key)).toEqual(["2026-09", "2026-10"]);
    expect(history.series[0].points[0]).toEqual(expect.objectContaining({ averageQuality: .9, p95LatencyMs: 900, averageCostUsd: .02, traceCount: 2, costTraceCount: 2, scoredTraceCount: 2 }));
    expect(history.series[0].points[1]).toEqual(expect.objectContaining({ averageQuality: null, p95LatencyMs: 400, averageCostUsd: .02 }));
  });

  it("combines lower-traffic groups into a weighted Other cost series", () => {
    const groups = Array.from({ length: 3 }, (_, index) => group(`${index}`, [`${index}`]));
    const traces = [trace("0", "2026-10-01T00:00:00.000Z", 100, .01), trace("1", "2026-10-01T00:00:00.000Z", 100, .02), trace("2", "2026-10-01T00:00:00.000Z", 100, .04)];
    const history = taskGroupPerformanceHistory(traces, groups, []);
    const costSeries = taskGroupCostSeries(history.series, 1);
    expect(costSeries).toHaveLength(2);
    expect(costSeries[1]).toEqual(expect.objectContaining({ id: "other", label: "Other Task Groups" }));
    expect(costSeries[1].points[0].averageCostUsd).toBeCloseTo(.03);
  });
});
