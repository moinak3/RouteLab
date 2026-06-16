import { describe, expect, it } from "vitest";
import { buildBenchmarkPriorRecommendation, mapDistinctTaskToBenchmarkPriors, recommendCandidateModels } from "../src/core/benchmarkPriors";
import type { DistinctTask } from "../src/types";

const base = (overrides: Partial<DistinctTask>): DistinctTask => ({
  task_type: "summarization",
  domain: "general",
  complexity: "medium",
  temporal_context: "single_turn",
  tool_use: "none",
  output_uncertainty: "low",
  output_format: "natural_language",
  grounding_requirement: "none",
  ...overrides,
});
const ids = (task: DistinctTask) => mapDistinctTaskToBenchmarkPriors(task).map((prior) => prior.benchmark_id);

describe("benchmark priors", () => {
  it("maps customer support with tools and policy adherence to tau bench and BFCL", () => {
    const task = base({ task_type: "customer_support_responses", domain: "customer_support", tool_use: "success", grounding_requirement: "policy_grounded" });
    const priors = mapDistinctTaskToBenchmarkPriors(task);
    expect(priors[0].benchmark_id).toBe("tau_bench");
    expect(ids(task)).toContain("bfcl");
    expect(priors[0].confidence).toBeGreaterThanOrEqual(4);
  });
  it("maps repo-wide coding with code output to SWE-bench and Terminal-Bench", () => {
    const task = base({ task_type: "code_generation", domain: "engineering", output_format: "code", complexity: "high" });
    expect(ids(task).slice(0, 2)).toEqual(["swe_bench_verified", "terminal_bench"]);
  });
  it("maps JSON extraction with tool calls to BFCL primary", () => {
    const task = base({ task_type: "extraction", output_format: "json", tool_use: "success" });
    expect(ids(task)[0]).toBe("bfcl");
  });
  it("maps browser workflow automation to WebArena/WebVoyager", () => {
    const task = base({ task_type: "tool_use_function_calling", domain: "general", tool_use: "success" });
    const priors = mapDistinctTaskToBenchmarkPriors(task);
    expect(priors[0].benchmark_id).toBe("webarena_webvoyager");
    expect(priors[0].confidence).toBeGreaterThanOrEqual(4);
  });
  it("maps long-context document QA to long-context benchmarks with optional expert priors", () => {
    const task = base({ task_type: "rag_grounded_answers", domain: "engineering", grounding_requirement: "source_citation_required", complexity: "high" });
    const priorIds = ids(task);
    expect(priorIds[0]).toBe("long_context");
    expect(priorIds).toContain("expert_reasoning");
  });
  it("keeps PM strategy writing low-confidence and recommends custom SignalEval traces", () => {
    const task = base({ task_type: "planning_strategy_recommendations", domain: "product", output_format: "natural_language" });
    const output = buildBenchmarkPriorRecommendation(task);
    expect(output.benchmark_priors[0].benchmark_id).toBe("custom_signaleval");
    expect(output.recommendation.benchmark_confidence).toBe("low");
    expect(output.candidate_models[0].caveats.join(" ")).toContain("Custom SignalEval traces should dominate");
  });
  it("returns suggested candidate models with separate model confidence", () => {
    const task = base({ task_type: "customer_support_responses", domain: "billing", tool_use: "success", grounding_requirement: "policy_grounded" });
    const candidates = recommendCandidateModels(task);
    expect(candidates).toHaveLength(5);
    expect(candidates[0].candidate_score).toBeGreaterThan(0);
    expect(candidates[0].confidence).toBeGreaterThanOrEqual(1);
    expect(candidates[0].rationale).toContain("Suggested candidate");
  });
});
