import { latestOpenRouterModels } from "../../src/core/openRouterModels.js";
import { sendJson, serverOpenRouterKey } from "../live/_shared.js";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models?sort=newest&output_modalities=text";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });

  try {
    const apiKey = serverOpenRouterKey();
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    const payload = await response.json().catch(() => ({})) as { data?: unknown; error?: { message?: unknown } };
    if (!response.ok) throw new Error(String(payload.error?.message ?? `OpenRouter HTTP ${response.status}`));
    const records = Array.isArray(payload.data) ? payload.data : [];
    const models = latestOpenRouterModels(records, 4);
    if (!models.length) throw new Error("OpenRouter returned no compatible text-generation models.");
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
    return sendJson(res, 200, { models, updatedAt: new Date().toISOString() });
  } catch (error) {
    return sendJson(res, 502, { error: error instanceof Error ? error.message : "OpenRouter model catalog failed." });
  }
}
