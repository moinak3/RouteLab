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

export type AssignmentValidationLane = "initial_blind" | "weekly_blind" | "weekly_targeted";
export type AssignmentValidationRoundKind = "initial" | "weekly";

export type ComparatorAssignment = {
  traceId: string;
  signatureId: string;
  confidence: number;
  model: string;
  rationale?: string;
};

export type AssignmentValidationRound = {
  roundId: string;
  roundKind: AssignmentValidationRoundKind;
  weekOf: string | null;
  catalogVersion: string;
  sampleSize: number;
  sampleTraceIds: string[];
  laneByTraceId: Record<string, AssignmentValidationLane>;
  createdAt: string;
  updatedAt: string;
  labels: AssignmentValidationLabel[];
  jevAssignments: ComparatorAssignment[];
  llmAssignments: ComparatorAssignment[];
};

export type AssignmentValidationWorkflow = AssignmentValidationRound & {
  version: 2;
  weeklyBudget: number;
  history: AssignmentValidationRound[];
};

type LegacyAssignmentValidationWorkflow = Omit<AssignmentValidationWorkflow, "version" | "weeklyBudget" | "history" | "roundId" | "roundKind" | "weekOf" | "catalogVersion" | "laneByTraceId"> & {
  version: 1;
};

const hash = (value: string) => {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

const weekStart = (value: string) => {
  const date = new Date(value);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - day);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
};

function catalogVersion(taskGroups: DistinctTaskBucket[]) {
  const fingerprint = taskGroups
    .map((group) => `${group.bucket_id}:${group.bucket_name}`)
    .sort()
    .join("|");
  return `catalog-${taskGroups.length}-${hash(fingerprint).toString(36)}`;
}

function roundId(kind: AssignmentValidationRoundKind, now: string) {
  return `${kind}-${now.replace(/[^0-9]/g, "").slice(0, 14)}`;
}

function traceAssignment(trace: Trace): ComparatorAssignment | null {
  const decision = trace.signature_decision;
  if (!decision) return null;
  return {
    traceId: trace.id,
    signatureId: decision.signature_id,
    confidence: decision.confidence,
    model: decision.model,
    rationale: decision.reason,
  };
}

export function taskGroupSignatures(taskGroups: DistinctTaskBucket[]): KnownTaskSignature[] {
  return taskGroups.map((group) => ({
    id: group.bucket_id,
    label: group.bucket_name,
    risk_level: group.risk_level,
    description: [
      `Outcome: ${group.bucket_name}`,
      `Task type: ${group.task.task_type.replaceAll("_", " ")}`,
      `Domain: ${group.task.domain.replaceAll("_", " ")}`,
      group.task.tool_use !== "none" ? `Tool pattern: ${group.task.tool_use.replaceAll("_", " ")}` : "",
      ...group.examples.slice(0, 3).map((example, index) => `Representative request ${index + 1}: ${example.prompt_preview}`),
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
  sampleSize = 20,
  now = new Date().toISOString(),
): AssignmentValidationWorkflow {
  const sample = buildAssignmentValidationSample(traces, taskGroups, sampleSize);
  const lanes = Object.fromEntries(sample.map((trace) => [trace.id, "initial_blind" as const]));
  return {
    version: 2,
    roundId: roundId("initial", now),
    roundKind: "initial",
    weekOf: null,
    catalogVersion: catalogVersion(taskGroups),
    sampleSize: sample.length,
    sampleTraceIds: sample.map((trace) => trace.id),
    laneByTraceId: lanes,
    createdAt: now,
    updatedAt: now,
    labels: [],
    jevAssignments: [],
    llmAssignments: [],
    weeklyBudget: 20,
    history: [],
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
  workflow: Pick<AssignmentValidationRound, "labels">,
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

function archivedRound(workflow: AssignmentValidationWorkflow): AssignmentValidationRound {
  const { version: _version, weeklyBudget: _weeklyBudget, history: _history, ...round } = workflow;
  return round;
}

function targetPriority(trace: Trace, taskGroups: DistinctTaskBucket[]) {
  const decision = trace.signature_decision;
  const group = taskGroups.find((item) => item.traces.includes(trace.id));
  let score = group ? 0 : 75;
  if (!decision) return score + 40;
  if (["unknown", "timeout", "error", "provider_unavailable"].includes(decision.status)) score += 100;
  if (decision.status === "low_confidence") score += 85;
  if (decision.runner_up && decision.confidence - decision.runner_up.confidence < .1) score += 65;
  if (group?.risk_level === "high") score += 35;
  score += Math.round((1 - decision.confidence) * 30);
  return score;
}

export function createWeeklyAssignmentValidationRound(
  workflow: AssignmentValidationWorkflow,
  traces: Trace[],
  taskGroups: DistinctTaskBucket[],
  budget: number,
  now = new Date().toISOString(),
): AssignmentValidationWorkflow {
  const normalizedBudget = Math.max(2, Math.min(traces.length, Math.round(budget)));
  const excluded = new Set([
    ...workflow.sampleTraceIds,
    ...workflow.history.flatMap((round) => round.sampleTraceIds),
  ]);
  const available = traces.filter((trace) => !excluded.has(trace.id));
  const targetedTarget = Math.floor(normalizedBudget * .4);
  const targeted = [...available]
    .sort((left, right) => targetPriority(right, taskGroups) - targetPriority(left, taskGroups) || hash(left.id) - hash(right.id))
    .slice(0, targetedTarget);
  const targetedIds = new Set(targeted.map((trace) => trace.id));
  const blind = buildAssignmentValidationSample(
    available.filter((trace) => !targetedIds.has(trace.id)),
    taskGroups,
    normalizedBudget - targeted.length,
  );
  const sample = [...blind, ...targeted];
  const lanes: Record<string, AssignmentValidationLane> = Object.fromEntries([
    ...blind.map((trace) => [trace.id, "weekly_blind" as const]),
    ...targeted.map((trace) => [trace.id, "weekly_targeted" as const]),
  ]);
  const productionAssignments = sample.flatMap((trace) => {
    const assignment = traceAssignment(trace);
    return assignment ? [assignment] : [];
  });
  const archived = archivedRound(workflow);
  return {
    version: 2,
    roundId: roundId("weekly", now),
    roundKind: "weekly",
    weekOf: weekStart(now),
    catalogVersion: catalogVersion(taskGroups),
    sampleSize: sample.length,
    sampleTraceIds: sample.map((trace) => trace.id),
    laneByTraceId: lanes,
    createdAt: now,
    updatedAt: now,
    labels: [],
    jevAssignments: productionAssignments,
    llmAssignments: [],
    weeklyBudget: normalizedBudget,
    history: [...workflow.history.filter((round) => round.roundId !== archived.roundId), archived],
  };
}

export function normalizeAssignmentValidationWorkflow(value: unknown): AssignmentValidationWorkflow | null {
  if (!value || typeof value !== "object") return null;
  const workflow = value as Record<string, unknown>;
  const sharedIsValid = Number.isFinite(workflow.sampleSize)
    && Array.isArray(workflow.sampleTraceIds)
    && Array.isArray(workflow.labels)
    && Array.isArray(workflow.jevAssignments)
    && Array.isArray(workflow.llmAssignments)
    && typeof workflow.createdAt === "string"
    && typeof workflow.updatedAt === "string";
  if (!sharedIsValid) return null;
  if (workflow.version === 2) {
    const roundKind = workflow.roundKind === "weekly" ? "weekly" : "initial";
    const createdAt = typeof workflow.createdAt === "string" ? workflow.createdAt : new Date(0).toISOString();
    const sampleTraceIds = workflow.sampleTraceIds as string[];
    return {
      ...(workflow as AssignmentValidationWorkflow),
      roundId: typeof workflow.roundId === "string" ? workflow.roundId : roundId(roundKind, createdAt),
      roundKind,
      weekOf: typeof workflow.weekOf === "string" ? workflow.weekOf : null,
      catalogVersion: typeof workflow.catalogVersion === "string" ? workflow.catalogVersion : "legacy-catalog",
      weeklyBudget: Number.isFinite(workflow.weeklyBudget) ? Number(workflow.weeklyBudget) : 20,
      history: Array.isArray(workflow.history) ? workflow.history as AssignmentValidationRound[] : [],
      laneByTraceId: workflow.laneByTraceId && typeof workflow.laneByTraceId === "object"
        ? workflow.laneByTraceId as Record<string, AssignmentValidationLane>
        : Object.fromEntries(sampleTraceIds.map((id) => [id, roundKind === "weekly" ? "weekly_blind" : "initial_blind"])),
    };
  }
  if (workflow.version !== 1) return null;
  const legacy = workflow as unknown as LegacyAssignmentValidationWorkflow;
  return {
    ...legacy,
    version: 2,
    roundId: `initial-${legacy.createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`,
    roundKind: "initial",
    weekOf: null,
    catalogVersion: "legacy-catalog",
    laneByTraceId: Object.fromEntries(legacy.sampleTraceIds.map((id) => [id, "initial_blind"])),
    weeklyBudget: 20,
    history: [],
  };
}

export function isAssignmentValidationWorkflow(value: unknown): value is AssignmentValidationWorkflow {
  return normalizeAssignmentValidationWorkflow(value) !== null;
}
