import type { ReplayResult } from "./simulations";
import type { LiveRunSource } from "./liveRouting";
import type { TraceJudgeResult } from "../types";

export type SavedSimulationRun = {
  id: string;
  comparisonKey: string;
  candidateId: string;
  completedAt: string;
  source: LiveRunSource;
  label: string;
  traceIds: string[];
  baselineResults: TraceJudgeResult[];
  result: ReplayResult;
};

const STORAGE_PREFIX = "routelab-simulation-runs-v1:";
const HISTORY_LIMIT = 4;

function storage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function simulationRunComparisonKey({
  scopeKey,
  evalId,
  evalVersion,
}: {
  scopeKey: string;
  evalId?: string;
  evalVersion?: number;
}) {
  return JSON.stringify({ scopeKey, evalId: evalId ?? null, evalVersion: evalVersion ?? null });
}

export function simulationRunStorageKey(workspaceId: string) {
  return `${STORAGE_PREFIX}${workspaceId}`;
}

export function loadSimulationRuns(workspaceId: string): SavedSimulationRun[] {
  try {
    const parsed = JSON.parse(storage()?.getItem(simulationRunStorageKey(workspaceId)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((run): run is SavedSimulationRun => Boolean(
        run
        && typeof run === "object"
        && typeof (run as SavedSimulationRun).id === "string"
        && typeof (run as SavedSimulationRun).comparisonKey === "string"
        && Array.isArray((run as SavedSimulationRun).traceIds)
        && Array.isArray((run as SavedSimulationRun).result?.runs),
      ))
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  } catch {
    return [];
  }
}

export function latestSimulationRun(workspaceId: string, comparisonKey: string) {
  return loadSimulationRuns(workspaceId).find((run) => run.comparisonKey === comparisonKey) ?? null;
}

export function saveSimulationRun(workspaceId: string, run: SavedSimulationRun) {
  const runs = [
    run,
    ...loadSimulationRuns(workspaceId).filter((item) => item.comparisonKey !== run.comparisonKey),
  ].slice(0, HISTORY_LIMIT);
  try {
    storage()?.setItem(simulationRunStorageKey(workspaceId), JSON.stringify(runs));
  } catch {
    // The completed result remains available in the current session if storage is full or unavailable.
  }
  return runs;
}
