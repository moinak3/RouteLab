import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LLMGroupedTasks } from "../src/pages/LLMGroupedTasks";
import type { DistinctTaskBucket, Trace, TraceJudgeResult } from "../src/types";

const trace: Trace = {
  id: "trace_scored",
  timestamp: "2026-11-01T00:00:00.000Z",
  model: "openai/test",
  messages: [],
  prompt_text: "Draft a short note.",
  response_text: "Here is the requested note.",
  input_tokens: 10,
  output_tokens: 5,
  total_tokens: 15,
  latency_ms: 250,
  cost_usd: 0.01,
  status: "success",
};

const savedTaskGroup = {
  bucket_id: "saved_group",
  bucket_name: "Draft Email",
  task: {
    task_type: "writing_editing",
    domain: "general",
    complexity: "low",
    temporal_context: "single_turn",
    tool_use: "none",
    output_uncertainty: "low",
    output_format: "natural_language",
    grounding_requirement: "none",
  },
  traces: [trace.id],
  trace_count: 1,
  total_cost_usd: 0.01,
  avg_cost_usd: 0.01,
  total_tokens: 15,
  avg_input_tokens: 10,
  avg_output_tokens: 5,
  avg_latency_ms: 250,
  avg_confidence: 0.9,
  low_confidence_count: 0,
  risk_level: "low",
  customer_facing: true,
  evidence: {},
  examples: [{ trace_id: trace.id, prompt_preview: trace.prompt_text, response_preview: trace.response_text }],
  name_source: "llm",
} as DistinctTaskBucket;

const judgeResult: TraceJudgeResult = {
  id: "judge_scored",
  trace_id: trace.id,
  evaluator_type: "quality",
  score: 0.8,
  passed: true,
  rationale: "The response completed the requested task.",
  created_at: "2026-11-01T00:01:00.000Z",
};

describe("saved LLM task groups", () => {
  it("keeps persisted eval scores available when a workspace is reopened", () => {
    const markup = renderToStaticMarkup(
      <LLMGroupedTasks
        traces={[trace]}
        traceJudgeResults={[judgeResult]}
        workspaceId="personal"
        savedTaskGroups={[savedTaskGroup]}
      />,
    );

    expect(markup).toContain("80.0%");
    expect(markup).not.toContain("Not scored");
  });
});
