import { describe, expect, it } from "vitest";
import { parseAskChatLabCommand, resolveModel, resolveTaskGroup, selectSimulationTraces, workspaceCoverageSummary } from "../src/core/askChatLab";
import type { DistinctTaskBucket, Model, Trace } from "../src/types";

const traces = Array.from({ length: 10 }, (_, index): Trace => ({
  id: `trace_${index}`,
  timestamp: "2026-10-30T12:00:00.000Z",
  model: "current",
  messages: [],
  prompt_text: `Prompt ${index}`,
  response_text: `Response ${index}`,
  input_tokens: 10,
  output_tokens: 5,
  total_tokens: 15,
  latency_ms: 100,
  cost_usd: 0.01,
  status: "success",
}));

const group: DistinctTaskBucket = {
  bucket_id: "finance",
  bucket_name: "Financial Savings Analysis",
  task: { task_type: "data_analysis_insight_generation", domain: "finance", complexity: "medium", temporal_context: "single_turn", tool_use: "none", output_uncertainty: "low", output_format: "natural_language", grounding_requirement: "none" },
  traces: traces.map((trace) => trace.id),
  trace_count: traces.length,
  total_cost_usd: 0.1,
  avg_cost_usd: 0.01,
  total_tokens: 150,
  avg_input_tokens: 10,
  avg_output_tokens: 5,
  avg_latency_ms: 100,
  avg_confidence: 0.9,
  low_confidence_count: 0,
  risk_level: "medium",
  customer_facing: true,
  evidence: { task_type: [], domain: [], complexity: [], temporal_context: [], tool_use: [], output_uncertainty: [], output_format: [], grounding_requirement: [] },
  examples: [],
};

const model: Model = {
  id: "openrouter:anthropic/claude-opus-5.5",
  provider: "Anthropic",
  display_name: "Anthropic Opus 5.5",
  input_cost_per_1m: 1,
  output_cost_per_1m: 2,
  default_latency_ms: 500,
  deployment_type: "api",
  pricing_source_model_id: "anthropic/claude-opus-5.5",
  quality_tier: "strong",
  family: "Claude",
  family_tier: "top",
};

describe("AskChatLab", () => {
  it("parses a live simulation request", () => {
    expect(parseAskChatLabCommand("Run 10% of traces for task group Financial Savings Analysis through Claude Opus 5.5 and give me the results")).toEqual({
      kind: "simulate",
      taskGroupQuery: "Financial Savings Analysis",
      modelQuery: "Claude Opus 5.5",
      sampleMode: "percent",
      sampleValue: 10,
    });
  });

  it("recognizes metrics and unsupported-coverage questions", () => {
    expect(parseAskChatLabCommand("What's new with my metrics?")).toEqual({ kind: "metrics" });
    expect(parseAskChatLabCommand("What conversations didn't have support for natively?")).toEqual({ kind: "coverage" });
  });

  it("resolves workspace task groups and model aliases", () => {
    expect(resolveTaskGroup("financial savings", [group])?.bucket_id).toBe("finance");
    expect(resolveModel("Claude Opus 5.5", [model])?.id).toBe(model.id);
  });

  it("selects the requested percent without exceeding the group", () => {
    expect(selectSimulationTraces(traces, group, "percent", 10).selected).toHaveLength(1);
    expect(selectSimulationTraces(traces, group, "percent", 100).selected).toHaveLength(10);
    expect(selectSimulationTraces(traces, group, "count", 20).selected).toHaveLength(10);
  });

  it("keeps classifier and eval coverage gaps separate", () => {
    const partiallyGrouped = { ...group, traces: group.traces.slice(0, 5) };
    const summary = workspaceCoverageSummary(traces, [partiallyGrouped], [], { id: "eval", version: 1 });
    expect(summary.classifierGaps).toHaveLength(5);
    expect(summary.evalGaps).toHaveLength(10);
    expect(summary.topReasons[0]).toEqual(["No Task Group assignment", 5]);
  });
});
