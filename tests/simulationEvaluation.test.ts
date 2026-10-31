import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateLiveReplay } from "../src/core/simulationEvaluation";
import type { CandidateRun, Trace, TraceJudgeResult } from "../src/types";

const activeEval = {
  version: 2,
  definition: {
    id: "personal_agent_eval",
    name: "Personal agent eval",
    status: "Running",
    evaluator_type: "llm_as_judge",
    model: "openai/gpt-5.5-pro",
    threshold: .85,
    prompt: "Evaluate the response.",
    dimensions: ["Outcome"],
    scope: "All task groups",
  },
};

const trace: Trace = {
  id: "trace_1",
  timestamp: "2026-10-29T12:00:00.000Z",
  model: "openai/gpt-5.4",
  messages: [{ role: "user", content: "Help me plan the task." }, { role: "assistant", content: "Original response." }],
  prompt_text: "Help me plan the task.",
  response_text: "Original response.",
  input_tokens: 20,
  output_tokens: 10,
  total_tokens: 30,
  latency_ms: 1000,
  cost_usd: .01,
  status: "success",
};

const run: CandidateRun = {
  id: "candidate_1",
  trace_id: trace.id,
  candidate_model: "particle-ai/particle-1",
  selected_model: "particle-ai/particle-1",
  response_text: "Candidate response.",
  input_tokens: 20,
  output_tokens: 8,
  latency_ms: 500,
  cost_usd: .002,
  status: "success",
};

function judgeResult(mode: "simulation_baseline" | "simulation_candidate", score: number): TraceJudgeResult {
  return {
    id: `${mode}_result`,
    trace_id: trace.id,
    evaluator_type: "personal_agent_eval (openai/gpt-5.5-pro)",
    score,
    passed: score >= .85,
    rationale: `${mode} rationale`,
    created_at: "2026-10-29T12:01:00.000Z",
    eval_id: activeEval.definition.id,
    eval_version: activeEval.version,
    run_id: `${mode}_run`,
    run_mode: mode,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("paired simulation evaluation", () => {
  it("reuses only an exact eval-version baseline and judges the candidate with that same version", async () => {
    const baseline = judgeResult("simulation_baseline", .61);
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request.mode).toBe("simulation_candidate");
      expect(request.evalVersion).toBe(activeEval.version);
      expect(request.definition).toEqual(activeEval.definition);
      expect(request.traces[0].response_text).toBe(run.response_text);
      return new Response(JSON.stringify({
        run: { id: "candidate_run", evalId: activeEval.definition.id, evalName: activeEval.definition.name, evalVersion: 2, mode: "simulation_candidate", status: "completed", traceCount: 1, passed: 1, failed: 0, averageScore: .9, startedAt: "now", completedAt: "now" },
        results: [judgeResult("simulation_candidate", .9)],
        errors: [],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const evaluated = await evaluateLiveReplay({
      workspaceId: "workspace_1",
      activeEval,
      traces: [trace],
      runs: [run],
      existingBaselineResults: [baseline],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(evaluated.baselineResults).toEqual([baseline]);
    expect(evaluated.result.summary.average_quality_score).toBe(.9);
    expect(evaluated.result.evaluation).toEqual({
      eval_id: activeEval.definition.id,
      eval_name: activeEval.definition.name,
      eval_version: activeEval.version,
      judge_model: activeEval.definition.model,
    });
  });

  it("re-scores the baseline when the saved result came from another eval version", async () => {
    const staleBaseline = { ...judgeResult("simulation_baseline", .61), eval_version: 1 };
    const modes: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      modes.push(request.mode);
      const score = request.mode === "simulation_baseline" ? .7 : .9;
      return new Response(JSON.stringify({
        run: { id: `${request.mode}_run`, evalId: activeEval.definition.id, evalName: activeEval.definition.name, evalVersion: 2, mode: request.mode, status: "completed", traceCount: 1, passed: 0, failed: 1, averageScore: score, startedAt: "now", completedAt: "now" },
        results: [judgeResult(request.mode, score)],
        errors: [],
      }), { status: 200 });
    }));

    const evaluated = await evaluateLiveReplay({
      workspaceId: "workspace_1",
      activeEval,
      traces: [trace],
      runs: [run],
      existingBaselineResults: [staleBaseline],
    });

    expect(new Set(modes)).toEqual(new Set(["simulation_baseline", "simulation_candidate"]));
    expect(evaluated.baselineResults[0]).toMatchObject({ score: .7, eval_version: 2 });
  });

  it("rejects candidate scores returned under a different eval identity", async () => {
    const baseline = judgeResult("simulation_baseline", .61);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      run: { id: "candidate_run", evalId: "other_eval", evalName: "Other eval", evalVersion: 1, mode: "simulation_candidate", status: "completed", traceCount: 1, passed: 1, failed: 0, averageScore: .9, startedAt: "now", completedAt: "now" },
      results: [{ ...judgeResult("simulation_candidate", .9), eval_id: "other_eval", eval_version: 1 }],
      errors: [],
    }), { status: 200 })));

    await expect(evaluateLiveReplay({
      workspaceId: "workspace_1",
      activeEval,
      traces: [trace],
      runs: [run],
      existingBaselineResults: [baseline],
    })).rejects.toThrow("different eval identity");
  });
});
