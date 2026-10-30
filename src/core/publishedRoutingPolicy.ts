import type { DraftRoutingPolicy } from "./routingDraft.js";
import type { DistinctTask, Risk } from "../types.js";

export const ROUTING_POLICY_SCHEMA_VERSION = "routelab.policy.v4" as const;
export const LEGACY_ROUTING_POLICY_SCHEMA_VERSIONS = ["routelab.policy.v1", "routelab.policy.v2", "routelab.policy.v3"] as const;

export type PublishedTaskSignature = {
  id: string;
  label: string;
  description: string;
  riskLevel: Risk;
  task?: DistinctTask;
  examples?: string[];
};

export type PublishedModelTarget = {
  modelId: string;
  openRouterModelId?: string;
  provider?: string;
  openRouterProvider?: string;
};

export type PublishedDefaultStrategy =
  | { type: "fixed_model"; target: PublishedModelTarget }
  | { type: "openrouter_auto"; openRouterModelId: "openrouter/auto"; costTier: "low" | "medium" | "high" | "xhigh" | "max" };

export type RoutingPolicyBundle = {
  schemaVersion: typeof ROUTING_POLICY_SCHEMA_VERSION | (typeof LEGACY_ROUTING_POLICY_SCHEMA_VERSIONS)[number];
  workspaceId: string;
  policyId: string;
  version: number;
  issuedAt: string;
  expiresAt: string;
  classifier: {
    provider: "openrouter";
    model: string;
    endpoint: string;
    timeoutMs: number;
    unknownSignatureId: "unknown";
    riskThresholds: Record<Risk, number>;
  };
  defaultStrategy?: PublishedDefaultStrategy;
  /** Retained only so previously signed v3 bundles remain readable. */
  emergencyFallback?: PublishedModelTarget;
  fallback?: PublishedModelTarget;
  guardrails?: {
    minimumPassRate: number;
    maximumLatencyIncreasePct: number;
    minimumReplayCount: number;
  };
  signatures: PublishedTaskSignature[];
  overrides: Array<{
    taskId: string;
    modelId: string;
    openRouterModelId?: string;
    provider?: string;
    openRouterProvider?: string;
    evidence: {
      passRate: number;
      costDeltaPct: number;
      latencyDeltaPct: number;
      replayCount: number;
      measuredAt: string;
    };
  }>;
};

export type SignedRoutingPolicyEnvelope = {
  bundle: RoutingPolicyBundle;
  signing: {
    algorithm: "Ed25519";
    keyId: string;
    signature: string;
    publicKey: string;
  };
};

export type PublishedPolicySummary = {
  policyId: string;
  version: number;
  publishedAt: string;
  activatedAt: string | null;
  active: boolean;
  defaultStrategyLabel: string;
  overrideCount: number;
  signatureCount: number;
  expiresAt: string;
};

export type PublishedPolicyHistory = {
  activeVersion: number | null;
  versions: PublishedPolicySummary[];
};

const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function validatePublishableDraft(draft: DraftRoutingPolicy, signatures: PublishedTaskSignature[]) {
  const errors: string[] = [];
  if (draft.defaultStrategyType === "fixed_model" && !draft.defaultModelId) errors.push("Select a fixed default model.");
  if (!signatures.length) errors.push("At least one known task signature is required.");
  const signatureIds = new Set(signatures.map((signature) => signature.id));
  if (signatureIds.size !== signatures.length) errors.push("Task signature IDs must be unique.");
  for (const override of Object.values(draft.overrides)) {
    if (!signatureIds.has(override.taskId)) errors.push(`${override.taskName} is not in the published signature catalog.`);
  }
  return [...new Set(errors)];
}

export function isPublishedTaskSignature(value: unknown): value is PublishedTaskSignature {
  if (!value || typeof value !== "object") return false;
  const signature = value as Partial<PublishedTaskSignature>;
  return typeof signature.id === "string"
    && typeof signature.label === "string"
    && typeof signature.description === "string"
    && (signature.examples === undefined || Array.isArray(signature.examples) && signature.examples.every((example) => typeof example === "string"))
    && (signature.riskLevel === "low" || signature.riskLevel === "medium" || signature.riskLevel === "high");
}

function isPublishedModelTarget(value: unknown, requireRuntimeTarget: boolean): value is PublishedModelTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<PublishedModelTarget>;
  return typeof target.modelId === "string"
    && (!requireRuntimeTarget || typeof target.openRouterModelId === "string" && Boolean(target.openRouterModelId.trim()))
    && (target.openRouterModelId === undefined || typeof target.openRouterModelId === "string")
    && (target.provider === undefined || typeof target.provider === "string")
    && (target.openRouterProvider === undefined || typeof target.openRouterProvider === "string");
}

function isPublishedDefaultStrategy(value: unknown): value is PublishedDefaultStrategy {
  if (!value || typeof value !== "object") return false;
  const strategy = value as Partial<PublishedDefaultStrategy> & { target?: PublishedModelTarget; costTier?: string };
  return strategy.type === "fixed_model"
    ? isPublishedModelTarget(strategy.target, true)
    : strategy.type === "openrouter_auto"
      && strategy.openRouterModelId === "openrouter/auto"
      && ["low", "medium", "high", "xhigh", "max"].includes(String(strategy.costTier));
}

export function isRoutingPolicyBundle(value: unknown): value is RoutingPolicyBundle {
  if (!value || typeof value !== "object") return false;
  const bundle = value as Partial<RoutingPolicyBundle>;
  const supportedSchema = bundle.schemaVersion === ROUTING_POLICY_SCHEMA_VERSION || LEGACY_ROUTING_POLICY_SCHEMA_VERSIONS.includes(bundle.schemaVersion as any);
  const requireRuntimeTarget = bundle.schemaVersion !== "routelab.policy.v1";
  const routesValid = bundle.schemaVersion === ROUTING_POLICY_SCHEMA_VERSION
    ? isPublishedDefaultStrategy(bundle.defaultStrategy)
    : bundle.schemaVersion === "routelab.policy.v3"
      ? isPublishedDefaultStrategy(bundle.defaultStrategy) && isPublishedModelTarget(bundle.emergencyFallback, true)
      : isPublishedModelTarget(bundle.fallback, requireRuntimeTarget);
  return supportedSchema
    && typeof bundle.workspaceId === "string"
    && typeof bundle.policyId === "string"
    && Number.isInteger(bundle.version)
    && typeof bundle.issuedAt === "string"
    && typeof bundle.expiresAt === "string"
    && routesValid
    && Array.isArray(bundle.signatures)
    && bundle.signatures.every(isPublishedTaskSignature)
    && Array.isArray(bundle.overrides)
    && bundle.overrides.every((override) => typeof override?.taskId === "string"
      && typeof override?.modelId === "string"
      && (!requireRuntimeTarget || typeof override?.openRouterModelId === "string")
      && (override?.openRouterModelId === undefined || typeof override.openRouterModelId === "string")
      && (override?.openRouterProvider === undefined || typeof override.openRouterProvider === "string")
      && finiteNumber(override?.evidence?.passRate)
      && finiteNumber(override?.evidence?.costDeltaPct)
      && finiteNumber(override?.evidence?.latencyDeltaPct)
      && finiteNumber(override?.evidence?.replayCount));
}

export function isSignedRoutingPolicyEnvelope(value: unknown): value is SignedRoutingPolicyEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<SignedRoutingPolicyEnvelope>;
  return isRoutingPolicyBundle(envelope.bundle)
    && envelope.signing?.algorithm === "Ed25519"
    && typeof envelope.signing.keyId === "string"
    && typeof envelope.signing.signature === "string"
    && typeof envelope.signing.publicKey === "string";
}

export function isPublishedPolicyHistory(value: unknown): value is PublishedPolicyHistory {
  if (!value || typeof value !== "object") return false;
  const history = value as Partial<PublishedPolicyHistory>;
  return (history.activeVersion === null || Number.isInteger(history.activeVersion))
    && Array.isArray(history.versions)
    && history.versions.every((version) => Number.isInteger(version.version)
      && typeof version.policyId === "string"
      && typeof version.publishedAt === "string"
      && typeof version.active === "boolean");
}
