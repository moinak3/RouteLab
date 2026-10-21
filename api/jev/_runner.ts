import type { KnownTaskSignature, Trace, TraceSignatureDecision } from "../../src/types.js";
import {
  failedJevSignatureDecision,
  interpretJevSignatureChoice,
  signatureCriteria,
  type JevChoiceAnswer,
  type JevSignatureGateResponse,
} from "../../src/core/jevSignatureGate.js";

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_MODEL = "typesafe/jev-1.14";
const DEFAULT_TIMEOUT_MS = 1_500;
const MAX_CONCURRENCY = 6;

const serverJevModel = () => String(process.env.ROUTELAB_JEV_MODEL ?? DEFAULT_MODEL).trim();
const serverJevTimeoutMs = () => {
  const configured = Number(process.env.ROUTELAB_JEV_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(configured) ? Math.max(250, Math.min(10_000, configured)) : DEFAULT_TIMEOUT_MS;
};

const requestState = (trace: Trace) => JSON.stringify({
  request: trace.messages
    .filter((message) => message.role !== "assistant")
    .map((message) => ({ role: message.role, content: message.content })),
  prompt: trace.prompt_text,
  tools: (trace.spans ?? [])
    .filter((span) => span.type === "tool" || span.type === "function" || span.type === "retriever")
    .map((span) => ({ type: span.type, name: span.name })),
  workflow: trace.workflow_id ? {
    workflow_id: trace.workflow_id,
    node_id: trace.node_id,
    parent_node_id: trace.parent_node_id,
    role: trace.workflow_role,
  } : undefined,
});

async function classifyOne(
  trace: Trace,
  signatures: KnownTaskSignature[],
  apiKey: string,
  baseThreshold: number,
): Promise<{ trace_id: string; decision: TraceSignatureDecision }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), serverJevTimeoutMs());
  try {
    const response = await fetch(DECISIONS_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "RouteLab Jev Signature Gate",
      },
      body: JSON.stringify({
        model: serverJevModel(),
        state: requestState(trace),
        questions: {
          task_signature: {
            type: "choice",
            instructions: "Classify this incoming AI request into exactly one known RouteLab task signature. Choose unknown when the evidence is insufficient or no signature is a reliable match.",
            criteria: signatureCriteria(signatures),
          },
        },
      }),
    });
    const payload = await response.json().catch(() => ({})) as {
      model?: string;
      answers?: { task_signature?: JevChoiceAnswer };
      error?: { message?: string } | string;
      message?: string;
    };
    if (!response.ok) {
      const providerError = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(providerError ?? payload.message ?? `OpenRouter Decisions HTTP ${response.status}`);
    }
    const answer = payload.answers?.task_signature;
    if (!answer || answer.type !== "choice" || typeof answer.choice !== "string") {
      throw new Error("OpenRouter returned no Jev task-signature decision.");
    }
    return {
      trace_id: trace.id,
      decision: interpretJevSignatureChoice(answer, signatures, payload.model ?? serverJevModel(), Date.now() - started, baseThreshold),
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    const reason = timedOut
      ? `Jev exceeded the ${serverJevTimeoutMs()}ms routing budget. Route through the broadly capable fallback model.`
      : `${error instanceof Error ? error.message : "Jev classification failed."} Route through the broadly capable fallback model.`;
    return {
      trace_id: trace.id,
      decision: failedJevSignatureDecision(timedOut ? "timeout" : "error", reason, Date.now() - started, serverJevModel()),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runJevSignatureGate(input: {
  traces: Trace[];
  signatures: KnownTaskSignature[];
  apiKey: string;
  baseThreshold?: number;
}): Promise<JevSignatureGateResponse> {
  const { traces, signatures, apiKey } = input;
  if (!apiKey) {
    const decisions = traces.map((trace) => ({
      trace_id: trace.id,
      decision: failedJevSignatureDecision("provider_unavailable", "The server-side OpenRouter key is not configured. Route through the broadly capable fallback model.", 0, serverJevModel()),
    }));
    return { decisions, summary: summarize(decisions) };
  }
  if (!traces.length || !signatures.length) return { decisions: [], summary: { total: 0, matched: 0, fallback: 0, unknown: 0, failed: 0 } };
  const decisions: JevSignatureGateResponse["decisions"] = [];
  for (let index = 0; index < traces.length; index += MAX_CONCURRENCY) {
    decisions.push(...await Promise.all(traces.slice(index, index + MAX_CONCURRENCY).map((trace) =>
      classifyOne(trace, signatures, apiKey, input.baseThreshold ?? .8),
    )));
  }
  return { decisions, summary: summarize(decisions) };
}

const summarize = (decisions: JevSignatureGateResponse["decisions"]) => ({
  total: decisions.length,
  matched: decisions.filter(({ decision }) => decision.status === "matched").length,
  fallback: decisions.filter(({ decision }) => decision.routing_action === "fallback_model").length,
  unknown: decisions.filter(({ decision }) => decision.status === "unknown").length,
  failed: decisions.filter(({ decision }) => ["timeout", "error", "provider_unavailable"].includes(decision.status)).length,
});
