import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { getModel } from "./src/core/catalog";

const readJsonBody = async (req: any) => new Promise<any>((resolve, reject) => {
  let body = "";
  req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  req.on("end", () => {
    try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
  });
  req.on("error", reject);
});

const sendJson = (res: any, status: number, payload: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
};

let loadedEnv: Record<string, string> = {};
const serverOpenRouterKey = () => String(process.env.ROUTELAB_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? loadedEnv.ROUTELAB_OPENROUTER_API_KEY ?? loadedEnv.OPENROUTER_API_KEY ?? "").trim();

const providerConfig = (source: string, modelId: string) => {
  const model = getModel(modelId);
  if (!model) throw new Error("Unknown candidate model.");
  if (source === "openrouter") {
    return { url: "https://openrouter.ai/api/v1/chat/completions", modelName: model.pricing_source_model_id ?? model.id, label: "OpenRouter" };
  }
  if (model.family === "OpenAI") return { url: "https://api.openai.com/v1/chat/completions", modelName: model.id, label: "OpenAI" };
  if (model.family === "Mistral") return { url: "https://api.mistral.ai/v1/chat/completions", modelName: model.pricing_source_model_id ?? model.id, label: "Mistral" };
  if (model.family === "DeepSeek") return { url: "https://api.deepseek.com/chat/completions", modelName: model.id, label: "DeepSeek" };
  throw new Error(`${model.family} direct API keys are not wired yet. Configure OpenRouter to run this model live through the gateway.`);
};

const toMessages = (trace: any) => Array.isArray(trace.messages) && trace.messages.length
  ? trace.messages.map((message: any) => ({ role: message.role === "assistant" || message.role === "system" ? message.role : "user", content: String(message.content ?? "") }))
  : [{ role: "user", content: String(trace.prompt_text ?? "") }];

export default defineConfig(({ mode }) => {
  loadedEnv = loadEnv(mode, process.cwd(), "");
  return {
  plugins: [react(), {
    name: "routelab-live-direct-routing",
    configureServer(server) {
      server.middlewares.use("/api/live/key-status", async (req, res) => {
        if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
        return sendJson(res, 200, { gateways: { OpenRouter: Boolean(serverOpenRouterKey()) } });
      });
      server.middlewares.use("/api/live/direct-routing", async (req, res) => {
        if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
        try {
          const body = await readJsonBody(req);
          const source = String(body.source ?? "");
          const apiKey = String(body.apiKey ?? "").trim() || (source === "openrouter" ? serverOpenRouterKey() : "");
          const traces = Array.isArray(body.traces) ? body.traces : [];
          if (!apiKey) return sendJson(res, 400, { error: source === "openrouter" ? "Missing OpenRouter API key. Add one in Model Catalog or start the server with OPENROUTER_API_KEY." : "Missing API key." });
          if (!traces.length) return sendJson(res, 400, { error: "No traces selected for live direct routing." });
          const config = providerConfig(source, String(body.modelId ?? ""));
          const controller = new AbortController();
          req.on("aborted", () => controller.abort());
          req.on("close", () => controller.abort());
          const runs = [];
          for (const trace of traces) {
            if (controller.signal.aborted) break;
            const started = Date.now();
            try {
              const response = await fetch(config.url, {
                method: "POST",
                signal: controller.signal,
                headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-OpenRouter-Metadata": "enabled" },
                body: JSON.stringify({ model: config.modelName, messages: toMessages(trace), temperature: 0, max_tokens: Math.max(16, Math.min(1200, Number(trace.output_tokens ?? 256) * 2 || 256)) }),
              });
              const payload = await response.json().catch(()=>({ error: { message: "Provider returned a non-JSON response." } })) as any;
              if (!response.ok) throw new Error(String(payload.error?.message ?? payload.message ?? `Provider HTTP ${response.status}`));
              runs.push({ trace_id: trace.id, response_text: String(payload.choices?.[0]?.message?.content ?? ""), output_tokens: Number(payload.usage?.completion_tokens ?? 0) || undefined, latency_ms: Date.now() - started, status: "success" });
            } catch (error) {
              runs.push({ trace_id: trace.id, response_text: "", latency_ms: Date.now() - started, status: "error", error: error instanceof Error ? error.message : "Live provider request failed." });
            }
          }
          if (controller.signal.aborted) return;
          return sendJson(res, 200, { runs, source: source === "openrouter" ? "openrouter" : "direct_family", label: config.label });
        } catch (error) {
          return sendJson(res, 500, { error: error instanceof Error ? error.message : "Live direct routing failed." });
        }
      });
    },
  }],
  test: { environment: "node" },
  };
});
