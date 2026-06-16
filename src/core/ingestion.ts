import Papa from "papaparse";
import { calculateCost, getModel } from "./catalog";
import type { Message, Trace, WorkflowRole, WorkflowTraceNode, WorkflowTraceTree } from "../types";

export type IngestionResult = { traces: Trace[]; workflows: WorkflowTraceTree[]; errors: Array<{ row: number; reason: string }> };
const workflowRoles = new Set<WorkflowRole>(["planner", "retriever", "retriever_summarizer", "tool_caller", "final_answer", "judge", "other"]);
const optionalString = (value: unknown) => value === undefined || value === null || value === "" ? undefined : String(value);
const parseRole = (value: unknown): WorkflowRole | undefined => {
  const role = optionalString(value)?.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_") as WorkflowRole | undefined;
  return role && workflowRoles.has(role) ? role : role ? "other" : undefined;
};

export function normalizeTrace(raw: Record<string, unknown>, row = 1): Trace {
  const id = String(raw.id ?? `trace-${row}`);
  const model = String(raw.model ?? "");
  if (!model) throw new Error("model is required");
  const prompt = String(raw.prompt_text ?? raw.prompt ?? "");
  let messages = raw.messages as Message[] | string | undefined;
  if (typeof messages === "string") messages = JSON.parse(messages) as Message[];
  if (!messages?.length && prompt) messages = [{ role: "user", content: prompt }];
  if (!messages?.length) throw new Error("messages or prompt_text is required");
  const input = Number(raw.input_tokens ?? 0);
  const output = Number(raw.output_tokens ?? 0);
  const catalogModel = getModel(model);
  const cost = raw.cost_usd === undefined && catalogModel ? calculateCost(input, output, catalogModel) : Number(raw.cost_usd ?? 0);
  return {
    id, timestamp: String(raw.timestamp ?? new Date(0).toISOString()), provider: String(raw.provider ?? catalogModel?.provider ?? "other"),
    model, messages, prompt_text: prompt || messages.map((message) => message.content).join(" "),
    response_text: String(raw.response_text ?? raw.response ?? ""), input_tokens: input, output_tokens: output,
    total_tokens: Number(raw.total_tokens ?? input + output), latency_ms: Number(raw.latency_ms ?? 0), cost_usd: cost,
    status: raw.status === "error" ? "error" : "success", error_type: raw.error_type ? String(raw.error_type) : undefined,
    workflow_id: optionalString(raw.workflow_id ?? raw.workflowId ?? raw.session_id),
    node_id: optionalString(raw.node_id ?? raw.nodeId ?? raw.span_id ?? raw.spanId) ?? id,
    parent_node_id: optionalString(raw.parent_node_id ?? raw.parentNodeId ?? raw.parent_span_id ?? raw.parentSpanId),
    workflow_role: parseRole(raw.workflow_role ?? raw.workflowRole ?? raw.role_type ?? raw.node_role),
    span_name: optionalString(raw.span_name ?? raw.spanName ?? raw.operation_name),
    source: optionalString(raw.source) as Trace["source"],
    spans: Array.isArray(raw.spans) ? raw.spans as Trace["spans"] : undefined,
    metadata: typeof raw.metadata === "string" ? JSON.parse(raw.metadata) as Record<string, unknown> : raw.metadata as Record<string, unknown> | undefined,
  };
}

export function buildWorkflowTrees(traces: Trace[]): WorkflowTraceTree[] {
  const groups = new Map<string, Trace[]>();
  traces.filter((trace) => trace.workflow_id).forEach((trace) => groups.set(trace.workflow_id!, [...(groups.get(trace.workflow_id!) ?? []), trace]));
  return [...groups.entries()].map(([workflowId, items]) => {
    const nodes = new Map<string, WorkflowTraceNode>();
    items.forEach((trace) => nodes.set(trace.node_id ?? trace.id, {
      node_id: trace.node_id ?? trace.id, trace_id: trace.id, parent_node_id: trace.parent_node_id,
      workflow_role: trace.workflow_role ?? "other", span_name: trace.span_name, children: [],
    }));
    const roots: WorkflowTraceNode[] = [];
    nodes.forEach((node) => {
      const parent = node.parent_node_id ? nodes.get(node.parent_node_id) : undefined;
      if (parent && parent !== node) parent.children.push(node); else roots.push(node);
    });
    const roles = items.reduce<WorkflowTraceTree["roles"]>((acc, trace) => {
      const role = trace.workflow_role ?? "other"; acc[role] = (acc[role] ?? 0) + 1; return acc;
    }, {});
    return {
      workflow_id: workflowId, trace_ids: items.map((trace) => trace.id), roots,
      total_cost_usd: items.reduce((sum, trace) => sum + (trace.cost_usd ?? 0), 0),
      total_latency_ms: items.reduce((sum, trace) => sum + (trace.latency_ms ?? 0), 0), roles,
    };
  });
}

export function ingestRecords(records: unknown[]): IngestionResult {
  const result: IngestionResult = { traces: [], workflows: [], errors: [] };
  records.forEach((record, index) => {
    try {
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("row must be an object");
      result.traces.push(normalizeTrace(record as Record<string, unknown>, index + 1));
    } catch (error) {
      result.errors.push({ row: index + 1, reason: error instanceof Error ? error.message : "invalid row" });
    }
  });
  result.workflows = buildWorkflowTrees(result.traces);
  return result;
}

function flattenNestedRecords(input: unknown): unknown[] {
  const flattened: unknown[] = [];
  const visit = (value: unknown, inherited: { workflow_id?: string; parent_node_id?: string } = {}) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const raw = value as Record<string, unknown>;
    const workflowId = inherited.workflow_id ?? optionalString(raw.workflow_id ?? raw.workflowId ?? raw.id);
    const nodeId = optionalString(raw.node_id ?? raw.nodeId ?? raw.span_id ?? raw.spanId ?? raw.id);
    const children = Array.isArray(raw.children) ? raw.children : Array.isArray(raw.nodes) ? raw.nodes : [];
    const isLlmCall = Boolean(raw.model || raw.messages || raw.prompt || raw.prompt_text);
    if (isLlmCall) {
      flattened.push({ ...raw, workflow_id: inherited.workflow_id ?? optionalString(raw.workflow_id ?? raw.workflowId), parent_node_id: optionalString(raw.parent_node_id ?? raw.parentNodeId) ?? inherited.parent_node_id });
    }
    children.forEach((child) => visit(child, { workflow_id: workflowId, parent_node_id: isLlmCall ? nodeId : inherited.parent_node_id }));
  };
  if (Array.isArray(input)) input.forEach((item) => visit(item));
  else if (input && typeof input === "object") {
    const envelope = input as Record<string, unknown>;
    if (Array.isArray(envelope.workflows)) envelope.workflows.forEach((workflow) => visit(workflow));
    else if (Array.isArray(envelope.traces)) envelope.traces.forEach((trace) => visit(trace));
    else visit(input);
  }
  return flattened;
}

export function ingestText(text: string, filename: string): IngestionResult {
  if (filename.endsWith(".csv")) return ingestRecords(Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true }).data);
  if (filename.endsWith(".jsonl")) {
    const rows: unknown[] = [];
    const errors: IngestionResult["errors"] = [];
    text.split(/\r?\n/).filter(Boolean).forEach((line, index) => {
      try { rows.push(JSON.parse(line)); } catch { errors.push({ row: index + 1, reason: "invalid JSON" }); }
    });
    const result = ingestRecords(rows);
    return { traces: result.traces, workflows: result.workflows, errors: [...errors, ...result.errors] };
  }
  try {
    const parsed = JSON.parse(text);
    return ingestRecords(flattenNestedRecords(parsed));
  } catch {
    return { traces: [], workflows: [], errors: [{ row: 1, reason: "invalid JSON" }] };
  }
}
