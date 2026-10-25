import { describe, expect, it } from "vitest";
import { providerConfig } from "../api/live/_shared";
import { getModel, registerOpenRouterModels } from "../src/core/catalog";
import { liveRoutingStatus } from "../src/core/liveRouting";
import { latestOpenRouterModels, openRouterFamilyLabels } from "../src/core/openRouterModels";

const record = (id: string, created: number, options: { outputs?: string[]; prompt?: string; completion?: string; parameters?: string[] } = {}) => ({
  id,
  name: `${id.split("/")[0]}: ${id.split("/")[1]}`,
  created,
  pricing: { prompt: options.prompt ?? "0.000001", completion: options.completion ?? "0.000002" },
  architecture: { output_modalities: options.outputs ?? ["text"] },
  supported_parameters: options.parameters ?? ["max_tokens"],
});

describe("OpenRouter model catalog", () => {
  it("keeps the newest four compatible models per supported family", () => {
    const records = [
      ...Array.from({ length: 6 }, (_, index) => record(`openai/gpt-${index}`, index)),
      ...Array.from({ length: 5 }, (_, index) => record(`anthropic/claude-${index}`, index + 10)),
      record("google/gemini-image", 99, { outputs: ["text", "image"] }),
      record("google/gemini-batch:batch", 98),
      record("other/model", 100),
    ];

    const models = latestOpenRouterModels(records);

    expect(models.filter(model => model.family === "OpenAI").map(model => model.pricing_source_model_id)).toEqual([
      "openai/gpt-5", "openai/gpt-4", "openai/gpt-3", "openai/gpt-2",
    ]);
    expect(models.filter(model => model.family === "Claude")).toHaveLength(4);
    expect(models.some(model => model.family === "Gemini")).toBe(false);
  });

  it("converts OpenRouter per-token prices to per-million prices", () => {
    const [model] = latestOpenRouterModels([record("mistralai/mistral-new", 20, { prompt: "0.0000005", completion: "0.0000015" })]);

    expect(model).toMatchObject({
      id: "openrouter:mistralai/mistral-new",
      family: "Mistral",
      input_cost_per_1m: .5,
      output_cost_per_1m: 1.5,
      pricing_source_model_id: "mistralai/mistral-new",
    });
  });

  it("keeps the newest three general models for GLM, MiniMax, and NVIDIA", () => {
    const records = [
      ...Array.from({ length: 5 }, (_, index) => record(`z-ai/glm-${index}`, index + 10)),
      ...Array.from({ length: 5 }, (_, index) => record(`minimax/minimax-${index}`, index + 20)),
      ...Array.from({ length: 5 }, (_, index) => record(`nvidia/nemotron-${index}`, index + 30)),
      record("nvidia/switchyard", 100),
      record("nvidia/nemotron-content-safety", 99),
      record("nvidia/nemotron-latest:free", 98),
    ];

    const models = latestOpenRouterModels(records);

    expect(models.filter(model => model.family === "GLM").map(model => model.pricing_source_model_id)).toEqual([
      "z-ai/glm-4", "z-ai/glm-3", "z-ai/glm-2",
    ]);
    expect(models.filter(model => model.family === "MiniMax").map(model => model.pricing_source_model_id)).toEqual([
      "minimax/minimax-4", "minimax/minimax-3", "minimax/minimax-2",
    ]);
    expect(models.filter(model => model.family === "NVIDIA").map(model => model.pricing_source_model_id)).toEqual([
      "nvidia/nemotron-4", "nvidia/nemotron-3", "nvidia/nemotron-2",
    ]);
    expect(openRouterFamilyLabels).toMatchObject({ GLM: "GLM", MiniMax: "MiniMax", NVIDIA: "NVIDIA" });
  });

  it("registers live candidates for simulation and keeps them on OpenRouter", () => {
    const [model] = latestOpenRouterModels([record("deepseek/deepseek-new", 20)]);
    registerOpenRouterModels([model]);

    expect(getModel(model.id)).toMatchObject({ pricing_source_model_id: "deepseek/deepseek-new" });
    expect(liveRoutingStatus(model.id, {
      familyApiKeys: { DeepSeek: "sk-family" },
      gatewayApiKeys: { OpenRouter: "sk-openrouter" },
    })).toMatchObject({ source: "openrouter", label: "OpenRouter" });
    expect(providerConfig("openrouter", model.id, model.pricing_source_model_id).modelName).toBe("deepseek/deepseek-new");
    expect(() => providerConfig("openrouter", model.id, "unsupported/model")).toThrow("Unsupported OpenRouter candidate model");

    registerOpenRouterModels([]);
  });
});
