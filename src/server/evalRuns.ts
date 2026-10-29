import { getModel } from "../core/catalog.js";
import type { EvalDefinition } from "../core/evalDefinitions.js";
import type { Trace, TraceJudgeResult } from "../types.js";
import { serverOpenRouterKey } from "../../api/live/_shared.js";

const MAX_TRACES_PER_RUN = 50;
const MAX_CONCURRENCY = 4;

const isObject = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function sendJson(res: any, status: number, payload: unknown) {
  return res.status(status).json(payload);
}

function runtimeModelId(model: string) {
  const configured = getModel(model);
  return configured?.pricing_source_model_id ?? model;
}

function visibleMetadata(trace: Trace) {
  return Object.fromEntries(Object.entries(trace.metadata ?? {}).filter(([key]) => !key.startsWith("_internal")));
}

function traceEvidence(trace: Trace) {
  return {
    trace_id: trace.id,
    user_request: trace.prompt_text,
    agent_response: trace.response_text ?? "",
    prior_conversation: trace.messages,
    status: trace.status,
    available_evidence: visibleMetadata(trace),
    workflow: {
      workflow_id: trace.workflow_id ?? null,
      node_id: trace.node_id ?? null,
      role: trace.workflow_role ?? null,
    },
  };
}

function parseJudgePayload(content: unknown) {
  const source = typeof content === "string" ? content : JSON.stringify(content ?? {});
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const object = source.match(/\{[\s\S]*\}/)?.[0];
  const parsed = JSON.parse((fenced ?? object ?? source).trim()) as Record<string, unknown>;
  const rawScore = Number(parsed.weighted_score ?? parsed.score ?? 0);
  const score = Math.max(0, Math.min(1, Number.isFinite(rawScore) ? rawScore : 0));
  const severity: TraceJudgeResult["severity"] = parsed.severity === "minor" || parsed.severity === "major" || parsed.severity === "critical"
    ? parsed.severity
    : undefined;
  return {
    score,
    passed: typeof parsed.passed === "boolean" ? parsed.passed : undefined,
    rationale: String(parsed.rationale ?? parsed.explanation ?? "The judge did not provide a rationale."),
    severity,
  };
}

export async function evaluateTraceWithDefinition({
  definition,
  trace,
  evalVersion,
  runId,
  runMode,
  apiKey,
  fetchImpl = fetch,
}: {
  definition: EvalDefinition;
  trace: Trace;
  evalVersion: number;
  runId: string;
  runMode: "historical_test" | "new_traces";
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<TraceJudgeResult> {
  if (!definition.evaluator_type.toLowerCase().includes("judge")) {
    throw new Error("Historical and continuous runs currently require an LLM judge evaluator.");
  }
  const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-OpenRouter-Metadata": "enabled",
    },
    body: JSON.stringify({
      model: runtimeModelId(definition.model),
      temperature: 0,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${definition.prompt}\n\nReturn one JSON object with: score (0 to 1), passed (boolean), rationale (concise evidence-based string), and severity (minor, major, critical, or null). Evaluate only the supplied trace evidence.`,
        },
        { role: "user", content: JSON.stringify(traceEvidence(trace)) },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(String(payload.error?.message ?? `OpenRouter HTTP ${response.status}`));
  const judged = parseJudgePayload(payload.choices?.[0]?.message?.content);
  const passed = typeof judged.passed === "boolean" ? judged.passed && judged.score >= definition.threshold : judged.score >= definition.threshold;
  return {
    id: `${runId}_${trace.id}`,
    trace_id: trace.id,
    evaluator_type: `${definition.id} (${runtimeModelId(definition.model)})`,
    score: judged.score,
    passed,
    rationale: judged.rationale,
    severity: judged.severity,
    created_at: new Date().toISOString(),
    eval_id: definition.id,
    eval_version: evalVersion,
    run_id: runId,
    run_mode: runMode,
  };
}

async function runWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>) {
  const results = new Array<R | undefined>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(workers);
  return results.filter((item): item is R => item !== undefined);
}

export default async function evalRunHandler(req: any, res: any) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  const definition = req.body?.definition as EvalDefinition | undefined;
  const traces = req.body?.traces as Trace[] | undefined;
  const evalVersion = Number(req.body?.evalVersion);
  const mode = req.body?.mode === "new_traces" ? "new_traces" : "historical_test";
  if (!isObject(definition) || typeof definition.id !== "string" || typeof definition.prompt !== "string") {
    return sendJson(res, 400, { error: "A valid eval definition is required." });
  }
  if (!Array.isArray(traces) || !traces.length || traces.length > MAX_TRACES_PER_RUN) {
    return sendJson(res, 400, { error: `Provide between 1 and ${MAX_TRACES_PER_RUN} traces per eval run.` });
  }
  if (!Number.isInteger(evalVersion) || evalVersion < 1) return sendJson(res, 400, { error: "A valid eval version is required." });
  if (!definition.evaluator_type.toLowerCase().includes("judge")) {
    return sendJson(res, 400, { error: "Historical and continuous runs currently require an LLM judge evaluator." });
  }
  const apiKey = serverOpenRouterKey();
  if (!apiKey) return sendJson(res, 503, { error: "The server-side OpenRouter key is not configured." });

  const startedAt = new Date().toISOString();
  const runId = `evalrun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const errors: Array<{ traceId: string; error: string }> = [];
  const results = await runWithConcurrency(traces, async (trace) => {
    try {
      return await evaluateTraceWithDefinition({ definition, trace, evalVersion, runId, runMode: mode, apiKey });
    } catch (error) {
      errors.push({ traceId: trace.id, error: error instanceof Error ? error.message : "Judge request failed." });
      return null;
    }
  }).then((items) => items.filter((item): item is TraceJudgeResult => item !== null));
  const passed = results.filter((result) => result.passed).length;
  const completedAt = new Date().toISOString();
  const averageScore = results.length ? results.reduce((sum, result) => sum + result.score, 0) / results.length : 0;
  return sendJson(res, results.length ? 200 : 502, {
    run: {
      id: runId,
      evalId: definition.id,
      evalName: definition.name,
      evalVersion,
      mode,
      status: results.length ? "completed" : "failed",
      traceCount: results.length,
      passed,
      failed: results.length - passed,
      averageScore,
      startedAt,
      completedAt,
      ...(results.length ? {} : { error: errors[0]?.error ?? "No trace was scored." }),
    },
    results,
    errors,
  });
}
