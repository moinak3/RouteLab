import { describe, expect, it } from "vitest";
import { buildFineTuningRecommendation, buildFineTuningRecommendationBundle } from "../src/core/fineTuningRecommendations";
import { createDistinctTaskBuckets } from "../src/core/distinctTasks";
import type { GoldenDataset, Trace, TraceJudgeResult } from "../src/types";

const now = "2026-06-25T00:00:00.000Z";
const staticInstruction = "Follow the company response rubric. Return strict JSON. Use the approved tone. ".repeat(90);
const fewShot = "Example 1: input A -> output A. Example 2: input B -> output B. ".repeat(35);
const ragContext = "Retrieved context: Current product policy, pricing, inventory, and support policy excerpts. ".repeat(150);

function trace(id: number, overrides: Partial<Trace> = {}): Trace {
  const prompt = overrides.prompt_text ?? `${staticInstruction}${fewShot} User request ${id}: classify this ticket.`;
  const input = overrides.input_tokens ?? 4200;
  const output = overrides.output_tokens ?? 180;
  return {
    id: `trace_${id}`,
    timestamp: new Date(Date.UTC(2026, 5, 1 + id % 20)).toISOString(),
    provider: "openai",
    model: "gpt-5.5-pro",
    messages: [{ role: "system", content: staticInstruction }, { role: "user", content: prompt }],
    prompt_text: prompt,
    response_text: overrides.response_text ?? '{"intent":"billing_dispute","priority":"high"}',
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    latency_ms: overrides.latency_ms ?? 1800,
    cost_usd: overrides.cost_usd ?? .16,
    status: "success",
    metadata: {
      task_type: "classification_tagging",
      domain: "customer_support",
      static_prompt_tokens: 2600,
      few_shot_tokens: 900,
      _internal_reference: '{"intent":"billing_dispute","priority":"high"}',
      _internal_candidate_quality: "fails",
      ...(overrides.metadata ?? {}),
    },
    spans: overrides.spans,
    ...overrides,
  };
}

function judges(traces: Trace[], mode: "pass" | "format" | "diverse" = "pass"): TraceJudgeResult[] {
  const rationales = [
    "Response is not valid JSON and misses a required field.",
    "Response hallucinates unsupported product facts.",
    "Response uses the wrong classification label.",
    "Response has a reasoning error.",
    "Response violates support policy.",
    "Response has a tone/style mismatch.",
  ];
  return traces.map((item, index) => ({
    id: `judge_${item.id}`,
    trace_id: item.id,
    evaluator_type: "llm_as_judge",
    score: mode === "pass" ? 1 : .5,
    passed: mode === "pass",
    severity: mode === "pass" ? undefined : "major",
    rationale: mode === "format" ? rationales[0] : mode === "diverse" ? rationales[index % rationales.length] : "The answer passes the task rubric.",
    created_at: item.timestamp,
  }));
}

function golden(count: number, traces: Trace[]): GoldenDataset {
  return {
    id: `golden_${count}`,
    name: "golden.csv",
    created_at: now,
    row_count: count,
    columns: ["trace_id", "prompt", "agent_answer", "human_answer", "human_passed", "human_score"],
    rows: Array.from({ length: count }, (_, index) => {
      const item = traces[index % traces.length];
      return {
        trace_id: item.id,
        prompt: item.prompt_text,
        agent_answer: item.response_text ?? "",
        human_answer: String(item.metadata?._internal_reference ?? item.response_text ?? ""),
        human_passed: true,
        human_score: 1,
      };
    }),
  };
}

describe("fine-tuning recommendations", () => {
  it("recommends a fine-tuning pilot for long static prompts with high traffic", () => {
    const traces = Array.from({ length: 1200 }, (_, index) => trace(index));
    const buckets = createDistinctTaskBuckets(traces);
    const report = buildFineTuningRecommendation({
      traces,
      distinctTaskBuckets: buckets,
      traceJudgeResults: judges(traces, "format"),
      goldenDatasets: [golden(1200, traces)],
      monthlyRequestVolume: 100_000,
    });

    expect(["use_routing", "pilot_fine_tuning", "strongly_recommend_fine_tuning"]).toContain(report.recommendation);
    expect(report.score).toBeGreaterThanOrEqual(70);
    expect(report.prompt_analysis.compressible_token_pct).toBeGreaterThan(55);
    expect(report.economic_summary.monthly_savings).toBeGreaterThan(0);
  });

  it("does not fine-tune short prompts with low traffic", () => {
    const traces = Array.from({ length: 20 }, (_, index) => trace(index, {
      prompt_text: `Classify ticket ${index}`,
      input_tokens: 70,
      output_tokens: 20,
      cost_usd: .0004,
      metadata: { task_type: "classification_tagging", static_prompt_tokens: 0, few_shot_tokens: 0 },
    }));
    const report = buildFineTuningRecommendation({
      traces,
      distinctTaskBuckets: createDistinctTaskBuckets(traces),
      traceJudgeResults: judges(traces),
      monthlyRequestVolume: 100,
    });

    expect(report.recommendation).toBe("do_not_fine_tune");
    expect(report.data_readiness.readiness_level).toBe("insufficient");
  });

  it("prefers RAG/context improvements for dynamic RAG-heavy prompts", () => {
    const traces = Array.from({ length: 1200 }, (_, index) => trace(index, {
      prompt_text: `${ragContext} Customer asks for current plan pricing ${index}.`,
      input_tokens: 5200,
      metadata: {
        task_type: "rag_grounded_answers",
        domain: "customer_support",
        retrieved_context_tokens: 3900,
        static_prompt_tokens: 200,
        few_shot_tokens: 0,
        retrieved_context: "Current plan pricing and product docs.",
      },
      spans: [{ id: `retriever_${index}`, type: "retriever", name: "pricing docs" }],
    }));
    const report = buildFineTuningRecommendation({
      traces,
      distinctTaskBuckets: createDistinctTaskBuckets(traces),
      traceJudgeResults: judges(traces, "format"),
      goldenDatasets: [golden(1200, traces)],
      monthlyRequestVolume: 80_000,
    });

    expect(report.recommendation).toBe("improve_prompting_or_context");
    expect(report.prompt_analysis.avg_retrieved_context_tokens).toBeGreaterThan(report.prompt_analysis.avg_static_prompt_tokens);
    expect(report.risks.join(" ")).toMatch(/retrieved|dynamic|RAG/i);
  });

  it("uses corrected examples in data readiness", () => {
    const traces = Array.from({ length: 200 }, (_, index) => trace(index));
    const report = buildFineTuningRecommendation({
      traces,
      distinctTaskBuckets: createDistinctTaskBuckets(traces),
      traceJudgeResults: judges(traces),
      goldenDatasets: [golden(2200, traces)],
      monthlyRequestVolume: 20_000,
    });

    expect(report.data_readiness.corrected_examples_available).toBe(2200);
    expect(report.data_readiness.readiness_level).toBe("pilot_ready");
    expect(report.data_readiness.label_quality).not.toBe("low");
  });

  it("marks fewer than 100 examples as insufficient", () => {
    const traces = Array.from({ length: 80 }, (_, index) => trace(index));
    const report = buildFineTuningRecommendation({
      traces,
      distinctTaskBuckets: createDistinctTaskBuckets(traces),
      traceJudgeResults: judges(traces),
      monthlyRequestVolume: 10_000,
    });

    expect(report.data_readiness.training_examples_available).toBe(80);
    expect(report.recommendation).toBe("do_not_fine_tune");
  });

  it("detects repeated formatting failures as teachable", () => {
    const traces = Array.from({ length: 600 }, (_, index) => trace(index, {
      response_text: "intent=billing priority=high",
      metadata: { task_type: "extraction", static_prompt_tokens: 2000, few_shot_tokens: 800 },
    }));
    const report = buildFineTuningRecommendation({
      traces,
      distinctTaskBuckets: createDistinctTaskBuckets(traces),
      traceJudgeResults: judges(traces, "format"),
      goldenDatasets: [golden(600, traces)],
      monthlyRequestVolume: 60_000,
    });

    expect(report.quality_summary.main_failure_modes).toContain("missing_field");
    expect(report.quality_summary.fine_tuning_likely_to_help).toBe(true);
    expect(report.quality_summary.systematic_failure_rate).toBeGreaterThan(80);
  });

  it("does not over-recommend on random diverse failures", () => {
    const traces = Array.from({ length: 600 }, (_, index) => trace(index, {
      prompt_text: `Handle unrelated support task ${index}: ${["refund", "legal clause", "pricing", "tool lookup", "tone rewrite", "inventory"][index % 6]}`,
      metadata: { task_type: "customer_support_responses", static_prompt_tokens: 200, few_shot_tokens: 0 },
    }));
    const report = buildFineTuningRecommendation({
      traces,
      distinctTaskBuckets: createDistinctTaskBuckets(traces),
      traceJudgeResults: judges(traces, "diverse"),
      goldenDatasets: [golden(600, traces)],
      monthlyRequestVolume: 60_000,
    });

    expect(report.quality_summary.fine_tuning_likely_to_help).toBe(false);
    expect(report.recommendation).not.toBe("strongly_recommend_fine_tuning");
  });

  it("prefers routing when a cheaper existing model solves the task", () => {
    const traces = Array.from({ length: 1200 }, (_, index) => trace(index, {
      input_tokens: 500,
      output_tokens: 80,
      cost_usd: .06,
      metadata: { task_type: "classification_tagging", _internal_candidate_quality: "passes", static_prompt_tokens: 100, few_shot_tokens: 0 },
    }));
    const report = buildFineTuningRecommendation({
      traces,
      distinctTaskBuckets: createDistinctTaskBuckets(traces),
      traceJudgeResults: judges(traces),
      goldenDatasets: [golden(1200, traces)],
      monthlyRequestVolume: 90_000,
    });

    expect(report.recommendation).toBe("use_routing");
    expect(report.routing_comparison.routing_cost_reduction_pct).toBeGreaterThan(20);
  });

  it("recommends fine-tuning when it beats routing economically", () => {
    const traces = Array.from({ length: 1500 }, (_, index) => trace(index, {
      model: "deepseek-r1",
      cost_usd: .02,
      input_tokens: 6200,
      output_tokens: 160,
      metadata: {
        task_type: "classification_tagging",
        _internal_candidate_quality: "fails",
        static_prompt_tokens: 4200,
        few_shot_tokens: 900,
      },
    }));
    const report = buildFineTuningRecommendation({
      traces,
      distinctTaskBuckets: createDistinctTaskBuckets(traces),
      traceJudgeResults: judges(traces, "format"),
      goldenDatasets: [golden(1500, traces)],
      monthlyRequestVolume: 120_000,
      trainingCostUsd: 100,
      setupCostUsd: 100,
      monthlyMaintenanceCostUsd: 0,
      monthlyHostingCostUsd: 0,
    });

    expect(["pilot_fine_tuning", "strongly_recommend_fine_tuning"]).toContain(report.recommendation);
    expect(report.routing_comparison.routing_cost_reduction_pct).toBeLessThan(report.economic_summary.total_cost_reduction_pct);
  });

  it("flags missing pricing data instead of fabricating exact savings", () => {
    const traces = Array.from({ length: 200 }, (_, index) => trace(index, {
      model: "unknown-private-model",
      cost_usd: undefined,
      metadata: { task_type: "classification_tagging", static_prompt_tokens: 2000, few_shot_tokens: 500 },
    }));
    const report = buildFineTuningRecommendation({
      traces,
      distinctTaskBuckets: createDistinctTaskBuckets(traces),
      traceJudgeResults: judges(traces),
      goldenDatasets: [golden(200, traces)],
      monthlyRequestVolume: 20_000,
    });

    expect(report.economic_summary.current_monthly_cost).toBe(0);
    expect(report.risks.join(" ")).toMatch(/Pricing data is missing/);
    expect(report.confidence).toBe("low");
  });

  it("flags missing volume data", () => {
    const traces = Array.from({ length: 200 }, (_, index) => trace(index));
    const report = buildFineTuningRecommendation({
      traces,
      distinctTaskBuckets: createDistinctTaskBuckets(traces),
      traceJudgeResults: judges(traces),
      goldenDatasets: [golden(200, traces)],
      monthlyRequestVolume: 0,
    });

    expect(report.economic_summary.current_monthly_cost).toBe(0);
    expect(report.risks.join(" ")).toMatch(/Monthly request volume is missing/);
  });

  it("returns per-trace-signature recommendations", () => {
    const traces = [
      ...Array.from({ length: 120 }, (_, index) => trace(index, { metadata: { task_type: "classification_tagging", static_prompt_tokens: 1000, few_shot_tokens: 500 } })),
      ...Array.from({ length: 120 }, (_, index) => trace(1000 + index, { metadata: { task_type: "rag_grounded_answers", retrieved_context_tokens: 2400, static_prompt_tokens: 100 } })),
    ];
    const buckets = createDistinctTaskBuckets(traces);
    const bundle = buildFineTuningRecommendationBundle({
      traces,
      distinctTaskBuckets: buckets,
      traceJudgeResults: judges(traces, "format"),
      goldenDatasets: [golden(240, traces)],
      monthlyRequestVolume: 24_000,
    });

    expect(bundle.global.scope).toBe("global");
    expect(bundle.by_signature.length).toBeGreaterThan(1);
    expect(bundle.by_signature.every((report) => report.scope === "trace_signature")).toBe(true);
  });
});
