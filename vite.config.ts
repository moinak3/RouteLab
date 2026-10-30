import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getModel } from "./src/core/catalog";
import { latestOpenRouterModels } from "./src/core/openRouterModels";
import { runFrontierProvider } from "./api/frontier-lab/_runner";
import { runJevSignatureGate } from "./api/jev/_runner";
import { getRoutingPolicyDraft, PolicyStoreConflictError, PolicyStoreUnavailableError, saveRoutingPolicyDraft } from "./api/routing-policy/_store";
import { isDraftRoutingPolicy } from "./src/core/routingDraft";
import publishRoutingPolicy from "./api/routing-policy/publish";
import activateRoutingPolicy from "./api/routing-policy/activate";
import routingPolicyBundle from "./api/routing-policy/bundle";
import routingPolicyVersions from "./api/routing-policy/versions";
import { routingPolicyWorkspaceId } from "./api/routing-policy/_config";
import { handleLLMGroupingLatest, handleLLMGroupingRun } from "./api/llm-grouping/_api";
import taskGroupNamesHandler from "./src/server/taskGroupNames";
import waitlistHandler from "./src/server/waitlist";
import evalRunHandler from "./src/server/evalRuns";

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

const runApiHandler = async (handler: (req: any, res: any) => unknown, req: any, res: any) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  req.query = Object.fromEntries(url.searchParams.entries());
  if (["POST", "PUT", "PATCH"].includes(String(req.method))) req.body = await readJsonBody(req);
  res.status = (status: number) => { res.statusCode = status; return res; };
  res.send = (payload: unknown) => { res.end(payload); return res; };
  res.json = (payload: unknown) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
    return res;
  };
  return handler(req, res);
};

let loadedEnv: Record<string, string> = {};
const serverOpenRouterKey = () => String(process.env.ROUTELAB_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? loadedEnv.ROUTELAB_OPENROUTER_API_KEY ?? loadedEnv.OPENROUTER_API_KEY ?? "").trim();

const dynamicOpenRouterModel = /^(openai|anthropic|google|mistralai|deepseek)\/[a-z0-9][a-z0-9._:-]*$/i;

const providerConfig = (source: string, modelId: string, openRouterModelId?: string) => {
  if (source === "openrouter") {
    const runtimeModelId = String(openRouterModelId ?? "").trim();
    if (runtimeModelId && !dynamicOpenRouterModel.test(runtimeModelId)) throw new Error("Unsupported OpenRouter candidate model.");
    const model = getModel(modelId);
    if (!runtimeModelId && !model) throw new Error("Unknown candidate model.");
    return { url: "https://openrouter.ai/api/v1/chat/completions", modelName: runtimeModelId || model!.pricing_source_model_id || model!.id, label: "OpenRouter" };
  }
  const model = getModel(modelId);
  if (!model) throw new Error("Unknown candidate model.");
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
  ["DATABASE_URL", "ROUTELAB_POLICY_WORKSPACE_ID", "ROUTELAB_POLICY_SIGNING_PRIVATE_KEY", "ROUTELAB_POLICY_SIGNING_PUBLIC_KEY", "ROUTELAB_POLICY_SIGNING_KEY_ID", "ROUTELAB_JEV_MODEL", "ROUTELAB_LLM_GROUPING_MODEL", "ROUTELAB_TASK_GROUP_NAMING_MODEL", "ROUTELAB_OPENROUTER_API_KEY", "OPENROUTER_API_KEY", "ROUTELAB_WAITLIST_SHEETS_WEBHOOK_URL", "ROUTELAB_WAITLIST_SHEETS_WEBHOOK_SECRET"]
    .forEach((key) => { if (!process.env[key] && loadedEnv[key]) process.env[key] = loadedEnv[key]; });
  return {
  plugins: [react(), {
    name: "routelab-support-console-assets",
    generateBundle() {
      for (const fileName of ["index.html", "styles.css", "app.js", "http.js"]) {
        this.emitFile({
          type: "asset",
          fileName: `support-console/${fileName}`,
          source: readFileSync(resolve(process.cwd(), "support-demo/public", fileName)),
        });
      }
    },
  }, {
    name: "routelab-live-direct-routing",
    configureServer(server) {
      server.middlewares.use("/api/openrouter/models", async (req, res) => {
        if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
        try {
          const apiKey = serverOpenRouterKey();
          const response = await fetch("https://openrouter.ai/api/v1/models?sort=newest&output_modalities=text", {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
          });
          const payload = await response.json().catch(() => ({})) as { data?: unknown; error?: { message?: unknown } };
          if (!response.ok) throw new Error(String(payload.error?.message ?? `OpenRouter HTTP ${response.status}`));
          const models = latestOpenRouterModels(Array.isArray(payload.data) ? payload.data : [], 4);
          if (!models.length) throw new Error("OpenRouter returned no compatible text-generation models.");
          res.setHeader("Cache-Control", "public, max-age=900");
          return sendJson(res, 200, { models, updatedAt: new Date().toISOString() });
        } catch (error) {
          return sendJson(res, 502, { error: error instanceof Error ? error.message : "OpenRouter model catalog failed." });
        }
      });
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
          const config = providerConfig(source, String(body.modelId ?? ""), String(body.openRouterModelId ?? ""));
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
      server.middlewares.use("/api/frontier-lab/run", async (req, res) => {
        if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
        try {
          const body = await readJsonBody(req);
          const apiKey = serverOpenRouterKey();
          const result = await runFrontierProvider({
            caseId: String(body.caseId ?? ""),
            harnessId: body.harnessId === "baseline" ? "baseline" : "improved",
            repetition: Math.max(1, Number(body.repetition ?? 1)),
            model: body.model,
            apiKey,
            assetBaseUrl: String(body.assetBaseUrl ?? "").trim() || `http://${req.headers.host ?? "127.0.0.1:5173"}`,
          });
          return sendJson(res, 200, result);
        } catch (error) {
          return sendJson(res, 500, { error: error instanceof Error ? error.message : "Frontier Model Lab run failed." });
        }
      });
      server.middlewares.use("/api/jev/signature-gate", async (req, res) => {
        if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
        try {
          const body = await readJsonBody(req);
          const traces = Array.isArray(body.traces) ? body.traces : [];
          const signatures = Array.isArray(body.signatures) ? body.signatures : [];
          if (!traces.length) return sendJson(res, 400, { error: "No incoming traces were provided to the Jev gate." });
          if (!signatures.length) return sendJson(res, 400, { error: "No known task signatures were provided to the Jev gate." });
          return sendJson(res, 200, await runJevSignatureGate({
            traces,
            signatures,
            apiKey: serverOpenRouterKey(),
            baseThreshold: Number(body.baseThreshold ?? .8),
          }));
        } catch (error) {
          return sendJson(res, 500, { error: error instanceof Error ? error.message : "Jev signature gate failed." });
        }
      });
      server.middlewares.use("/api/routing-policy/draft", async (req, res) => {
        const databaseUrl = String(process.env.DATABASE_URL ?? loadedEnv.DATABASE_URL ?? "").trim();
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
        const workspaceId = routingPolicyWorkspaceId({ query: Object.fromEntries(url.searchParams.entries()) });
        try {
          if (req.method === "GET") return sendJson(res, 200, await getRoutingPolicyDraft(databaseUrl, workspaceId));
          if (req.method !== "PUT") return sendJson(res, 405, { error: "Method not allowed." });
          const body = await readJsonBody(req);
          const expectedRevision = Number(body.expectedRevision);
          if (!isDraftRoutingPolicy(body.draft) || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
            return sendJson(res, 400, { error: "A valid routing policy draft and expected revision are required." });
          }
          return sendJson(res, 200, await saveRoutingPolicyDraft(databaseUrl, workspaceId, body.draft, expectedRevision));
        } catch (error) {
          if (error instanceof PolicyStoreUnavailableError) return sendJson(res, 503, { error: error.message });
          if (error instanceof PolicyStoreConflictError) return sendJson(res, 409, error.current);
          return sendJson(res, 500, { error: error instanceof Error ? error.message : "Routing policy storage failed." });
        }
      });
      server.middlewares.use("/api/routing-policy/publish", (req, res) => runApiHandler(publishRoutingPolicy, req, res));
      server.middlewares.use("/api/routing-policy/activate", (req, res) => runApiHandler(activateRoutingPolicy, req, res));
      server.middlewares.use("/api/routing-policy/bundle", (req, res) => runApiHandler(routingPolicyBundle, req, res));
      server.middlewares.use("/api/routing-policy/versions", (req, res) => runApiHandler(routingPolicyVersions, req, res));
      server.middlewares.use("/api/llm-grouping/latest", (req, res) => runApiHandler(handleLLMGroupingLatest, req, res));
      server.middlewares.use("/api/llm-grouping/run", (req, res) => runApiHandler(handleLLMGroupingRun, req, res));
      server.middlewares.use("/api/task-group-names", (req, res) => runApiHandler(taskGroupNamesHandler, req, res));
      server.middlewares.use("/api/waitlist", (req, res) => runApiHandler(waitlistHandler, req, res));
      server.middlewares.use("/api/evals/run", (req, res) => runApiHandler(evalRunHandler, req, res));
    },
  }],
  test: { environment: "node" },
  };
});
