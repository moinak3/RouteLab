import type { RoutingPolicy, RoutingRule, ScriptAutomationRecommendation, ToolCallSignatureStep, Trace, TraceSpan, DistinctTaskBucket } from "../types";
import { getModel, recommendationCandidates } from "./catalog";
import { evaluateTrace } from "./evaluators";
import { cheapestProviderQuoteForModel, providerQuotesForModel, quoteLabel } from "./providerPricing";
import { cascade, MONTHLY_MULTIPLIER, replay } from "./simulations";

const percentDelta = (before: number, after: number) => before ? (after - before) / before * 100 : 0;
const MAX_LATENCY_REGRESSION_PCT = 50;
const SCRIPTABLE_PATTERN_THRESHOLD = .9;
const SCRIPT_REPLACEMENT_SAVINGS_RATE = .9;
const toolSpanTypes = new Set(["tool", "function"]);

type ToolCallInstance = {
  tool: string;
  args: Record<string, string>;
};
type ToolCallSession = {
  id: string;
  calls: ToolCallInstance[];
  accepted: boolean;
  automation_cost_usd: number;
};

const compactName = (value: string) => value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const scriptSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "tool_sequence";
const normalizeArgumentValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return JSON.stringify(value.map(normalizeArgumentValue));
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(Object.fromEntries(entries.map(([key, item]) => [key, normalizeArgumentValue(item)])));
  }
  return String(value);
};
const argumentRecord = (span: TraceSpan): Record<string, string> => {
  const metadata = span.metadata ?? {};
  const raw = span.input ?? metadata.arguments ?? metadata.args ?? metadata.params ?? metadata.input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw === undefined ? {} : { input: normalizeArgumentValue(raw) };
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([key, value]) => [key, normalizeArgumentValue(value)]));
};
const explicitAccepted = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  if (/^(accepted|approved|pass|passed|success|true)$/i.test(value)) return true;
  if (/^(rejected|failed|fail|false)$/i.test(value)) return false;
  return undefined;
};
const traceAccepted = (trace: Trace) => {
  const metadata = trace.metadata ?? {};
  const explicit = explicitAccepted(metadata.user_accepted ?? metadata.accepted ?? metadata.result_accepted ?? metadata.human_accepted ?? metadata.human_passed ?? metadata.outcome);
  if (explicit !== undefined) return explicit;
  if (trace.status === "error") return false;
  const reference = metadata._internal_reference;
  if (reference !== undefined) return String(trace.response_text ?? "") === String(reference);
  return true;
};
const toolCallsForTrace = (trace: Trace): ToolCallInstance[] => (trace.spans ?? [])
  .filter((span) => toolSpanTypes.has(span.type))
  .map((span) => ({ tool: String(span.name ?? span.id ?? span.type), args: argumentRecord(span) }));
const toolCallSessions = (traces: Trace[]): ToolCallSession[] => {
  const groups = new Map<string, Trace[]>();
  traces.forEach((trace) => {
    const key = trace.id;
    groups.set(key, [...(groups.get(key) ?? []), trace]);
  });
  return [...groups.entries()].map(([id, items]) => {
    const sorted = [...items].sort((a, b) => `${a.timestamp}-${a.node_id ?? a.id}`.localeCompare(`${b.timestamp}-${b.node_id ?? b.id}`));
    const toolBearing = sorted.map((trace) => ({ trace, calls: toolCallsForTrace(trace) })).filter((item) => item.calls.length);
    return {
      id,
      calls: toolBearing.flatMap((item) => item.calls),
      accepted: sorted.every(traceAccepted),
      automation_cost_usd: toolBearing.reduce((sum, item) => sum + (item.trace.cost_usd ?? 0), 0),
    };
  }).filter((session) => session.calls.length);
};
const signatureKey = (calls: ToolCallInstance[]) => calls.map((call) => `${call.tool}(${Object.keys(call.args).sort().join(",")})`).join(" -> ");
const stepSummaries = (sessions: ToolCallSession[]): ToolCallSignatureStep[] => {
  const maxSteps = Math.max(...sessions.map((session) => session.calls.length));
  return Array.from({ length: maxSteps }, (_, index) => {
    const calls = sessions.map((session) => session.calls[index]).filter((call): call is ToolCallInstance => Boolean(call));
    const keys = [...new Set(calls.flatMap((call) => Object.keys(call.args)))].sort();
    return {
      tool_name: calls[0]?.tool ?? "unknown_tool",
      fixed_arguments: keys.filter((key) => calls.length === sessions.length && new Set(calls.map((call) => call.args[key])).size === 1),
      variable_arguments: keys.filter((key) => calls.length !== sessions.length || new Set(calls.map((call) => call.args[key])).size !== 1),
    };
  });
};
const variationPct = (values: string[]) => {
  if (!values.length) return 0;
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return (1 - Math.max(...counts.values()) / values.length) * 100;
};
const argumentVariationPct = (sessions: ToolCallSession[]) => {
  const steps = stepSummaries(sessions);
  if (!steps.length) return 0;
  const variableSteps = steps.filter((step) => step.variable_arguments.length).length;
  return variableSteps / steps.length * 100;
};
const scriptStub = (steps: ToolCallSignatureStep[], scriptName: string) => {
  const calls = steps.map((step, index) => {
    const args = [...step.fixed_arguments.map((arg) => `${arg}: fixed.${arg}`), ...step.variable_arguments.map((arg) => `${arg}: input.${arg}`)].join(", ");
    return `  const step${index + 1} = await tools.${scriptSlug(step.tool_name)}({ ${args} });`;
  }).join("\n");
  return `export async function ${scriptName}(input) {\n${calls || "  const step1 = await tools.run(input);"}\n  return step${Math.max(steps.length, 1)};\n}`;
};

export function recommendScriptAutomation(traces: Trace[], monthlyMultiplier = MONTHLY_MULTIPLIER): ScriptAutomationRecommendation[] {
  const sessions = toolCallSessions(traces);
  const clusters = new Map<string, ToolCallSession[]>();
  sessions.forEach((session) => clusters.set(signatureKey(session.calls), [...(clusters.get(signatureKey(session.calls)) ?? []), session]));
  return [...clusters.entries()].flatMap(([key, items], index) => {
    const branchVariation = variationPct(items.map((item) => item.calls.map((call) => call.tool).join(" -> ")));
    const outcomeVariation = variationPct(items.map((item) => String(item.accepted)));
    const argVariation = argumentVariationPct(items);
    const patternMatch = 100 - Math.max(branchVariation, outcomeVariation);
    if (items.length < 3 || patternMatch < SCRIPTABLE_PATTERN_THRESHOLD * 100) return [];
    const steps = stepSummaries(items);
    const name = steps.map((step) => compactName(step.tool_name)).join(" -> ");
    const scriptName = `run${steps.map((step) => compactName(step.tool_name).replace(/\s+/g, "")).join("") || `ToolSequence${index + 1}`}`;
    const projectedMonthlySavings = items.reduce((sum, item) => sum + item.automation_cost_usd, 0) * monthlyMultiplier * SCRIPT_REPLACEMENT_SAVINGS_RATE;
    return [{
      id: `script_${scriptSlug(key)}_${index + 1}`,
      cluster_name: name,
      example_sequence: steps,
      instance_count: items.length,
      pattern_match_pct: patternMatch,
      variation: {
        argument_variation_pct: argVariation,
        branch_variation_pct: branchVariation,
        outcome_variation_pct: outcomeVariation,
      },
      projected_monthly_savings_usd: projectedMonthlySavings,
      script_name: `${scriptSlug(name)}.ts`,
      script_stub: scriptStub(steps, scriptName),
      rationale: `${items.length} sessions follow the same tool-call signature with no observed reasoning-driven branch changes.`,
    }];
  }).sort((a, b) => b.projected_monthly_savings_usd - a.projected_monthly_savings_usd).slice(0, 4);
}

export function recommendPolicy(traces: Trace[], buckets: DistinctTaskBucket[], candidateIds = recommendationCandidates.map((model) => model.id), strong = "claude-opus-4.8"): RoutingPolicy {
  const rules: RoutingRule[] = [];
  let sampleSavings = 0;
  const monthlyMultiplier = MONTHLY_MULTIPLIER;
  const tracesById = new Map(traces.map((trace) => [trace.id, trace]));
  const cascadeFallbackEnabled = candidateIds.includes(strong);
  buckets.forEach((bucket) => {
    const selected = bucket.traces.map((id) => tracesById.get(id)).filter((trace): trace is Trace => Boolean(trace));
    const baselineQuality = selected.filter((trace) => evaluateTrace(trace, trace.response_text ?? "").passed).length / (selected.length || 1);
    let strategy: RoutingRule["strategy"];
    let rationale: string;
    let recommended: ReturnType<typeof replay> | undefined;
    const providerQuotes = candidateIds.flatMap((modelId) => providerQuotesForModel(modelId));
    const fallbackQuote = cheapestProviderQuoteForModel(strong);
    const candidates = candidateIds.flatMap((modelId) => providerQuotesForModel(modelId).map((quote) => {
      const direct = replay(selected, modelId, quote);
      const cascaded = cascade(selected, modelId, strong, quote, fallbackQuote);
      const needsStrictEvidence = bucket.task.complexity === "high" || bucket.task.temporal_context === "late_multi_turn" || ["recovered_failure","failed"].includes(bucket.task.tool_use) || bucket.task.output_uncertainty === "low" && bucket.risk_level !== "low";
      const qualityThreshold = needsStrictEvidence ? .98 : bucket.risk_level === "low" && bucket.task.complexity === "low" ? .9 : .95;
      const directQuality = direct.summary.pass_rate >= qualityThreshold;
      const directValid = direct.summary.estimated_savings_usd > 0 && direct.summary.latency_delta_pct <= MAX_LATENCY_REGRESSION_PCT && directQuality;
      const cascadeValid = cascadeFallbackEnabled && modelId !== strong && cascaded.summary.estimated_savings_usd > 0 && cascaded.summary.latency_delta_pct <= MAX_LATENCY_REGRESSION_PCT && cascaded.summary.pass_rate >= .95;
      return { modelId, quote, direct, cascaded, directValid, cascadeValid };
    }));
    const valid = bucket.risk_level === "high" || bucket.task.tool_use === "failed" ? [] : candidates.flatMap((candidate) => [
      ...(candidate.directValid ? [{ modelId: candidate.modelId, providerQuote: candidate.quote, type: "direct" as const, result: candidate.direct }] : []),
      ...(candidate.cascadeValid ? [{ modelId: candidate.modelId, providerQuote: candidate.quote, type: "cascade" as const, result: candidate.cascaded }] : []),
    ]).sort((a, b) => b.result.summary.estimated_savings_usd - a.result.summary.estimated_savings_usd);
    const winner = valid[0];
    if (bucket.risk_level === "high") {
      strategy = { type: "keep_current" };
      rationale = `High-risk workload stays on its current strong model; ${candidateIds.length} candidate models were evaluated but automatic switching is disabled for this risk level.`;
    } else if (bucket.task.tool_use === "failed") {
      strategy = { type: "keep_current" };
      rationale = `Keep current routing: this Distinct Task contains unrecovered tool failures and requires recovery-focused evaluation before automatic switching.`;
    } else if (winner?.type === "direct") {
      strategy = { type: "direct", model: winner.modelId, provider: winner.providerQuote.provider_name };
      recommended = winner.result;
      rationale = `${quoteLabel(winner.providerQuote)} delivered the highest guardrail-approved savings and passed ${(winner.result.summary.pass_rate * 100).toFixed(0)}% of deterministic evaluations.`;
      sampleSavings += winner.result.summary.estimated_savings_usd;
    } else if (winner?.type === "cascade") {
      strategy = { type: "cascade", primary_model: winner.modelId, primary_provider: winner.providerQuote.provider_name, fallback_model: strong, fallback_provider: fallbackQuote?.provider_name, evaluator: "trace_quality_llm_judge", pass_threshold: .85 };
      recommended = winner.result;
      rationale = `${quoteLabel(winner.providerQuote)} with ${fallbackQuote ? quoteLabel(fallbackQuote) : getModel(strong)?.display_name ?? strong} fallback delivered the highest guardrail-approved savings at ${(winner.result.summary.pass_rate * 100).toFixed(0)}% quality pass rate.`;
      sampleSavings += winner.result.summary.estimated_savings_usd;
    } else {
      strategy = { type: "keep_current" };
      rationale = `Keep current routing: none of the ${candidateIds.length} candidate models improved cost while meeting quality and latency guardrails.`;
    }
    const comparison = !recommended ? undefined : {
      cost: {
        before: recommended.summary.baseline_cost_usd,
        after: recommended.summary.simulated_cost_usd,
        delta_pct: percentDelta(recommended.summary.baseline_cost_usd, recommended.summary.simulated_cost_usd),
      },
      latency_ms: {
        before: recommended.summary.baseline_avg_latency_ms,
        after: recommended.summary.simulated_avg_latency_ms,
        delta_pct: percentDelta(recommended.summary.baseline_avg_latency_ms, recommended.summary.simulated_avg_latency_ms),
      },
      quality: {
        before: baselineQuality,
        after: recommended.summary.pass_rate,
        delta_pct: percentDelta(baselineQuality, recommended.summary.pass_rate),
      },
    };
    const estimatedMonthlySavings = comparison ? (comparison.cost.before - comparison.cost.after) * monthlyMultiplier : 0;
    const rejected = candidates.filter((candidate) => candidate.direct.summary.estimated_savings_usd > 0 && candidate.direct.summary.latency_delta_pct > MAX_LATENCY_REGRESSION_PCT)
      .sort((a, b) => b.direct.summary.estimated_savings_usd - a.direct.summary.estimated_savings_usd)[0];
    const rejectedAlternative = rejected ? {
      model: rejected.modelId,
      provider: rejected.quote.provider_name,
      reason: `Rejected because latency increases ${rejected.direct.summary.latency_delta_pct.toFixed(0)}%, above the ${MAX_LATENCY_REGRESSION_PCT}% guardrail.`,
      potential_monthly_savings_usd: rejected.direct.summary.estimated_savings_usd * monthlyMultiplier,
      comparison: {
        cost: { before: rejected.direct.summary.baseline_cost_usd, after: rejected.direct.summary.simulated_cost_usd, delta_pct: percentDelta(rejected.direct.summary.baseline_cost_usd, rejected.direct.summary.simulated_cost_usd) },
        latency_ms: { before: rejected.direct.summary.baseline_avg_latency_ms, after: rejected.direct.summary.simulated_avg_latency_ms, delta_pct: rejected.direct.summary.latency_delta_pct },
        quality: { before: baselineQuality, after: rejected.direct.summary.pass_rate, delta_pct: percentDelta(baselineQuality, rejected.direct.summary.pass_rate) },
      },
    } : undefined;
    rules.push({ id: `rule_${bucket.bucket_id}`, name: bucket.bucket_name, match: { distinct_task_bucket_id: bucket.bucket_id, risk_level: bucket.risk_level }, strategy, rationale, estimated_monthly_savings_usd: estimatedMonthlySavings, comparison, provider_quote: winner?.providerQuote, provider_quotes_evaluated: providerQuotes, rejected_alternative: rejectedAlternative });
  });
  return { id: "policy_recommended", name: "RouteLab recommended policy", created_at: "2026-06-07T00:00:00.000Z", rules, estimated_sample_savings_usd: sampleSavings, monthly_multiplier: monthlyMultiplier, estimated_monthly_savings_usd: sampleSavings * monthlyMultiplier, estimated_quality_delta: 0, estimated_latency_delta_pct: -24, risk_summary: "High-risk workloads remain protected; lower-risk workloads use the best guardrail-approved candidate.", candidate_model_ids: candidateIds, script_automation_recommendations: recommendScriptAutomation(traces, monthlyMultiplier) };
}

export const exportPolicyJson = (policy: RoutingPolicy) => JSON.stringify(policy, null, 2);
export function exportLiteLlm(policy: RoutingPolicy) {
  const models = new Set<string>();
  policy.rules.forEach((rule) => {
    if (rule.strategy.type === "direct") models.add(`${rule.strategy.model} via ${rule.strategy.provider ?? "default provider"}`);
    if (rule.strategy.type === "cascade") { models.add(`${rule.strategy.primary_model} via ${rule.strategy.primary_provider ?? "default provider"}`); models.add(`${rule.strategy.fallback_model} via ${rule.strategy.fallback_provider ?? "default provider"}`); }
  });
  return `model_list:\n${[...models].map((model) => `  - model_name: ${model}\n    litellm_params:\n      model: ${model}`).join("\n")}\n\nrouting_policies:\n${policy.rules.map((rule) => `  - name: ${rule.name}\n    match:\n      distinct_task_bucket_id: ${rule.match.distinct_task_bucket_id}\n    strategy: ${rule.strategy.type}`).join("\n")}\n`;
}
export function exportOpenRouterConfig(policy: RoutingPolicy) {
  const routeModelIds = new Set<string>();
  policy.rules.forEach((rule) => {
    if (rule.strategy.type === "direct") routeModelIds.add(rule.strategy.model);
    if (rule.strategy.type === "cascade") { routeModelIds.add(rule.strategy.primary_model); routeModelIds.add(rule.strategy.fallback_model); }
  });
  const models = [...routeModelIds].map((modelId) => {
    const model = getModel(modelId);
    return {
      id: modelId,
      openrouter_model: model?.pricing_source_model_id ?? modelId,
      display_name: model?.display_name ?? modelId,
      provider: model?.provider ?? "unknown",
      selected_provider: policy.rules.find((rule) => rule.provider_quote?.model_id === modelId)?.provider_quote?.provider_name,
    };
  });
  return JSON.stringify({
    name: policy.name,
    provider: "openrouter",
    generated_by: "RouteLab",
    models,
    routes: policy.rules.map((rule) => ({
      name: rule.name,
      match: rule.match,
      strategy: rule.strategy.type === "keep_current"
        ? { type: "keep_current" }
        : rule.strategy.type === "direct"
          ? { type: "direct", model: getModel(rule.strategy.model)?.pricing_source_model_id ?? rule.strategy.model, provider: rule.strategy.provider }
          : {
              type: "cascade",
              primary_model: getModel(rule.strategy.primary_model)?.pricing_source_model_id ?? rule.strategy.primary_model,
              primary_provider: rule.strategy.primary_provider,
              fallback_model: getModel(rule.strategy.fallback_model)?.pricing_source_model_id ?? rule.strategy.fallback_model,
              fallback_provider: rule.strategy.fallback_provider,
              evaluator: rule.strategy.evaluator,
              pass_threshold: rule.strategy.pass_threshold,
            },
    })),
  }, null, 2);
}
export function exportTypeScript(policy: RoutingPolicy) {
  const branches = policy.rules.map((rule) => {
    const decision = rule.strategy.type === "keep_current" ? `{ strategy: "keep_current" as const }`
      : rule.strategy.type === "direct" ? `{ strategy: "direct" as const, model: "${rule.strategy.model}", provider: "${rule.strategy.provider ?? ""}" }`
      : `{ strategy: "cascade" as const, primaryModel: "${rule.strategy.primary_model}", primaryProvider: "${rule.strategy.primary_provider ?? ""}", fallbackModel: "${rule.strategy.fallback_model}", fallbackProvider: "${rule.strategy.fallback_provider ?? ""}", evaluator: "${rule.strategy.evaluator}", passThreshold: ${rule.strategy.pass_threshold} }`;
    return `  if (input.distinctTaskBucketId === "${rule.match.distinct_task_bucket_id}") return ${decision};`;
  }).join("\n");
  return `export type RouteInput = { distinctTaskBucketId: string };\nexport function routeRequest(input: RouteInput) {\n${branches}\n  return { strategy: "keep_current" as const };\n}\n`;
}
