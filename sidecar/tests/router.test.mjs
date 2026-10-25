import { describe, expect, it, vi } from "vitest";
import {
  classifyConversation,
  conversationState,
  routeConversation,
  routedChatRequest,
  selectRoute,
  signatureCriteria,
} from "../src/router.mjs";

const bundle = {
  schemaVersion: "routelab.policy.v3",
  workspaceId: "workspace_test",
  policyId: "policy_test",
  version: 4,
  issuedAt: "2026-10-24T00:00:00.000Z",
  expiresAt: "2027-01-24T00:00:00.000Z",
  classifier: {
    provider: "openrouter",
    model: "typesafe/jev-1.14",
    endpoint: "https://openrouter.ai/api/alpha/decisions",
    timeoutMs: 1_500,
    unknownSignatureId: "unknown",
    riskThresholds: { low: .8, medium: .86, high: .92 },
  },
  defaultStrategy: { type: "fixed_model", target: { modelId: "gpt-5.5-pro", openRouterModelId: "openai/gpt-5.5-pro" } },
  emergencyFallback: { modelId: "claude-opus-4.8", openRouterModelId: "anthropic/claude-opus-4.8" },
  guardrails: { minimumPassRate: .9, maximumLatencyIncreasePct: 20, minimumReplayCount: 3 },
  signatures: [{
    id: "billing_dispute",
    label: "Billing dispute",
    description: "Refunds, disputed charges, and invoice corrections",
    riskLevel: "medium",
    task: {
      task_type: "customer_support_responses",
      domain: "billing",
      complexity: "medium",
      temporal_context: "late_multi_turn",
      tool_use: "success",
      output_uncertainty: "low",
      output_format: "natural_language",
      grounding_requirement: "tool_grounded",
    },
    examples: ["Refund the duplicate invoice charge after checking the account."],
  }],
  overrides: [{
    taskId: "billing_dispute",
    modelId: "deepseek-r1",
    openRouterModelId: "deepseek/deepseek-r1",
    provider: "DeepInfra",
    openRouterProvider: "DeepInfra",
    evidence: { passRate: .94, costDeltaPct: -60, latencyDeltaPct: -10, replayCount: 20, measuredAt: "2026-10-24T00:00:00.000Z" },
  }],
};

const request = {
  model: "caller/model",
  messages: [
    { role: "system", content: "Use account data before answering." },
    { role: "user", content: "I was charged twice. Please refund the duplicate." },
    { role: "assistant", tool_calls: [{ function: { name: "lookup_invoice", arguments: "{\"id\":\"inv_1\"}" } }] },
    { role: "tool", tool_call_id: "call_1", content: "duplicate=true" },
  ],
  tools: [{ type: "function", function: { name: "lookup_invoice", description: "Read an invoice", parameters: { type: "object" } } }],
  response_format: { type: "json_object" },
};

const decisionResponse = (choice, confidence) => new Response(JSON.stringify({
  model: "typesafe/jev-1.14",
  answers: { trace_bucket: { type: "choice", choice, confidence, probabilities: { [choice]: confidence, unknown: 1 - confidence } } },
}), { status: 200, headers: { "Content-Type": "application/json" } });

describe("RouteLab sidecar routing", () => {
  it("parses conversation turns, tool calls, tool definitions, and output constraints", () => {
    const state = conversationState(request);
    expect(state.latest_user_prompt).toContain("charged twice");
    expect(state.conversation[2].tool_calls[0].name).toBe("lookup_invoice");
    expect(state.available_tools[0]).toMatchObject({ name: "lookup_invoice", description: "Read an invoice" });
    expect(state.response_format).toEqual({ type: "json_object" });
  });

  it("publishes structured bucket criteria with representative prompts", () => {
    const criteria = signatureCriteria(bundle.signatures);
    expect(criteria.billing_dispute).toContain("domain=billing");
    expect(criteria.billing_dispute).toContain("Refund the duplicate invoice charge");
    expect(criteria.unknown).toContain("does not reliably match");
  });

  it("routes a confident bucket match to its published model and provider", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(decisionResponse("billing_dispute", .93));
    const route = await routeConversation({ request, bundle, apiKey: "test-key", fetchImpl });
    expect(route).toMatchObject({
      source: "task_override",
      taskBucketId: "billing_dispute",
      openRouterModelId: "deepseek/deepseek-r1",
      openRouterProvider: "DeepInfra",
      policyVersion: 4,
    });
    const classifierBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(classifierBody.state.available_tools[0].name).toBe("lookup_invoice");
  });

  it("uses the configured default strategy when confidence is below the bucket risk threshold", async () => {
    const decision = await classifyConversation({
      request,
      bundle,
      apiKey: "test-key",
      fetchImpl: vi.fn().mockResolvedValue(decisionResponse("billing_dispute", .84)),
    });
    expect(decision.status).toBe("low_confidence");
    expect(selectRoute(bundle, decision)).toMatchObject({ source: "default_strategy", openRouterModelId: "openai/gpt-5.5-pro" });
  });

  it("uses the emergency fallback if classification is unavailable", async () => {
    const route = await routeConversation({ request, bundle, apiKey: "" });
    expect(route).toMatchObject({ source: "emergency_fallback", openRouterModelId: "anthropic/claude-opus-4.8" });
    expect(route.decision.status).toBe("provider_unavailable");
  });

  it("uses OpenRouter Auto Router for uncovered tasks when configured as the default", () => {
    const autoBundle = { ...bundle, defaultStrategy: { type: "openrouter_auto", openRouterModelId: "openrouter/auto", costTier: "medium" } };
    const route = selectRoute(autoBundle, { signatureId: "unknown", signatureLabel: "Unknown", status: "unknown", reason: "unknown" });
    expect(route).toMatchObject({ source: "default_strategy", openRouterModelId: "openrouter/auto" });
  });

  it("overrides the requested model in enforce mode and preserves it in shadow mode", () => {
    const route = selectRoute(bundle, { signatureId: "billing_dispute", signatureLabel: "Billing dispute", status: "matched", reason: "matched" });
    expect(routedChatRequest(request, route, "enforce")).toMatchObject({
      model: "deepseek/deepseek-r1",
      provider: { order: ["DeepInfra"], allow_fallbacks: true },
    });
    expect(routedChatRequest(request, route, "shadow").model).toBe("caller/model");
  });
});
