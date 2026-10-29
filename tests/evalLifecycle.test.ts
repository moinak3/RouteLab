import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureNewTraceEvaluation,
  loadEvalAutomationPolicies,
  mergeEvalResults,
  monthlyEvalHistory,
  selectHistoricalTestSample,
} from "../src/core/evalLifecycle";
import { evaluateTraceWithDefinition } from "../src/server/evalRuns";
import type { Trace, TraceJudgeResult } from "../src/types";

const definition = {
  id: "personal_agent_eval",
  name: "Personal agent eval",
  status: "Draft",
  evaluator_type: "llm_as_judge",
  model: "gpt-5.5-pro",
  threshold: .85,
  prompt: "Evaluate the response.",
  dimensions: ["Outcome"],
  scope: "All task groups",
};

function trace(index: number): Trace {
  return {
    id: `trace_${String(index).padStart(3, "0")}`,
    timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    model: "gpt-5.4",
    messages: [{ role: "user", content: `Request ${index}` }],
    prompt_text: `Request ${index}`,
    response_text: `Response ${index}`,
    input_tokens: 10,
    output_tokens: 10,
    total_tokens: 20,
    status: "success",
    metadata: { visible: "yes", _internal_reference: "hidden" },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("eval lifecycle", () => {
  it("reconciles monthly historical quality with passed divided by scored", () => {
    const results: TraceJudgeResult[] = Array.from({ length: 25 }, (_, index) => ({
      id: `result_${index}`,
      trace_id: `trace_${index}`,
      evaluator_type: "personal_agent_eval",
      eval_id: "personal_agent_eval",
      score: index < 3 ? 1 : index < 20 ? .5 : 0,
      passed: index < 3,
      rationale: "Historical evaluation result.",
      created_at: "2026-10-28T12:00:00.000Z",
    }));

    expect(monthlyEvalHistory(results)).toEqual([expect.objectContaining({
      count: 25,
      passing: 3,
      failing: 22,
      passRate: .12,
    })]);
  });

  it("selects a bounded historical sample spanning the full time range", () => {
    const traces = Array.from({ length: 100 }, (_, index) => trace(index));
    const sample = selectHistoricalTestSample(traces, 25);

    expect(sample).toHaveLength(25);
    expect(sample[0].id).toBe("trace_000");
    expect(sample.at(-1)?.id).toBe("trace_099");
    expect(new Set(sample.map((item) => item.id)).size).toBe(25);
  });

  it("starts continuous evaluation after the current trace population", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
      dispatchEvent: vi.fn(),
    });

    configureNewTraceEvaluation({
      workspaceId: "workspace_1",
      definition,
      evalVersion: 2,
      enabled: true,
      currentTraceIds: ["trace_existing_1", "trace_existing_2"],
      now: "2026-10-28T12:00:00.000Z",
    });

    expect(loadEvalAutomationPolicies("workspace_1")[0]).toMatchObject({
      evalId: definition.id,
      evalVersion: 2,
      runOnNewTraces: true,
      enabledAt: "2026-10-28T12:00:00.000Z",
      knownTraceIds: ["trace_existing_1", "trace_existing_2"],
    });
  });

  it("keeps one result per eval and trace while preserving other evaluators", () => {
    const current: TraceJudgeResult[] = [
      { id: "old", trace_id: "trace_1", evaluator_type: "personal", eval_id: "personal", score: .5, passed: false, rationale: "old", created_at: "2026-10-01" },
      { id: "policy", trace_id: "trace_1", evaluator_type: "policy", eval_id: "policy", score: 1, passed: true, rationale: "ok", created_at: "2026-10-01" },
    ];
    const incoming: TraceJudgeResult[] = [
      { id: "new", trace_id: "trace_1", evaluator_type: "personal", eval_id: "personal", score: 1, passed: true, rationale: "new", created_at: "2026-10-02" },
    ];

    expect(mergeEvalResults(current, incoming).map((result) => result.id)).toEqual(["new", "policy"]);
  });

  it("runs the saved judge definition against trace evidence without exposing internal metadata", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request.model).toBe("openai/gpt-5.5-pro");
      expect(request.messages[1].content).toContain('"visible":"yes"');
      expect(request.messages[1].content).not.toContain("_internal_reference");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ score: .9, passed: true, rationale: "The requested outcome was achieved.", severity: null }) } }] }), { status: 200 });
    });

    const result = await evaluateTraceWithDefinition({
      definition,
      trace: trace(1),
      evalVersion: 3,
      runId: "run_1",
      runMode: "historical_test",
      apiKey: "test-key",
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(result).toMatchObject({ eval_id: definition.id, eval_version: 3, run_id: "run_1", score: .9, passed: true });
  });

  it("returns the provider error when an entire historical run fails", async () => {
    vi.stubEnv("ROUTELAB_OPENROUTER_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { message: "calibrated judge model is not a valid model ID" },
    }), { status: 400 })));
    const { default: evalRunHandler } = await import("../src/server/evalRuns");
    const response = {
      statusCode: 200,
      payload: undefined as unknown,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: unknown) { this.payload = payload; return payload; },
    };

    await evalRunHandler({
      method: "POST",
      body: { definition, evalVersion: 1, mode: "historical_test", traces: [trace(1)] },
    }, response);

    expect(response.statusCode).toBe(502);
    expect(response.payload).toMatchObject({ error: "calibrated judge model is not a valid model ID" });
  });
});
