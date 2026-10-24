import { overrideEligibility } from "../lib/quality.js";

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

export type RoutingPolicyDraftEnvelope = {
  draft: DraftRoutingPolicy | null;
  revision: number;
  updatedAt: string | null;
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
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ROUTING_DRAFT_STORAGE_KEY, JSON.stringify(policy));
    window.dispatchEvent(new CustomEvent("routelab-routing-policy-updated", { detail: policy }));
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
    && (item.provider === undefined || typeof item.provider === "string")
    && isFiniteNumber(item.passRate)
    && isFiniteNumber(item.costDeltaPct)
    && isFiniteNumber(item.latencyDeltaPct)
    && isFiniteNumber(item.replayCount)
    && typeof item.updatedAt === "string";
}

export function isDraftRoutingPolicy(value: unknown): value is DraftRoutingPolicy {
  if (!value || typeof value !== "object") return false;
  const policy = value as Partial<DraftRoutingPolicy>;
  if (typeof policy.fallbackModelId !== "string"
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
  const base = overrideEligibility({
    successes: Math.round(evidence.passRate * evidence.replayCount),
    total: evidence.replayCount,
    qualityBar: guardrails.minimumPassRate,
    costDeltaPct: evidence.costDeltaPct,
    latencyDeltaPct: evidence.latencyDeltaPct,
    maximumLatencyIncreasePct: guardrails.maximumLatencyIncreasePct,
  });
  const checks = [...base.checks, {
    label: "Evidence",
    passed: evidence.replayCount >= guardrails.minimumReplayCount,
    detail: `${evidence.replayCount} replayed trace${evidence.replayCount === 1 ? "" : "s"} vs ${guardrails.minimumReplayCount} minimum`,
  }];
  return { eligible: checks.every((check) => check.passed), checks };
}

