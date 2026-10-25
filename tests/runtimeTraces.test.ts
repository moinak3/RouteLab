import { describe, expect, it } from "vitest";
import { runtimeTraceFromResult } from "../api/sidecar/_traceStore";
import { isUnknownClassifierTrace, mergeRuntimeTraces } from "../src/core/runtimeTraces";
import type { Trace } from "../src/types";

describe("runtime trace ingestion", () => {
  it("normalizes an unknown sidecar decision into a reviewable trace", () => {
    const trace = runtimeTraceFromResult({
      request: { messages: [{ role: "user", content: "A completely new workflow" }], tools: [] },
      payload: {
        ok: true,
        openRouterRequest: { model: "openai/gpt-5.5-pro" },
        openRouterResponse: { choices: [{ message: { content: "Can you provide more detail?" } }], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28, cost: .001 } },
        timing: { totalMs: 420 },
      },
      decision: { signatureId: "unknown", signatureLabel: "Unknown or new trace bucket", confidence: .31, probabilities: { unknown: .31 }, threshold: 1, status: "unknown", latencyMs: 55, reason: "No published trace bucket matched reliably." },
      route: { source: "fallback", taskBucketId: "unknown", taskBucketLabel: "Unknown or new trace bucket", policyId: "policy_1", policyVersion: 1, openRouterModelId: "openai/gpt-5.5-pro" },
      source: "routelab_support",
    });

    expect(trace.prompt_text).toBe("A completely new workflow");
    expect(trace.response_text).toBe("Can you provide more detail?");
    expect(trace.source).toBe("routelab_support");
    expect(trace.metadata?.unknown_classifier).toBe(true);
    expect(isUnknownClassifierTrace(trace)).toBe(true);
  });

  it("merges persisted runtime traces without duplicating existing rows", () => {
    const base: Trace = {
      id: "trace_1", timestamp: "2026-01-01T00:00:00.000Z", model: "model-a", messages: [], prompt_text: "old",
      input_tokens: 0, output_tokens: 0, total_tokens: 0, status: "success",
    };
    const updated = { ...base, prompt_text: "new" };
    const second = { ...base, id: "trace_2" };
    expect(mergeRuntimeTraces([base], [updated, second])).toEqual([updated, second]);
  });
});
