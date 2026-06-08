import { describe, expect, it } from "vitest";
import { clusterTraces, dashboardMetrics, explainRisk, inferRisk } from "../src/core/analysis";
import { calculateCost, getModel, modelCatalog, updateModelPricing } from "../src/core/catalog";
import { exactMatch, jsonSchema, mockJudge, regexEval } from "../src/core/evaluators";
import { buildWorkflowTrees, ingestRecords, ingestText } from "../src/core/ingestion";
import { exportLiteLlm, exportPolicyJson, exportTypeScript, recommendPolicy } from "../src/core/recommendations";
import { createSeedTraces, SEED_TRACE_COUNT, SEED_TRACES_PER_GROUP } from "../src/core/seed";
import { cascade, costOnly, familyCascade, MONTHLY_MULTIPLIER, monthlyClusterBreakdown, mockGenerate, replay } from "../src/core/simulations";
import { filterTracesByRange, monthlyBuckets } from "../src/core/time";

const traces = createSeedTraces();
const clusters = clusterTraces(traces);
describe("ingestion and costs", () => {
  it("normalizes the enterprise seed records and fills derived fields", () => {
    const raw = traces.map(({ total_tokens, messages, cost_usd, ...trace }) => trace);
    const result = ingestRecords(raw);
    expect(result.traces).toHaveLength(SEED_TRACE_COUNT);
    expect(result.traces[0].messages).toHaveLength(1);
    expect(result.traces[0].total_tokens).toBe(result.traces[0].input_tokens + result.traces[0].output_tokens);
    expect(result.traces.some((trace) => (trace.cost_usd ?? 0) > 0)).toBe(true);
    expect(result.traces.every((trace) => (trace.cost_usd ?? 0) >= 0)).toBe(true);
  });
  it("spreads seed traffic over six months with half in the latest two calendar months", () => {
    const buckets = monthlyBuckets(traces);
    expect(buckets).toHaveLength(6);
    expect(buckets.reduce((sum, bucket) => sum + bucket.calls, 0)).toBe(SEED_TRACE_COUNT);
    expect(buckets.slice(-2).reduce((sum, bucket) => sum + bucket.calls, 0)).toBe(SEED_TRACE_COUNT / 2);
    expect(filterTracesByRange(traces, "7d").length).toBeLessThan(filterTracesByRange(traces, "30d").length);
    expect(filterTracesByRange(traces, "30d").length).toBeLessThan(filterTracesByRange(traces, "3m").length);
    expect(filterTracesByRange(traces, "6m")).toHaveLength(SEED_TRACE_COUNT);
  });
  it("handles JSONL, JSON, CSV, and malformed rows", () => {
    expect(ingestText(traces.slice(0, 2).map((trace) => JSON.stringify(trace)).join("\n") + "\n{bad", "x.jsonl").traces).toHaveLength(2);
    expect(ingestText(JSON.stringify(traces.slice(0, 2)), "x.json").traces).toHaveLength(2);
    expect(ingestText("id,model,prompt_text,input_tokens,output_tokens\nx,gpt-5.5-pro,hello,1,2", "x.csv").traces).toHaveLength(1);
    expect(ingestRecords([null, { id: "x" }]).errors).toHaveLength(2);
  });
  it("preserves flat and nested workflow trace trees", () => {
    const seededTrees = buildWorkflowTrees(traces);
    expect(seededTrees).toHaveLength(SEED_TRACES_PER_GROUP);
    expect(seededTrees[0].trace_ids).toHaveLength(5);
    expect(seededTrees[0].roots[0].workflow_role).toBe("planner");
    expect(seededTrees[0].roots[0].children[0].workflow_role).toBe("retriever_summarizer");

    const nested = ingestText(JSON.stringify({
      workflows: [{ id: "workflow_nested", nodes: [{
        id: "planner_node", model: "gpt-5.5-pro", prompt: "Plan the task", workflow_role: "planner",
        children: [{ id: "answer_node", model: "claude-opus-4.8", prompt: "Answer the task", workflow_role: "final_answer" }],
      }] }],
    }), "nested.json");
    expect(nested.traces).toHaveLength(2);
    expect(nested.workflows).toHaveLength(1);
    expect(nested.traces[1].parent_node_id).toBe("planner_node");
    expect(nested.workflows[0].roots[0].children[0].trace_id).toBe("answer_node");

    const csv = ingestText("id,workflow_id,node_id,parent_node_id,workflow_role,model,prompt_text\ncall-1,wf-1,n-1,,tool_caller,gpt-5.5-pro,use tool", "tree.csv");
    expect(csv.workflows[0].roles.tool_caller).toBe(1);
  });
  it("matches reference pricing", () => {
    expect(calculateCost(1e9, 1e9, getModel("gpt-5.5-pro")!)).toBe(105000);
    expect(calculateCost(1e9, 1e9, getModel("claude-opus-4.8")!)).toBe(30000);
    expect(calculateCost(1e9, 1e9, getModel("deepseek-v4-pro")!)).toBe(5220);
    expect(calculateCost(1e9, 1e9, getModel("deepseek-r1")!)).toBe(2740);
    expect(calculateCost(1000, 500, getModel("gpt-5.5-pro")!)).toBeCloseTo(.06);
  });
});
describe("analysis and clustering", () => {
  it("calculates consistent dashboard metrics", () => {
    const metrics = dashboardMetrics(traces);
    expect(metrics.totalRequests).toBe(SEED_TRACE_COUNT);
    expect(Object.values(metrics.byModel).reduce((sum, item) => sum + item.requests, 0)).toBe(SEED_TRACE_COUNT);
    expect((metrics.byModel["gpt-5.5-pro"]?.requests ?? 0) + (metrics.byModel["claude-opus-4.8"]?.requests ?? 0)).toBeGreaterThan(SEED_TRACE_COUNT / 2);
    expect(Object.values(metrics.byModel).reduce((sum, item) => sum + item.cost, 0)).toBeCloseTo(metrics.totalCost);
    expect(metrics.failed).toBe(1);
    expect(metrics.p95Latency).toBeGreaterThan(metrics.p50Latency);
  });
  it("creates stable workload clusters and risks", () => {
    expect(clusters.length).toBeGreaterThanOrEqual(4);
    expect(clusters.find((c) => c.id.includes("json_extraction"))?.volume).toBe(SEED_TRACES_PER_GROUP);
    expect(clusters.every((c) => c.name && c.representative_trace_ids.length)).toBe(true);
    expect(clusters.every((c) => c.clustering_reason && c.risk_reason)).toBe(true);
    expect(clusters.find((c) => c.id.includes("legal"))?.risk_signals).toContain("legal");
    expect(clusters.find((c) => c.id.includes("json_extraction"))?.risk_signals).toContain("json");
    expect(inferRisk("review legal compliance contract")).toBe("high");
    expect(inferRisk("extract fields to JSON")).toBe("low");
    expect(explainRisk("review a policy").reason).toContain("keyword fallback");
    expect(explainRisk("ordinary task").risk).toBe("medium");
  });
});
describe("providers and evaluators", () => {
  it("mock provider is deterministic and respects difficulty", () => {
    const easy = traces.find((t) => t.metadata?.mock_difficulty === "easy")!;
    const hard = traces.find((t) => t.metadata?.mock_difficulty === "hard")!;
    expect(mockGenerate(easy, "deepseek-r1")).toEqual(mockGenerate(easy, "deepseek-r1"));
    expect(mockGenerate(easy, "deepseek-r1").response_text).toBe(easy.metadata?.expected_answer);
    expect(mockGenerate(hard, "deepseek-r1").response_text).toContain("[FAIL_MAJOR]");
    expect(mockGenerate(hard, "claude-opus-4.8").response_text).toBe(hard.metadata?.expected_answer);
  });
  it("runs deterministic evaluators", () => {
    expect(exactMatch("Hello world", "hello   world").passed).toBe(true);
    expect(jsonSchema('{"id":1}', { type: "object", required: ["id"], properties: { id: { type: "number" } } }).passed).toBe(true);
    expect(jsonSchema('{"id":"x"}', { type: "object", required: ["id"], properties: { id: { type: "number" } } }).passed).toBe(false);
    expect(regexEval("Invoice INV-123", "INV-\\d+").passed).toBe(true);
    expect(mockJudge("[PASS]").score).toBe(1);
    expect(mockJudge("[FAIL_MINOR]").score).toBe(.75);
    expect(mockJudge("[FAIL_MAJOR]").passed).toBe(false);
    expect(mockJudge("[FAIL_CRITICAL]").severity).toBe("critical");
  });
});
describe("simulation and recommendations", () => {
  it("calculates cheaper cost-only routing", () => {
    const result = costOnly(traces, "deepseek-r1", clusters);
    expect(result.simulated_cost_usd).toBeLessThan(result.baseline_cost_usd);
    expect(result.byCluster.reduce((sum, row) => sum + row.savings, 0)).toBeCloseTo(result.estimated_savings_usd);
  });
  it("supports cluster-scoped simulations and expensive candidates", () => {
    const legal = clusters.find((cluster) => cluster.id.includes("legal"))!;
    const legalTraces = traces.filter((trace) => legal.trace_ids.includes(trace.id));
    const scoped = replay(legalTraces, "claude-opus-4.8");
    const expensive = costOnly(traces, "gpt-5.5-pro", clusters);
    expect(scoped.runs).toHaveLength(legal.volume);
    expect(scoped.summary.pass_rate).toBe(1);
    expect(scoped.summary.baseline_cost_usd).toBeCloseTo(legal.actual_cost_usd);
    expect(expensive.simulated_cost_usd).toBeGreaterThan(0);
    expect(expensive.byCluster).toHaveLength(clusters.length);
  });
  it("makes all-strong routing more expensive than the believable mixed baseline", () => {
    for (const model of ["claude-opus-4.8", "gpt-5.5-pro"]) {
      const projected = costOnly(traces, model, clusters);
      const replayed = replay(traces, model);
      expect(projected.simulated_cost_usd).toBeGreaterThan(projected.baseline_cost_usd);
      expect(replayed.summary.simulated_cost_usd).toBeGreaterThan(replayed.summary.baseline_cost_usd);
      expect(replayed.summary.simulated_cost_usd).toBeCloseTo(projected.simulated_cost_usd);
    }
  });
  it("reconciles cluster monthly savings to the top-level simulation", () => {
    for (const strategy of ["direct", "cascade"] as const) {
      const result = strategy === "direct" ? replay(traces, "deepseek-r1") : cascade(traces, "deepseek-r1", "claude-opus-4.8");
      const breakdown = monthlyClusterBreakdown(traces, clusters, "deepseek-r1", strategy);
      expect(breakdown.reduce((sum, row) => sum + row.monthly_savings_usd, 0)).toBeCloseTo(result.summary.estimated_savings_usd * MONTHLY_MULTIPLIER);
    }
  });
  it("runs replay and cascade", () => {
    const cheap = replay(traces, "deepseek-r1");
    const strong = replay(traces, "claude-opus-4.8");
    const mixed = cascade(traces, "deepseek-r1", "claude-opus-4.8");
    expect(cheap.runs).toHaveLength(SEED_TRACE_COUNT);
    expect(strong.summary.pass_rate).toBe(1);
    expect(mixed.summary.pass_rate).toBeGreaterThanOrEqual(.95);
    expect(mixed.summary.escalation_rate).toBeGreaterThan(0);
    expect(mixed.summary.simulated_cost_usd).toBeGreaterThan(cheap.summary.simulated_cost_usd);
    expect(mixed.summary.simulated_cost_usd).toBeLessThan(mixed.summary.baseline_cost_usd);
  });
  it("cascades from the cheapest to strongest model in the selected family", () => {
    const mixed = familyCascade(traces, "mistral-large-3");
    const breakdown = monthlyClusterBreakdown(traces, clusters, "mistral-large-3", "family_cascade");
    expect(mixed.runs).toHaveLength(SEED_TRACE_COUNT);
    expect(mixed.summary.escalation_rate).toBeGreaterThan(0);
    expect(mixed.runs.some((run) => run.candidate_model === "mistral-large-3")).toBe(true);
    expect(breakdown.reduce((sum, row) => sum + row.monthly_savings_usd, 0)).toBeCloseTo(mixed.summary.estimated_savings_usd * MONTHLY_MULTIPLIER);
  });
  it("protects high risk clusters and exports policies", () => {
    const policy = recommendPolicy(traces, clusters);
    const legal = policy.rules.find((rule) => rule.match.cluster_id.includes("legal"))!;
    expect(legal.strategy.type).toBe("keep_current");
    expect(policy.estimated_monthly_savings_usd).toBeGreaterThan(0);
    expect(policy.estimated_monthly_savings_usd).toBeGreaterThanOrEqual(50000);
    expect(policy.estimated_monthly_savings_usd).toBeCloseTo(policy.estimated_sample_savings_usd * policy.monthly_multiplier);
    expect(policy.estimated_monthly_savings_usd).toBeCloseTo(policy.rules.reduce((sum, rule) => sum + rule.estimated_monthly_savings_usd, 0));
    expect(policy.estimated_sample_savings_usd).toBeCloseTo(policy.rules.reduce((sum, rule) => sum + (rule.comparison ? rule.comparison.cost.before - rule.comparison.cost.after : 0), 0));
    expect(policy.rules.every((rule) => rule.rationale)).toBe(true);
    expect(policy.rules.filter((rule) => rule.strategy.type !== "keep_current").every((rule) => rule.comparison)).toBe(true);
    expect(policy.rules.filter((rule) => rule.strategy.type === "keep_current").every((rule) => !rule.comparison)).toBe(true);
    expect(policy.rules.find((rule) => rule.strategy.type === "direct")?.comparison?.cost.after).toBeLessThan(
      policy.rules.find((rule) => rule.strategy.type === "direct")!.comparison!.cost.before,
    );
    const slowSupport = policy.rules.find((rule) => rule.match.cluster_id.includes("support_faq"))!;
    expect(slowSupport.strategy.type).toBe("direct");
    expect(slowSupport.estimated_monthly_savings_usd).toBeGreaterThan(0);
    expect(slowSupport.rejected_alternative?.potential_monthly_savings_usd).toBeGreaterThan(0);
    expect(slowSupport.rejected_alternative?.comparison.latency_ms.delta_pct).toBeGreaterThan(50);
    expect(slowSupport.rejected_alternative?.comparison.latency_ms.after).toBeGreaterThan(slowSupport.rejected_alternative!.comparison.latency_ms.before);
    expect(slowSupport.rejected_alternative?.comparison.cost.after).toBeLessThan(slowSupport.rejected_alternative!.comparison.cost.before);
    expect(slowSupport.rejected_alternative?.reason).toContain("latency");
    expect(JSON.parse(exportPolicyJson(policy)).rules).toHaveLength(5);
    expect(exportLiteLlm(policy)).toContain("routing_policies:");
    expect(exportTypeScript(policy)).toContain("routeRequest");
  });
  it("can constrain recommendations to one model candidate", () => {
    const policy = recommendPolicy(traces, clusters, ["gemini-3-flash"]);
    expect(policy.candidate_model_ids).toEqual(["gemini-3-flash"]);
    expect(policy.rules.every((rule) => rule.strategy.type === "keep_current" || rule.strategy.type === "direct" && rule.strategy.model === "gemini-3-flash" || rule.strategy.type === "cascade" && rule.strategy.primary_model === "gemini-3-flash")).toBe(true);
  });
  it("catalog contains top, mid, and cheapest options for major families", () => {
    for (const family of ["OpenAI", "Claude", "Gemini", "Mistral"]) {
      const familyModels = modelCatalog.filter((model) => model.family === family);
      expect(familyModels.map((model) => model.family_tier).sort()).toEqual(["cheapest", "mid", "top"]);
    }
    expect(modelCatalog).toHaveLength(15);
  });
  it("supports configurable Local Qwen serving costs", () => {
    const local = getModel("local-qwen-14b")!;
    const original = { input: local.input_cost_per_1m, output: local.output_cost_per_1m };
    updateModelPricing(local.id, .2, .8);
    expect(calculateCost(1_000_000, 1_000_000, local)).toBe(1);
    expect(replay(traces.slice(0, 1), local.id).summary.simulated_cost_usd).toBeGreaterThan(0);
    updateModelPricing(local.id, original.input, original.output);
  });
});
