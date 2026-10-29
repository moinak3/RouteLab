import type { DistinctTaskBucket, GoldenDataset, Trace, TraceJudgeResult } from "../types";
import { normalizeAutomaticTaskGroupNames } from "./taskGroupDisplayNames";

export type WorkspaceId = "personal" | "demo";
export type TaskGroupingMethod = "rules" | "llm";

export type WorkspaceData = {
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  goldenDatasets: GoldenDataset[];
  taskGroups: DistinctTaskBucket[];
  taskGroupingMethod?: TaskGroupingMethod;
};

const ACTIVE_WORKSPACE_KEY = "routelab-active-workspace-v1";
const PERSONAL_WORKSPACE_KEY = "routelab-personal-workspace-v1";
const PERSONAL_CLOUD_WORKSPACE_KEY = "routelab-personal-cloud-workspace-v1";
let inMemoryPersonalCloudWorkspaceId: string | null = null;

export const emptyPersonalWorkspace = (): WorkspaceData => ({ traces: [], traceJudgeResults: [], goldenDatasets: [], taskGroups: [] });

export function inferTaskGroupingMethod(taskGroups: DistinctTaskBucket[]): TaskGroupingMethod | undefined {
  if (!taskGroups.length) return undefined;
  return taskGroups.every((group) => group.bucket_id.startsWith("llm_")) ? "llm" : "rules";
}

export function replaceWorkspaceTraces(workspace: WorkspaceData, traces: Trace[]): WorkspaceData {
  return { ...workspace, traces, traceJudgeResults: [], taskGroups: [], taskGroupingMethod: undefined };
}

export function clearWorkspaceTraces(workspace: WorkspaceData): WorkspaceData {
  return replaceWorkspaceTraces(workspace, []);
}

export function loadActiveWorkspace(): WorkspaceId {
  try {
    return window.localStorage.getItem(ACTIVE_WORKSPACE_KEY) === "demo" ? "demo" : "personal";
  } catch {
    return "personal";
  }
}

export function saveActiveWorkspace(workspace: WorkspaceId) {
  try {
    window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspace);
  } catch {
    // Privacy-restricted browsers can disable local storage.
  }
}

function createPersonalCloudWorkspaceId() {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `personal_${suffix}`;
}

export function loadCloudWorkspaceId(workspace: WorkspaceId) {
  if (workspace === "demo") return "demo";
  try {
    const existing = window.localStorage.getItem(PERSONAL_CLOUD_WORKSPACE_KEY);
    if (existing) return existing;
    const created = createPersonalCloudWorkspaceId();
    window.localStorage.setItem(PERSONAL_CLOUD_WORKSPACE_KEY, created);
    return created;
  } catch {
    inMemoryPersonalCloudWorkspaceId ??= createPersonalCloudWorkspaceId();
    return inMemoryPersonalCloudWorkspaceId;
  }
}

export function loadPersonalWorkspace(): WorkspaceData {
  try {
    const raw = window.localStorage.getItem(PERSONAL_WORKSPACE_KEY);
    if (!raw) return emptyPersonalWorkspace();
    const parsed = JSON.parse(raw) as Partial<WorkspaceData>;
    const taskGroups = normalizeAutomaticTaskGroupNames(Array.isArray(parsed.taskGroups) ? parsed.taskGroups : []);
    const taskGroupingMethod = parsed.taskGroupingMethod === "rules" || parsed.taskGroupingMethod === "llm"
      ? parsed.taskGroupingMethod
      : inferTaskGroupingMethod(taskGroups);
    return {
      traces: Array.isArray(parsed.traces) ? parsed.traces : [],
      traceJudgeResults: Array.isArray(parsed.traceJudgeResults) ? parsed.traceJudgeResults : [],
      goldenDatasets: Array.isArray(parsed.goldenDatasets) ? parsed.goldenDatasets : [],
      taskGroups,
      taskGroupingMethod,
    };
  } catch {
    return emptyPersonalWorkspace();
  }
}

export function savePersonalWorkspace(workspace: WorkspaceData) {
  try {
    window.localStorage.setItem(PERSONAL_WORKSPACE_KEY, JSON.stringify(workspace));
  } catch {
    // Keep the active session usable if browser storage is full or unavailable.
  }
}
