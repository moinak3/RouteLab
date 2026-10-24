import type { CandidateRun, RoutingPolicy, Trace } from "../types";

export const representedMonthlyCalls = (traces: Trace[]) => traces.reduce((sum, trace) => sum + (trace.represents_monthly_calls ?? 0), 0);
export const sampleExpansionFactor = (traces: Trace[]) => traces.length ? representedMonthlyCalls(traces) / traces.length : 0;
export const uploadedSampleCost = (traces: Trace[]) => traces.reduce((sum, trace) => sum + (trace.cost_usd ?? 0), 0);
export const currentMonthlySpend = (traces: Trace[]) => traces.reduce((sum, trace) => sum + (trace.cost_usd ?? 0) * (trace.represents_monthly_calls ?? 0), 0);
export const projectedMonthlyRunRate = (traces: Trace[]) => currentMonthlySpend(traces);

export function projectedCandidateMonthlySpend(traces: Trace[], runs: CandidateRun[]) {
  const runByTrace = new Map(runs.map((run) => [run.trace_id, run]));
  return traces.reduce((sum, trace) => sum + (runByTrace.get(trace.id)?.cost_usd ?? trace.cost_usd ?? 0) * (trace.represents_monthly_calls ?? 0), 0);
}

export const projectedMonthlySavings = (traces: Trace[], runs: CandidateRun[]) => currentMonthlySpend(traces) - projectedCandidateMonthlySpend(traces, runs);
export const approvedMonthlySavings = (policy: RoutingPolicy) => policy.rules.reduce((sum, rule) => sum + rule.estimated_monthly_savings_usd, 0);
export const rejectedMonthlySavings = (policy: RoutingPolicy) => policy.rules.reduce((sum, rule) => sum + (rule.rejected_alternative?.potential_monthly_savings_usd ?? 0), 0);
export const rawMonthlySavingsCeiling = (policy: RoutingPolicy) => approvedMonthlySavings(policy) + rejectedMonthlySavings(policy);

export function overviewEconomics(traces: Trace[], policy: RoutingPolicy) {
  const approvedSavings = approvedMonthlySavings(policy);
  const rejectedSavings = rejectedMonthlySavings(policy);
  return { sampleCost: uploadedSampleCost(traces), monthlyCalls: representedMonthlyCalls(traces), monthlyRunRate: currentMonthlySpend(traces), approvedSavings, rejectedSavings, rawSavingsCeiling: approvedSavings + rejectedSavings };
}

export function signedSavingsLabel(monthlySavings: number) {
  return monthlySavings >= 0
    ? { favorable: true, amount: monthlySavings, label: "monthly savings" }
    : { favorable: false, amount: Math.abs(monthlySavings), label: "monthly cost increase" };
}
