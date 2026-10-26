import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const port = Number(process.env.SUPPORT_DEMO_PORT ?? 8790);
const sidecarUrl = String(process.env.ROUTELAB_SIDECAR_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const sidecarApiKey = String(process.env.ROUTELAB_SIDECAR_API_KEY ?? "").trim();
const maxBodyBytes = 1_000_000;

const assets = new Map([
  ["/", { path: resolve(here, "public/index.html"), type: "text/html; charset=utf-8" }],
  ["/index.html", { path: resolve(here, "public/index.html"), type: "text/html; charset=utf-8" }],
  ["/styles.css", { path: resolve(here, "public/styles.css"), type: "text/css; charset=utf-8" }],
  ["/app.js", { path: resolve(here, "public/app.js"), type: "text/javascript; charset=utf-8" }],
  ["/routelab-icon.svg", { path: resolve(repoRoot, "public/routelab-icon.svg"), type: "image/svg+xml" }],
]);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 });
  }
}

async function fetchSidecar(path, options = {}) {
  return fetch(`${sidecarUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(125_000),
  });
}

async function inspectedCompletion(request, continuationToken = "") {
  const response = await fetchSidecar("/v1/inspect/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${sidecarApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...request,
      stream: false,
      ...(continuationToken ? { routelab_continuation: continuationToken } : {}),
    }),
  });
  const payload = await response.json().catch(() => ({ error: { message: `Sidecar returned HTTP ${response.status} without JSON.` } }));
  return { status: response.status, payload };
}

function parseToolArguments(value) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value ?? "{}"));
  } catch {
    return {};
  }
}

function executeSupportTool(call) {
  const name = String(call?.function?.name ?? "unknown_tool");
  const arguments_ = parseToolArguments(call?.function?.arguments);
  if (name === "get_order_status") {
    return { name, arguments: arguments_, result: { order_id: arguments_.order_id ?? "unknown", status: "processing", tracking_status: "pending", estimated_update: "within one business day" } };
  }
  if (name === "lookup_invoice") {
    return { name, arguments: arguments_, result: { invoice_id: arguments_.invoice_id ?? "unknown", status: "available", delivery: "secure customer portal" } };
  }
  if (name === "issue_refund") {
    return { name, arguments: arguments_, result: { status: "approval_required", action_taken: false, reason: "Refunds require a support-agent approval." } };
  }
  if (name === "get_subscription") {
    return { name, arguments: arguments_, result: { customer_id: arguments_.customer_id ?? "unknown", plan: "RouteLab Pro", status: "active", billing_cycle: "monthly" } };
  }
  return { name, arguments: arguments_, result: { error: "This tool is not implemented by the support demo." } };
}

async function supportCompletion(request) {
  const first = await inspectedCompletion(request);
  const message = first.payload?.openRouterResponse?.choices?.[0]?.message;
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  if (first.status !== 200 || !first.payload?.ok || !toolCalls.length) return first;

  const toolExecutions = toolCalls.map(executeSupportTool);
  const toolMessages = toolCalls.map((call, index) => ({
    role: "tool",
    tool_call_id: call.id,
    name: toolExecutions[index].name,
    content: JSON.stringify(toolExecutions[index].result),
  }));
  const second = await inspectedCompletion(
    {
      ...request,
      messages: [
        ...(Array.isArray(request.messages) ? request.messages : []),
        { role: "assistant", content: message.content ?? null, tool_calls: toolCalls },
        ...toolMessages,
      ],
    },
    first.payload?.continuationToken,
  );
  const firstPass = {
    decision: first.payload.decision,
    route: first.payload.route,
    openRouterRequest: first.payload.openRouterRequest,
    upstream: first.payload.upstream,
    timing: first.payload.timing,
    classificationReused: false,
  };
  const secondPass = {
    decision: second.payload?.decision,
    route: second.payload?.route,
    openRouterRequest: second.payload?.openRouterRequest,
    upstream: second.payload?.upstream,
    timing: second.payload?.timing,
    classificationReused: true,
  };
  return {
    status: second.status,
    payload: {
      ...second.payload,
      toolExecutions,
      classifierInvocations: 1,
      classificationReused: true,
      routingPasses: [firstPass, secondPass],
      timing: {
        ...second.payload?.timing,
        totalMs: Number(first.payload?.timing?.totalMs ?? 0) + Number(second.payload?.timing?.totalMs ?? 0),
      },
    },
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { status: "ok" });

    if (req.method === "GET" && url.pathname === "/api/status") {
      try {
        const response = await fetchSidecar("/ready");
        const payload = await response.json().catch(() => ({}));
        return sendJson(res, response.ok ? 200 : 503, { connected: response.ok, sidecarUrl, ...payload });
      } catch (error) {
        return sendJson(res, 503, { connected: false, sidecarUrl, status: "unavailable", error: error instanceof Error ? error.message : "Sidecar is unavailable." });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      if (!sidecarApiKey) return sendJson(res, 503, { error: { message: "ROUTELAB_SIDECAR_API_KEY is not configured for the support console." } });
      const request = await readJson(req);
      const result = await supportCompletion(request);
      return sendJson(res, result.status, result.payload);
    }

    if (req.method === "GET" && assets.has(url.pathname)) {
      const asset = assets.get(url.pathname);
      const body = await readFile(asset.path);
      res.writeHead(200, {
        "Content-Type": asset.type,
        "Content-Length": body.length,
        "Cache-Control": url.pathname === "/" || url.pathname === "/index.html" ? "no-store" : "public, max-age=3600",
        "Content-Security-Policy": "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
      });
      return res.end(body);
    }

    return sendJson(res, 404, { error: { message: "Not found." } });
  } catch (error) {
    const status = Number(error?.statusCode ?? 502);
    return sendJson(res, status, { error: { message: error instanceof Error ? error.message : "Support console request failed." } });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.info(`RouteLab Support Console listening on http://127.0.0.1:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
