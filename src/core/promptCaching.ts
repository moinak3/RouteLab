import { getModel } from "./catalog";
import { MIN_PROVIDER_QUOTES, providerQuotesForModel } from "./providerPricing";
import type { DistinctTaskBucket, InferenceProviderQuote, Trace } from "../types";

export type PromptCachingRecommendation = "add_cache_control" | "monitor" | "already_configured" | "not_recommended";
export type PromptCachingProviderSaving = {
  provider_id: string;
  provider_name: string;
  model_id: string;
  model_display_name: string;
  input_cost_per_1m: number;
  estimated_cache_read_discount_pct: number;
  current_monthly_prefix_cost: number;
  projected_monthly_prefix_cost: number;
  monthly_savings: number;
  annual_savings: number;
  estimated_latency_ms: number;
};
export type PromptCachingOpportunity = {
  scope: "global" | "trace_signature";
  scope_id: string;
  scope_name: string;
  trace_count: number;
  model_id: string;
  model_display_name: string;
  stable_prefix_tokens: number;
  stable_prefix_chars: number;
  prefix_similarity_pct: number;
  prompt_cache_configured: boolean;
  monthly_request_volume: number;
  sample_prefix_preview: string;
  suggested_cache_control_path: string;
  marker_instruction: string;
  recommendation: PromptCachingRecommendation;
  primary_reason: string;
  per_provider: PromptCachingProviderSaving[];
};
export type PromptCachingOpportunityBundle = {
  global: PromptCachingOpportunity;
  by_signature: PromptCachingOpportunity[];
};

type BuildOptions = {
  traces: Trace[];
  distinctTaskBuckets?: DistinctTaskBucket[];
  monthlyRequestVolume?: number;
  monthlyMultiplier?: number;
  minStablePrefixTokens?: number;
};

const TOKEN_CHARS = 4;
const DEFAULT_MIN_STABLE_PREFIX_TOKENS = 128;
const round = (value: number, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const approxTokens = (text: string) => Math.ceil(text.length / TOKEN_CHARS);
const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

const cacheDiscountByProvider: Record<string, number> = {
  "anthropic-direct": .9,
  "aws-bedrock": .9,
  "openai-direct": .5,
  "azure-ai-foundry": .5,
  "google-ai-studio": .75,
  "vertex-ai": .75,
  openrouter: .5,
  "vercel-ai-gateway": .5,
  "litellm-gateway": .5,
  "mistral-direct": .5,
  "deepseek-direct": .5,
  "together-ai": .5,
  "fireworks-ai": .5,
  deepinfra: .5,
};

export function buildPromptCachingOpportunityBundle(options: BuildOptions): PromptCachingOpportunityBundle {
  const global = buildPromptCachingOpportunity({
    ...options,
    scope: "global",
    scopeId: "all",
    scopeName: "All production traces",
  });
  const traceById = new Map(options.traces.map((trace) => [trace.id, trace]));
  const bySignature = (options.distinctTaskBuckets ?? []).map((bucket) => buildPromptCachingOpportunity({
    ...options,
    traces: bucket.traces.map((id) => traceById.get(id)).filter((trace): trace is Trace => Boolean(trace)),
    scope: "trace_signature",
    scopeId: bucket.bucket_id,
    scopeName: bucket.bucket_name,
  }));
  return { global, by_signature: bySignature };
}

export function buildPromptCachingOpportunity(options: BuildOptions & { scope?: "global" | "trace_signature"; scopeId?: string; scopeName?: string }): PromptCachingOpportunity {
  const traces = options.traces;
  const monthlyRequestVolume = options.monthlyRequestVolume ?? traces.length * (options.monthlyMultiplier ?? 30);
  const dominantModelId = dominantModel(traces);
  const model = getModel(dominantModelId);
  const promptCacheConfigured = traces.some(hasExplicitCacheControl);
  const stablePrefix = findStablePrefix(traces);
  const prefixSimilarity = estimatePromptSimilarity(traces.map(promptEnvelope));
  const stablePrefixTokens = Math.max(stablePrefix.tokens, averageMetadataStaticTokens(traces));
  const stablePrefixChars = stablePrefix.text ? stablePrefix.text.length : Math.round(stablePrefixTokens * TOKEN_CHARS);
  const perProvider = providerQuotesForModel(dominantModelId, MIN_PROVIDER_QUOTES)
    .map((quote) => providerSavings(quote, stablePrefixTokens, monthlyRequestVolume))
    .sort((a, b) => b.monthly_savings - a.monthly_savings || a.projected_monthly_prefix_cost - b.projected_monthly_prefix_cost);
  const minimumTokens = options.minStablePrefixTokens ?? DEFAULT_MIN_STABLE_PREFIX_TOKENS;
  const topSavings = perProvider[0]?.monthly_savings ?? 0;
  const recommendation: PromptCachingRecommendation = promptCacheConfigured
    ? "already_configured"
    : traces.length < 5 || stablePrefixTokens < minimumTokens
      ? "not_recommended"
      : topSavings >= .05
        ? "add_cache_control"
        : "monitor";

  return {
    scope: options.scope ?? "global",
    scope_id: options.scopeId ?? "all",
    scope_name: options.scopeName ?? "All production traces",
    trace_count: traces.length,
    model_id: dominantModelId,
    model_display_name: model?.display_name ?? dominantModelId,
    stable_prefix_tokens: round(stablePrefixTokens, 1),
    stable_prefix_chars: stablePrefixChars,
    prefix_similarity_pct: round(prefixSimilarity * 100, 1),
    prompt_cache_configured: promptCacheConfigured,
    monthly_request_volume: Math.round(monthlyRequestVolume),
    sample_prefix_preview: stablePrefix.text ? preview(stablePrefix.text) : "Stable prefix inferred from trace metadata.",
    suggested_cache_control_path: markerPath(stablePrefix.kind),
    marker_instruction: markerInstruction(stablePrefix.kind, stablePrefixTokens),
    recommendation,
    primary_reason: reasonFor(recommendation, stablePrefixTokens, prefixSimilarity, monthlyRequestVolume, topSavings),
    per_provider: perProvider,
  };
}

function providerSavings(quote: InferenceProviderQuote, stablePrefixTokens: number, monthlyRequestVolume: number): PromptCachingProviderSaving {
  const discount = cacheDiscountByProvider[quote.provider_id] ?? .5;
  const currentMonthlyPrefixCost = stablePrefixTokens * quote.input_cost_per_1m / 1_000_000 * monthlyRequestVolume;
  const projectedMonthlyPrefixCost = currentMonthlyPrefixCost * (1 - discount);
  const monthlySavings = currentMonthlyPrefixCost - projectedMonthlyPrefixCost;
  return {
    provider_id: quote.provider_id,
    provider_name: quote.provider_name,
    model_id: quote.model_id,
    model_display_name: quote.model_display_name,
    input_cost_per_1m: quote.input_cost_per_1m,
    estimated_cache_read_discount_pct: round(discount * 100, 1),
    current_monthly_prefix_cost: round(currentMonthlyPrefixCost, 2),
    projected_monthly_prefix_cost: round(projectedMonthlyPrefixCost, 2),
    monthly_savings: round(monthlySavings, 2),
    annual_savings: round(monthlySavings * 12, 2),
    estimated_latency_ms: quote.estimated_latency_ms,
  };
}

function findStablePrefix(traces: Trace[]) {
  const systemMessages = traces.map((trace) => trace.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n"));
  const commonSystem = longestCommonPrefix(systemMessages);
  if (approxTokens(commonSystem) >= 48) return { text: commonSystem.trim(), tokens: approxTokens(commonSystem), kind: "system" as const };
  const prompts = traces.map(promptEnvelope);
  const commonPrompt = longestCommonPrefix(prompts);
  if (approxTokens(commonPrompt) >= 48) return { text: commonPrompt.trim(), tokens: approxTokens(commonPrompt), kind: "prompt" as const };
  const repeatedPrefix = repeatedPromptPrefix(traces.map((trace) => trace.prompt_text));
  if (repeatedPrefix.tokens >= 48) return { text: repeatedPrefix.text, tokens: repeatedPrefix.tokens, kind: "prompt" as const };
  return { text: "", tokens: 0, kind: "metadata" as const };
}

function longestCommonPrefix(values: string[]) {
  if (!values.length) return "";
  let prefix = values[0] ?? "";
  for (const value of values.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < value.length && prefix[index] === value[index]) index++;
    prefix = prefix.slice(0, index);
    if (!prefix) break;
  }
  return prefix;
}

function averageMetadataStaticTokens(traces: Trace[]) {
  return avg(traces.map((trace) => {
    const staticTokens = Number(trace.metadata?.static_prompt_tokens ?? trace.metadata?.system_prompt_tokens ?? 0);
    const fewShotTokens = Number(trace.metadata?.few_shot_tokens ?? 0);
    return (Number.isFinite(staticTokens) ? staticTokens : 0) + (Number.isFinite(fewShotTokens) ? fewShotTokens : 0);
  }));
}

function repeatedPromptPrefix(prompts: string[]) {
  const candidates = new Map<string, { text: string; count: number }>();
  prompts.forEach((prompt) => {
    const sentencePrefix = prompt.match(/^(.{80,900}?(?:\.|:|;|,))/)?.[1] ?? "";
    const wordPrefix = prompt.split(/\s+/).slice(0, 14).join(" ");
    [sentencePrefix, wordPrefix].forEach((candidate) => {
      const cleaned = candidate.trim();
      if (approxTokens(cleaned) < 8) return;
      const key = normalize(cleaned);
      const existing = candidates.get(key);
      candidates.set(key, { text: cleaned, count: (existing?.count ?? 0) + 1 });
    });
  });
  const repeated = [...candidates.values()]
    .filter((candidate) => candidate.count >= Math.max(5, Math.ceil(prompts.length * .08)))
    .sort((a, b) => b.count * approxTokens(b.text) - a.count * approxTokens(a.text))[0];
  return repeated ? { text: repeated.text, tokens: approxTokens(repeated.text) } : { text: "", tokens: 0 };
}

function promptEnvelope(trace: Trace) {
  if (trace.messages.length) return trace.messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
  return trace.prompt_text;
}

function hasExplicitCacheControl(trace: Trace) {
  return /cache_control|prompt.?cache|cached.?prefix/i.test(`${trace.prompt_text} ${JSON.stringify(trace.messages)} ${JSON.stringify(trace.metadata ?? {})}`);
}

function estimatePromptSimilarity(prompts: string[]) {
  if (prompts.length < 2) return prompts.length ? 1 : 0;
  const sampled = prompts.slice(0, 40).map((prompt) => new Set(normalize(prompt).split(/\s+/).filter((word) => word.length > 2)));
  const scores: number[] = [];
  for (let i = 0; i < sampled.length; i++) {
    for (let j = i + 1; j < Math.min(sampled.length, i + 6); j++) {
      const intersection = [...sampled[i]].filter((word) => sampled[j].has(word)).length;
      const union = new Set([...sampled[i], ...sampled[j]]).size;
      scores.push(union ? intersection / union : 0);
    }
  }
  return avg(scores);
}

function dominantModel(traces: Trace[]) {
  const counts = traces.reduce<Record<string, number>>((items, trace) => {
    items[trace.model] = (items[trace.model] ?? 0) + 1;
    return items;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function markerPath(kind: "system" | "prompt" | "metadata") {
  if (kind === "system") return "messages[system].content[last_static_block].cache_control";
  if (kind === "prompt") return "prompt_text[stable_prefix_end].cache_control";
  return "messages[last_static_instruction_or_few_shot_block].cache_control";
}

function markerInstruction(kind: "system" | "prompt" | "metadata", tokens: number) {
  const roundedTokens = Math.round(tokens).toLocaleString();
  if (kind === "system") return `Add cache_control to the final static system-message block before request-specific user input. The repeated prefix is about ${roundedTokens} tokens.`;
  if (kind === "prompt") return `Add cache_control immediately after the stable prompt prefix, before dynamic customer/request fields. The repeated prefix is about ${roundedTokens} tokens.`;
  return `Split static instructions and few-shot examples into their own message/content block, then add cache_control to that block. The inferred stable prefix is about ${roundedTokens} tokens.`;
}

function reasonFor(recommendation: PromptCachingRecommendation, stablePrefixTokens: number, similarity: number, monthlyVolume: number, monthlySavings: number) {
  if (recommendation === "already_configured") return "These traces already include cache_control or prompt-cache markers, so no duplicate marker is suggested.";
  if (recommendation === "not_recommended") return `Only ${Math.round(stablePrefixTokens).toLocaleString()} stable prefix tokens were detected across ${monthlyVolume.toLocaleString()} monthly calls; caching is unlikely to matter yet.`;
  if (recommendation === "monitor") return `A stable prefix was found, but provider-level savings are below $1/month at current volume. Keep monitoring as traffic grows.`;
  return `A repeated ${Math.round(stablePrefixTokens).toLocaleString()}-token prefix appears in prompts with ${round(similarity * 100, 1)}% similarity. Estimated top-provider savings are ${money(monthlySavings)}/mo by caching that prefix.`;
}

function preview(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 260);
}

function money(value: number) {
  return `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
