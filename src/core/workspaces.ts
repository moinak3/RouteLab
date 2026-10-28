import type { GoldenDataset, Trace, TraceJudgeResult } from "../types";

export type WorkspaceId = "personal" | "demo";

export type WorkspaceData = {
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  goldenDatasets: GoldenDataset[];
};

const ACTIVE_WORKSPACE_KEY = "routelab-active-workspace-v1";
const PERSONAL_WORKSPACE_KEY = "routelab-personal-workspace-v1";

export const emptyPersonalWorkspace = (): WorkspaceData => ({ traces: [], traceJudgeResults: [], goldenDatasets: [] });

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

export function loadPersonalWorkspace(): WorkspaceData {
  try {
    const raw = window.localStorage.getItem(PERSONAL_WORKSPACE_KEY);
    if (!raw) return emptyPersonalWorkspace();
    const parsed = JSON.parse(raw) as Partial<WorkspaceData>;
    return {
      traces: Array.isArray(parsed.traces) ? parsed.traces : [],
      traceJudgeResults: Array.isArray(parsed.traceJudgeResults) ? parsed.traceJudgeResults : [],
      goldenDatasets: Array.isArray(parsed.goldenDatasets) ? parsed.goldenDatasets : [],
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
