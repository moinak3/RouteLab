import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureNewTraceEvaluation,
  evalRunBatches,
  historicalEvalRunCoversPopulation,
  loadEvalAutomationPolicies,
  loadEvalRunHistory,
  mergeEvalResults,
  monthlyEvalHistory,
  removeEvalLifecycleState,
  runEvalBatchPool,
  saveEvalRunRecord,
  type EvalRunRecord,
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

  it("partitions the complete historical trace library without sampling", () => {
    const traces = Array.from({ length: 100 }, (_, index) => trace(index));
    const batches = evalRunBatches(traces, 25);
    const population = batches.flat();

    expect(batches).toHaveLength(4);
    expect(batches.every((batch) => batch.length === 25)).toBe(true);
    expect(population).toHaveLength(100);
    expect(population[0].id).toBe("trace_000");
    expect(population.at(-1)?.id).toBe("trace_099");
    expect(new Set(population.map((item) => item.id)).size).toBe(100);
  });

  it("runs historical batches with bounded concurrency and processes every trace once", async () => {
    const batches = evalRunBatches(Array.from({ length: 100 }, (_, index) => trace(index)), 25);
    const processed: string[] = [];
    let active = 0;
    let maxActive = 0;

    await runEvalBatchPool(batches, async (batch) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return batch.map((item) => item.id);
    }, (ids) => {
      processed.push(...ids);
    });

    expect(maxActive).toBe(2);
    expect(processed).toHaveLength(100);
    expect(new Set(processed).size).toBe(100);
  });

  it("does not treat an old 25-trace sample as a complete 300-trace historical test", () => {
    const sampledRun: EvalRunRecord = {
      id: "run_sampled",
      evalId: "personal_agent_eval",
      evalName: "Personal agent eval",
      evalVersion: 1,
      mode: "historical_test",
      status: "completed",
      traceCount: 25,
      passed: 20,
      failed: 5,
      averageScore: .8,
      startedAt: "2026-10-29T12:00:00.000Z",
      completedAt: "2026-10-29T12:01:00.000Z",
    };

    expect(historicalEvalRunCoversPopulation(sampledRun, 300)).toBe(false);
    expect(historicalEvalRunCoversPopulation({ ...sampledRun, attemptedCount: 300 }, 300)).toBe(true);
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

  it("removes a deleted eval's automation policy and run history without touching other evals", () => {
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
      currentTraceIds: ["trace_1"],
    });
    const otherDefinition = { ...definition, id: "other_eval", name: "Other eval" };
    configureNewTraceEvaluation({
      workspaceId: "workspace_1",
      definition: otherDefinition,
      evalVersion: 1,
      enabled: true,
      currentTraceIds: ["trace_1"],
    });
    saveEvalRunRecord("workspace_1", {
      id: "run_deleted",
      evalId: definition.id,
      evalName: definition.name,
      evalVersion: 2,
      mode: "historical_test",
      status: "completed",
      traceCount: 1,
      passed: 1,
      failed: 0,
      averageScore: 1,
      startedAt: "2026-10-28T12:00:00.000Z",
      completedAt: "2026-10-28T12:01:00.000Z",
    });
    saveEvalRunRecord("workspace_1", {
      id: "run_kept",
      evalId: otherDefinition.id,
      evalName: otherDefinition.name,
      evalVersion: 1,
      mode: "historical_test",
      status: "completed",
      traceCount: 1,
      passed: 1,
      failed: 0,
      averageScore: 1,
      startedAt: "2026-10-28T12:00:00.000Z",
      completedAt: "2026-10-28T12:02:00.000Z",
    });

    removeEvalLifecycleState("workspace_1", definition.id);

    expect(loadEvalAutomationPolicies("workspace_1").map((policy) => policy.evalId)).toEqual(["other_eval"]);
    expect(loadEvalRunHistory("workspace_1").map((run) => run.id)).toEqual(["run_kept"]);
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
      expect(request.messages[1].content).toContain('"evidence_schema_version":"routelab.eval-evidence.v1"');
      expect(request.messages[1].content).toContain('"evaluation_scope":"full_trajectory"');
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

  it("does not leak the original final answer or human calibration labels into candidate judging", async () => {
    const candidateTrace: Trace = {
      ...trace(1),
      response_text: "Candidate response.",
      messages: [
        { role: "system", content: "Follow the user request." },
        { role: "user", content: "Request 1" },
        { role: "assistant", content: "Original response 1" },
      ],
      metadata: {
        visible: "yes",
        human_feedback: "thumbs down",
        corrected_output: "Hidden correction",
        nested: { expected_answer: "Hidden answer", operational: "keep" },
      },
    };
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const evidence = request.messages[1].content as string;
      expect(evidence).toContain("Candidate response.");
      expect(evidence).toContain('"operational":"keep"');
      expect(evidence).not.toContain("Original response 1");
      expect(evidence).not.toContain("thumbs down");
      expect(evidence).not.toContain("Hidden correction");
      expect(evidence).not.toContain("Hidden answer");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ score: .9, passed: true, rationale: "Candidate passed.", severity: null }) } }] }), { status: 200 });
    });

    await evaluateTraceWithDefinition({
      definition,
      trace: candidateTrace,
      evalVersion: 3,
      runId: "candidate_run",
      runMode: "simulation_candidate",
      apiKey: "test-key",
      fetchImpl: fetchMock as typeof fetch,
    });
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
