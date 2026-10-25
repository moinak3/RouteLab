import type { DraftRoutingPolicy } from "./routingDraft";
import type { DistinctTask, Risk } from "../types";

export const ROUTING_POLICY_SCHEMA_VERSION = "routelab.policy.v2" as const;
export const LEGACY_ROUTING_POLICY_SCHEMA_VERSION = "routelab.policy.v1" as const;

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

export type RoutingPolicyBundle = {
  schemaVersion: typeof ROUTING_POLICY_SCHEMA_VERSION | typeof LEGACY_ROUTING_POLICY_SCHEMA_VERSION;
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
  fallback: PublishedModelTarget;
  guardrails: {
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
  fallbackModelId: string;
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
  if (!draft.fallbackModelId) errors.push("Select a general fallback model.");
  if (!signatures.length) errors.push("At least one known task signature is required.");
  const signatureIds = new Set(signatures.map((signature) => signature.id));
  if (signatureIds.size !== signatures.length) errors.push("Task signature IDs must be unique.");
  for (const override of Object.values(draft.overrides)) {
    if (!signatureIds.has(override.taskId)) errors.push(`${override.taskName} is not in the published signature catalog.`);
    if (override.passRate < draft.minimumPassRate) errors.push(`${override.taskName} no longer clears the quality bar.`);
    if (override.costDeltaPct >= 0) errors.push(`${override.taskName} does not reduce measured cost.`);
    if (override.latencyDeltaPct > draft.maximumLatencyIncreasePct) errors.push(`${override.taskName} exceeds the latency guardrail.`);
    if (override.replayCount < 3) errors.push(`${override.taskName} has fewer than three replayed traces.`);
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

export function isRoutingPolicyBundle(value: unknown): value is RoutingPolicyBundle {
  if (!value || typeof value !== "object") return false;
  const bundle = value as Partial<RoutingPolicyBundle>;
  const supportedSchema = bundle.schemaVersion === ROUTING_POLICY_SCHEMA_VERSION || bundle.schemaVersion === LEGACY_ROUTING_POLICY_SCHEMA_VERSION;
  const requireRuntimeTarget = bundle.schemaVersion === ROUTING_POLICY_SCHEMA_VERSION;
  return supportedSchema
    && typeof bundle.workspaceId === "string"
    && typeof bundle.policyId === "string"
    && Number.isInteger(bundle.version)
    && typeof bundle.issuedAt === "string"
    && typeof bundle.expiresAt === "string"
    && isPublishedModelTarget(bundle.fallback, requireRuntimeTarget)
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
