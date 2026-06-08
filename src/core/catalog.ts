import type { Model } from "../types";

export const modelCatalog: Model[] = [
  { id: "gpt-5.5-pro", provider: "openai", family: "OpenAI", family_tier: "top", display_name: "GPT-5.5 Pro", input_cost_per_1m: 15, output_cost_per_1m: 90, default_latency_ms: 1800, deployment_type: "closed_managed", quality_tier: "strong" },
  { id: "gpt-5.4", provider: "openai", family: "OpenAI", family_tier: "mid", display_name: "GPT-5.4", input_cost_per_1m: 2.5, output_cost_per_1m: 15, default_latency_ms: 1250, deployment_type: "closed_managed", quality_tier: "strong" },
  { id: "gpt-5.4-mini", provider: "openai", family: "OpenAI", family_tier: "cheapest", display_name: "GPT-5.4 Mini", input_cost_per_1m: .75, output_cost_per_1m: 4.5, default_latency_ms: 720, deployment_type: "closed_managed", quality_tier: "balanced" },
  { id: "claude-opus-4.8", provider: "anthropic", family: "Claude", family_tier: "top", display_name: "Claude Opus 4.8", input_cost_per_1m: 5, output_cost_per_1m: 25, default_latency_ms: 1450, deployment_type: "closed_managed", quality_tier: "strong" },
  { id: "claude-sonnet-4.8", provider: "anthropic", family: "Claude", family_tier: "mid", display_name: "Claude Sonnet 4.8", input_cost_per_1m: 3, output_cost_per_1m: 15, default_latency_ms: 980, deployment_type: "closed_managed", quality_tier: "strong" },
  { id: "claude-haiku-4.5", provider: "anthropic", family: "Claude", family_tier: "cheapest", display_name: "Claude Haiku 4.5", input_cost_per_1m: 1, output_cost_per_1m: 5, default_latency_ms: 520, deployment_type: "closed_managed", quality_tier: "balanced" },
  { id: "gemini-3-pro", provider: "google", family: "Gemini", family_tier: "top", display_name: "Gemini 3 Pro", input_cost_per_1m: 2, output_cost_per_1m: 12, default_latency_ms: 1100, deployment_type: "closed_managed", quality_tier: "strong" },
  { id: "gemini-3-flash", provider: "google", family: "Gemini", family_tier: "mid", display_name: "Gemini 3 Flash", input_cost_per_1m: .5, output_cost_per_1m: 3, default_latency_ms: 560, deployment_type: "closed_managed", quality_tier: "balanced" },
  { id: "gemini-2.5-flash-lite", provider: "google", family: "Gemini", family_tier: "cheapest", display_name: "Gemini 2.5 Flash-Lite", input_cost_per_1m: .1, output_cost_per_1m: .4, default_latency_ms: 390, deployment_type: "closed_managed", quality_tier: "cheap" },
  { id: "mistral-large-3", provider: "mistral", family: "Mistral", family_tier: "top", display_name: "Mistral Large 3", input_cost_per_1m: 2, output_cost_per_1m: 6, default_latency_ms: 1050, deployment_type: "closed_managed", quality_tier: "strong" },
  { id: "mistral-medium-3.1", provider: "mistral", family: "Mistral", family_tier: "mid", display_name: "Mistral Medium 3.1", input_cost_per_1m: .4, output_cost_per_1m: 2, default_latency_ms: 690, deployment_type: "closed_managed", quality_tier: "balanced" },
  { id: "mistral-small-3.2", provider: "mistral", family: "Mistral", family_tier: "cheapest", display_name: "Mistral Small 3.2", input_cost_per_1m: .1, output_cost_per_1m: .3, default_latency_ms: 430, deployment_type: "closed_managed", quality_tier: "cheap" },
  { id: "deepseek-v4-pro", provider: "deepseek", family: "DeepSeek", family_tier: "top", display_name: "DeepSeek V4 Pro", input_cost_per_1m: .72, output_cost_per_1m: 4.5, default_latency_ms: 900, deployment_type: "managed_open", quality_tier: "balanced" },
  { id: "deepseek-r1", provider: "deepseek", family: "DeepSeek", family_tier: "mid", display_name: "DeepSeek R1", input_cost_per_1m: .14, output_cost_per_1m: 2.6, default_latency_ms: 680, deployment_type: "managed_open", quality_tier: "balanced" },
  { id: "local-qwen-14b", provider: "local", family: "Local", family_tier: "cheapest", display_name: "Local Qwen 14B", input_cost_per_1m: 0, output_cost_per_1m: 0, default_latency_ms: 420, deployment_type: "local", quality_tier: "cheap" },
];

export const getModel = (id: string, catalog = modelCatalog) => catalog.find((model) => model.id === id);
export function updateModelPricing(id: string, inputCost: number, outputCost: number) {
  const model = getModel(id);
  if (!model) return;
  model.input_cost_per_1m = Math.max(0, inputCost);
  model.output_cost_per_1m = Math.max(0, outputCost);
}
export const modelFamilies = Array.from(new Set(modelCatalog.map((model) => model.family)));
export const recommendationCandidates = modelCatalog;
export const calculateCost = (input: number, output: number, model: Model) =>
  input * model.input_cost_per_1m / 1_000_000 + output * model.output_cost_per_1m / 1_000_000;
