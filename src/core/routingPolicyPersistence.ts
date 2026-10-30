import type { DraftRoutingPolicy, RoutingPolicyDraftEnvelope } from "./routingDraft";
import { isDraftRoutingPolicy, normalizeDraftRoutingPolicy } from "./routingDraft";
import {
  isPublishedPolicyHistory,
  isSignedRoutingPolicyEnvelope,
  type PublishedPolicyHistory,
  type PublishedTaskSignature,
  type SignedRoutingPolicyEnvelope,
} from "./publishedRoutingPolicy";

export class RoutingPolicyConflictError extends Error {
  current: RoutingPolicyDraftEnvelope;

  constructor(current: RoutingPolicyDraftEnvelope) {
    super("The routing policy draft changed in another session.");
    this.name = "RoutingPolicyConflictError";
    this.current = current;
  }
}

const workspaceUrl = (path: string, workspaceId: string) => {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${encodeURIComponent(workspaceId)}`;
};

function validEnvelope(value: unknown): value is RoutingPolicyDraftEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<RoutingPolicyDraftEnvelope>;
  return Number.isInteger(envelope.revision)
    && (envelope.updatedAt === null || typeof envelope.updatedAt === "string")
    && (envelope.draft === null || isDraftRoutingPolicy(envelope.draft));
}

async function parseEnvelope(response: Response): Promise<RoutingPolicyDraftEnvelope> {
  const raw = await response.json().catch(() => null) as any;
  const payload = raw?.draft && !isDraftRoutingPolicy(raw.draft)
    ? { ...raw, draft: normalizeDraftRoutingPolicy(raw.draft, raw.draft.fallbackModelId ?? "") }
    : raw;
  if (!validEnvelope(payload)) throw new Error("Policy storage returned an invalid response.");
  return payload;
}

export async function fetchRoutingPolicyDraft(workspaceId: string, signal?: AbortSignal): Promise<RoutingPolicyDraftEnvelope> {
  const response = await fetch(workspaceUrl("/api/routing-policy/draft", workspaceId), { method: "GET", headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new Error(response.status === 503 ? "Cloud policy storage is not configured." : "Could not load the saved routing policy.");
  return parseEnvelope(response);
}

export async function persistRoutingPolicyDraft(
  draft: DraftRoutingPolicy,
  expectedRevision: number,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<RoutingPolicyDraftEnvelope> {
  const response = await fetch(workspaceUrl("/api/routing-policy/draft", workspaceId), {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ draft, expectedRevision }),
    signal,
  });
  if (response.status === 409) throw new RoutingPolicyConflictError(await parseEnvelope(response));
  if (!response.ok) throw new Error(response.status === 503 ? "Cloud policy storage is not configured." : "Could not save the routing policy.");
  return parseEnvelope(response);
}

async function parseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: string; details?: string[] } | null;
  const detail = payload?.details?.length ? ` ${payload.details.join(" ")}` : "";
  return `${payload?.error ?? fallback}${detail}`;
}

export async function fetchPublishedPolicyHistory(workspaceId: string, signal?: AbortSignal): Promise<PublishedPolicyHistory> {
  const response = await fetch(workspaceUrl("/api/routing-policy/versions", workspaceId), { headers: { Accept: "application/json" }, signal });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok || !isPublishedPolicyHistory(payload)) throw new Error("Could not load published policy history.");
  return payload;
}

export async function publishRoutingPolicy(input: {
  expectedRevision: number;
  signatures: PublishedTaskSignature[];
}, workspaceId: string): Promise<SignedRoutingPolicyEnvelope> {
  const response = await fetch(workspaceUrl("/api/routing-policy/publish", workspaceId), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => null) as (SignedRoutingPolicyEnvelope & { error?: string; details?: string[] }) | null;
  if (!response.ok) throw new Error(`${payload?.error ?? "Could not publish the routing policy."}${payload?.details?.length ? ` ${payload.details.join(" ")}` : ""}`);
  if (!payload || typeof payload !== "object" || !isSignedRoutingPolicyEnvelope(payload)) throw new Error("Policy publishing returned an invalid bundle.");
  return payload;
}

export async function activateRoutingPolicy(version: number, workspaceId: string) {
  const response = await fetch(workspaceUrl("/api/routing-policy/activate", workspaceId), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ version }),
  });
  if (!response.ok) throw new Error(await parseError(response, "Could not activate the policy."));
  return response.json() as Promise<{ version: number; activatedAt: string }>;
}

export async function fetchSignedRoutingPolicy(version: number | "active", workspaceId: string, signal?: AbortSignal) {
  const response = await fetch(workspaceUrl(`/api/routing-policy/bundle?version=${encodeURIComponent(String(version))}`, workspaceId), { headers: { Accept: "application/json" }, signal });
  const payload = await response.json().catch(() => null) as (SignedRoutingPolicyEnvelope & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error ?? "Could not export the policy bundle.");
  if (!isSignedRoutingPolicyEnvelope(payload)) throw new Error("Policy export returned an invalid bundle.");
  return payload;
}
