import { stableStringify, type RoutingPolicyBundle, type SignedRoutingPolicyEnvelope } from "../../src/core/publishedRoutingPolicy.js";

const decodeBase64 = (value: string) => Uint8Array.from(atob(value.replace(/\s+/g, "")), (character) => character.charCodeAt(0));
const encodeBase64 = (value: ArrayBuffer) => {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export class PolicySigningUnavailableError extends Error {}

export async function signRoutingPolicy(bundle: RoutingPolicyBundle, config: { privateKey: string; publicKey: string; keyId: string }): Promise<SignedRoutingPolicyEnvelope> {
  if (!config.privateKey || !config.publicKey) throw new PolicySigningUnavailableError("Policy signing is not configured.");
  const key = await crypto.subtle.importKey("pkcs8", decodeBase64(config.privateKey), { name: "Ed25519" }, false, ["sign"]);
  const payload = new TextEncoder().encode(stableStringify(bundle));
  const signature = await crypto.subtle.sign("Ed25519", key, payload);
  return {
    bundle,
    signing: {
      algorithm: "Ed25519",
      keyId: config.keyId,
      signature: encodeBase64(signature),
      publicKey: config.publicKey,
    },
  };
}

export async function verifyRoutingPolicy(envelope: SignedRoutingPolicyEnvelope, publicKey = envelope.signing.publicKey) {
  const key = await crypto.subtle.importKey("spki", decodeBase64(publicKey), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify(
    "Ed25519",
    key,
    decodeBase64(envelope.signing.signature),
    new TextEncoder().encode(stableStringify(envelope.bundle)),
  );
}
