import { webcrypto } from "node:crypto";

const subtle = globalThis.crypto?.subtle ?? webcrypto.subtle;
const supportedSchemas = new Set(["routelab.policy.v1", "routelab.policy.v2", "routelab.policy.v3"]);

export function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

const decodeBase64 = (value) => Uint8Array.from(Buffer.from(String(value).replace(/\s+/g, ""), "base64"));

function assertModelTarget(target, label, requireRuntimeTarget) {
  if (!target || typeof target !== "object" || typeof target.modelId !== "string") {
    throw new Error(`${label} is missing a model target.`);
  }
  if (requireRuntimeTarget && !String(target.openRouterModelId ?? "").trim()) {
    throw new Error(`${label} is missing an OpenRouter model target.`);
  }
}

export function assertPolicyEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || !envelope.bundle || !envelope.signing) {
    throw new Error("The policy endpoint returned an invalid signed envelope.");
  }
  const { bundle, signing } = envelope;
  if (!supportedSchemas.has(bundle.schemaVersion)) throw new Error(`Unsupported policy schema: ${bundle.schemaVersion ?? "missing"}.`);
  if (!Number.isInteger(bundle.version) || typeof bundle.policyId !== "string") throw new Error("The policy identity is invalid.");
  if (!Array.isArray(bundle.signatures) || !bundle.signatures.length) throw new Error("The policy has no task signatures.");
  if (!Array.isArray(bundle.overrides)) throw new Error("The policy overrides are invalid.");
  if (!bundle.classifier || typeof bundle.classifier.endpoint !== "string" || typeof bundle.classifier.model !== "string") {
    throw new Error("The policy classifier configuration is invalid.");
  }
  const requireRuntimeTarget = bundle.schemaVersion !== "routelab.policy.v1";
  if (bundle.schemaVersion === "routelab.policy.v3") {
    if (bundle.defaultStrategy?.type === "fixed_model") assertModelTarget(bundle.defaultStrategy.target, "The fixed default route", true);
    else if (bundle.defaultStrategy?.type !== "openrouter_auto" || bundle.defaultStrategy.openRouterModelId !== "openrouter/auto") {
      throw new Error("The default routing strategy is invalid.");
    }
    assertModelTarget(bundle.emergencyFallback, "The emergency fallback route", true);
  } else {
    assertModelTarget(bundle.fallback, "The fallback route", requireRuntimeTarget);
  }
  bundle.overrides.forEach((override) => {
    if (typeof override?.taskId !== "string") throw new Error("A policy override is missing its task bucket ID.");
    assertModelTarget(override, `The ${override.taskId} route`, requireRuntimeTarget);
  });
  if (signing.algorithm !== "Ed25519" || !signing.signature || !signing.publicKey) {
    throw new Error("The policy signature metadata is invalid.");
  }
  return envelope;
}

export async function verifyPolicyEnvelope(envelope, pinnedPublicKey, now = Date.now()) {
  assertPolicyEnvelope(envelope);
  const publicKey = String(pinnedPublicKey ?? "").replace(/\s+/g, "");
  if (!publicKey) throw new Error("ROUTELAB_POLICY_PUBLIC_KEY is required.");
  if (String(envelope.signing.publicKey).replace(/\s+/g, "") !== publicKey) {
    throw new Error("The policy was signed by an unexpected key.");
  }
  const key = await subtle.importKey("spki", decodeBase64(publicKey), { name: "Ed25519" }, false, ["verify"]);
  const verified = await subtle.verify(
    "Ed25519",
    key,
    decodeBase64(envelope.signing.signature),
    new TextEncoder().encode(stableStringify(envelope.bundle)),
  );
  if (!verified) throw new Error("The routing policy signature is invalid.");
  const expiresAt = Date.parse(envelope.bundle.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error("The routing policy has expired.");
  return envelope;
}

export class PolicyClient {
  constructor({ url, publicKey, pollMs = 30_000, fetchImpl = fetch, now = () => Date.now(), logger = console }) {
    if (!url) throw new Error("ROUTELAB_POLICY_URL is required.");
    this.url = url;
    this.publicKey = publicKey;
    this.pollMs = Math.max(1_000, Number(pollMs) || 30_000);
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.logger = logger;
    this.envelope = null;
    this.etag = "";
    this.timer = null;
  }

  async refresh() {
    const headers = { Accept: "application/json" };
    if (this.etag) headers["If-None-Match"] = this.etag;
    const response = await this.fetchImpl(this.url, { headers });
    if (response.status === 304 && this.envelope) return this.envelope;
    if (!response.ok) throw new Error(`Policy endpoint returned HTTP ${response.status}.`);
    const envelope = await response.json();
    await verifyPolicyEnvelope(envelope, this.publicKey, this.now());
    this.envelope = envelope;
    this.etag = response.headers.get("etag") ?? `"${envelope.bundle.policyId}"`;
    this.logger.info?.(`Loaded RouteLab policy v${envelope.bundle.version}.`);
    return envelope;
  }

  getBundle() {
    if (!this.envelope) throw new Error("No verified routing policy is loaded.");
    const expiresAt = Date.parse(this.envelope.bundle.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) throw new Error("The loaded routing policy has expired.");
    return this.envelope.bundle;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.refresh().catch((error) => this.logger.error?.(`Policy refresh failed: ${error instanceof Error ? error.message : error}`));
    }, this.pollMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
