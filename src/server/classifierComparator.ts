import type { KnownTaskSignature, Trace } from "../types.js";

const sendJson = (res: any, status: number, payload: unknown) => res.status(status).json(payload);
const apiKey = () => String(process.env.ROUTELAB_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "").trim();
const model = () => String(process.env.ROUTELAB_CLASSIFIER_COMPARATOR_MODEL ?? "google/gemini-2.5-flash").trim();

const cleanContent = (value: unknown) => String(value ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

const traceInput = (trace: Trace) => ({
  traceId: trace.id,
  request: trace.messages.filter((message) => message.role !== "assistant").map((message) => ({ role: message.role, content: message.content })),
  prompt: trace.prompt_text,
  tools: (trace.spans ?? []).filter((span) => ["tool", "function", "retriever"].includes(span.type)).map((span) => ({ type: span.type, name: span.name })),
  workflow: trace.workflow_id ? { role: trace.workflow_role, nodeId: trace.node_id, parentNodeId: trace.parent_node_id } : undefined,
});

async function classifyBatch(traces: Trace[], signatures: KnownTaskSignature[]) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", "X-Title": "RouteLab classifier comparator" },
    body: JSON.stringify({
      model: model(),
      temperature: 0,
      messages: [
        { role: "system", content: "You independently classify incoming AI requests into a supplied Task Group catalog. Use only pre-response evidence: user request, prior conversation, available tool names, and whitelisted workflow metadata. Do not use assistant responses, outcomes, scores, or existing labels. Choose unknown when no group reliably matches. Return exactly one assignment for every trace." },
        { role: "user", content: JSON.stringify({ taskGroups: signatures, traces: traces.map(traceInput) }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "task_group_assignments",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["assignments"],
            properties: {
              assignments: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["traceId", "signatureId", "confidence", "rationale"],
                  properties: {
                    traceId: { type: "string" }, signatureId: { type: "string" },
                    confidence: { type: "number", minimum: 0, maximum: 1 }, rationale: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });
  const body = await response.json().catch(() => ({ error: { message: "Comparator returned a non-JSON response." } })) as any;
  if (!response.ok) throw new Error(String(body.error?.message ?? body.message ?? `OpenRouter HTTP ${response.status}`));
  const parsed = JSON.parse(cleanContent(body.choices?.[0]?.message?.content));
  if (!Array.isArray(parsed.assignments)) throw new Error("The strong classifier returned no assignments.");
  const allowed = new Set([...signatures.map((signature) => signature.id), "unknown"]);
  return parsed.assignments.map((assignment: any) => ({
    traceId: String(assignment.traceId),
    signatureId: allowed.has(String(assignment.signatureId)) ? String(assignment.signatureId) : "unknown",
    confidence: Math.min(1, Math.max(0, Number(assignment.confidence) || 0)),
    model: model(),
    rationale: String(assignment.rationale ?? ""),
  }));
}

export default async function classifierComparatorHandler(req: any, res: any) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  try {
    if (!apiKey()) return sendJson(res, 503, { error: "The server-side OpenRouter key is not configured." });
    const traces = Array.isArray(req.body?.traces) ? req.body.traces as Trace[] : [];
    const signatures = Array.isArray(req.body?.signatures) ? req.body.signatures as KnownTaskSignature[] : [];
    if (!traces.length || !signatures.length) return sendJson(res, 400, { error: "Traces and Task Groups are required." });
    const assignments = [];
    for (let index = 0; index < traces.length; index += 20) assignments.push(...await classifyBatch(traces.slice(index, index + 20), signatures));
    return sendJson(res, 200, { assignments, model: model() });
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Strong classifier comparison failed." });
  }
}
