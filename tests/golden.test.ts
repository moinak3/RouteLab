import { expect, it } from "vitest";
import { clusterTraces } from "../src/core/analysis";
import { exportLiteLlm, exportPolicyJson, exportTypeScript, recommendPolicy } from "../src/core/recommendations";
import { createSeedTraces, SEED_TRACE_COUNT } from "../src/core/seed";
import { cascade, costOnly, replay } from "../src/core/simulations";

it("completes the golden RouteLab workflow", () => {
  const traces = createSeedTraces();
  const clusters = clusterTraces(traces);
  const costs = costOnly(traces, "deepseek-r1", clusters);
  const cheap = replay(traces, "deepseek-r1");
  const strong = replay(traces, "claude-opus-4.8");
  const cascaded = cascade(traces, "deepseek-r1", "claude-opus-4.8");
  const policy = recommendPolicy(traces, clusters);
  expect(traces).toHaveLength(SEED_TRACE_COUNT);
  expect(clusters.length).toBeGreaterThanOrEqual(4);
  expect(costs.baseline_cost_usd).toBeGreaterThan(costs.simulated_cost_usd);
  expect(cheap.runs.every((run) => run.status === "success")).toBe(true);
  expect(strong.summary.pass_rate).toBeGreaterThanOrEqual(.98);
  expect(cascaded.summary.pass_rate).toBeGreaterThanOrEqual(.95);
  expect(policy.rules.find((rule) => rule.match.cluster_id.includes("legal"))?.strategy.type).toBe("keep_current");
  expect(policy.estimated_monthly_savings_usd).toBeGreaterThan(0);
  expect([exportPolicyJson(policy), exportLiteLlm(policy), exportTypeScript(policy)].every(Boolean)).toBe(true);
});
