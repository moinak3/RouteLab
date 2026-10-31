import { afterEach, describe, expect, it, vi } from "vitest";
import {
  latestSimulationRun,
  loadSimulationRuns,
  saveSimulationRun,
  simulationRunComparisonKey,
} from "../src/core/simulationHistory";
import type { SavedSimulationRun } from "../src/core/simulationHistory";

function useMemoryStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
}

const result = {
  runs: [{
    id: "run_1",
    trace_id: "trace_1",
    candidate_model: "openai/gpt-6.1-sol",
    response_text: "Measured response",
    input_tokens: 100,
    output_tokens: 20,
    latency_ms: 500,
    cost_usd: 0.001,
    status: "success" as const,
  }],
  evals: [{
    id: "eval_1",
    trace_id: "trace_1",
    candidate_run_id: "run_1",
    evaluator_type: "llm_as_judge",
    score: 0.9,
    passed: true,
  }],
  summary: {
    baseline_cost_usd: 0.002,
    simulated_cost_usd: 0.001,
    estimated_savings_usd: 0.001,
    estimated_savings_pct: 50,
    baseline_avg_latency_ms: 900,
    simulated_avg_latency_ms: 500,
    latency_delta_pct: -44.4,
    average_quality_score: 0.9,
    pass_rate: 1,
    severe_failure_rate: 0,
  },
  evaluation: { eval_id: "quality", eval_name: "Quality", eval_version: 2, judge_model: "judge" },
};

function savedRun(overrides: Partial<SavedSimulationRun> = {}): SavedSimulationRun {
  return {
    id: "saved_1",
    comparisonKey: simulationRunComparisonKey({ scopeKey: "scope-a", evalId: "quality", evalVersion: 2 }),
    candidateId: "openai/gpt-6.1-sol",
    completedAt: "2026-10-31T12:00:00.000Z",
    source: "openrouter",
    label: "OpenRouter",
    traceIds: ["trace_1"],
    baselineResults: [],
    result,
    ...overrides,
  };
}

describe("simulation result history", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("restores only a completed run with the exact comparison key", () => {
    useMemoryStorage();
    const run = savedRun();
    saveSimulationRun("personal", run);

    expect(latestSimulationRun("personal", run.comparisonKey)?.id).toBe("saved_1");
    expect(latestSimulationRun("personal", simulationRunComparisonKey({ scopeKey: "scope-b", evalId: "quality", evalVersion: 2 }))).toBeNull();
  });

  it("treats eval versions as different evidence", () => {
    expect(simulationRunComparisonKey({ scopeKey: "scope-a", evalId: "quality", evalVersion: 2 }))
      .not.toBe(simulationRunComparisonKey({ scopeKey: "scope-a", evalId: "quality", evalVersion: 3 }));
  });

  it("keeps the newest result for a repeated comparison", () => {
    useMemoryStorage();
    const first = savedRun();
    const second = savedRun({ id: "saved_2", completedAt: "2026-10-31T13:00:00.000Z" });
    saveSimulationRun("personal", first);
    saveSimulationRun("personal", second);

    expect(loadSimulationRuns("personal")).toHaveLength(1);
    expect(latestSimulationRun("personal", first.comparisonKey)?.id).toBe("saved_2");
  });
});
