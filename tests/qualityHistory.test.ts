import { describe, expect, it } from "vitest";
import { taskGroupQualityHistory } from "../src/core/qualityHistory";
import type { DistinctTaskBucket, TraceJudgeResult } from "../src/types";

const group = (id: string, name: string, traces: string[]): DistinctTaskBucket => ({
  bucket_id: id,
  bucket_name: name,
  task: {
    task_type: "question_answering",
    domain: "general",
    complexity: "low",
    temporal_context: "single_turn",
    tool_use: "none",
    output_uncertainty: "low",
    output_format: "natural_language",
    grounding_requirement: "none",
  },
  traces,
  trace_count: traces.length,
  total_cost_usd: 0,
  avg_cost_usd: 0,
  total_tokens: 0,
  avg_input_tokens: 0,
  avg_output_tokens: 0,
  avg_confidence: 1,
  low_confidence_count: 0,
  risk_level: "low",
  customer_facing: true,
  evidence: {
    task_type: [], domain: [], complexity: [], temporal_context: [], tool_use: [],
    output_uncertainty: [], output_format: [], grounding_requirement: [],
  },
  examples: [],
});

const result = (traceId: string, score: number, createdAt: string): TraceJudgeResult => ({
  id: `${traceId}_${createdAt}`,
  trace_id: traceId,
  evaluator_type: "response_quality",
  score,
  passed: score >= .8,
  rationale: "Measured result",
  created_at: createdAt,
});

describe("task-group quality history", () => {
  it("uses the workspace Task Group assignments and computes monthly averages", () => {
    const history = taskGroupQualityHistory([
      result("a1", 1, "2026-09-10T12:00:00.000Z"),
      result("a2", .5, "2026-09-11T12:00:00.000Z"),
      result("b1", .25, "2026-10-10T12:00:00.000Z"),
    ], [group("a", "Account Support", ["a1", "a2"]), group("b", "Billing", ["b1"])]);

    expect(history.months.map((month) => month.key)).toEqual(["2026-09", "2026-10"]);
    expect(history.series.find((series) => series.id === "a")?.points).toEqual([
      expect.objectContaining({ averageScore: .75, count: 2 }),
      null,
    ]);
    expect(history.series.find((series) => series.id === "b")?.points).toEqual([
      null,
      expect.objectContaining({ averageScore: .25, count: 1 }),
    ]);
  });

  it("combines lower-support groups into a clearly labeled other series", () => {
    const groups = Array.from({ length: 4 }, (_, index) => group(`g${index}`, `Group ${index}`, [`t${index}`]));
    const results = groups.map((item, index) => result(item.traces[0], 1 - index * .1, "2026-10-10T12:00:00.000Z"));
    const history = taskGroupQualityHistory(results, groups, 2);

    expect(history.series).toHaveLength(3);
    expect(history.series.at(-1)).toEqual(expect.objectContaining({ label: "Other Task Groups", resultCount: 2 }));
  });
});
