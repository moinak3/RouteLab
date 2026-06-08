import type { Cluster, Risk, Trace } from "../types";

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
export function clusterTraces(traces: Trace[]): Cluster[] {
  const groups = new Map<string, Trace[]>();
  traces.forEach((trace) => {
    const task = String(trace.metadata?.task_type ?? "other");
    const group = groups.get(task);
    if (group) group.push(trace);
    else groups.set(task, [trace]);
  });
  return [...groups.entries()].map(([task, items], index) => {
    const models = items.reduce<Record<string, number>>((acc, trace) => ({ ...acc, [trace.model]: (acc[trace.model] ?? 0) + 1 }), {});
    const combinedPrompts = items.map((item) => item.prompt_text).join(" ");
    const explicitRisk = items[0].metadata?.risk_level as Risk | undefined;
    const riskExplanation = explainRisk(combinedPrompts, explicitRisk);
    const risk = riskExplanation.risk;
    return {
      id: `cluster_${task}`, name: task.split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" "),
      description: `${risk} risk workload identified from repeated task patterns`, trace_ids: items.map((item) => item.id),
      representative_trace_ids: items.slice(0, 3).map((item) => item.id), volume: items.length,
      actual_cost_usd: items.reduce((sum, item) => sum + (item.cost_usd ?? 0), 0),
      average_latency_ms: average(items.map((item) => item.latency_ms ?? 0)),
      average_input_tokens: average(items.map((item) => item.input_tokens)), average_output_tokens: average(items.map((item) => item.output_tokens)),
      dominant_model: Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
      inferred_task_type: task || `cluster_${index + 1}`, risk_level: risk,
      clustering_reason: task === "other"
        ? `Grouped into the fallback “other” cluster because these ${items.length} traces do not provide metadata.task_type.`
        : `Grouped because all ${items.length} traces share metadata.task_type = “${task}”.`,
      risk_reason: riskExplanation.reason,
      risk_signals: riskExplanation.signals,
    };
  });
}
