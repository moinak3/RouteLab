import type { GoldenDatasetRow, Message, Trace } from "../types";

export const EVALUATION_EVIDENCE_SCHEMA_VERSION = "routelab.eval-evidence.v1";
export const EVALUATION_EVIDENCE_SCOPE = "full_trajectory";

const calibrationOnly = new Set([
  "case_type",
  "corrected_output",
  "eval_passed",
  "eval_rationale",
  "eval_score",
  "expected_answer",
  "expected_response",
  "human_answer",
  "human_feedback",
  "human_passed",
  "human_rationale",
  "human_score",
  "label_source",
  "review_status",
]);

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function visibleEvaluationEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(visibleEvaluationEvidence);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.startsWith("_internal") && !calibrationOnly.has(key))
    .map(([key, item]) => [key, visibleEvaluationEvidence(item)]));
}

function priorConversation(trace: Trace): Message[] {
  const messages = [...(trace.messages ?? [])];
  let lastUserIndex = -1;
  let finalAssistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (lastUserIndex < 0 && messages[index].role === "user") lastUserIndex = index;
  }
  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    if (messages[index].role === "assistant") {
      finalAssistantIndex = index;
      break;
    }
  }
  return messages.filter((message, index) => message.role !== "system" && index !== finalAssistantIndex);
}

function systemInstructions(trace: Trace) {
  return (trace.messages ?? []).filter((message) => message.role === "system").map((message) => message.content);
}

function executionSpans(trace: Trace) {
  return (trace.spans ?? []).map((span) => ({
    id: span.id,
    parent_id: span.parent_id ?? null,
    type: span.type,
    name: span.name ?? null,
    input: visibleEvaluationEvidence(span.input ?? null),
    output: visibleEvaluationEvidence(span.output ?? null),
    metadata: visibleEvaluationEvidence(span.metadata ?? {}),
  }));
}

function metadataValue(trace: Trace, keys: string[]) {
  for (const key of keys) {
    const value = trace.metadata?.[key];
    if (value !== undefined && value !== null) return visibleEvaluationEvidence(value);
  }
  return null;
}

export function buildTraceEvaluationEvidence(trace: Trace) {
  const spans = executionSpans(trace);
  const toolSpans = spans.filter((span) => span.type === "tool" || span.type === "function");
  return {
    evidence_schema_version: EVALUATION_EVIDENCE_SCHEMA_VERSION,
    evaluation_scope: EVALUATION_EVIDENCE_SCOPE,
    trace_id: trace.id,
    user_request: trace.prompt_text,
    system_instructions: systemInstructions(trace),
    prior_conversation: priorConversation(trace),
    available_tools: metadataValue(trace, ["tools_available", "available_tools", "tool_definitions"]),
    retrieved_context: metadataValue(trace, ["retrieved_context", "retrieval_context", "documents", "sources"]),
    execution_spans: spans,
    tool_calls: metadataValue(trace, ["tool_calls"]) ?? toolSpans.map((span) => ({ name: span.name, input: span.input })),
    tool_results: toolSpans.map((span) => ({ name: span.name, output: span.output, metadata: span.metadata })),
    agent_response: trace.response_text ?? "",
    trajectory_outcome: {
      status: trace.status,
      error_type: trace.error_type ?? null,
    },
    workflow: {
      workflow_id: trace.workflow_id ?? null,
      node_id: trace.node_id ?? null,
      parent_node_id: trace.parent_node_id ?? null,
      role: trace.workflow_role ?? null,
    },
    operational_metadata: visibleEvaluationEvidence(trace.metadata ?? {}),
  };
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export function evaluationEvidenceFingerprint(evidence: ReturnType<typeof buildTraceEvaluationEvidence>) {
  const input = stableValue(evidence);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const jsonCell = (value: unknown) => JSON.stringify(value ?? null);

export function goldenEvidenceFieldsFromTrace(trace: Trace): GoldenDatasetRow {
  const evidence = buildTraceEvaluationEvidence(trace);
  return {
    evidence_schema_version: evidence.evidence_schema_version,
    evaluation_scope: evidence.evaluation_scope,
    evidence_fingerprint: evaluationEvidenceFingerprint(evidence),
    trace_id: trace.id,
    user_request: evidence.user_request,
    system_instructions_json: jsonCell(evidence.system_instructions),
    prior_conversation_json: jsonCell(evidence.prior_conversation),
    available_tools_json: jsonCell(evidence.available_tools),
    retrieved_context_json: jsonCell(evidence.retrieved_context),
    execution_spans_json: jsonCell(evidence.execution_spans),
    tool_calls_json: jsonCell(evidence.tool_calls),
    tool_results_json: jsonCell(evidence.tool_results),
    agent_answer: evidence.agent_response,
    trajectory_status: String(evidence.trajectory_outcome.status),
    workflow_json: jsonCell(evidence.workflow),
    evidence_metadata_json: jsonCell(evidence.operational_metadata),
  };
}

export function goldenEvidenceMatchesTrace(row: GoldenDatasetRow, trace: Trace | undefined) {
  const expected = String(row.evidence_fingerprint ?? "").trim();
  if (!expected || !trace) return undefined;
  return expected === evaluationEvidenceFingerprint(buildTraceEvaluationEvidence(trace));
}
