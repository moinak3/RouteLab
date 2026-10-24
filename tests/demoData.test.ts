import { describe, expect, it } from "vitest";
import { createDistinctTaskBuckets } from "../src/core/distinctTasks";
import { calibrateGoldenDataset, createSimulatedGoldenDataset } from "../src/core/goldenDatasets";
import { recommendPolicy } from "../src/core/recommendations";
import { createSeedTraces, REPRESENTED_MONTHLY_CALLS, SEED_TRACE_COUNT } from "../src/core/seed";
import { createTraceJudgeResults } from "../src/core/traceJudge";
import { currentMonthlySpend, representedMonthlyCalls } from "../src/lib/economics";
import { overrideEligibility, wilsonInterval } from "../src/lib/quality";

const traces = createSeedTraces();
const buckets = createDistinctTaskBuckets(traces);
const judges = createTraceJudgeResults(traces);

describe("deterministic demo data", () => {
  it("generates the same long-tail workload every time", () => {
    expect(createSeedTraces()).toEqual(traces);
    expect(traces).toHaveLength(SEED_TRACE_COUNT);
    expect(new Set(buckets.map((bucket) => bucket.trace_count)).size).toBeGreaterThan(8);
    expect(Math.max(...buckets.map((bucket) => bucket.trace_count))).toBeGreaterThan(300);
    expect(Math.min(...buckets.map((bucket) => bucket.trace_count))).toBeLessThan(50);
  });

  it("keeps account references internally consistent", () => {
    traces.forEach((trace) => {
      const account = trace.prompt_text.match(/Account: ([^.]+)\./)?.[1];
      expect(account).toBeTruthy();
      const displayedEvidence = [trace.prompt_text, trace.response_text, JSON.stringify(trace.spans ?? [])].join(" ");
      const named = ["Northstar", "Acme", "Greenbyte", "Atlas", "Waypoint", "Cobalt", "Helio", "Nimbus", "Redwood", "Summit", "Kite", "Harbor"]
        .filter((name) => displayedEvidence.includes(name));
      expect(named.every((name) => name === account)).toBe(true);
    });
  });

  it("represents the intended monthly scale and economics", () => {
    expect(representedMonthlyCalls(traces)).toBeCloseTo(REPRESENTED_MONTHLY_CALLS, 2);
    expect(currentMonthlySpend(traces)).toBeGreaterThan(160_000);
    expect(currentMonthlySpend(traces)).toBeLessThan(200_000);
    const policy = recommendPolicy(traces, buckets);
    const savingsRate = policy.estimated_monthly_savings_usd / currentMonthlySpend(traces);
    expect(savingsRate).toBeGreaterThanOrEqual(.35);
    expect(savingsRate).toBeLessThanOrEqual(.55);
    expect(policy.rules.filter((rule) => rule.match.risk_level === "high").every((rule) => rule.strategy.type === "keep_current")).toBe(true);
  });

  it("produces a plausible, coherent golden dataset", () => {
    const golden = createSimulatedGoldenDataset(traces, judges);
    const calibration = calibrateGoldenDataset(golden, traces, judges);
    expect(golden.row_count).toBeGreaterThanOrEqual(150);
    expect(golden.row_count).toBeLessThanOrEqual(250);
    const traceById = new Map(traces.map((trace) => [trace.id, trace]));
    expect(new Set(golden.rows.map((row) => traceById.get(String(row.trace_id))?.metadata?.distinct_task_label)).size).toBeGreaterThanOrEqual(8);
    expect(calibration.agreement_rate).toBeGreaterThanOrEqual(88);
    expect(calibration.agreement_rate).toBeLessThanOrEqual(93);
    golden.rows.forEach((row) => {
      if (row.human_passed === false) {
        expect(row.human_answer).not.toBe(row.agent_answer);
        expect(String(row.human_rationale).length).toBeGreaterThan(20);
      }
    });
  });
});

describe("quality uncertainty", () => {
  it("matches known Wilson 95% bounds", () => {
    const a = wilsonInterval(28, 32);
    const b = wilsonInterval(11, 12);
    expect(a.lower).toBeCloseTo(.719, 2);
    expect(a.upper).toBeCloseTo(.950, 2);
    expect(b.lower).toBeCloseTo(.646, 2);
    expect(b.upper).toBeCloseTo(.985, 2);
  });

  it("requires quality, latency and cost guardrails together", () => {
    expect(overrideEligibility({ successes: 300, total: 312, qualityBar: .9, costDeltaPct: -42, latencyDeltaPct: 8, maximumLatencyIncreasePct: 20 }).eligible).toBe(true);
    expect(overrideEligibility({ successes: 11, total: 12, qualityBar: .9, costDeltaPct: -42, latencyDeltaPct: 8, maximumLatencyIncreasePct: 20 }).eligible).toBe(false);
    expect(overrideEligibility({ successes: 300, total: 312, qualityBar: .9, costDeltaPct: 2, latencyDeltaPct: 8, maximumLatencyIncreasePct: 20 }).eligible).toBe(false);
  });
});
