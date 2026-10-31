import type { DistinctTaskBucket, KnownTaskSignature, Trace, TraceSignatureDecision } from "../types.js";

type ClassifierValidationExample = {
  id: string;
  promptPreview: string;
  reviewedSignatureId: string;
  predictedSignatureId: string;
  confidence: number;
  accepted: boolean;
  usesOnlyPreInferenceInformation: boolean;
};

export type HumanAssignmentOutcome = "task_group" | "unknown" | "ambiguous" | "needs_new_group";

export type AssignmentValidationLabel = {
  traceId: string;
  outcome: HumanAssignmentOutcome;
  signatureId: string | null;
  rationale: string | null;
  reviewedAt: string;
};

export type ComparatorAssignment = {
  traceId: string;
  signatureId: string;
  confidence: number;
  model: string;
  rationale?: string;
};

export type AssignmentValidationWorkflow = {
  version: 1;
  sampleSize: number;
  sampleTraceIds: string[];
  createdAt: string;
  updatedAt: string;
  labels: AssignmentValidationLabel[];
  jevAssignments: ComparatorAssignment[];
  llmAssignments: ComparatorAssignment[];
};

const hash = (value: string) => {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

export function taskGroupSignatures(taskGroups: DistinctTaskBucket[]): KnownTaskSignature[] {
  return taskGroups.map((group) => ({
    id: group.bucket_id,
    label: group.bucket_name,
    risk_level: group.risk_level,
    description: [
      group.bucket_name,
      group.examples[0]?.prompt_preview ? `Representative request: ${group.examples[0].prompt_preview}` : "",
    ].filter(Boolean).join(". "),
  }));
}

export function buildAssignmentValidationSample(
  traces: Trace[],
  taskGroups: DistinctTaskBucket[],
  requestedSize: number,
  excludedTraceIds: string[] = [],
) {
  const size = Math.min(traces.length, Math.max(1, Math.round(requestedSize)));
  const excluded = new Set(excludedTraceIds);
  const traceById = new Map(traces.map((trace) => [trace.id, trace]));
  const groups = taskGroups
    .map((group) => group.traces.map((id) => traceById.get(id)).filter((trace): trace is Trace => Boolean(trace)))
    .filter((group) => group.length)
    .map((group) => group.filter((trace) => !excluded.has(trace.id)).sort((left, right) => hash(left.id) - hash(right.id)));
  const ungrouped = traces
    .filter((trace) => !excluded.has(trace.id) && !taskGroups.some((group) => group.traces.includes(trace.id)))
    .sort((left, right) => hash(left.id) - hash(right.id));
  if (ungrouped.length) groups.push(ungrouped);

  const selected: Trace[] = [];
  while (selected.length < size && groups.some((group) => group.length)) {
    for (const group of groups) {
      const trace = group.shift();
      if (trace) selected.push(trace);
      if (selected.length >= size) break;
    }
  }
  return selected;
}

export function emptyAssignmentValidationWorkflow(
  traces: Trace[],
  taskGroups: DistinctTaskBucket[],
  sampleSize = 50,
  now = new Date().toISOString(),
): AssignmentValidationWorkflow {
  const sample = buildAssignmentValidationSample(traces, taskGroups, sampleSize);
  return {
    version: 1,
    sampleSize: sample.length,
    sampleTraceIds: sample.map((trace) => trace.id),
    createdAt: now,
    updatedAt: now,
    labels: [],
    jevAssignments: [],
    llmAssignments: [],
  };
}

export function reviewedSignatureId(label: AssignmentValidationLabel) {
  return label.outcome === "task_group" && label.signatureId ? label.signatureId : "unknown";
}

export function decisionAssignments(decisions: Array<{ trace_id: string; decision: TraceSignatureDecision }>): ComparatorAssignment[] {
  return decisions.map(({ trace_id, decision }) => ({
    traceId: trace_id,
    signatureId: decision.signature_id,
    confidence: decision.confidence,
    model: decision.model,
    rationale: decision.reason,
  }));
}

export function classifierExamplesFromAssignments(
  workflow: AssignmentValidationWorkflow,
  traces: Trace[],
  assignments: ComparatorAssignment[],
  thresholds: Record<string, number> = {},
): ClassifierValidationExample[] {
  const traceById = new Map(traces.map((trace) => [trace.id, trace]));
  const assignmentByTrace = new Map(assignments.map((assignment) => [assignment.traceId, assignment]));
  return workflow.labels.flatMap((label) => {
    const assignment = assignmentByTrace.get(label.traceId);
    if (!assignment) return [];
    const threshold = thresholds[assignment.signatureId] ?? 0;
    return [{
      id: label.traceId,
      promptPreview: traceById.get(label.traceId)?.prompt_text ?? label.traceId,
      reviewedSignatureId: reviewedSignatureId(label),
      predictedSignatureId: assignment.signatureId,
      confidence: assignment.confidence,
      accepted: assignment.signatureId !== "unknown" && assignment.confidence >= threshold,
      usesOnlyPreInferenceInformation: true,
    }];
  });
}

export function appendAssignmentValidationSample(
  workflow: AssignmentValidationWorkflow,
  traces: Trace[],
  taskGroups: DistinctTaskBucket[],
  count: number,
  now = new Date().toISOString(),
): AssignmentValidationWorkflow {
  const additions = buildAssignmentValidationSample(traces, taskGroups, count, workflow.sampleTraceIds);
  return {
    ...workflow,
    sampleSize: workflow.sampleTraceIds.length + additions.length,
    sampleTraceIds: [...workflow.sampleTraceIds, ...additions.map((trace) => trace.id)],
    updatedAt: now,
  };
}

export function isAssignmentValidationWorkflow(value: unknown): value is AssignmentValidationWorkflow {
  if (!value || typeof value !== "object") return false;
  const workflow = value as Partial<AssignmentValidationWorkflow>;
  return workflow.version === 1
    && Number.isFinite(workflow.sampleSize)
    && Array.isArray(workflow.sampleTraceIds)
    && Array.isArray(workflow.labels)
    && Array.isArray(workflow.jevAssignments)
    && Array.isArray(workflow.llmAssignments);
}
