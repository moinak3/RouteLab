import { normalizeAssignmentValidationWorkflow, type AssignmentValidationWorkflow } from "./assignmentValidation";

const STORAGE_PREFIX = "routelab-assignment-validation:";

const storage = () => typeof window === "undefined" ? null : window.localStorage;

export function loadLocalAssignmentValidation(workspaceId: string) {
  try {
    const parsed = JSON.parse(storage()?.getItem(`${STORAGE_PREFIX}${workspaceId}`) ?? "null");
    return normalizeAssignmentValidationWorkflow(parsed);
  } catch {
    return null;
  }
}

export function saveLocalAssignmentValidation(workspaceId: string, workflow: AssignmentValidationWorkflow) {
  storage()?.setItem(`${STORAGE_PREFIX}${workspaceId}`, JSON.stringify(workflow));
}

const endpoint = (workspaceId: string) => `/api/classifier-validation?workspace=${encodeURIComponent(workspaceId)}`;

async function payload<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Classifier validation persistence failed.");
  return body;
}

export async function fetchAssignmentValidation(workspaceId: string, signal?: AbortSignal) {
  const result = await payload<{ workflow: AssignmentValidationWorkflow | null }>(await fetch(endpoint(workspaceId), {
    headers: { Accept: "application/json" }, cache: "no-store", signal,
  }));
  return normalizeAssignmentValidationWorkflow(result.workflow);
}

export async function persistAssignmentValidation(workspaceId: string, workflow: AssignmentValidationWorkflow) {
  const result = await payload<{ workflow: AssignmentValidationWorkflow }>(await fetch(endpoint(workspaceId), {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ workflow }),
  }));
  const normalized = normalizeAssignmentValidationWorkflow(result.workflow);
  if (!normalized) throw new Error("Classifier validation storage returned an invalid workflow.");
  return normalized;
}

export async function runStrongClassifierComparator(
  workspaceId: string,
  traces: unknown[],
  signatures: unknown[],
) {
  return payload<{ assignments: Array<{ traceId: string; signatureId: string; confidence: number; model: string; rationale?: string }>; model: string }>(await fetch(`/api/classifier-comparator?workspace=${encodeURIComponent(workspaceId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ traces, signatures }),
  }));
}
