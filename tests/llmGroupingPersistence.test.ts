import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LLM_GROUPING_PROMPT_VERSION,
  LLM_GROUPING_SCHEMA_VERSION,
  createLLMGroupingSnapshot,
  stableLLMGroupId,
  type LLMGroupingRun,
} from "../src/core/llmGrouping";
import { runLLMGroupingExperiment } from "../src/core/llmGroupingPersistence";
import type { Trace } from "../src/types";

const trace: Trace = {
  id: "trace-1",
  timestamp: "2026-10-27T12:00:00.000Z",
  provider: "OpenRouter",
  model: "current-model",
  messages: [{ role: "user", content: "Where is my order?" }],
  prompt_text: "Where is my order?",
  response_text: "It is in transit.",
  input_tokens: 20,
  output_tokens: 8,
  total_tokens: 28,
  latency_ms: 500,
  cost_usd: 0.001,
  status: "success",
};

function completedRun(): LLMGroupingRun {
  const snapshot = createLLMGroupingSnapshot([trace]);
  const definition = {
    name: "Order Status Lookups",
    description: "Retrieve the current status of an order.",
    inclusionCriteria: ["The user asks where an order is."],
    exclusionCriteria: ["The user requests a refund."],
  };
  const groupId = stableLLMGroupId(definition);
  return {
    schemaVersion: LLM_GROUPING_SCHEMA_VERSION,
    runId: "recovered-run",
    provider: "OpenRouter",
    model: "test/model",
    promptVersion: LLM_GROUPING_PROMPT_VERSION,
    startedAt: "2026-10-27T12:00:00.000Z",
    completedAt: "2026-10-27T12:01:00.000Z",
    snapshot,
    method: { discoverySampling: "none", discoveryTraceCount: 1, assignmentTraceCount: 1, batchSize: 32, metadataFieldsUsed: [], excludedFields: [] },
    groups: [{
      id: groupId,
      ...definition,
      representativeTraceIds: [trace.id],
      confusingCounterexamples: [],
      nearestNeighbors: [],
      attributes: { modality: ["text"], grounding: ["none"], expectedOutput: ["status"], reasoningRequirements: ["lookup"] },
      suggestedEvaluationDimensions: ["factuality"],
      routingRationale: "A lightweight retrieval-capable model can handle this group.",
    }],
    assignments: [{ traceId: trace.id, status: "assigned", groupId, confidence: 0.96, alternateGroupIds: [], rationale: "The request asks for current order status." }],
    coverage: { assigned: 1, ambiguous: 0, unassigned: 0, processed: 1, total: 1 },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("LLM grouping stream recovery", () => {
  it("loads the matching saved run when the stream closes before its complete event", async () => {
    const run = completedRun();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/run")) {
        return new Response(`${JSON.stringify({ type: "heartbeat", at: "2026-10-27T12:00:30.000Z" })}\n`, {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }
      return new Response(JSON.stringify({ run }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchImpl);

    await expect(runLLMGroupingExperiment([trace], "workspace-1", vi.fn())).resolves.toEqual(run);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
