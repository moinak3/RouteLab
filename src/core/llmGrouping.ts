import type { DistinctTaskBucket, Trace } from "../types.js";
import { createDistinctTaskBuckets } from "./distinctTasks.js";
import { normalizeAutomaticTaskGroupNames } from "./taskGroupDisplayNames.js";

export const LLM_GROUPING_SCHEMA_VERSION = "routelab.llm-grouping.v1" as const;
export const LLM_GROUPING_PROMPT_VERSION = "independent-task-discovery-v2";

export type LLMGroupingStage = "extraction" | "discovery" | "consolidation" | "assignment";
export type LLMGroupingAssignmentStatus = "assigned" | "ambiguous" | "unassigned";

export type LLMGroupingTraceInput = {
  traceId: string;
  latestRequest: string;
  requestContext: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>;
  workflowContext: Record<string, string | string[]>;
};

export type LLMTaskDescription = {
  traceId: string;
  immediateJob: string;
  modality: string[];
  grounding: string[];
  expectedOutput: string[];
  reasoningRequirements: string[];
  clarity: "clear" | "ambiguous" | "insufficient";
  ambiguityReason?: string;
};

export type LLMGroupingNeighbor = { groupId: string; distinction: string };
export type LLMGroupingCounterexample = { traceId: string; explanation: string };

export type LLMTaskGroup = {
  id: string;
  name: string;
  description: string;
  inclusionCriteria: string[];
  exclusionCriteria: string[];
  representativeTraceIds: string[];
  confusingCounterexamples: LLMGroupingCounterexample[];
  nearestNeighbors: LLMGroupingNeighbor[];
  attributes: {
    modality: string[];
    grounding: string[];
    expectedOutput: string[];
    reasoningRequirements: string[];
  };
  suggestedEvaluationDimensions: string[];
  routingRationale: string;
};

export type LLMGroupingAssignment = {
  traceId: string;
  status: LLMGroupingAssignmentStatus;
  groupId: string | null;
  confidence: number;
  alternateGroupIds: string[];
  rationale: string;
};

export type LLMGroupingRun = {
  schemaVersion: typeof LLM_GROUPING_SCHEMA_VERSION;
  runId: string;
  provider: "OpenRouter";
  model: string;
  promptVersion: string;
  startedAt: string;
  completedAt: string;
  snapshot: {
    hash: string;
    traceIds: string[];
    totalTraces: number;
  };
  method: {
    discoverySampling: "none" | "representative";
    discoveryTraceCount: number;
    assignmentTraceCount: number;
    batchSize: number;
    metadataFieldsUsed: string[];
    excludedFields: string[];
  };
  groups: LLMTaskGroup[];
  assignments: LLMGroupingAssignment[];
  coverage: {
    assigned: number;
    ambiguous: number;
    unassigned: number;
    processed: number;
    total: number;
  };
};

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export function createTaskBucketsFromLLMGrouping(traces: Trace[], run: LLMGroupingRun): DistinctTaskBucket[] {
  const traceById = new Map(traces.map((trace) => [trace.id, trace]));
  const buckets = run.groups.flatMap((group) => {
    const assignments = run.assignments.filter((assignment) => assignment.status === "assigned" && assignment.groupId === group.id);
    const groupedTraces = assignments.flatMap((assignment) => {
      const trace = traceById.get(assignment.traceId);
      return trace ? [trace] : [];
    });
    if (!groupedTraces.length) return [];

    // Legacy task attributes support downstream analysis, but the LLM run defines the group boundary.
    const inferred = createDistinctTaskBuckets(groupedTraces);
    const representative = [...inferred].sort((left, right) => right.trace_count - left.trace_count)[0];
    const totalCost = groupedTraces.reduce((sum, trace) => sum + (trace.cost_usd ?? 0), 0);
    const latencies = groupedTraces.flatMap((trace) => trace.latency_ms === undefined ? [] : [trace.latency_ms]);
    return [{
      bucket_id: group.id,
      bucket_name: group.name,
      name_source: "llm" as const,
      task: representative.task,
      traces: groupedTraces.map((trace) => trace.id),
      trace_count: groupedTraces.length,
      total_cost_usd: totalCost,
      avg_cost_usd: totalCost / groupedTraces.length,
      total_tokens: groupedTraces.reduce((sum, trace) => sum + trace.total_tokens, 0),
      avg_input_tokens: average(groupedTraces.map((trace) => trace.input_tokens)),
      avg_output_tokens: average(groupedTraces.map((trace) => trace.output_tokens)),
      avg_latency_ms: average(latencies),
      avg_confidence: average(assignments.map((assignment) => assignment.confidence)),
      low_confidence_count: assignments.filter((assignment) => assignment.confidence < .86).length,
      risk_level: representative.risk_level,
      customer_facing: inferred.some((bucket) => bucket.customer_facing),
      evidence: representative.evidence,
      examples: groupedTraces.slice(0, 3).map((trace) => ({
        trace_id: trace.id,
        prompt_preview: trace.prompt_text.slice(0, 140),
        response_preview: (trace.response_text ?? "").slice(0, 140),
      })),
    }];
  }).sort((left, right) => right.trace_count - left.trace_count);
  return normalizeAutomaticTaskGroupNames(buckets);
}

export function compactLLMGroupingRunNames(traces: Trace[], run: LLMGroupingRun) {
  const nameById = new Map(createTaskBucketsFromLLMGrouping(traces, run).map((bucket) => [bucket.bucket_id, bucket.bucket_name]));
  return {
    ...run,
    groups: run.groups.map((group) => ({ ...group, name: nameById.get(group.id) ?? group.name })),
  };
}

export type LLMGroupingComparisonCell = {
  existingBucketId: string;
  existingBucketName: string;
  llmGroupId: string;
  llmGroupName: string;
  count: number;
};

export type LLMGroupingComparison = {
  existingGroupSizes: number[];
  llmGroupSizes: number[];
  existingAssigned: number;
  llmAssigned: number;
  ambiguous: number;
  unassigned: number;
  cells: LLMGroupingComparisonCell[];
  splits: Array<{ existingBucketId: string; existingBucketName: string; groups: Array<{ groupId: string; groupName: string; count: number }> }>;
  merges: Array<{ groupId: string; groupName: string; buckets: Array<{ bucketId: string; bucketName: string; count: number }> }>;
  rows: Array<{
    traceId: string;
    existingBucketId: string | null;
    existingBucketName: string;
    llmGroupId: string | null;
    llmGroupName: string;
    status: LLMGroupingAssignmentStatus;
    confidence: number;
    rationale: string;
  }>;
};

const allowedMetadataFields = [
  "operation",
  "operation_name",
  "workflow_operation",
  "workflow_name",
  "step_name",
  "feature",
  "product_area",
  "request_type",
  "source_app",
  "available_tools",
] as const;

export const LLM_GROUPING_METADATA_FIELDS = [
  "workflow_id",
  "node_id",
  "parent_node_id",
  "workflow_role",
  "span_name",
  ...allowedMetadataFields,
];
const allowedWorkflowFields = new Set(LLM_GROUPING_METADATA_FIELDS);

export const LLM_GROUPING_EXCLUDED_FIELDS = [
  "response_text",
  "spans and tool outcomes",
  "feedback and judge scores",
  "model and provider",
  "latency, token counts, and cost",
  "signature_decision",
  "task_type, distinct_task_label, and inferred bucket fields",
];

const text = (value: unknown, limit = 6_000) => String(value ?? "").trim().slice(0, limit);
const stringList = (value: unknown) => Array.isArray(value) ? value.map((item) => text(item, 240)).filter(Boolean).slice(0, 40) : [];

function sanitizedMessages(trace: Trace) {
  const messages = (trace.messages ?? []).map((message) => ({ role: message.role, content: text(message.content) })).filter((message) => message.content);
  const response = text(trace.response_text);
  while (messages.length && messages[messages.length - 1]?.role === "assistant" && response && messages[messages.length - 1]?.content === response) messages.pop();
  return messages;
}

export function prepareLLMGroupingTrace(trace: Trace): LLMGroupingTraceInput {
  const requestContext = sanitizedMessages(trace);
  const latestRequest = text(trace.prompt_text) || [...requestContext].reverse().find((message) => message.role === "user")?.content || "";
  const workflowContext: Record<string, string | string[]> = {};
  const topLevel = {
    workflow_id: trace.workflow_id,
    node_id: trace.node_id,
    parent_node_id: trace.parent_node_id,
    workflow_role: trace.workflow_role,
    span_name: trace.span_name,
  };
  Object.entries(topLevel).forEach(([key, value]) => { if (value) workflowContext[key] = text(value, 240); });
  allowedMetadataFields.forEach((key) => {
    const value = trace.metadata?.[key];
    if (Array.isArray(value)) {
      const values = stringList(value);
      if (values.length) workflowContext[key] = values;
    } else if (["string", "number", "boolean"].includes(typeof value)) {
      const normalized = text(value, 240);
      if (normalized) workflowContext[key] = normalized;
    }
  });
  return { traceId: trace.id, latestRequest, requestContext, workflowContext };
}

export const prepareLLMGroupingInput = (traces: Trace[]) => traces.map(prepareLLMGroupingTrace);

const fnv = (value: string) => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export function createLLMGroupingInputSnapshot(inputs: LLMGroupingTraceInput[]) {
  const prepared = [...inputs].sort((left, right) => left.traceId.localeCompare(right.traceId));
  return {
    hash: `snapshot_${fnv(JSON.stringify(prepared))}`,
    traceIds: prepared.map((trace) => trace.traceId),
    totalTraces: prepared.length,
  };
}

export const createLLMGroupingSnapshot = (traces: Trace[]) => createLLMGroupingInputSnapshot(prepareLLMGroupingInput(traces));

export const stableLLMGroupId = (group: Pick<LLMTaskGroup, "name" | "description" | "inclusionCriteria" | "exclusionCriteria">) =>
  `llm_${fnv(JSON.stringify([group.name.trim().toLowerCase(), group.description.trim().toLowerCase(), group.inclusionCriteria, group.exclusionCriteria]))}`;

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finiteUnit = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

export function validateLLMGroupingTraceInputs(inputs: unknown): string[] {
  if (!Array.isArray(inputs) || inputs.length === 0) return ["At least one prepared trace is required."];
  const errors: string[] = [];
  const seen = new Set<string>();
  inputs.forEach((input, index) => {
    if (!object(input)) return errors.push(`Trace input ${index + 1} is not an object.`);
    Object.keys(input).forEach((field) => {
      if (!["traceId", "latestRequest", "requestContext", "workflowContext"].includes(field)) errors.push(`Trace input ${index + 1} includes unsupported field ${field}.`);
    });
    const traceId = typeof input.traceId === "string" ? input.traceId : "";
    if (!traceId) errors.push(`Trace input ${index + 1} is missing traceId.`);
    else if (seen.has(traceId)) errors.push(`Duplicate trace input: ${traceId}.`);
    else seen.add(traceId);
    if (typeof input.latestRequest !== "string") errors.push(`Trace ${traceId || index + 1} is missing latestRequest.`);
    if (!Array.isArray(input.requestContext)) errors.push(`Trace ${traceId || index + 1} has invalid requestContext.`);
    else input.requestContext.forEach((message, messageIndex) => {
      if (!object(message) || typeof message.content !== "string" || !["system", "user", "assistant", "tool"].includes(String(message.role))) errors.push(`Trace ${traceId || index + 1} has invalid requestContext message ${messageIndex + 1}.`);
      else Object.keys(message).forEach((field) => { if (!["role", "content"].includes(field)) errors.push(`Trace ${traceId || index + 1} requestContext message ${messageIndex + 1} includes unsupported field ${field}.`); });
    });
    if (!object(input.workflowContext)) errors.push(`Trace ${traceId || index + 1} has invalid workflowContext.`);
    else Object.entries(input.workflowContext).forEach(([field, value]) => {
      if (!allowedWorkflowFields.has(field)) errors.push(`Trace ${traceId || index + 1} includes unsupported workflow field ${field}.`);
      if (typeof value !== "string" && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) errors.push(`Trace ${traceId || index + 1} has invalid workflow field ${field}.`);
    });
    const forbidden = ["response_text", "model", "provider", "cost_usd", "latency_ms", "signature_decision", "task_type", "distinct_task_label"];
    forbidden.forEach((field) => { if (field in input) errors.push(`Trace ${traceId || index + 1} includes forbidden field ${field}.`); });
  });
  return errors;
}

export function validateLLMGroupingRun(value: unknown, expectedTraceIds?: string[]): string[] {
  if (!object(value)) return ["Grouping run is not an object."];
  const errors: string[] = [];
  if (value.schemaVersion !== LLM_GROUPING_SCHEMA_VERSION) errors.push("Grouping run has an unsupported schema version.");
  if (typeof value.runId !== "string" || !value.runId) errors.push("Grouping run is missing runId.");
  if (value.provider !== "OpenRouter") errors.push("Grouping run has an unsupported provider.");
  if (typeof value.model !== "string" || !value.model) errors.push("Grouping run is missing model metadata.");
  if (typeof value.promptVersion !== "string" || !value.promptVersion) errors.push("Grouping run is missing prompt version metadata.");
  if (typeof value.startedAt !== "string" || !value.startedAt || typeof value.completedAt !== "string" || !value.completedAt) errors.push("Grouping run is missing timing metadata.");
  if (!object(value.snapshot) || typeof value.snapshot.hash !== "string" || !Array.isArray(value.snapshot.traceIds) || typeof value.snapshot.totalTraces !== "number") errors.push("Grouping run has an invalid snapshot.");
  if (!object(value.method) || !Array.isArray(value.method.metadataFieldsUsed) || !Array.isArray(value.method.excludedFields)) errors.push("Grouping run has invalid method metadata.");
  if (!object(value.coverage)) errors.push("Grouping run has invalid coverage metadata.");
  if (!Array.isArray(value.groups)) errors.push("Grouping run groups are missing.");
  if (!Array.isArray(value.assignments)) errors.push("Grouping run assignments are missing.");
  if (errors.length) return errors;

  const groups = value.groups as unknown[];
  const assignments = value.assignments as unknown[];
  const groupIds = new Set<string>();
  const assignmentByTrace = new Map<string, Record<string, unknown>>();
  groups.forEach((group, index) => {
    if (!object(group)) return errors.push(`Group ${index + 1} is not an object.`);
    const id = typeof group.id === "string" ? group.id : "";
    if (!id) errors.push(`Group ${index + 1} is missing an ID.`);
    else if (groupIds.has(id)) errors.push(`Duplicate group ID: ${id}.`);
    else groupIds.add(id);
    ["name", "description", "routingRationale"].forEach((field) => { if (typeof group[field] !== "string" || !group[field]) errors.push(`Group ${id || index + 1} is missing ${field}.`); });
    ["inclusionCriteria", "exclusionCriteria", "representativeTraceIds", "confusingCounterexamples", "nearestNeighbors", "suggestedEvaluationDimensions"].forEach((field) => {
      if (!Array.isArray(group[field])) errors.push(`Group ${id || index + 1} has invalid ${field}.`);
    });
    if (!object(group.attributes) || ["modality", "grounding", "expectedOutput", "reasoningRequirements"].some((field) => !Array.isArray((group.attributes as Record<string, unknown>)[field]))) errors.push(`Group ${id || index + 1} has invalid attributes.`);
  });
  assignments.forEach((assignment, index) => {
    if (!object(assignment)) return errors.push(`Assignment ${index + 1} is not an object.`);
    const traceId = typeof assignment.traceId === "string" ? assignment.traceId : "";
    if (!traceId) errors.push(`Assignment ${index + 1} is missing traceId.`);
    else if (assignmentByTrace.has(traceId)) errors.push(`Duplicate assignment for trace ${traceId}.`);
    else assignmentByTrace.set(traceId, assignment);
    const status = assignment.status;
    if (!(["assigned", "ambiguous", "unassigned"] as unknown[]).includes(status)) errors.push(`Trace ${traceId || index + 1} has invalid assignment status.`);
    const groupId = assignment.groupId;
    if (status === "assigned" && (typeof groupId !== "string" || !groupIds.has(groupId))) errors.push(`Trace ${traceId || index + 1} references an invalid assigned group.`);
    if (status !== "assigned" && groupId !== null) errors.push(`Trace ${traceId || index + 1} must not force a primary group when ${String(status)}.`);
    if (!finiteUnit(assignment.confidence)) errors.push(`Trace ${traceId || index + 1} has invalid confidence.`);
    if (typeof assignment.rationale !== "string" || !assignment.rationale) errors.push(`Trace ${traceId || index + 1} is missing assignment rationale.`);
    if (!Array.isArray(assignment.alternateGroupIds) || assignment.alternateGroupIds.some((id) => typeof id !== "string" || !groupIds.has(id))) errors.push(`Trace ${traceId || index + 1} has invalid alternate groups.`);
  });

  const expected = new Set(expectedTraceIds ?? (object(value.snapshot) && Array.isArray(value.snapshot.traceIds) ? value.snapshot.traceIds.filter((id): id is string => typeof id === "string") : []));
  if (object(value.snapshot)) {
    const traceIds = Array.isArray(value.snapshot.traceIds) ? value.snapshot.traceIds.filter((id): id is string => typeof id === "string") : [];
    if (traceIds.length !== expected.size) errors.push("Grouping snapshot contains duplicate or invalid trace IDs.");
    if (value.snapshot.totalTraces !== traceIds.length) errors.push("Grouping snapshot total does not match its trace IDs.");
  }
  expected.forEach((traceId) => { if (!assignmentByTrace.has(traceId)) errors.push(`Missing assignment for trace ${traceId}.`); });
  assignmentByTrace.forEach((_, traceId) => { if (expected.size && !expected.has(traceId)) errors.push(`Assignment references nonexistent trace ${traceId}.`); });
  groups.forEach((group) => {
    if (!object(group)) return;
    const id = String(group.id ?? "unknown");
    const representativeIds = Array.isArray(group.representativeTraceIds) ? group.representativeTraceIds : [];
    representativeIds.forEach((traceId) => {
      if (typeof traceId !== "string" || !expected.has(traceId)) errors.push(`Group ${id} representative references nonexistent trace ${String(traceId)}.`);
      else if (assignmentByTrace.get(traceId)?.groupId !== id) errors.push(`Group ${id} representative ${traceId} is assigned elsewhere.`);
    });
    const counterexamples = Array.isArray(group.confusingCounterexamples) ? group.confusingCounterexamples : [];
    counterexamples.forEach((counterexample) => {
      if (!object(counterexample) || typeof counterexample.traceId !== "string" || !expected.has(counterexample.traceId)) errors.push(`Group ${id} has an invalid counterexample reference.`);
      else if (assignmentByTrace.get(counterexample.traceId)?.groupId === id) errors.push(`Group ${id} counterexample ${counterexample.traceId} belongs to the same group.`);
    });
  });
  if (object(value.coverage)) {
    const assigned = assignments.filter((assignment) => object(assignment) && assignment.status === "assigned").length;
    const ambiguous = assignments.filter((assignment) => object(assignment) && assignment.status === "ambiguous").length;
    const unassigned = assignments.filter((assignment) => object(assignment) && assignment.status === "unassigned").length;
    if (value.coverage.assigned !== assigned || value.coverage.ambiguous !== ambiguous || value.coverage.unassigned !== unassigned || value.coverage.processed !== assignments.length || value.coverage.total !== expected.size) errors.push("Grouping run coverage does not match its assignments.");
  }
  return [...new Set(errors)];
}

export function parseLLMGroupingRun(value: unknown): LLMGroupingRun {
  const expectedTraceIds = object(value) && object(value.snapshot) && Array.isArray(value.snapshot.traceIds)
    ? value.snapshot.traceIds.filter((id): id is string => typeof id === "string")
    : [];
  const errors = validateLLMGroupingRun(value, expectedTraceIds);
  if (errors.length) throw new Error(`Invalid persisted LLM grouping run: ${errors.join(" ")}`);
  return value as LLMGroupingRun;
}

export const isLLMGroupingRunOutdated = (run: LLMGroupingRun, traces: Trace[]) => run.snapshot.hash !== createLLMGroupingSnapshot(traces).hash;

export function compareLLMGrouping(existingBuckets: DistinctTaskBucket[], run: LLMGroupingRun): LLMGroupingComparison {
  const existingByTrace = new Map<string, DistinctTaskBucket>();
  existingBuckets.forEach((bucket) => bucket.traces.forEach((traceId) => existingByTrace.set(traceId, bucket)));
  const llmById = new Map(run.groups.map((group) => [group.id, group]));
  const counts = new Map<string, number>();
  const rows = run.assignments.map((assignment) => {
    const existing = existingByTrace.get(assignment.traceId);
    const group = assignment.groupId ? llmById.get(assignment.groupId) : undefined;
    if (existing && group) counts.set(`${existing.bucket_id}|${group.id}`, (counts.get(`${existing.bucket_id}|${group.id}`) ?? 0) + 1);
    return {
      traceId: assignment.traceId,
      existingBucketId: existing?.bucket_id ?? null,
      existingBucketName: existing?.bucket_name ?? "No existing bucket",
      llmGroupId: group?.id ?? null,
      llmGroupName: group?.name ?? (assignment.status === "ambiguous" ? "Ambiguous" : "Unassigned"),
      status: assignment.status,
      confidence: assignment.confidence,
      rationale: assignment.rationale,
    };
  });
  const cells = [...counts.entries()].map(([key, count]) => {
    const [existingBucketId, llmGroupId] = key.split("|");
    const existing = existingBuckets.find((bucket) => bucket.bucket_id === existingBucketId)!;
    const group = llmById.get(llmGroupId)!;
    return { existingBucketId, existingBucketName: existing.bucket_name, llmGroupId, llmGroupName: group.name, count };
  }).sort((left, right) => right.count - left.count);
  const splits = existingBuckets.flatMap((bucket) => {
    const groups = cells.filter((cell) => cell.existingBucketId === bucket.bucket_id).map((cell) => ({ groupId: cell.llmGroupId, groupName: cell.llmGroupName, count: cell.count }));
    return groups.length > 1 ? [{ existingBucketId: bucket.bucket_id, existingBucketName: bucket.bucket_name, groups }] : [];
  });
  const merges = run.groups.flatMap((group) => {
    const buckets = cells.filter((cell) => cell.llmGroupId === group.id).map((cell) => ({ bucketId: cell.existingBucketId, bucketName: cell.existingBucketName, count: cell.count }));
    return buckets.length > 1 ? [{ groupId: group.id, groupName: group.name, buckets }] : [];
  });
  return {
    existingGroupSizes: existingBuckets.map((bucket) => bucket.trace_count).sort((a, b) => b - a),
    llmGroupSizes: run.groups.map((group) => run.assignments.filter((assignment) => assignment.groupId === group.id).length).sort((a, b) => b - a),
    existingAssigned: existingByTrace.size,
    llmAssigned: run.coverage.assigned,
    ambiguous: run.coverage.ambiguous,
    unassigned: run.coverage.unassigned,
    cells,
    splits,
    merges,
    rows,
  };
}
