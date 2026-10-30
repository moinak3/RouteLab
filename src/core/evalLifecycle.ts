import type { EvalDefinition } from "./evalDefinitions";
import type { Trace, TraceJudgeResult } from "../types";

export type EvalRunMode = "historical_test" | "new_traces";

export type EvalAutomationPolicy = {
  evalId: string;
  evalVersion: number;
  definition: EvalDefinition;
  runOnNewTraces: boolean;
  enabledAt: string | null;
  knownTraceIds: string[];
  updatedAt: string;
};

export type EvalRunRecord = {
  id: string;
  evalId: string;
  evalName: string;
  evalVersion: number;
  mode: EvalRunMode;
  status: "completed" | "failed";
  traceCount: number;
  passed: number;
  failed: number;
  averageScore: number;
  startedAt: string;
  completedAt: string;
  error?: string;
};

export type EvalRunResponse = {
  run: EvalRunRecord;
  results: TraceJudgeResult[];
  errors: Array<{ traceId: string; error: string }>;
};

const POLICY_PREFIX = "routelab-eval-automation-v1:";
const RUN_PREFIX = "routelab-eval-runs-v1:";
export const HISTORICAL_TEST_SAMPLE_SIZE = 25;

const monthLabel = (date: Date) => date.toLocaleString("en-US", { month: "short" });

export function monthlyEvalHistory(results: TraceJudgeResult[]) {
  const buckets = new Map<string, { label: string; count: number; scoreSum: number; passing: number }>();

  for (const result of results) {
    const date = new Date(result.created_at);
    if (Number.isNaN(date.getTime())) continue;

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key) ?? { label: monthLabel(date), count: 0, scoreSum: 0, passing: 0 };
    bucket.count += 1;
    bucket.scoreSum += result.score;
    bucket.passing += result.passed ? 1 : 0;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      count: bucket.count,
      passing: bucket.passing,
      failing: bucket.count - bucket.passing,
      averageScore: bucket.count ? bucket.scoreSum / bucket.count : 0,
      passRate: bucket.count ? bucket.passing / bucket.count : 0,
    }));
}

function storage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function loadArray<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(storage()?.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export function loadEvalAutomationPolicies(workspaceId: string): EvalAutomationPolicy[] {
  return loadArray<EvalAutomationPolicy>(`${POLICY_PREFIX}${workspaceId}`)
    .filter((policy) => typeof policy?.evalId === "string" && typeof policy?.definition?.id === "string");
}

export function saveEvalAutomationPolicy(workspaceId: string, policy: EvalAutomationPolicy) {
  const policies = [
    policy,
    ...loadEvalAutomationPolicies(workspaceId).filter((item) => item.evalId !== policy.evalId),
  ];
  try {
    storage()?.setItem(`${POLICY_PREFIX}${workspaceId}`, JSON.stringify(policies));
    window.dispatchEvent(new CustomEvent("routelab-eval-policy-updated", { detail: { workspaceId, policies } }));
  } catch {
    // Keep the current session usable when browser storage is unavailable.
  }
  return policies;
}

export function configureNewTraceEvaluation({
  workspaceId,
  definition,
  evalVersion,
  enabled,
  currentTraceIds,
  now = new Date().toISOString(),
}: {
  workspaceId: string;
  definition: EvalDefinition;
  evalVersion: number;
  enabled: boolean;
  currentTraceIds: string[];
  now?: string;
}) {
  const existing = loadEvalAutomationPolicies(workspaceId).find((policy) => policy.evalId === definition.id);
  return saveEvalAutomationPolicy(workspaceId, {
    evalId: definition.id,
    evalVersion,
    definition,
    runOnNewTraces: enabled,
    enabledAt: enabled ? existing?.enabledAt ?? now : null,
    knownTraceIds: enabled
      ? Array.from(new Set([...(existing?.knownTraceIds ?? []), ...currentTraceIds]))
      : existing?.knownTraceIds ?? currentTraceIds,
    updatedAt: now,
  }).find((policy) => policy.evalId === definition.id)!;
}

export function markEvalTracesProcessed(workspaceId: string, evalId: string, traceIds: string[], now = new Date().toISOString()) {
  const existing = loadEvalAutomationPolicies(workspaceId).find((policy) => policy.evalId === evalId);
  if (!existing) return null;
  return saveEvalAutomationPolicy(workspaceId, {
    ...existing,
    knownTraceIds: Array.from(new Set([...existing.knownTraceIds, ...traceIds])),
    updatedAt: now,
  }).find((policy) => policy.evalId === evalId) ?? null;
}

export function loadEvalRunHistory(workspaceId: string): EvalRunRecord[] {
  return loadArray<EvalRunRecord>(`${RUN_PREFIX}${workspaceId}`)
    .filter((run) => typeof run?.id === "string" && typeof run?.evalId === "string")
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

export function saveEvalRunRecord(workspaceId: string, run: EvalRunRecord) {
  const runs = [run, ...loadEvalRunHistory(workspaceId).filter((item) => item.id !== run.id)].slice(0, 100);
  try {
    storage()?.setItem(`${RUN_PREFIX}${workspaceId}`, JSON.stringify(runs));
  } catch {
    // Run history remains available for the current response even if storage is unavailable.
  }
  return runs;
}

export function removeEvalLifecycleState(workspaceId: string, evalId: string) {
  const policies = loadEvalAutomationPolicies(workspaceId).filter((policy) => policy.evalId !== evalId);
  const runs = loadEvalRunHistory(workspaceId).filter((run) => run.evalId !== evalId);
  try {
    storage()?.setItem(`${POLICY_PREFIX}${workspaceId}`, JSON.stringify(policies));
    storage()?.setItem(`${RUN_PREFIX}${workspaceId}`, JSON.stringify(runs));
    window.dispatchEvent(new CustomEvent("routelab-eval-policy-updated", { detail: { workspaceId, policies } }));
  } catch {
    // Keep the current session usable when browser storage is unavailable.
  }
  return { policies, runs };
}

export function selectHistoricalTestSample(traces: Trace[], limit = HISTORICAL_TEST_SAMPLE_SIZE) {
  if (traces.length <= limit) return [...traces];
  const ordered = [...traces].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  const selected: Trace[] = [];
  const used = new Set<number>();
  for (let index = 0; index < limit; index += 1) {
    const position = Math.min(ordered.length - 1, Math.round(index * (ordered.length - 1) / Math.max(1, limit - 1)));
    if (!used.has(position)) {
      used.add(position);
      selected.push(ordered[position]);
    }
  }
  return selected;
}

export async function runEvalOnTraces({
  workspaceId,
  definition,
  evalVersion,
  mode,
  traces,
  signal,
}: {
  workspaceId: string;
  definition: EvalDefinition;
  evalVersion: number;
  mode: EvalRunMode;
  traces: Trace[];
  signal?: AbortSignal;
}): Promise<EvalRunResponse> {
  const response = await fetch(`/api/evals/run?workspace=${encodeURIComponent(workspaceId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ definition, evalVersion, mode, traces }),
    signal,
  });
  const payload = await response.json().catch(() => ({})) as Partial<EvalRunResponse> & { error?: unknown };
  if (!response.ok || !payload.run || !Array.isArray(payload.results)) {
    throw new Error(typeof payload.error === "string" ? payload.error : "The eval run could not be completed.");
  }
  return {
    run: payload.run,
    results: payload.results,
    errors: Array.isArray(payload.errors) ? payload.errors : [],
  };
}

export function mergeEvalResults(current: TraceJudgeResult[], incoming: TraceJudgeResult[]) {
  const key = (result: TraceJudgeResult) => `${result.eval_id ?? result.evaluator_type}:${result.trace_id}`;
  const incomingKeys = new Set(incoming.map(key));
  return [...incoming, ...current.filter((result) => !incomingKeys.has(key(result)))];
}
