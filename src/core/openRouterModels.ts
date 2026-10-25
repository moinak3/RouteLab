import type { Model } from "../types.js";

type OpenRouterModelRecord = {
  id?: unknown;
  name?: unknown;
  created?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { output_modalities?: unknown };
  supported_parameters?: unknown;
};

const familyByAuthor = {
  openai: "OpenAI",
  anthropic: "Claude",
  google: "Gemini",
  mistralai: "Mistral",
  deepseek: "DeepSeek",
  "z-ai": "GLM",
  minimax: "MiniMax",
  nvidia: "NVIDIA",
} as const satisfies Record<string, Model["family"]>;

const familyLimits: Partial<Record<Model["family"], number>> = {
  GLM: 3,
  MiniMax: 3,
  NVIDIA: 3,
};

const excludedModelVariant = /(?:^|[-_])(batch|free|content-safety|guard|moderation|embedding|rerank|switchyard)(?:$|[-_])/i;

export const openRouterFamilyLabels: Record<Model["family"], string> = {
  OpenAI: "OpenAI",
  Claude: "Anthropic",
  Gemini: "Google",
  Mistral: "Mistral",
  DeepSeek: "DeepSeek",
  GLM: "GLM",
  MiniMax: "MiniMax",
  NVIDIA: "NVIDIA",
  Local: "Local",
  Router: "Routing strategies",
};

const numericPrice = (value: unknown) => {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? Number((price * 1_000_000).toFixed(6)) : undefined;
};

const isTextGenerationModel = (record: OpenRouterModelRecord) => {
  const modalities = Array.isArray(record.architecture?.output_modalities)
    ? record.architecture.output_modalities.map(String)
    : [];
  const parameters = Array.isArray(record.supported_parameters)
    ? record.supported_parameters.map(String)
    : [];
  return modalities.length === 1
    && modalities[0] === "text"
    && (parameters.includes("max_tokens") || parameters.includes("max_completion_tokens"));
};

const displayName = (record: OpenRouterModelRecord, runtimeId: string) => {
  const named = String(record.name ?? "").replace(/^[^:]+:\s*/, "").trim();
  const idParts = runtimeId.split("/");
  return named || idParts[idParts.length - 1] || runtimeId;
};

export function latestOpenRouterModels(records: OpenRouterModelRecord[], perFamily = 4): Model[] {
  const selected = new Map<Model["family"], Array<{ record: OpenRouterModelRecord; runtimeId: string; created: number; input: number; output: number }>>();

  records.forEach((record) => {
    const runtimeId = String(record.id ?? "");
    const [author, slug, ...extra] = runtimeId.split("/");
    const family = familyByAuthor[author as keyof typeof familyByAuthor];
    const created = Number(record.created);
    const input = numericPrice(record.pricing?.prompt);
    const output = numericPrice(record.pricing?.completion);
    if (!family || !slug || extra.length || slug.includes(":") || excludedModelVariant.test(slug) || !Number.isFinite(created) || input === undefined || output === undefined || !isTextGenerationModel(record)) return;
    selected.set(family, [...(selected.get(family) ?? []), { record, runtimeId, created, input, output }]);
  });

  return Object.values(familyByAuthor).flatMap((family) => {
    const limit = Math.min(perFamily, familyLimits[family] ?? perFamily);
    const newest = (selected.get(family) ?? [])
      .sort((a, b) => b.created - a.created || a.runtimeId.localeCompare(b.runtimeId))
      .slice(0, Math.max(0, limit));
    const prices = newest.map((item) => item.input + item.output);
    const cheapest = prices.length ? Math.min(...prices) : 0;
    const priciest = prices.length ? Math.max(...prices) : 0;

    return newest.map(({ record, runtimeId, created, input, output }): Model => {
      const combinedPrice = input + output;
      const familyTier: Model["family_tier"] = combinedPrice === priciest && priciest !== cheapest
        ? "top"
        : combinedPrice === cheapest && priciest !== cheapest
          ? "cheapest"
          : "mid";
      const qualityTier: Model["quality_tier"] = familyTier === "top" ? "strong" : familyTier === "cheapest" ? "cheap" : "balanced";
      return {
        id: `openrouter:${runtimeId}`,
        provider: runtimeId.split("/")[0],
        family,
        family_tier: familyTier,
        display_name: displayName(record, runtimeId),
        input_cost_per_1m: input,
        output_cost_per_1m: output,
        default_latency_ms: familyTier === "top" ? 1_300 : familyTier === "cheapest" ? 550 : 850,
        deployment_type: family === "Mistral" || family === "DeepSeek" || family === "GLM" || family === "MiniMax" || family === "NVIDIA" ? "managed_open" : "closed_managed",
        quality_tier: qualityTier,
        pricing_source: "OpenRouter",
        pricing_source_model_id: runtimeId,
        pricing_updated_at: new Date().toISOString().slice(0, 10),
        openrouter_created_at: new Date(created * 1_000).toISOString(),
      };
    });
  });
}
