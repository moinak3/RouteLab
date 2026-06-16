import type { Risk, Trace } from "../types";

export const riskKeywords: Record<Risk, string[]> = {
  high: ["legal", "medical", "health", "finance", "tax", "compliance", "contract", "diagnosis", "investment", "hr", "termination", "pii"],
  medium: ["analysis", "analyze", "recommend", "ranking", "decision", "policy", "review"],
  low: ["extract", "format", "summar", "classif", "rewrite", "translat", "json", "faq"],
};
const matchesFor = (text: string, risk: Risk) => riskKeywords[risk].filter((keyword) => text.toLowerCase().includes(keyword));
export function inferRisk(text: string): Risk {
  if (matchesFor(text, "high").length) return "high";
  if (matchesFor(text, "medium").length) return "medium";
  if (matchesFor(text, "low").length) return "low";
  return "medium";
}
export function explainRisk(text: string, explicitRisk?: Risk) {
  const risk = explicitRisk ?? inferRisk(text);
  const signals = matchesFor(text, risk);
  const signalText = signals.length ? ` Prompts also matched ${signals.join(", ")}.` : "";
  return {
    risk,
    signals,
    reason: explicitRisk
      ? `The trace metadata explicitly labels this workload ${risk} risk.${signalText}`
      : signals.length
        ? `No explicit risk label was provided, so the keyword fallback assigned ${risk} risk from: ${signals.join(", ")}.`
        : "No explicit label or keyword signal was found, so the conservative fallback assigned medium risk.",
  };
}
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
export function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : 0;
}
export function dashboardMetrics(traces: Trace[]) {
  const byModel: Record<string, { requests: number; cost: number; tokens: number }> = {};
  traces.forEach((trace) => {
    byModel[trace.model] ??= { requests: 0, cost: 0, tokens: 0 };
    byModel[trace.model].requests++; byModel[trace.model].cost += trace.cost_usd ?? 0; byModel[trace.model].tokens += trace.total_tokens;
  });
  const latencies = traces.map((trace) => trace.latency_ms ?? 0);
  return {
    totalRequests: traces.length, successful: traces.filter((trace) => trace.status === "success").length,
    failed: traces.filter((trace) => trace.status === "error").length,
    inputTokens: traces.reduce((sum, trace) => sum + trace.input_tokens, 0),
    outputTokens: traces.reduce((sum, trace) => sum + trace.output_tokens, 0),
    totalCost: traces.reduce((sum, trace) => sum + (trace.cost_usd ?? 0), 0),
    averageLatency: average(latencies), p50Latency: percentile(latencies, .5), p95Latency: percentile(latencies, .95), byModel,
  };
}
