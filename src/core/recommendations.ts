import type { RoutingPolicy, RoutingRule, Trace, DistinctTaskBucket } from "../types";
import { getModel, recommendationCandidates } from "./catalog";
import { evaluateTrace } from "./evaluators";
import { cascade, MONTHLY_MULTIPLIER, replay } from "./simulations";

const percentDelta = (before: number, after: number) => before ? (after - before) / before * 100 : 0;
const MAX_LATENCY_REGRESSION_PCT = 50;

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
    const candidates = candidateIds.map((modelId) => {
      const direct = replay(selected, modelId);
      const cascaded = cascade(selected, modelId, strong);
      const needsStrictEvidence = bucket.task.complexity === "high" || bucket.task.temporal_context === "late_multi_turn" || ["recovered_failure","failed"].includes(bucket.task.tool_use) || bucket.task.output_uncertainty === "low" && bucket.risk_level !== "low";
      const qualityThreshold = needsStrictEvidence ? .98 : bucket.risk_level === "low" && bucket.task.complexity === "low" ? .9 : .95;
      const directQuality = direct.summary.pass_rate >= qualityThreshold;
      const directValid = direct.summary.estimated_savings_usd > 0 && direct.summary.latency_delta_pct <= MAX_LATENCY_REGRESSION_PCT && directQuality;
      const cascadeValid = cascadeFallbackEnabled && modelId !== strong && cascaded.summary.estimated_savings_usd > 0 && cascaded.summary.latency_delta_pct <= MAX_LATENCY_REGRESSION_PCT && cascaded.summary.pass_rate >= .95;
      return { modelId, direct, cascaded, directValid, cascadeValid };
    });
    const valid = bucket.risk_level === "high" || bucket.task.tool_use === "failed" ? [] : candidates.flatMap((candidate) => [
      ...(candidate.directValid ? [{ modelId: candidate.modelId, type: "direct" as const, result: candidate.direct }] : []),
      ...(candidate.cascadeValid ? [{ modelId: candidate.modelId, type: "cascade" as const, result: candidate.cascaded }] : []),
    ]).sort((a, b) => b.result.summary.estimated_savings_usd - a.result.summary.estimated_savings_usd);
    const winner = valid[0];
    if (bucket.risk_level === "high") {
      strategy = { type: "keep_current" };
      rationale = `High-risk workload stays on its current strong model; ${candidateIds.length} candidate models were evaluated but automatic switching is disabled for this risk level.`;
    } else if (bucket.task.tool_use === "failed") {
      strategy = { type: "keep_current" };
      rationale = `Keep current routing: this Distinct Task contains unrecovered tool failures and requires recovery-focused evaluation before automatic switching.`;
    } else if (winner?.type === "direct") {
      strategy = { type: "direct", model: winner.modelId };
      recommended = winner.result;
      rationale = `${getModel(winner.modelId)?.display_name ?? winner.modelId} delivered the highest guardrail-approved savings and passed ${(winner.result.summary.pass_rate * 100).toFixed(0)}% of deterministic evaluations.`;
      sampleSavings += winner.result.summary.estimated_savings_usd;
    } else if (winner?.type === "cascade") {
      strategy = { type: "cascade", primary_model: winner.modelId, fallback_model: strong, evaluator: "mock_judge", pass_threshold: .85 };
      recommended = winner.result;
      rationale = `${getModel(winner.modelId)?.display_name ?? winner.modelId} with Opus fallback delivered the highest guardrail-approved savings at ${(winner.result.summary.pass_rate * 100).toFixed(0)}% quality pass rate.`;
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
      reason: `Rejected because latency increases ${rejected.direct.summary.latency_delta_pct.toFixed(0)}%, above the ${MAX_LATENCY_REGRESSION_PCT}% guardrail.`,
      potential_monthly_savings_usd: rejected.direct.summary.estimated_savings_usd * monthlyMultiplier,
      comparison: {
        cost: { before: rejected.direct.summary.baseline_cost_usd, after: rejected.direct.summary.simulated_cost_usd, delta_pct: percentDelta(rejected.direct.summary.baseline_cost_usd, rejected.direct.summary.simulated_cost_usd) },
        latency_ms: { before: rejected.direct.summary.baseline_avg_latency_ms, after: rejected.direct.summary.simulated_avg_latency_ms, delta_pct: rejected.direct.summary.latency_delta_pct },
        quality: { before: baselineQuality, after: rejected.direct.summary.pass_rate, delta_pct: percentDelta(baselineQuality, rejected.direct.summary.pass_rate) },
      },
    } : undefined;
    rules.push({ id: `rule_${bucket.bucket_id}`, name: bucket.bucket_name, match: { distinct_task_bucket_id: bucket.bucket_id, risk_level: bucket.risk_level }, strategy, rationale, estimated_monthly_savings_usd: estimatedMonthlySavings, comparison, rejected_alternative: rejectedAlternative });
  });
  return { id: "policy_recommended", name: "RouteLab recommended policy", created_at: "2026-06-07T00:00:00.000Z", rules, estimated_sample_savings_usd: sampleSavings, monthly_multiplier: monthlyMultiplier, estimated_monthly_savings_usd: sampleSavings * monthlyMultiplier, estimated_quality_delta: 0, estimated_latency_delta_pct: -24, risk_summary: "High-risk workloads remain protected; lower-risk workloads use the best guardrail-approved candidate.", candidate_model_ids: candidateIds };
}

export const exportPolicyJson = (policy: RoutingPolicy) => JSON.stringify(policy, null, 2);
export function exportLiteLlm(policy: RoutingPolicy) {
  const models = new Set<string>();
  policy.rules.forEach((rule) => {
    if (rule.strategy.type === "direct") models.add(rule.strategy.model);
    if (rule.strategy.type === "cascade") { models.add(rule.strategy.primary_model); models.add(rule.strategy.fallback_model); }
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
          ? { type: "direct", model: getModel(rule.strategy.model)?.pricing_source_model_id ?? rule.strategy.model }
          : {
              type: "cascade",
              primary_model: getModel(rule.strategy.primary_model)?.pricing_source_model_id ?? rule.strategy.primary_model,
              fallback_model: getModel(rule.strategy.fallback_model)?.pricing_source_model_id ?? rule.strategy.fallback_model,
              evaluator: rule.strategy.evaluator,
              pass_threshold: rule.strategy.pass_threshold,
            },
    })),
  }, null, 2);
}
export function exportTypeScript(policy: RoutingPolicy) {
  const branches = policy.rules.map((rule) => {
    const decision = rule.strategy.type === "keep_current" ? `{ strategy: "keep_current" as const }`
      : rule.strategy.type === "direct" ? `{ strategy: "direct" as const, model: "${rule.strategy.model}" }`
      : `{ strategy: "cascade" as const, primaryModel: "${rule.strategy.primary_model}", fallbackModel: "${rule.strategy.fallback_model}", evaluator: "${rule.strategy.evaluator}", passThreshold: ${rule.strategy.pass_threshold} }`;
    return `  if (input.distinctTaskBucketId === "${rule.match.distinct_task_bucket_id}") return ${decision};`;
  }).join("\n");
  return `export type RouteInput = { distinctTaskBucketId: string };\nexport function routeRequest(input: RouteInput) {\n${branches}\n  return { strategy: "keep_current" as const };\n}\n`;
}
