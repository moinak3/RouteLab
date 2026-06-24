import type { InferenceProviderQuote, Model } from "../types";
import { getModel } from "./catalog";

type ProviderTemplate = {
  id: string; name: string; costMultiplier: number; latencyMultiplier: number;
};

export const MIN_PROVIDER_QUOTES = 5;

const familyProviders: Record<Model["family"], ProviderTemplate[]> = {
  OpenAI: [
    { id: "openai-direct", name: "OpenAI Direct API", costMultiplier: 1, latencyMultiplier: .92 },
    { id: "openrouter", name: "OpenRouter", costMultiplier: .96, latencyMultiplier: 1 },
    { id: "vercel-ai-gateway", name: "Vercel AI Gateway", costMultiplier: .98, latencyMultiplier: .96 },
    { id: "azure-ai-foundry", name: "Azure AI Foundry", costMultiplier: 1.04, latencyMultiplier: .9 },
    { id: "litellm-gateway", name: "LiteLLM Gateway", costMultiplier: .99, latencyMultiplier: 1.03 },
  ],
  Claude: [
    { id: "anthropic-direct", name: "Anthropic Direct API", costMultiplier: 1, latencyMultiplier: .91 },
    { id: "openrouter", name: "OpenRouter", costMultiplier: .94, latencyMultiplier: 1 },
    { id: "aws-bedrock", name: "AWS Bedrock", costMultiplier: .98, latencyMultiplier: .94 },
    { id: "vercel-ai-gateway", name: "Vercel AI Gateway", costMultiplier: .97, latencyMultiplier: .97 },
    { id: "litellm-gateway", name: "LiteLLM Gateway", costMultiplier: .99, latencyMultiplier: 1.02 },
  ],
  Gemini: [
    { id: "google-ai-studio", name: "Google AI Studio", costMultiplier: 1, latencyMultiplier: .9 },
    { id: "vertex-ai", name: "Vertex AI", costMultiplier: 1.03, latencyMultiplier: .92 },
    { id: "openrouter", name: "OpenRouter", costMultiplier: .95, latencyMultiplier: 1 },
    { id: "vercel-ai-gateway", name: "Vercel AI Gateway", costMultiplier: .97, latencyMultiplier: .98 },
    { id: "litellm-gateway", name: "LiteLLM Gateway", costMultiplier: .99, latencyMultiplier: 1.03 },
  ],
  Mistral: [
    { id: "mistral-direct", name: "Mistral Direct API", costMultiplier: 1, latencyMultiplier: .91 },
    { id: "openrouter", name: "OpenRouter", costMultiplier: .94, latencyMultiplier: 1 },
    { id: "together-ai", name: "Together AI", costMultiplier: .9, latencyMultiplier: .94 },
    { id: "fireworks-ai", name: "Fireworks AI", costMultiplier: .88, latencyMultiplier: .9 },
    { id: "aws-bedrock", name: "AWS Bedrock", costMultiplier: .99, latencyMultiplier: .97 },
  ],
  DeepSeek: [
    { id: "deepseek-direct", name: "DeepSeek Direct API", costMultiplier: 1, latencyMultiplier: .95 },
    { id: "openrouter", name: "OpenRouter", costMultiplier: .94, latencyMultiplier: 1 },
    { id: "together-ai", name: "Together AI", costMultiplier: .88, latencyMultiplier: .92 },
    { id: "fireworks-ai", name: "Fireworks AI", costMultiplier: .86, latencyMultiplier: .89 },
    { id: "deepinfra", name: "DeepInfra", costMultiplier: .82, latencyMultiplier: .97 },
  ],
  Local: [
    { id: "self-hosted", name: "Self-hosted cluster", costMultiplier: 1, latencyMultiplier: 1 },
    { id: "runpod", name: "RunPod", costMultiplier: 1.15, latencyMultiplier: .9 },
    { id: "modal", name: "Modal", costMultiplier: 1.22, latencyMultiplier: .86 },
    { id: "replicate", name: "Replicate", costMultiplier: 1.35, latencyMultiplier: 1.08 },
    { id: "together-dedicated", name: "Together Dedicated", costMultiplier: 1.1, latencyMultiplier: .93 },
  ],
};

const roundPrice = (value: number) => Number(value.toFixed(6));

export function providerQuotesForModel(modelId: string, limit = MIN_PROVIDER_QUOTES, catalogModel = getModel(modelId)): InferenceProviderQuote[] {
  if (!catalogModel) return [];
  return familyProviders[catalogModel.family]
    .slice(0, Math.max(limit, MIN_PROVIDER_QUOTES))
    .map((provider) => ({
      provider_id: provider.id,
      provider_name: provider.name,
      model_id: catalogModel.id,
      model_display_name: catalogModel.display_name,
      input_cost_per_1m: roundPrice(catalogModel.input_cost_per_1m * provider.costMultiplier),
      output_cost_per_1m: roundPrice(catalogModel.output_cost_per_1m * provider.costMultiplier),
      estimated_latency_ms: Math.max(1, Math.round(catalogModel.default_latency_ms * provider.latencyMultiplier)),
      pricing_source: catalogModel.pricing_source === "User configured" ? "user_configured" : "provider_quote",
    }));
}

export function quoteLabel(quote: Pick<InferenceProviderQuote, "model_display_name" | "provider_name">) {
  return `${quote.model_display_name} via ${quote.provider_name}`;
}

export function calculateProviderCost(inputTokens: number, outputTokens: number, quote: InferenceProviderQuote) {
  return inputTokens * quote.input_cost_per_1m / 1_000_000 + outputTokens * quote.output_cost_per_1m / 1_000_000;
}

export function cheapestProviderQuoteForModel(modelId: string) {
  return providerQuotesForModel(modelId).sort((a, b) =>
    (a.input_cost_per_1m + a.output_cost_per_1m) - (b.input_cost_per_1m + b.output_cost_per_1m)
    || a.estimated_latency_ms - b.estimated_latency_ms,
  )[0];
}
