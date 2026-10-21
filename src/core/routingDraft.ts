export type RouteCandidateGuardrails = {
  minimumPassRate: number;
  maximumLatencyIncreasePct: number;
  minimumReplayCount: number;
};

export const DEFAULT_ROUTE_GUARDRAILS: RouteCandidateGuardrails = {
  minimumPassRate: 0.9,
  maximumLatencyIncreasePct: 20,
  minimumReplayCount: 3,
};

export type DraftTaskOverride = {
  taskId: string;
  taskName: string;
  modelId: string;
  modelName: string;
  provider?: string;
  passRate: number;
  costDeltaPct: number;
  latencyDeltaPct: number;
  replayCount: number;
  updatedAt: string;
};

export type DraftRoutingPolicy = {
  fallbackModelId: string;
  minimumPassRate: number;
  maximumLatencyIncreasePct: number;
  overrides: Record<string, DraftTaskOverride>;
  version: number;
  updatedAt: string;
};

export const ROUTING_DRAFT_STORAGE_KEY = "routelab-routing-policy-draft-v1";

export function createDraftRoutingPolicy(fallbackModelId: string): DraftRoutingPolicy {
  return {
    fallbackModelId,
    minimumPassRate: DEFAULT_ROUTE_GUARDRAILS.minimumPassRate,
    maximumLatencyIncreasePct: DEFAULT_ROUTE_GUARDRAILS.maximumLatencyIncreasePct,
    overrides: {},
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

export function loadDraftRoutingPolicy(fallbackModelId: string): DraftRoutingPolicy {
  const initial = createDraftRoutingPolicy(fallbackModelId);
  if (typeof window === "undefined") return initial;
  try {
    const saved = JSON.parse(window.localStorage.getItem(ROUTING_DRAFT_STORAGE_KEY) ?? "null") as Partial<DraftRoutingPolicy> | null;
    return saved ? { ...initial, ...saved, overrides: saved.overrides ?? {} } : initial;
  } catch {
    return initial;
  }
}

export function saveDraftRoutingPolicy(policy: DraftRoutingPolicy) {
  if (typeof window !== "undefined") window.localStorage.setItem(ROUTING_DRAFT_STORAGE_KEY, JSON.stringify(policy));
}

export function reviseDraftRoutingPolicy(policy: DraftRoutingPolicy, changes: Partial<DraftRoutingPolicy>): DraftRoutingPolicy {
  return { ...policy, ...changes, version: policy.version + 1, updatedAt: new Date().toISOString() };
}

export type RouteCandidateAssessment = {
  eligible: boolean;
  checks: Array<{ label: string; passed: boolean; detail: string }>;
};

export function assessRouteCandidate(
  evidence: { passRate: number; costDeltaPct: number; latencyDeltaPct: number; replayCount: number },
  guardrails: RouteCandidateGuardrails = DEFAULT_ROUTE_GUARDRAILS,
): RouteCandidateAssessment {
  const checks = [
    {
      label: "Quality",
      passed: evidence.passRate >= guardrails.minimumPassRate,
      detail: `${(evidence.passRate * 100).toFixed(1)}% pass rate vs ${(guardrails.minimumPassRate * 100).toFixed(0)}% minimum`,
    },
    {
      label: "Cost",
      passed: evidence.costDeltaPct < 0,
      detail: `${Math.abs(evidence.costDeltaPct).toFixed(1)}% ${evidence.costDeltaPct < 0 ? "lower" : "higher or unchanged"} cost`,
    },
    {
      label: "Latency",
      passed: evidence.latencyDeltaPct <= guardrails.maximumLatencyIncreasePct,
      detail: `${evidence.latencyDeltaPct > 0 ? "+" : ""}${evidence.latencyDeltaPct.toFixed(1)}% vs +${guardrails.maximumLatencyIncreasePct}% maximum`,
    },
    {
      label: "Evidence",
      passed: evidence.replayCount >= guardrails.minimumReplayCount,
      detail: `${evidence.replayCount} replayed trace${evidence.replayCount === 1 ? "" : "s"} vs ${guardrails.minimumReplayCount} minimum`,
    },
  ];
  return { eligible: checks.every((check) => check.passed), checks };
}
