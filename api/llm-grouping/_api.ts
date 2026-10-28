import { createLLMGroupingInputSnapshot, validateLLMGroupingTraceInputs, type LLMGroupingRun } from "../../src/core/llmGrouping.js";
import { serverOpenRouterKey, sendJson } from "../live/_shared.js";
import { LLMGroupingConfigurationError, LLMGroupingProviderError, runLLMGrouping } from "./_runner.js";
import { getLatestLLMGroupingRun, LLMGroupingStoreUnavailableError, saveLLMGroupingRun } from "./_store.js";

const databaseUrl = () => String(process.env.DATABASE_URL ?? "").trim();
const workspaceId = (req: any) => {
  const requested = String(req?.query?.workspace ?? "").trim();
  if (/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(requested)) return requested;
  return String(process.env.ROUTELAB_POLICY_WORKSPACE_ID ?? "demo").trim() || "demo";
};
const groupingModel = () => String(process.env.ROUTELAB_LLM_GROUPING_MODEL ?? "google/gemini-2.5-flash").trim();
const emit = (res: any, payload: unknown) => res.write(`${JSON.stringify(payload)}\n`);

export async function handleLLMGroupingLatest(req: any, res: any) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
  try {
    return sendJson(res, 200, { run: await getLatestLLMGroupingRun(databaseUrl(), workspaceId(req)) });
  } catch (error) {
    if (error instanceof LLMGroupingStoreUnavailableError) return sendJson(res, 503, { error: error.message });
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Could not load the latest LLM grouping run." });
  }
}

export async function handleLLMGroupingRun(req: any, res: any) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  const apiKey = serverOpenRouterKey();
  if (!apiKey) return sendJson(res, 503, { error: "OpenRouter is not configured for LLM grouping." });
  const inputs = req.body?.inputs;
  const snapshot = req.body?.snapshot as LLMGroupingRun["snapshot"];
  const inputErrors = validateLLMGroupingTraceInputs(inputs);
  if (inputErrors.length || !snapshot || !Array.isArray(snapshot.traceIds) || typeof snapshot.hash !== "string") {
    return sendJson(res, 400, { error: "A valid sanitized trace snapshot is required.", details: inputErrors });
  }
  const verifiedSnapshot = createLLMGroupingInputSnapshot(inputs);
  if (snapshot.hash !== verifiedSnapshot.hash || snapshot.totalTraces !== verifiedSnapshot.totalTraces || JSON.stringify(snapshot.traceIds) !== JSON.stringify(verifiedSnapshot.traceIds)) {
    return sendJson(res, 400, { error: "The trace snapshot does not match the sanitized inputs." });
  }

  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  const controller = new AbortController();
  req.on?.("aborted", () => controller.abort());
  res.on?.("close", () => { if (!res.writableEnded) controller.abort(); });
  try {
    const run = await runLLMGrouping({
      inputs,
      snapshot: verifiedSnapshot,
      apiKey,
      model: groupingModel(),
      signal: controller.signal,
      onProgress: (progress) => emit(res, { type: "progress", ...progress }),
    });
    const saved = await saveLLMGroupingRun(databaseUrl(), workspaceId(req), run);
    emit(res, { type: "complete", run: saved });
  } catch (error) {
    const recoverable = error instanceof LLMGroupingProviderError || error instanceof LLMGroupingConfigurationError || error instanceof LLMGroupingStoreUnavailableError;
    emit(res, { type: "error", error: error instanceof Error ? error.message : "LLM grouping failed.", recoverable });
  } finally {
    res.end();
  }
}
