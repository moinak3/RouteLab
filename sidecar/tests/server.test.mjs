import { spawn } from "node:child_process";
import { webcrypto } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { stableStringify } from "../src/policy.mjs";

const subtle = webcrypto.subtle;
const children = new Set();
const servers = new Set();

const listen = (server, port = 0) => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", () => resolve(server.address().port));
});

const close = (server) => new Promise((resolve) => server.close(resolve));

async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function signedEnvelope(classifierEndpoint) {
  const keyPair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = Buffer.from(await subtle.exportKey("spki", keyPair.publicKey)).toString("base64");
  const bundle = {
    schemaVersion: "routelab.policy.v2",
    workspaceId: "workspace_smoke",
    policyId: "policy_smoke",
    version: 7,
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    classifier: { provider: "openrouter", model: "typesafe/jev-1.14", endpoint: classifierEndpoint, timeoutMs: 1_500, unknownSignatureId: "unknown", riskThresholds: { low: .8, medium: .86, high: .92 } },
    fallback: { modelId: "gpt-5.5-pro", openRouterModelId: "openai/gpt-5.5-pro" },
    guardrails: { minimumPassRate: .9, maximumLatencyIncreasePct: 20, minimumReplayCount: 3 },
    signatures: [{ id: "billing", label: "Billing", description: "Billing and refund requests", riskLevel: "medium" }],
    overrides: [{
      taskId: "billing",
      modelId: "deepseek-r1",
      openRouterModelId: "deepseek/deepseek-r1",
      openRouterProvider: "DeepInfra",
      evidence: { passRate: .95, costDeltaPct: -60, latencyDeltaPct: -12, replayCount: 20, measuredAt: new Date().toISOString() },
    }],
  };
  const signature = Buffer.from(await subtle.sign("Ed25519", keyPair.privateKey, new TextEncoder().encode(stableStringify(bundle)))).toString("base64");
  return { envelope: { bundle, signing: { algorithm: "Ed25519", keyId: "smoke", signature, publicKey } }, publicKey };
}

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

async function waitUntilReady(url, child) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Sidecar exited before readiness with code ${child.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Sidecar did not become ready.");
}

afterEach(async () => {
  for (const child of children) child.kill("SIGTERM");
  children.clear();
  await Promise.all([...servers].map(close));
  servers.clear();
});

describe("RouteLab sidecar HTTP server", () => {
  it("loads a signed policy, classifies a conversation, and proxies to the policy model", async () => {
    let proxiedRequest;
    let decisionRequests = 0;
    let envelope;
    const upstream = http.createServer(async (req, res) => {
      if (req.url === "/policy") {
        res.writeHead(200, { "Content-Type": "application/json", ETag: '"policy_smoke"' });
        return res.end(JSON.stringify(envelope));
      }
      if (req.url === "/decisions") {
        decisionRequests += 1;
        const body = await readBody(req);
        expect(body.state.available_tools[0].name).toBe("lookup_invoice");
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ answers: { trace_bucket: { type: "choice", choice: "billing", confidence: .95, probabilities: { billing: .95, unknown: .05 } } } }));
      }
      if (req.url === "/chat") {
        proxiedRequest = await readBody(req);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ id: "chat_smoke", model: "deepseek/deepseek-r1", choices: [{ message: { role: "assistant", content: "Refund queued." } }] }));
      }
      res.writeHead(404).end();
    });
    servers.add(upstream);
    const upstreamPort = await listen(upstream);
    const signed = await signedEnvelope(`http://127.0.0.1:${upstreamPort}/decisions`);
    envelope = signed.envelope;
    const publicKey = signed.publicKey;
    const sidecarPort = await freePort();
    const child = spawn(process.execPath, ["sidecar/src/server.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(sidecarPort),
        ROUTELAB_POLICY_URL: `http://127.0.0.1:${upstreamPort}/policy`,
        ROUTELAB_POLICY_PUBLIC_KEY: publicKey,
        ROUTELAB_SIDECAR_API_KEY: "test-sidecar-key",
        OPENROUTER_API_KEY: "test-openrouter-key",
        OPENROUTER_CHAT_URL: `http://127.0.0.1:${upstreamPort}/chat`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    const baseUrl = `http://127.0.0.1:${sidecarPort}`;
    await expect(waitUntilReady(`${baseUrl}/ready`, child)).resolves.toMatchObject({ policyVersion: 7, mode: "enforce" });

    const request = {
      model: "caller/model",
      messages: [{ role: "user", content: "Refund the duplicate invoice charge." }],
      tools: [{ type: "function", function: { name: "lookup_invoice", description: "Find invoice", parameters: { type: "object" } } }],
    };
    const unauthorized = await fetch(`${baseUrl}/v1/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
    expect(unauthorized.status).toBe(401);
    const decisionResponse = await fetch(`${baseUrl}/v1/route`, { method: "POST", headers: { Authorization: "Bearer test-sidecar-key", "Content-Type": "application/json" }, body: JSON.stringify(request) });
    expect(await decisionResponse.json()).toMatchObject({ route: { source: "task_override", taskBucketId: "billing", openRouterModelId: "deepseek/deepseek-r1" } });

    const chatResponse = await fetch(`${baseUrl}/v1/chat/completions`, { method: "POST", headers: { Authorization: "Bearer test-sidecar-key", "Content-Type": "application/json" }, body: JSON.stringify(request) });
    expect(chatResponse.headers.get("x-routelab-policy-version")).toBe("7");
    expect(chatResponse.headers.get("x-routelab-bucket")).toBe("billing");
    expect((await chatResponse.json()).choices[0].message.content).toBe("Refund queued.");
    expect(proxiedRequest).toMatchObject({
      model: "deepseek/deepseek-r1",
      provider: { order: ["DeepInfra"], allow_fallbacks: true },
    });

    const decisionsBeforeInspection = decisionRequests;
    const inspectionResponse = await fetch(`${baseUrl}/v1/inspect/chat/completions`, { method: "POST", headers: { Authorization: "Bearer test-sidecar-key", "Content-Type": "application/json" }, body: JSON.stringify(request) });
    expect(inspectionResponse.status).toBe(200);
    expect(await inspectionResponse.json()).toMatchObject({
      ok: true,
      received: { messageCount: 1, latestUserPrompt: "Refund the duplicate invoice charge.", tools: [{ name: "lookup_invoice" }] },
      decision: { signatureId: "billing", confidence: .95, status: "matched" },
      route: { source: "task_override", taskBucketId: "billing", openRouterModelId: "deepseek/deepseek-r1", policyVersion: 7 },
      openRouterRequest: { model: "deepseek/deepseek-r1", provider: { order: ["DeepInfra"] }, stream: false },
      openRouterResponse: { model: "deepseek/deepseek-r1", choices: [{ message: { content: "Refund queued." } }] },
      upstream: { status: 200, selectedModel: "deepseek/deepseek-r1" },
    });
    expect(decisionRequests).toBe(decisionsBeforeInspection + 1);
  });
});
