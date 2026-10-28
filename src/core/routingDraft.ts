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
  openRouterModelId?: string;
  provider?: string;
  providerId?: string;
  passRate: number;
  costDeltaPct: number;
  latencyDeltaPct: number;
  replayCount: number;
  updatedAt: string;
};

export type DraftRoutingPolicy = {
  defaultStrategyType: "fixed_model" | "openrouter_auto";
  defaultModelId: string;
  defaultOpenRouterModelId?: string;
  autoRouterCostTier: "low" | "medium" | "high" | "xhigh" | "max";
  emergencyFallbackModelId: string;
  emergencyFallbackOpenRouterModelId?: string;
  minimumPassRate: number;
  maximumLatencyIncreasePct: number;
  overrides: Record<string, DraftTaskOverride>;
  version: number;
  updatedAt: string;
};

export type RoutingPolicyDraftEnvelope = {
  draft: DraftRoutingPolicy | null;
  revision: number;
  updatedAt: string | null;
};

export const ROUTING_DRAFT_STORAGE_KEY = "routelab-routing-policy-draft-v2";
const routingDraftStorageKey = (workspaceId: string) => `${ROUTING_DRAFT_STORAGE_KEY}:${workspaceId}`;

export function createDraftRoutingPolicy(fallbackModelId: string): DraftRoutingPolicy {
  return {
    defaultStrategyType: "fixed_model",
    defaultModelId: fallbackModelId,
    autoRouterCostTier: "medium",
    emergencyFallbackModelId: fallbackModelId,
    minimumPassRate: DEFAULT_ROUTE_GUARDRAILS.minimumPassRate,
    maximumLatencyIncreasePct: DEFAULT_ROUTE_GUARDRAILS.maximumLatencyIncreasePct,
    overrides: {},
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

export function loadDraftRoutingPolicy(fallbackModelId: string, workspaceId = "demo"): DraftRoutingPolicy {
  const initial = createDraftRoutingPolicy(fallbackModelId);
  if (typeof window === "undefined") return initial;
  try {
    const saved = JSON.parse(window.localStorage.getItem(routingDraftStorageKey(workspaceId)) ?? "null") as Partial<DraftRoutingPolicy> & { fallbackModelId?: string; fallbackOpenRouterModelId?: string } | null;
    return saved ? normalizeDraftRoutingPolicy(saved, fallbackModelId) : initial;
  } catch {
    return initial;
  }
}

export function normalizeDraftRoutingPolicy(value: Partial<DraftRoutingPolicy> & { fallbackModelId?: string; fallbackOpenRouterModelId?: string }, fallbackModelId = ""): DraftRoutingPolicy {
  const initial = createDraftRoutingPolicy(value.fallbackModelId || fallbackModelId);
  return {
    ...initial,
    ...value,
    defaultStrategyType: value.defaultStrategyType === "openrouter_auto" ? "openrouter_auto" : "fixed_model",
    defaultModelId: value.defaultModelId || value.fallbackModelId || fallbackModelId,
    defaultOpenRouterModelId: value.defaultOpenRouterModelId || value.fallbackOpenRouterModelId,
    autoRouterCostTier: ["low", "medium", "high", "xhigh", "max"].includes(String(value.autoRouterCostTier)) ? value.autoRouterCostTier! : "medium",
    emergencyFallbackModelId: value.emergencyFallbackModelId || value.fallbackModelId || fallbackModelId,
    emergencyFallbackOpenRouterModelId: value.emergencyFallbackOpenRouterModelId || value.fallbackOpenRouterModelId,
    overrides: value.overrides ?? {},
  };
}

export function saveDraftRoutingPolicy(policy: DraftRoutingPolicy, workspaceId = "demo") {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(routingDraftStorageKey(workspaceId), JSON.stringify(policy));
    window.dispatchEvent(new CustomEvent("routelab-routing-policy-updated", { detail: { policy, workspaceId } }));
  }
}

export function reviseDraftRoutingPolicy(policy: DraftRoutingPolicy, changes: Partial<DraftRoutingPolicy>): DraftRoutingPolicy {
  return { ...policy, ...changes, version: policy.version + 1, updatedAt: new Date().toISOString() };
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isDraftTaskOverride(value: unknown): value is DraftTaskOverride {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DraftTaskOverride>;
  return typeof item.taskId === "string"
    && typeof item.taskName === "string"
    && typeof item.modelId === "string"
    && typeof item.modelName === "string"
    && (item.openRouterModelId === undefined || typeof item.openRouterModelId === "string")
    && (item.provider === undefined || typeof item.provider === "string")
    && (item.providerId === undefined || typeof item.providerId === "string")
    && isFiniteNumber(item.passRate)
    && isFiniteNumber(item.costDeltaPct)
    && isFiniteNumber(item.latencyDeltaPct)
    && isFiniteNumber(item.replayCount)
    && typeof item.updatedAt === "string";
}

export function isDraftRoutingPolicy(value: unknown): value is DraftRoutingPolicy {
  if (!value || typeof value !== "object") return false;
  const policy = value as Partial<DraftRoutingPolicy>;
  if ((policy.defaultStrategyType !== "fixed_model" && policy.defaultStrategyType !== "openrouter_auto")
    || typeof policy.defaultModelId !== "string"
    || (policy.defaultOpenRouterModelId !== undefined && typeof policy.defaultOpenRouterModelId !== "string")
    || !["low", "medium", "high", "xhigh", "max"].includes(String(policy.autoRouterCostTier))
    || typeof policy.emergencyFallbackModelId !== "string"
    || (policy.emergencyFallbackOpenRouterModelId !== undefined && typeof policy.emergencyFallbackOpenRouterModelId !== "string")
    || !isFiniteNumber(policy.minimumPassRate)
    || !isFiniteNumber(policy.maximumLatencyIncreasePct)
    || !isFiniteNumber(policy.version)
    || typeof policy.updatedAt !== "string"
    || !policy.overrides
    || typeof policy.overrides !== "object"
    || Array.isArray(policy.overrides)) return false;
  return Object.values(policy.overrides).every(isDraftTaskOverride);
}

export function initialDraftSync(localDraft: DraftRoutingPolicy, serverDraft: DraftRoutingPolicy | null) {
  return serverDraft
    ? { draft: serverDraft, shouldImportLocal: false }
    : { draft: localDraft, shouldImportLocal: true };
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
