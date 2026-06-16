import type { Model } from "../types";

export const modelCatalog: Model[] = [
  { id: "gpt-5.5-pro", provider: "openai", family: "OpenAI", family_tier: "top", display_name: "GPT-5.5 Pro", input_cost_per_1m: 30, output_cost_per_1m: 180, default_latency_ms: 1800, deployment_type: "closed_managed", quality_tier: "strong", pricing_source: "OpenRouter", pricing_source_model_id: "openai/gpt-5.5-pro", pricing_updated_at: "2026-06-09" },
  { id: "gpt-5.4", provider: "openai", family: "OpenAI", family_tier: "mid", display_name: "GPT-5.4", input_cost_per_1m: 2.5, output_cost_per_1m: 15, default_latency_ms: 1250, deployment_type: "closed_managed", quality_tier: "strong", pricing_source: "OpenRouter", pricing_source_model_id: "openai/gpt-5.4", pricing_updated_at: "2026-06-09" },
  { id: "gpt-5.4-mini", provider: "openai", family: "OpenAI", family_tier: "cheapest", display_name: "GPT-5.4 Mini", input_cost_per_1m: .75, output_cost_per_1m: 4.5, default_latency_ms: 720, deployment_type: "closed_managed", quality_tier: "balanced", pricing_source: "OpenRouter", pricing_source_model_id: "openai/gpt-5.4-mini", pricing_updated_at: "2026-06-09" },
  { id: "claude-opus-4.8", provider: "anthropic", family: "Claude", family_tier: "top", display_name: "Claude Opus 4.8", input_cost_per_1m: 5, output_cost_per_1m: 25, default_latency_ms: 1450, deployment_type: "closed_managed", quality_tier: "strong", pricing_source: "OpenRouter", pricing_source_model_id: "anthropic/claude-opus-4.8", pricing_updated_at: "2026-06-09" },
  { id: "claude-sonnet-4.8", provider: "anthropic", family: "Claude", family_tier: "mid", display_name: "Claude Sonnet 4.8", input_cost_per_1m: 3, output_cost_per_1m: 15, default_latency_ms: 980, deployment_type: "closed_managed", quality_tier: "strong", pricing_source: "OpenRouter", pricing_source_model_id: "anthropic/claude-sonnet-4.6", pricing_updated_at: "2026-06-09" },
  { id: "claude-haiku-4.5", provider: "anthropic", family: "Claude", family_tier: "cheapest", display_name: "Claude Haiku 4.5", input_cost_per_1m: 1, output_cost_per_1m: 5, default_latency_ms: 520, deployment_type: "closed_managed", quality_tier: "balanced", pricing_source: "OpenRouter", pricing_source_model_id: "anthropic/claude-haiku-4.5", pricing_updated_at: "2026-06-09" },
  { id: "gemini-3-pro", provider: "google", family: "Gemini", family_tier: "top", display_name: "Gemini 3 Pro", input_cost_per_1m: 2, output_cost_per_1m: 12, default_latency_ms: 1100, deployment_type: "closed_managed", quality_tier: "strong", pricing_source: "OpenRouter", pricing_source_model_id: "google/gemini-3.1-pro-preview", pricing_updated_at: "2026-06-09" },
  { id: "gemini-3-flash", provider: "google", family: "Gemini", family_tier: "mid", display_name: "Gemini 3 Flash", input_cost_per_1m: .5, output_cost_per_1m: 3, default_latency_ms: 560, deployment_type: "closed_managed", quality_tier: "balanced", pricing_source: "OpenRouter", pricing_source_model_id: "google/gemini-3-flash-preview", pricing_updated_at: "2026-06-09" },
  { id: "gemini-2.5-flash-lite", provider: "google", family: "Gemini", family_tier: "cheapest", display_name: "Gemini 2.5 Flash-Lite", input_cost_per_1m: .1, output_cost_per_1m: .4, default_latency_ms: 390, deployment_type: "closed_managed", quality_tier: "cheap", pricing_source: "OpenRouter", pricing_source_model_id: "google/gemini-2.5-flash-lite", pricing_updated_at: "2026-06-09" },
  { id: "mistral-large-3", provider: "mistral", family: "Mistral", family_tier: "top", display_name: "Mistral Large 3", input_cost_per_1m: .5, output_cost_per_1m: 1.5, default_latency_ms: 1050, deployment_type: "closed_managed", quality_tier: "strong", pricing_source: "OpenRouter", pricing_source_model_id: "mistralai/mistral-large-2512", pricing_updated_at: "2026-06-09" },
  { id: "mistral-medium-3.1", provider: "mistral", family: "Mistral", family_tier: "mid", display_name: "Mistral Medium 3.1", input_cost_per_1m: .4, output_cost_per_1m: 2, default_latency_ms: 690, deployment_type: "closed_managed", quality_tier: "balanced", pricing_source: "OpenRouter", pricing_source_model_id: "mistralai/mistral-medium-3.1", pricing_updated_at: "2026-06-09" },
  { id: "mistral-small-3.2", provider: "mistral", family: "Mistral", family_tier: "cheapest", display_name: "Mistral Small 3.2", input_cost_per_1m: .075, output_cost_per_1m: .2, default_latency_ms: 430, deployment_type: "closed_managed", quality_tier: "cheap", pricing_source: "OpenRouter", pricing_source_model_id: "mistralai/mistral-small-3.2-24b-instruct", pricing_updated_at: "2026-06-09" },
  { id: "deepseek-v4-pro", provider: "deepseek", family: "DeepSeek", family_tier: "top", display_name: "DeepSeek V4 Pro", input_cost_per_1m: .435, output_cost_per_1m: .87, default_latency_ms: 900, deployment_type: "managed_open", quality_tier: "balanced", pricing_source: "OpenRouter", pricing_source_model_id: "deepseek/deepseek-v4-pro", pricing_updated_at: "2026-06-09" },
  { id: "deepseek-r1", provider: "deepseek", family: "DeepSeek", family_tier: "mid", display_name: "DeepSeek R1", input_cost_per_1m: .7, output_cost_per_1m: 2.5, default_latency_ms: 680, deployment_type: "managed_open", quality_tier: "balanced", pricing_source: "OpenRouter", pricing_source_model_id: "deepseek/deepseek-r1", pricing_updated_at: "2026-06-09" },
  { id: "local-qwen-14b", provider: "local", family: "Local", family_tier: "cheapest", display_name: "Local Qwen 14B", input_cost_per_1m: 0, output_cost_per_1m: 0, default_latency_ms: 420, deployment_type: "local", quality_tier: "cheap", pricing_source: "User configured" },
];

export const getModel = (id: string, catalog = modelCatalog) => catalog.find((model) => model.id === id);
export const isModelEnabled = (model: Model) => model.enabled !== false;
export const enabledModels = (catalog = modelCatalog) => catalog.filter(isModelEnabled);
export function updateModelPricing(id: string, inputCost: number, outputCost: number) {
  const model = getModel(id);
  if (!model) return;
  model.input_cost_per_1m = Math.max(0, inputCost);
  model.output_cost_per_1m = Math.max(0, outputCost);
  model.pricing_source = "User configured";
  model.pricing_updated_at = new Date().toISOString().slice(0, 10);
}
export function updateModelEnabled(id: string, enabled: boolean) {
  const model = getModel(id);
  if (!model) return;
  model.enabled = enabled;
}
export function updateFamilyEnabled(family: Model["family"], enabled: boolean) {
  modelCatalog.filter((model) => model.family === family).forEach((model) => { model.enabled = enabled; });
}
export const modelFamilies = Array.from(new Set(modelCatalog.map((model) => model.family)));
export const recommendationCandidates = modelCatalog;
export const calculateCost = (input: number, output: number, model: Model) =>
  input * model.input_cost_per_1m / 1_000_000 + output * model.output_cost_per_1m / 1_000_000;
