import { providerConfig, sendJson, serverOpenRouterKey, toMessages, type LiveTracePayload } from "./_shared";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const body = req.body ?? {};
    const source = String(body.source ?? "");
    const apiKey = String(body.apiKey ?? "").trim() || (source === "openrouter" ? serverOpenRouterKey() : "");
    const traces = Array.isArray(body.traces) ? (body.traces as LiveTracePayload[]) : [];

    if (!apiKey) {
      return sendJson(res, 400, {
        error: source === "openrouter"
          ? "Missing OpenRouter API key. Add one in Model Catalog or start the server with OPENROUTER_API_KEY."
          : "Missing API key.",
      });
    }
    if (!traces.length) {
      return sendJson(res, 400, { error: "No traces selected for live direct routing." });
    }

    const config = providerConfig(source, String(body.modelId ?? ""));
    const runs = [];

    for (const trace of traces) {
      const started = Date.now();
      try {
        const response = await fetch(config.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-OpenRouter-Metadata": "enabled",
          },
          body: JSON.stringify({
            model: config.modelName,
            messages: toMessages(trace),
            temperature: 0,
            max_tokens: Math.max(16, Math.min(1200, Number(trace.output_tokens ?? 256) * 2 || 256)),
          }),
        });
        const payload = await response.json().catch(() => ({ error: { message: "Provider returned a non-JSON response." } })) as any;
        if (!response.ok) {
          throw new Error(String(payload.error?.message ?? payload.message ?? `Provider HTTP ${response.status}`));
        }
        runs.push({
          trace_id: String(trace.id ?? ""),
          response_text: String(payload.choices?.[0]?.message?.content ?? ""),
          output_tokens: Number(payload.usage?.completion_tokens ?? 0) || undefined,
          latency_ms: Date.now() - started,
          status: "success",
        });
      } catch (error) {
        runs.push({
          trace_id: String(trace.id ?? ""),
          response_text: "",
          latency_ms: Date.now() - started,
          status: "error",
          error: error instanceof Error ? error.message : "Live provider request failed.",
        });
      }
    }

    return sendJson(res, 200, { runs, source: source === "openrouter" ? "openrouter" : "direct_family", label: config.label });
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Live direct routing failed." });
  }
}
