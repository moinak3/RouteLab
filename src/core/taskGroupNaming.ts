import type { DistinctTaskBucket } from "../types";

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
  const normalizedNames = names.map((item) => item.name.trim().toLocaleLowerCase());
  if (new Set(normalizedNames).size !== normalizedNames.length) throw new Error("The naming model returned duplicate task group names.");
  names.forEach((item) => {
    const wordCount = item.name.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 2 || wordCount > 6 || item.name.trim().length > 64) {
      throw new Error("Task group names must be concise phrases between 2 and 6 words.");
    }
  });
  return names.map((item) => ({ bucketId: item.bucketId, name: item.name.trim() }));
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
