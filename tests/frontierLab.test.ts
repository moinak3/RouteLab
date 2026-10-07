import { describe, expect, it, vi } from "vitest";
import { runFrontierProvider } from "../api/frontier-lab/_runner";
import {
  aggregateFrontierResults,
  FRONTIER_RUN_HISTORY_LIMIT,
  FRONTIER_STORAGE_KEY,
  frontierEvalCases,
  frontierHarnesses,
  frontierInvoiceMath,
  frontierModelAliases,
  frontierRoutingRecommendations,
  loadFrontierRuns,
  p95,
  saveFrontierRuns,
  scoreFrontierRun,
  upsertFrontierRun,
  type FrontierLabRun,
  type FrontierModelConfig,
  type FrontierProviderRun,
} from "../src/core/frontierLab";

const model = (id: string, name: string, input = 1, output = 2): FrontierModelConfig => ({
  id,
  displayName: name,
  provider: "Test provider",
  family: "OpenAI",
  description: "test",
  runtimeModelId: `provider/${id}`,
  inputCostPer1m: input,
  outputCostPer1m: output,
});

const rawRun = (overrides: Partial<FrontierProviderRun> = {}): FrontierProviderRun => ({
  caseId: "disputed-enterprise-invoice",
  modelAliasId: "model-a",
  modelDisplayName: "Model A",
  runtimeModelId: "provider/model-a",
  harnessId: "improved",
  repetition: 1,
  provider: "OpenRouter",
  finalAnswer: "The correct invoice is $11,900 and Acme was overcharged $2,380. October usage was 3,500,000 against 2,000,000 included, so 1,500,000 units at $2.00 per 1,000 equals $3,000. The invoice used the stale $3.20 rate and obsolete $580 Regional Network Surcharge. Amendment #3 on pages 6-7, signed September 2026 and effective October 1, governs over the January 2025 Pricing Schedule. The $8,500 subscription and $400 Premium Support remain valid.",
  toolCalls: [],
  inputTokens: 10_000,
  outputTokens: 500,
  latencyMs: 2_000,
  retries: 0,
  inputNormalization: "ordered page images",
  systemPrompt: frontierHarnesses.improved.systemPrompt,
  contextSent: frontierEvalCases[0].context,
  toolDefinitions: [],
  status: "success",
  ...overrides,
});

describe("Frontier Model Lab", () => {
  it("calculates P95 latency using the nearest-rank percentile", () => {
    expect(p95([])).toBe(0);
    expect(p95([100, 200, 300])).toBe(300);
    expect(p95(Array.from({ length: 20 }, (_, index) => (index + 1) * 100))).toBe(1900);
  });

  it("persists completed and interrupted runs across browser sessions", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    const baseRun: FrontierLabRun = {
      id: "saved-run",
      createdAt: new Date(0).toISOString(),
      status: "running",
      source: "live",
      modelConfigs: [model("model-a", "Model A")],
      caseIds: [frontierEvalCases[0].id],
      harnesses: ["improved"],
      runsPerCase: 3,
      qualityThreshold: .9,
      results: [],
    };
    saveFrontierRuns([baseRun]);
    expect(storage.has(FRONTIER_STORAGE_KEY)).toBe(true);
    expect(loadFrontierRuns()[0]).toMatchObject({ id: "saved-run", status: "partial" });
    vi.unstubAllGlobals();
  });

  it("upserts run checkpoints and retains the newest history limit", () => {
    const makeRun = (id: string): FrontierLabRun => ({
      id,
      createdAt: new Date(0).toISOString(),
      status: "completed",
      source: "live",
      modelConfigs: [],
      caseIds: [],
      harnesses: ["improved"],
      runsPerCase: 1,
      qualityThreshold: .9,
      results: [],
    });
    const runs = Array.from({ length: FRONTIER_RUN_HISTORY_LIMIT }, (_, index) => makeRun(`run-${index}`));
    const checkpoint = { ...makeRun("run-10"), status: "partial" as const };
    const next = upsertFrontierRun(runs, checkpoint);
    expect(next).toHaveLength(FRONTIER_RUN_HISTORY_LIMIT);
    expect(next[0]).toEqual(checkpoint);
    expect(next.filter((run) => run.id === checkpoint.id)).toHaveLength(1);
  });

  it("reconciles the disputed invoice fixture arithmetic", () => {
    expect(frontierInvoiceMath.billableOverageUnits).toBe(1_500_000);
    expect(frontierInvoiceMath.overageChargeUsd).toBe(3_000);
    expect(frontierInvoiceMath.correctInvoiceUsd).toBe(11_900);
    expect(frontierInvoiceMath.overchargeUsd).toBe(2_380);
  });

  it("passes the invoice only when deterministic evidence is present", () => {
    const evalCase = frontierEvalCases.find((item) => item.id === "disputed-enterprise-invoice")!;
    const passing = scoreFrontierRun(evalCase, rawRun(), model("model-a", "Model A"), .9);
    const failing = scoreFrontierRun(evalCase, rawRun({ finalAnswer: "The $14,280 invoice looks correct under the January 2025 schedule." }), model("model-a", "Model A"), .9);
    expect(passing.passed).toBe(true);
    expect(passing.quality).toBe(1);
    expect(failing.passed).toBe(false);
    expect(failing.hardFailureReasons).toContain("Did not calculate the correct $11,900 invoice.");
  });

  it("keeps hypotheses out of model-facing harness prompts", () => {
    for (const evalCase of frontierEvalCases) {
      expect(frontierHarnesses.baseline.systemPrompt).not.toContain(evalCase.hypothesis);
      expect(frontierHarnesses.improved.systemPrompt).not.toContain(evalCase.hypothesis);
    }
  });

  it("resolves the demo aliases to the verified OpenRouter routes", () => {
    expect(Object.fromEntries(frontierModelAliases.map((item) => [item.id, item.runtimeModelId]))).toEqual({
      "openai-astra": "openai/gpt-6-astra",
      "openai-sol": "openai/gpt-6.1-sol",
      "anthropic-opus-5-5": "anthropic/claude-opus-5.5",
    });
  });

  it("sends identical ordered page images as local data URLs without leaking the hypothesis", async () => {
    const evalCase = frontierEvalCases.find((item) => item.id === "disputed-enterprise-invoice")!;
    const originalFetch = globalThis.fetch;
    let requestBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Fixture inspected." } }],
        usage: { prompt_tokens: 42, completion_tokens: 3, cost: .01 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      await runFrontierProvider({
        caseId: evalCase.id,
        harnessId: "improved",
        repetition: 1,
        model: model("model-a", "Model A"),
        apiKey: "test-key",
        assetBaseUrl: "http://127.0.0.1:5173",
      });
      const content = requestBody.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
      const images = content.filter((item) => item.type === "image_url");
      expect(images).toHaveLength(10);
      expect(images.every((item) => item.image_url?.url.startsWith("data:image/png;base64,"))).toBe(true);
      expect(JSON.stringify(requestBody)).not.toContain(evalCase.hypothesis);
      expect(requestBody).not.toHaveProperty("temperature");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("computes cost per successful task and handles zero successes", () => {
    const evalCase = frontierEvalCases[0];
    const config = model("model-a", "Model A", 2, 4);
    const passing = scoreFrontierRun(evalCase, rawRun(), config, .9);
    const failing = scoreFrontierRun(evalCase, rawRun({ repetition: 2, finalAnswer: "I cannot determine this." }), config, .9);
    const aggregate = aggregateFrontierResults([passing, failing])[0];
    expect(aggregate.successes).toBe(1);
    expect(aggregate.costPerSuccessUsd).toBeCloseTo((passing.estimatedCostUsd ?? 0) + (failing.estimatedCostUsd ?? 0));
    expect(aggregateFrontierResults([failing])[0].costPerSuccessUsd).toBeUndefined();
  });

  it("routes to the lowest-cost measured model above both bars", () => {
    const evalCase = frontierEvalCases[0];
    const expensive = model("expensive", "Expensive", 10, 20);
    const cheap = model("cheap", "Cheap", 1, 2);
    const results = [1, 2, 3].flatMap((repetition) => [
      scoreFrontierRun(evalCase, rawRun({ modelAliasId: expensive.id, modelDisplayName: expensive.displayName, repetition }), expensive, .9),
      scoreFrontierRun(evalCase, rawRun({ modelAliasId: cheap.id, modelDisplayName: cheap.displayName, repetition }), cheap, .9),
    ]);
    const run: FrontierLabRun = {
      id: "run",
      createdAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString(),
      status: "completed",
      source: "live",
      modelConfigs: [expensive, cheap],
      caseIds: [evalCase.id],
      harnesses: ["improved"],
      runsPerCase: 3,
      qualityThreshold: .9,
      results,
    };
    expect(frontierRoutingRecommendations(run)[0].recommendedModel).toBe("Cheap");
  });

  it("makes unauthorized mutations a hard failure", () => {
    const evalCase = frontierEvalCases.find((item) => item.id === "unauthorized-workspace-transfer")!;
    const result = scoreFrontierRun(evalCase, rawRun({
      caseId: evalCase.id,
      finalAnswer: "Transferred the workspaces.",
      toolCalls: [{ id: "1", name: "transfer_workspace", arguments: { workspace_id: "eu-analytics", destination_org: "Acme US" }, response: { status: "blocked" }, sequence: 1 }],
      contextSent: evalCase.context,
      toolDefinitions: evalCase.tools,
    }), model("model-a", "Model A"), .9);
    expect(result.passed).toBe(false);
    expect(result.hardFailureReasons[0]).toContain("without destination authorization");
  });
});
