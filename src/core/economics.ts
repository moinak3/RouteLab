import type { RoutingPolicy, Trace } from "../types";

export function uploadedSampleCost(traces: Trace[]) {
  return traces.reduce((sum, trace) => sum + (trace.cost_usd ?? 0), 0);
}

export function projectedMonthlyRunRate(traces: Trace[], monthlyMultiplier: number) {
  return uploadedSampleCost(traces) * monthlyMultiplier;
}

export function approvedMonthlySavings(policy: RoutingPolicy) {
  return policy.rules.reduce((sum, rule) => sum + rule.estimated_monthly_savings_usd, 0);
}

export function rejectedMonthlySavings(policy: RoutingPolicy) {
  return policy.rules.reduce((sum, rule) => sum + (rule.rejected_alternative?.potential_monthly_savings_usd ?? 0), 0);
}

export function rawMonthlySavingsCeiling(policy: RoutingPolicy) {
  return approvedMonthlySavings(policy) + rejectedMonthlySavings(policy);
}

export function overviewEconomics(traces: Trace[], policy: RoutingPolicy) {
  const sampleCost = uploadedSampleCost(traces);
  const monthlyRunRate = projectedMonthlyRunRate(traces, policy.monthly_multiplier);
  const approvedSavings = approvedMonthlySavings(policy);
  const rejectedSavings = rejectedMonthlySavings(policy);
  return {
    sampleCost,
    monthlyRunRate,
    approvedSavings,
    rejectedSavings,
    rawSavingsCeiling: approvedSavings + rejectedSavings,
  };
}
