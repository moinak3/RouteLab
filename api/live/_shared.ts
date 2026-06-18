import { getModel } from "../../src/core/catalog";

export type LiveTracePayload = {
  id?: unknown;
  messages?: Array<{ role?: unknown; content?: unknown }>;
  prompt_text?: unknown;
  output_tokens?: unknown;
};

export const sendJson = (res: any, status: number, payload: unknown) => {
  res.status(status).setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(payload));
};

export const serverOpenRouterKey = () =>
  String(process.env.ROUTELAB_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "").trim();

export const providerConfig = (source: string, modelId: string) => {
  const model = getModel(modelId);
  if (!model) throw new Error("Unknown candidate model.");
  if (source === "openrouter") {
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      modelName: model.pricing_source_model_id ?? model.id,
      label: "OpenRouter",
    };
  }
  if (model.family === "OpenAI") {
    return { url: "https://api.openai.com/v1/chat/completions", modelName: model.id, label: "OpenAI" };
  }
  if (model.family === "Mistral") {
    return {
      url: "https://api.mistral.ai/v1/chat/completions",
      modelName: model.pricing_source_model_id ?? model.id,
      label: "Mistral",
    };
  }
  if (model.family === "DeepSeek") {
    return { url: "https://api.deepseek.com/chat/completions", modelName: model.id, label: "DeepSeek" };
  }
  throw new Error(`${model.family} direct API keys are not wired yet. Configure OpenRouter to run this model live through the gateway.`);
};

export const toMessages = (trace: LiveTracePayload) =>
  Array.isArray(trace.messages) && trace.messages.length
    ? trace.messages.map((message) => ({
        role: message.role === "assistant" || message.role === "system" ? message.role : "user",
        content: String(message.content ?? ""),
      }))
    : [{ role: "user", content: String(trace.prompt_text ?? "") }];
