import { calculateCost, getModel } from "./catalog";
import type { CandidateRun, GatewayProvider, Model, Trace } from "../types";

export type LiveKeyConfig = {
  familyApiKeys: Partial<Record<Model["family"], string>>;
  gatewayApiKeys: Partial<Record<GatewayProvider, string>>;
  serverGatewayKeys?: Partial<Record<GatewayProvider, boolean>>;
};

export type LiveRunSource = "openrouter" | "direct_family";

export type LiveRoutingStatus = {
  source: LiveRunSource;
  label: string;
  message: string;
};

export type LiveRunResponse = {
  runs: Array<{
    trace_id: string;
    response_text: string;
    output_tokens?: number;
    latency_ms: number;
    status: "success" | "error";
    error?: string;
  }>;
  source: LiveRunSource;
  label: string;
};

const directFamilySupported = (family: Model["family"]) => family === "OpenAI" || family === "Mistral" || family === "DeepSeek";

export function liveRoutingStatus(candidateId: string, keys: LiveKeyConfig): LiveRoutingStatus | undefined {
  const model = getModel(candidateId);
  if (!model || model.family === "Local") return undefined;
  const familyKey = keys.familyApiKeys[model.family]?.trim();
  const openRouterKey = keys.gatewayApiKeys.OpenRouter?.trim();
  const openRouterAvailable = Boolean(openRouterKey || keys.serverGatewayKeys?.OpenRouter);
  if (familyKey && directFamilySupported(model.family)) {
    return { source: "direct_family", label: model.family, message: `Live direct routing will use the ${model.family} family key.` };
  }
  if (openRouterAvailable) {
    return {
      source: "openrouter",
      label: "OpenRouter",
      message: familyKey
        ? `${model.family} direct API is not wired yet; live direct routing will use the OpenRouter gateway key.`
        : `No ${model.family} key configured; live direct routing will use the OpenRouter gateway key.`,
    };
  }
  if (familyKey) {
    return { source: "direct_family", label: model.family, message: `Live direct routing will use the ${model.family} family key.` };
  }
  return undefined;
}

export async function runLiveDirectRouting(traces: Trace[], candidateId: string, keys: LiveKeyConfig, signal?: AbortSignal): Promise<{runs:CandidateRun[];source:LiveRunSource;label:string}> {
  const model = getModel(candidateId);
  const live = liveRoutingStatus(candidateId, keys);
  if (!model || !live) throw new Error("No live API key is configured for the selected model.");
  const apiKey = live.source === "openrouter" ? keys.gatewayApiKeys.OpenRouter : keys.familyApiKeys[model.family];
  const response = await fetch("/api/live/direct-routing", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: live.source,
      apiKey,
      modelId: model.id,
      traces: traces.map(trace=>({ id: trace.id, messages: trace.messages, prompt_text: trace.prompt_text, input_tokens: trace.input_tokens, output_tokens: trace.output_tokens })),
    }),
  });
  const payload = await response.json().catch(()=>({ error: "Live provider returned a non-JSON response." })) as { error?: unknown };
  if (!response.ok) throw new Error(String(payload.error ?? `Live direct routing failed with HTTP ${response.status}.`));
  const liveResponse = payload as LiveRunResponse;
  return {
    source: liveResponse.source,
    label: liveResponse.label,
    runs: liveResponse.runs.map(run=>{
      const trace = traces.find(item=>item.id===run.trace_id);
      const outputTokens = Math.max(0, run.output_tokens ?? Math.ceil(run.response_text.length / 4));
      return {
        id: `live_${run.trace_id}_${candidateId}`,
        trace_id: run.trace_id,
        candidate_model: candidateId,
        response_text: run.error ? `[LIVE_ERROR] ${run.error}` : run.response_text,
        input_tokens: trace?.input_tokens ?? 0,
        output_tokens: outputTokens,
        latency_ms: run.latency_ms,
        cost_usd: calculateCost(trace?.input_tokens ?? 0, outputTokens, model),
        status: run.status,
      };
    }),
  };
}
