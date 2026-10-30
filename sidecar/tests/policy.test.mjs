import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PolicyClient, stableStringify, verifyPolicyEnvelope } from "../src/policy.mjs";

const subtle = webcrypto.subtle;

async function signedEnvelope(overrides = {}) {
  const keyPair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = Buffer.from(await subtle.exportKey("spki", keyPair.publicKey)).toString("base64");
  const bundle = {
    schemaVersion: "routelab.policy.v4",
    workspaceId: "workspace_test",
    policyId: "policy_test",
    version: 1,
    issuedAt: "2026-10-24T00:00:00.000Z",
    expiresAt: "2027-01-24T00:00:00.000Z",
    classifier: { provider: "openrouter", model: "typesafe/jev-1.14", endpoint: "https://openrouter.ai/api/alpha/decisions", timeoutMs: 1_500, unknownSignatureId: "unknown", riskThresholds: { low: .8, medium: .86, high: .92 } },
    defaultStrategy: { type: "openrouter_auto", openRouterModelId: "openrouter/auto", costTier: "medium" },
    guardrails: { minimumPassRate: .9, maximumLatencyIncreasePct: 20, minimumReplayCount: 3 },
    signatures: [{ id: "billing", label: "Billing", description: "Billing requests", riskLevel: "medium" }],
    overrides: [],
    ...overrides,
  };
  const signature = Buffer.from(await subtle.sign("Ed25519", keyPair.privateKey, new TextEncoder().encode(stableStringify(bundle)))).toString("base64");
  return { envelope: { bundle, signing: { algorithm: "Ed25519", keyId: "test", signature, publicKey } }, publicKey };
}

describe("RouteLab sidecar policy verification", () => {
  it("accepts a valid pinned, unexpired policy", async () => {
    const { envelope, publicKey } = await signedEnvelope();
    await expect(verifyPolicyEnvelope(envelope, publicKey, Date.parse("2026-10-25T00:00:00.000Z"))).resolves.toBe(envelope);
  });

  it("rejects tampering, an unexpected key, and expired policies", async () => {
    const { envelope, publicKey } = await signedEnvelope();
    const tampered = structuredClone(envelope);
    tampered.bundle.defaultStrategy.costTier = "high";
    await expect(verifyPolicyEnvelope(tampered, publicKey, Date.parse("2026-10-25T00:00:00.000Z"))).rejects.toThrow("signature is invalid");
    await expect(verifyPolicyEnvelope(envelope, Buffer.from("wrong-key").toString("base64"), Date.parse("2026-10-25T00:00:00.000Z"))).rejects.toThrow("unexpected key");
    await expect(verifyPolicyEnvelope(envelope, publicKey, Date.parse("2027-01-25T00:00:00.000Z"))).rejects.toThrow("expired");
  });

  it("polls with ETags and keeps the last verified policy on 304", async () => {
    const { envelope, publicKey } = await signedEnvelope();
    const requests = [];
    const responses = [
      new Response(JSON.stringify(envelope), { status: 200, headers: { ETag: '"policy_test"' } }),
      new Response(null, { status: 304 }),
    ];
    const client = new PolicyClient({
      url: "https://routelab.test/api/routing-policy/bundle?version=active",
      publicKey,
      fetchImpl: async (_url, options) => { requests.push(options); return responses.shift(); },
      now: () => Date.parse("2026-10-25T00:00:00.000Z"),
      logger: { info() {}, error() {} },
    });
    await client.refresh();
    await client.refresh();
    expect(requests[1].headers["If-None-Match"]).toBe('"policy_test"');
    expect(client.getBundle().version).toBe(1);
  });
});
