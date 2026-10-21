import type { DraftRoutingPolicy, RoutingPolicyDraftEnvelope } from "./routingDraft";
import { isDraftRoutingPolicy } from "./routingDraft";

export class RoutingPolicyConflictError extends Error {
  current: RoutingPolicyDraftEnvelope;

  constructor(current: RoutingPolicyDraftEnvelope) {
    super("The routing policy draft changed in another session.");
    this.name = "RoutingPolicyConflictError";
    this.current = current;
  }
}

function validEnvelope(value: unknown): value is RoutingPolicyDraftEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<RoutingPolicyDraftEnvelope>;
  return Number.isInteger(envelope.revision)
    && (envelope.updatedAt === null || typeof envelope.updatedAt === "string")
    && (envelope.draft === null || isDraftRoutingPolicy(envelope.draft));
}

async function parseEnvelope(response: Response): Promise<RoutingPolicyDraftEnvelope> {
  const payload = await response.json().catch(() => null) as unknown;
  if (!validEnvelope(payload)) throw new Error("Policy storage returned an invalid response.");
  return payload;
}

export async function fetchRoutingPolicyDraft(signal?: AbortSignal): Promise<RoutingPolicyDraftEnvelope> {
  const response = await fetch("/api/routing-policy/draft", { method: "GET", headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new Error(response.status === 503 ? "Cloud policy storage is not configured." : "Could not load the saved routing policy.");
  return parseEnvelope(response);
}

export async function persistRoutingPolicyDraft(
  draft: DraftRoutingPolicy,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<RoutingPolicyDraftEnvelope> {
  const response = await fetch("/api/routing-policy/draft", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ draft, expectedRevision }),
    signal,
  });
  if (response.status === 409) throw new RoutingPolicyConflictError(await parseEnvelope(response));
  if (!response.ok) throw new Error(response.status === 503 ? "Cloud policy storage is not configured." : "Could not save the routing policy.");
  return parseEnvelope(response);
}
