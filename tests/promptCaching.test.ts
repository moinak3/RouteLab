import { describe, expect, it } from "vitest";
import { buildPromptCachingOpportunity, buildPromptCachingOpportunityBundle } from "../src/core/promptCaching";
import { createDistinctTaskBuckets } from "../src/core/distinctTasks";
import type { Trace } from "../src/types";

const staticSystem = "You are a support classifier. Follow the taxonomy, return strict JSON, preserve priority rules, and never invent fields. ".repeat(80);

function trace(id: number, overrides: Partial<Trace> = {}): Trace {
  const prompt = overrides.prompt_text ?? `Customer ticket ${id}: refund request with billing dispute.`;
  const system = String(overrides.messages?.find((message) => message.role === "system")?.content ?? staticSystem);
  return {
    id: `trace_${id}`,
    timestamp: "2026-06-25T00:00:00.000Z",
    provider: "openai",
    model: "gpt-5.5-pro",
    messages: overrides.messages ?? [{ role: "system", content: system }, { role: "user", content: prompt }],
    prompt_text: prompt,
    response_text: '{"intent":"billing_dispute"}',
    input_tokens: overrides.input_tokens ?? 2600,
    output_tokens: overrides.output_tokens ?? 120,
    total_tokens: (overrides.input_tokens ?? 2600) + (overrides.output_tokens ?? 120),
    latency_ms: 1500,
    cost_usd: overrides.cost_usd ?? .09,
    status: "success",
    metadata: { task_type: "classification_tagging", domain: "billing", ...(overrides.metadata ?? {}) },
    ...overrides,
  };
}

describe("prompt caching opportunities", () => {
  it("recommends cache_control markers for a stable long prefix with traffic", () => {
    const traces = Array.from({ length: 200 }, (_, index) => trace(index));
    const opportunity = buildPromptCachingOpportunity({ traces, monthlyRequestVolume: 50_000 });

    expect(opportunity.recommendation).toBe("add_cache_control");
    expect(opportunity.stable_prefix_tokens).toBeGreaterThan(1200);
    expect(opportunity.per_provider.length).toBeGreaterThanOrEqual(5);
    expect(opportunity.per_provider[0].monthly_savings).toBeGreaterThan(0);
    expect(opportunity.marker_instruction).toMatch(/cache_control/);
  });

  it("does not suggest duplicate markers when cache_control already exists", () => {
    const traces = Array.from({ length: 20 }, (_, index) => trace(index, {
      metadata: { cache_control: { type: "ephemeral" }, static_prompt_tokens: 1600 },
    }));
    const opportunity = buildPromptCachingOpportunity({ traces, monthlyRequestVolume: 20_000 });

    expect(opportunity.recommendation).toBe("already_configured");
    expect(opportunity.prompt_cache_configured).toBe(true);
  });

  it("does not recommend caching for mostly dynamic prompts", () => {
    const traces = Array.from({ length: 20 }, (_, index) => trace(index, {
      messages: [{ role: "user", content: `Unique current-context payload ${index}: ${"dynamic facts ".repeat(index + 2)}` }],
      prompt_text: `Unique current-context payload ${index}: ${"dynamic facts ".repeat(index + 2)}`,
      input_tokens: 300,
      metadata: { static_prompt_tokens: 0, few_shot_tokens: 0 },
    }));
    const opportunity = buildPromptCachingOpportunity({ traces, monthlyRequestVolume: 20_000 });

    expect(opportunity.recommendation).toBe("not_recommended");
    expect(opportunity.stable_prefix_tokens).toBeLessThan(128);
  });

  it("returns per-trace-signature cache opportunities", () => {
    const stable = Array.from({ length: 40 }, (_, index) => trace(index));
    const dynamic = Array.from({ length: 40 }, (_, index) => trace(1000 + index, {
      messages: [{ role: "user", content: `Answer from retrieved context ${index}: ${"policy ".repeat(index + 1)}` }],
      prompt_text: `Answer from retrieved context ${index}: ${"policy ".repeat(index + 1)}`,
      input_tokens: 500,
      metadata: { task_type: "rag_grounded_answers", retrieved_context_tokens: 350, static_prompt_tokens: 0 },
      spans: [{ id: `retriever_${index}`, type: "retriever" }],
    }));
    const traces = [...stable, ...dynamic];
    const bundle = buildPromptCachingOpportunityBundle({
      traces,
      distinctTaskBuckets: createDistinctTaskBuckets(traces),
      monthlyRequestVolume: 80_000,
    });

    expect(bundle.global.scope).toBe("global");
    expect(bundle.by_signature.length).toBeGreaterThan(1);
    expect(bundle.by_signature.some((opportunity) => opportunity.recommendation === "add_cache_control")).toBe(true);
  });
});
