import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { Message, Trace, TraceSignatureDecision } from "../../src/types.js";

let initializedForUrl = "";
let initialization: Promise<unknown> | null = null;

function databaseUrl() {
  const value = String(process.env.DATABASE_URL ?? "").trim();
  if (!value) throw Object.assign(new Error("Runtime trace storage is not configured."), { statusCode: 503 });
  return value;
}

function workspaceId() {
  return String(process.env.ROUTELAB_POLICY_WORKSPACE_ID ?? "demo").trim() || "demo";
}

function store() {
  const url = databaseUrl();
  const sql = neon(url);
  if (initializedForUrl !== url || !initialization) {
    initializedForUrl = url;
    initialization = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS routelab_runtime_traces (
          workspace_id text NOT NULL,
          trace_id text NOT NULL,
          observed_at timestamptz NOT NULL DEFAULT now(),
          classifier_status text NOT NULL,
          trace jsonb NOT NULL,
          PRIMARY KEY (workspace_id, trace_id)
        )
      `,
      await Promise.all([
        sql`
          CREATE INDEX IF NOT EXISTS routelab_runtime_traces_recent
          ON routelab_runtime_traces (workspace_id, observed_at DESC)
        `,
        sql`
          CREATE INDEX IF NOT EXISTS routelab_runtime_traces_classifier_status
          ON routelab_runtime_traces (workspace_id, classifier_status, observed_at DESC)
        `,
      ]);
    })();
  }
  return { sql, ready: initialization };
}

const textContent = (content: unknown) => {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) return content.map((part) => typeof part === "string" ? part : String(part?.text ?? JSON.stringify(part))).join("\n");
  return JSON.stringify(content);
};

const normalizedMessages = (messages: unknown): Message[] => Array.isArray(messages)
  ? messages.flatMap((message): Message[] => {
    const role = String(message?.role ?? "user");
    if (!(["system", "user", "assistant", "tool"] as string[]).includes(role)) return [];
    return [{ role: role as Message["role"], content: textContent(message?.content) }];
  })
  : [];

const assistantContent = (payload: any) => textContent(payload?.openRouterResponse?.choices?.[0]?.message?.content);

function signatureDecision(decision: any): TraceSignatureDecision | undefined {
  if (!decision) return undefined;
  const status = String(decision.status ?? "error") as TraceSignatureDecision["status"];
  const signatureId = String(decision.signatureId ?? "unknown");
  return {
    provider: "jev",
    model: String(process.env.ROUTELAB_JEV_MODEL ?? "typesafe/jev-1.14"),
    signature_id: signatureId,
    signature_label: String(decision.signatureLabel ?? "Unknown or new trace bucket"),
    confidence: Number(decision.confidence ?? 0),
    probabilities: decision.probabilities && typeof decision.probabilities === "object" ? decision.probabilities : {},
    status,
    routing_action: status === "matched" ? "signature_route" : "fallback_model",
    confidence_threshold: Number(decision.threshold ?? 1),
    latency_ms: Number(decision.latencyMs ?? 0),
    reason: String(decision.reason ?? "No classifier reason was reported."),
  };
}

export function runtimeTraceFromResult({
  request,
  payload,
  decision = payload?.decision,
  route = payload?.route,
  source,
}: {
  request: any;
  payload: any;
  decision?: any;
  route?: any;
  source: "routelab_support" | "routelab_sidecar";
}): Trace {
  const messages = normalizedMessages(request?.messages);
  const latestPrompt = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const usage = payload?.openRouterResponse?.usage ?? {};
  const selectedModel = String(payload?.openRouterRequest?.model ?? route?.openRouterModelId ?? route?.modelId ?? request?.model ?? "unknown");
  const normalizedDecision = signatureDecision(decision);
  const classifierStatus = normalizedDecision?.status ?? "error";
  const unknownClassifier = classifierStatus === "unknown" || normalizedDecision?.signature_id === "unknown";
  const toolExecutions = Array.isArray(payload?.toolExecutions) ? payload.toolExecutions : [];
  const conversationId = request?.session_id ? String(request.session_id) : undefined;
  const conversationTurn = messages.filter((message) => message.role === "user").length;
  return {
    id: `runtime_${Date.now()}_${randomUUID()}`,
    timestamp: new Date().toISOString(),
    provider: String(payload?.openRouterResponse?.provider ?? "OpenRouter"),
    model: selectedModel,
    messages,
    prompt_text: latestPrompt,
    response_text: assistantContent(payload),
    input_tokens: Number(usage.prompt_tokens ?? 0),
    output_tokens: Number(usage.completion_tokens ?? 0),
    total_tokens: Number(usage.total_tokens ?? 0),
    latency_ms: Number(payload?.timing?.totalMs ?? decision?.latencyMs ?? 0),
    cost_usd: Number(usage.cost ?? 0),
    status: payload?.ok === false ? "error" : "success",
    workflow_id: conversationId,
    workflow_role: "final_answer",
    source,
    spans: toolExecutions.map((execution: any, index: number) => ({
      id: `tool_${index + 1}`,
      type: "tool" as const,
      name: String(execution?.name ?? "unknown_tool"),
      input: execution?.arguments,
      output: execution?.result,
      metadata: { status: execution?.result?.error ? "error" : "success" },
    })),
    error_type: payload?.ok === false ? "upstream_error" : undefined,
    metadata: {
      runtime_source: source,
      conversation_id: conversationId,
      conversation_turn: conversationTurn,
      policy_id: route?.policyId,
      policy_version: route?.policyVersion,
      route_source: route?.source,
      task_bucket_id: route?.taskBucketId ?? normalizedDecision?.signature_id,
      distinct_task_label: route?.taskBucketLabel ?? normalizedDecision?.signature_label,
      classifier_status: classifierStatus,
      classifier_confidence: normalizedDecision?.confidence ?? 0,
      classifier_threshold: normalizedDecision?.confidence_threshold ?? 1,
      classifier_reason: normalizedDecision?.reason,
      unknown_classifier: unknownClassifier,
      available_tools: Array.isArray(request?.tools) ? request.tools.map((tool: any) => String(tool?.function?.name ?? tool?.name ?? "unknown_tool")) : [],
      executed_tools: toolExecutions.map((execution: any) => String(execution?.name ?? "unknown_tool")),
      routing_passes: Array.isArray(payload?.routingPasses) ? payload.routingPasses.length : 1,
    },
    signature_decision: normalizedDecision,
  };
}

export async function saveRuntimeTrace(trace: Trace) {
  const database = store();
  await database.ready;
  const traceJson = JSON.stringify(trace);
  const classifierStatus = String(trace.signature_decision?.status ?? trace.metadata?.classifier_status ?? "error");
  await database.sql`
    INSERT INTO routelab_runtime_traces (workspace_id, trace_id, observed_at, classifier_status, trace)
    VALUES (${workspaceId()}, ${trace.id}, ${trace.timestamp}, ${classifierStatus}, ${traceJson}::jsonb)
    ON CONFLICT (workspace_id, trace_id) DO UPDATE
    SET observed_at = EXCLUDED.observed_at, classifier_status = EXCLUDED.classifier_status, trace = EXCLUDED.trace
  `;
  return trace;
}

export async function listRuntimeTraces(limit = 500) {
  const database = store();
  await database.ready;
  const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(limit) || 500));
  const rows = await database.sql`
    SELECT trace FROM routelab_runtime_traces
    WHERE workspace_id = ${workspaceId()}
    ORDER BY observed_at DESC
    LIMIT ${boundedLimit}
  `;
  return rows.map((row) => row.trace as Trace);
}
