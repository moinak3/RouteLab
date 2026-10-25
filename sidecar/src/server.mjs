import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { PolicyClient } from "./policy.mjs";
import { routeConversation, routedChatRequest } from "./router.mjs";

const env = process.env;
const configuredPort = Number(env.PORT ?? 8787);
const port = Number.isInteger(configuredPort) && configuredPort >= 0 ? configuredPort : 8787;
const maxBodyBytes = Math.max(1_024, Number(env.ROUTELAB_MAX_BODY_BYTES ?? 2_000_000));
const openRouterChatUrl = String(env.OPENROUTER_CHAT_URL ?? "https://openrouter.ai/api/v1/chat/completions");
const decisionMode = String(env.ROUTELAB_DECISION_MODE ?? "enforce").toLowerCase() === "shadow" ? "shadow" : "enforce";
const openRouterApiKey = String(env.OPENROUTER_API_KEY ?? env.ROUTELAB_OPENROUTER_API_KEY ?? "").trim();
const sidecarApiKey = String(env.ROUTELAB_SIDECAR_API_KEY ?? "").trim();

if (!sidecarApiKey) throw new Error("ROUTELAB_SIDECAR_API_KEY is required.");

const policyClient = new PolicyClient({
  url: String(env.ROUTELAB_POLICY_URL ?? "").trim(),
  publicKey: String(env.ROUTELAB_POLICY_PUBLIC_KEY ?? "").trim(),
  pollMs: Number(env.ROUTELAB_POLICY_POLL_MS ?? 30_000),
});

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBodyBytes) throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 });
  }
}

const routeHeaders = (route) => ({
  "X-RouteLab-Policy-Version": String(route.policyVersion),
  "X-RouteLab-Bucket": route.taskBucketId,
  "X-RouteLab-Model": route.openRouterModelId,
  "X-RouteLab-Route-Source": route.source,
});

const authorized = (req) => {
  const authorization = String(req.headers.authorization ?? "");
  const supplied = authorization.replace(/^Bearer\s+/i, "").trim() || String(req.headers["x-routelab-api-key"] ?? "").trim();
  const expected = Buffer.from(sidecarApiKey);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

async function proxyChat(req, res, request, route) {
  const disconnected = new AbortController();
  const abort = () => disconnected.abort();
  req.once("aborted", abort);
  res.once("close", abort);
  try {
    const upstream = await fetch(openRouterChatUrl, {
      method: "POST",
      signal: AbortSignal.any([AbortSignal.timeout(120_000), disconnected.signal]),
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
        "X-Title": "RouteLab Sidecar",
      },
      body: JSON.stringify(routedChatRequest(request, route, decisionMode)),
    });
    const headers = {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      ...routeHeaders(route),
    };
    res.writeHead(upstream.status, headers);
    if (!upstream.body) return res.end();
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } finally {
    req.off("aborted", abort);
    res.off("close", abort);
  }
}

function inspectableRoute(route) {
  const { decision, ...selectedRoute } = route;
  return { decision, selectedRoute };
}

async function inspectChat(request, route) {
  const started = Date.now();
  const routedRequest = routedChatRequest({ ...request, stream: false }, route, decisionMode);
  const upstream = await fetch(openRouterChatUrl, {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      "Content-Type": "application/json",
      "X-Title": "RouteLab Support Console",
    },
    body: JSON.stringify(routedRequest),
  });
  const payload = await upstream.json().catch(() => ({
    error: { message: `OpenRouter returned a non-JSON response with HTTP ${upstream.status}.` },
  }));
  const selectedModel = typeof payload?.model === "string" && payload.model.trim()
    ? payload.model.trim()
    : null;
  const { decision, selectedRoute } = inspectableRoute(route);
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const tools = Array.isArray(request.tools) ? request.tools : [];
  return {
    ok: upstream.ok,
    received: {
      messages,
      messageCount: messages.length,
      latestUserPrompt: [...messages].reverse().find((message) => message?.role === "user")?.content ?? "",
      tools: tools.map((tool) => ({
        type: String(tool?.type ?? "function"),
        name: String(tool?.function?.name ?? tool?.name ?? "unknown_tool"),
        description: String(tool?.function?.description ?? tool?.description ?? ""),
      })),
      toolChoice: request.tool_choice ?? null,
      responseFormat: request.response_format ?? null,
    },
    decision,
    route: selectedRoute,
    openRouterRequest: {
      model: routedRequest.model,
      provider: routedRequest.provider ?? null,
      messageCount: messages.length,
      tools: tools.map((tool) => String(tool?.function?.name ?? tool?.name ?? "unknown_tool")),
      stream: false,
    },
    openRouterResponse: payload,
    upstream: {
      status: upstream.status,
      requestId: upstream.headers.get("x-request-id") ?? upstream.headers.get("x-openrouter-request-id"),
      selectedModel,
    },
    timing: {
      classificationMs: decision.latencyMs,
      totalMs: Date.now() - started + Number(decision.latencyMs ?? 0),
    },
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { status: "ok" });
    if (req.method === "GET" && url.pathname === "/ready") {
      try {
        const bundle = policyClient.getBundle();
        return json(res, 200, { status: "ready", policyVersion: bundle.version, policyId: bundle.policyId, mode: decisionMode });
      } catch (error) {
        return json(res, 503, { status: "not_ready", error: error instanceof Error ? error.message : "No verified policy is loaded." });
      }
    }
    if (req.method === "POST" && (url.pathname === "/v1/route" || url.pathname === "/v1/chat/completions" || url.pathname === "/v1/inspect/chat/completions")) {
      if (!authorized(req)) return json(res, 401, { error: { message: "A valid RouteLab sidecar API key is required.", type: "authentication_error" } });
      const request = await readJson(req);
      const route = await routeConversation({ request, bundle: policyClient.getBundle(), apiKey: openRouterApiKey });
      if (url.pathname === "/v1/route") return json(res, 200, { route }, routeHeaders(route));
      if (!openRouterApiKey) return json(res, 503, { error: { message: "OPENROUTER_API_KEY or ROUTELAB_OPENROUTER_API_KEY is required for chat completions.", type: "configuration_error" }, route }, routeHeaders(route));
      if (url.pathname === "/v1/inspect/chat/completions") {
        const result = await inspectChat(request, route);
        return json(res, 200, result, routeHeaders(route));
      }
      return await proxyChat(req, res, request, route);
    }
    return json(res, 404, { error: { message: "Not found. Use /v1/route, /v1/chat/completions, or /v1/inspect/chat/completions.", type: "not_found" } });
  } catch (error) {
    const status = Number(error?.statusCode ?? 500);
    return json(res, status, { error: { message: error instanceof Error ? error.message : "RouteLab sidecar request failed.", type: status >= 500 ? "sidecar_error" : "invalid_request_error" } });
  }
});

try {
  await policyClient.refresh();
  policyClient.start();
  server.listen(port, "0.0.0.0", () => console.info(`RouteLab sidecar listening on :${port} in ${decisionMode} mode.`));
} catch (error) {
  console.error(`RouteLab sidecar failed to start: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}

const shutdown = () => {
  policyClient.stop();
  server.close(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
