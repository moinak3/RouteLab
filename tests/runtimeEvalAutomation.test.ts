import { describe, expect, it, vi } from "vitest";
import { evaluateTraceForAutomationPolicies } from "../api/evals/_automation";
import type { EvalAutomationPolicy } from "../src/core/evalLifecycle";
import type { Trace, TraceJudgeResult } from "../src/types";

const trace: Trace = {
  id: "runtime_new_1",
  timestamp: "2026-11-02T12:00:00.000Z",
  model: "openrouter/auto",
  messages: [{ role: "user", content: "Where is my order?" }],
  prompt_text: "Where is my order?",
  response_text: "Your order is processing and should update within one business day.",
  input_tokens: 10,
  output_tokens: 12,
  total_tokens: 22,
  status: "success",
};

const policy: EvalAutomationPolicy = {
  evalId: "trace_quality_llm_judge",
  evalVersion: 2,
  definition: {
    id: "trace_quality_llm_judge",
    name: "Trace quality LLM judge",
    status: "Running",
    evaluator_type: "llm_as_judge",
    model: "gpt-5.5-pro",
    threshold: .85,
    prompt: "Evaluate the response.",
    dimensions: ["Outcome"],
    scope: "All task groups",
  },
  runOnNewTraces: true,
  enabledAt: "2026-11-02T11:00:00.000Z",
  knownTraceIds: [],
  updatedAt: "2026-11-02T11:00:00.000Z",
};

describe("runtime eval automation", () => {
  it("evaluates and persists a new runtime trace with the enabled eval version", async () => {
    const result: TraceJudgeResult = {
      id: "result_1",
      trace_id: trace.id,
      evaluator_type: policy.definition.evaluator_type,
      eval_id: policy.evalId,
      eval_version: policy.evalVersion,
      run_mode: "new_traces",
      score: .9,
      passed: true,
      rationale: "The response answered the request.",
      created_at: "2026-11-02T12:00:01.000Z",
    };
    const save = vi.fn(async () => undefined);
    const evaluate = vi.fn(async () => result);

    const results = await evaluateTraceForAutomationPolicies({
      trace,
      policies: [policy],
      hasResult: async () => false,
      evaluate,
      save,
    });

    expect(results).toEqual([result]);
    expect(evaluate).toHaveBeenCalledWith(policy, trace);
    expect(save).toHaveBeenCalledWith(result);
  });

  it("does not rerun a trace that already has a persisted result", async () => {
    const evaluate = vi.fn();
    const save = vi.fn();
    const results = await evaluateTraceForAutomationPolicies({
      trace,
      policies: [policy],
      hasResult: async () => true,
      evaluate,
      save,
    });

    expect(results).toEqual([]);
    expect(evaluate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
