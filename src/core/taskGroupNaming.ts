import type { DistinctTaskBucket } from "../types";
import { resolveAutomaticTaskGroupNames, type TaskGroupNamingFactors } from "./taskGroupDisplayNames";

export type TaskGroupNamingInput = {
  bucketId: string;
  fallbackName: string;
  traceCount: number;
  factors: {
    taskType: string;
    domain: string;
    complexity: string;
    temporalContext: string;
    toolUse: string;
    outputUncertainty: string;
    outputFormat: string;
    riskLevel?: string;
    customerFacing?: boolean;
  };
  representativeRequests: string[];
};

export type TaskGroupName = { bucketId: string; name: string };

export function prepareTaskGroupNamingInput(groups: DistinctTaskBucket[]): TaskGroupNamingInput[] {
  return groups.map((group) => ({
    bucketId: group.bucket_id,
    fallbackName: group.bucket_name,
    traceCount: group.trace_count,
    factors: {
      taskType: group.task.task_type,
      domain: group.task.domain,
      complexity: group.task.complexity,
      temporalContext: group.task.temporal_context,
      toolUse: group.task.tool_use,
      outputUncertainty: group.task.output_uncertainty,
      outputFormat: group.task.output_format,
      riskLevel: group.risk_level,
      customerFacing: group.customer_facing,
    },
    representativeRequests: group.examples.slice(0, 3).map((example) => example.prompt_preview.slice(0, 500)),
  }));
}

export function validateTaskGroupNames(inputs: TaskGroupNamingInput[], names: TaskGroupName[]) {
  const expected = new Set(inputs.map((input) => input.bucketId));
  const received = new Set(names.map((item) => item.bucketId));
  if (received.size !== names.length) throw new Error("The naming model returned duplicate task group IDs.");
  if (expected.size !== received.size || [...expected].some((id) => !received.has(id))) {
    throw new Error("The naming model did not return exactly one name for every task group.");
  }
  names.forEach((item) => {
    const wordCount = item.name.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 2 || wordCount > 6 || item.name.trim().length > 64 || /[,;:|/\\[\]{}]/.test(item.name) || item.name.includes("_")) {
      throw new Error("Task group names must be plain, concise phrases between 2 and 6 words.");
    }
  });
  const inputById = new Map(inputs.map((input) => [input.bucketId, input]));
  return resolveAutomaticTaskGroupNames(names.map((item) => {
    const input = inputById.get(item.bucketId)!;
    return {
      id: item.bucketId,
      name: item.name,
      factors: {
        task_type: input.factors.taskType,
        domain: input.factors.domain,
        complexity: input.factors.complexity,
        temporal_context: input.factors.temporalContext,
        tool_use: input.factors.toolUse,
        output_format: input.factors.outputFormat,
        risk_level: input.factors.riskLevel,
        customer_facing: input.factors.customerFacing,
      } as TaskGroupNamingFactors,
    };
  })).map((item) => ({ bucketId: item.id, name: item.name }));
}

export function applyTaskGroupNames(groups: DistinctTaskBucket[], names: TaskGroupName[]) {
  const validNames = validateTaskGroupNames(prepareTaskGroupNamingInput(groups), names);
  const nameById = new Map(validNames.map((item) => [item.bucketId, item.name]));
  return groups.map((group) => ({ ...group, bucket_name: nameById.get(group.bucket_id)!, name_source: "llm" as const }));
}

async function responseError(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown };
  return new Error(typeof payload.error === "string" ? payload.error : "Task group naming failed.");
}

export async function nameTaskGroups(groups: DistinctTaskBucket[], signal?: AbortSignal) {
  const response = await fetch("/api/task-group-names", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groups: prepareTaskGroupNamingInput(groups) }),
    signal,
  });
  if (!response.ok) throw await responseError(response);
  const payload = await response.json() as { names?: TaskGroupName[] };
  if (!Array.isArray(payload.names)) throw new Error("The naming model returned no task group names.");
  return applyTaskGroupNames(groups, payload.names);
}
