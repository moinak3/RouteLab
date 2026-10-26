import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

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

async function waitUntilReady(url, child) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Support console exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Support console did not become ready.");
}

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

afterEach(async () => {
  for (const child of children) child.kill("SIGTERM");
  children.clear();
  await Promise.all([...servers].map(close));
  servers.clear();
});

describe("RouteLab Support Console server", () => {
  it("serves the app and proxies a complete inspected chat through the sidecar", async () => {
    let receivedAuthorization;
    const receivedRequests = [];
    const sidecar = http.createServer(async (req, res) => {
      if (req.url === "/ready") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ready", policyVersion: 4, policyId: "policy_demo" }));
      }
      if (req.url === "/v1/inspect/chat/completions") {
        receivedAuthorization = req.headers.authorization;
        const receivedRequest = await readBody(req);
        receivedRequests.push(receivedRequest);
        const toolResult = receivedRequest.messages.find((message) => message.role === "tool");
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          ok: true,
          received: { messageCount: receivedRequest.messages.length, latestUserPrompt: receivedRequest.messages.at(-1).content, tools: [] },
          decision: { signatureId: "billing", signatureLabel: "Billing", confidence: .94, probabilities: { billing: .94 }, threshold: .86, status: "matched", latencyMs: 18 },
          route: { source: "task_override", taskBucketId: "billing", modelId: "deepseek-r1", openRouterModelId: "deepseek/deepseek-r1", policyVersion: 4, reason: "Matched Billing." },
          openRouterRequest: { model: "deepseek/deepseek-r1", provider: { order: ["DeepInfra"] }, messageCount: receivedRequest.messages.length, tools: [], stream: false },
          openRouterResponse: toolResult
            ? { id: "chat_demo_final", model: "google/gemini-3-flash", choices: [{ message: { role: "assistant", content: "I found your invoice." } }], usage: { total_tokens: 38 } }
            : { id: "chat_demo_tool", model: "google/gemini-3-flash", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_invoice", type: "function", function: { name: "lookup_invoice", arguments: "{\"invoice_id\":\"123\"}" } }] } }], usage: { total_tokens: 20 } },
          upstream: { status: 200, requestId: "req_demo", selectedModel: "google/gemini-3-flash" },
          timing: { classificationMs: 18, totalMs: 210 },
        }));
      }
      res.writeHead(404).end();
    });
    servers.add(sidecar);
    const sidecarPort = await listen(sidecar);
    const appPort = await freePort();
    const child = spawn(process.execPath, ["support-demo/server.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SUPPORT_DEMO_PORT: String(appPort),
        ROUTELAB_SIDECAR_URL: `http://127.0.0.1:${sidecarPort}`,
        ROUTELAB_SIDECAR_API_KEY: "support-demo-secret",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    const baseUrl = `http://127.0.0.1:${appPort}`;
    await waitUntilReady(`${baseUrl}/health`, child);

    const page = await fetch(baseUrl);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("RouteLab Support Console");

    const status = await fetch(`${baseUrl}/api/status`);
    expect(await status.json()).toMatchObject({ connected: true, policyVersion: 4 });

    const chat = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "support_session_test", messages: [{ role: "user", content: "Find invoice 123." }], tools: [{ type: "function", function: { name: "lookup_invoice" } }] }),
    });
    expect(chat.status).toBe(200);
    expect(await chat.json()).toMatchObject({
      route: { taskBucketId: "billing" },
      toolExecutions: [{ name: "lookup_invoice", arguments: { invoice_id: "123" }, result: { status: "available" } }],
      routingPasses: [{ route: { taskBucketId: "billing" } }, { route: { taskBucketId: "billing" } }],
      openRouterResponse: { model: "google/gemini-3-flash", choices: [{ message: { content: "I found your invoice." } }] },
      upstream: { selectedModel: "google/gemini-3-flash" },
    });
    expect(receivedAuthorization).toBe("Bearer support-demo-secret");
    expect(receivedRequests).toHaveLength(2);
    expect(receivedRequests.every((request) => request.session_id === "support_session_test")).toBe(true);
    expect(receivedRequests[0].messages[0].content).toBe("Find invoice 123.");
    expect(JSON.parse(receivedRequests[1].messages.at(-1).content)).toMatchObject({ invoice_id: "123", status: "available" });
  });
});
