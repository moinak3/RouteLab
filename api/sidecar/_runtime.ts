import { timingSafeEqual } from "node:crypto";
import { verifyPolicyEnvelope } from "../../sidecar/src/policy.mjs";
import { routeConversation, routedChatRequest } from "../../sidecar/src/router.mjs";

const policyCacheMs = 5_000;
let cachedEnvelope: any = null;
let cachedAt = 0;
let cachedEtag = "";

const openRouterApiKey = () => String(process.env.ROUTELAB_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "").trim();
const policyUrl = () => String(process.env.ROUTELAB_POLICY_URL ?? "").trim();
const policyPublicKey = () => String(process.env.ROUTELAB_POLICY_PUBLIC_KEY ?? process.env.ROUTELAB_POLICY_SIGNING_PUBLIC_KEY ?? "").trim();
const sidecarApiKey = () => String(process.env.ROUTELAB_SIDECAR_API_KEY ?? "").trim();
const decisionMode = () => String(process.env.ROUTELAB_DECISION_MODE ?? "enforce").trim() || "enforce";
const openRouterChatUrl = () => String(process.env.OPENROUTER_CHAT_URL ?? "https://openrouter.ai/api/v1/chat/completions").trim();

const statusError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

export function sidecarAuthorized(req: any) {
  const expectedValue = sidecarApiKey();
  if (!expectedValue) return false;
  const authorization = String(req.headers?.authorization ?? "");
  const suppliedValue = authorization.replace(/^Bearer\s+/i, "").trim() || String(req.headers?.["x-routelab-api-key"] ?? "").trim();
  const expected = Buffer.from(expectedValue);
  const supplied = Buffer.from(suppliedValue);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function loadPolicyBundle() {
  const url = policyUrl();
  const publicKey = policyPublicKey();
  if (!url) throw statusError("ROUTELAB_POLICY_URL is not configured.", 503);
  if (!publicKey) throw statusError("The RouteLab policy verification key is not configured.", 503);
  if (cachedEnvelope && Date.now() - cachedAt < policyCacheMs) return cachedEnvelope.bundle;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (cachedEtag) headers["If-None-Match"] = cachedEtag;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (response.status === 304 && cachedEnvelope) {
    cachedAt = Date.now();
    return cachedEnvelope.bundle;
  }
  if (!response.ok) throw statusError(`Policy endpoint returned HTTP ${response.status}.`, 503);
  const envelope = await response.json();
  await verifyPolicyEnvelope(envelope, publicKey);
  cachedEnvelope = envelope;
  cachedAt = Date.now();
  cachedEtag = response.headers.get("etag") ?? `"${envelope.bundle.policyId}"`;
  return envelope.bundle;
}

export const routeHeaders = (route: any) => ({
  "X-RouteLab-Policy-Version": String(route.policyVersion),
  "X-RouteLab-Bucket": String(route.taskBucketId),
  "X-RouteLab-Model": String(route.openRouterModelId),
  "X-RouteLab-Route-Source": String(route.source),
});

export async function runRoute(request: any) {
  const bundle = await loadPolicyBundle();
  return routeConversation({ request, bundle, apiKey: openRouterApiKey() });
}

export async function runInspectedCompletion(request: any) {
  const apiKey = openRouterApiKey();
  if (!apiKey) throw statusError("ROUTELAB_OPENROUTER_API_KEY is not configured.", 503);
  const route = await runRoute(request);
  const started = Date.now();
  const routedRequest = routedChatRequest({ ...request, stream: false }, route, decisionMode());
  const upstream = await fetch(openRouterChatUrl(), {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "RouteLab Hosted Sidecar Demo",
    },
    body: JSON.stringify(routedRequest),
  });
  const payload = await upstream.json().catch(() => ({
    error: { message: `OpenRouter returned a non-JSON response with HTTP ${upstream.status}.` },
  }));
  const { decision, ...selectedRoute } = route;
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const tools = Array.isArray(request.tools) ? request.tools : [];
  return {
    status: upstream.status,
    headers: routeHeaders(route),
    payload: {
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
      },
      timing: {
        classificationMs: decision.latencyMs,
        totalMs: Date.now() - started + Number(decision.latencyMs ?? 0),
      },
    },
  };
}

export async function runChatCompletion(request: any) {
  if (request?.stream) throw statusError("The hosted sidecar demo does not support streaming. Use the Docker sidecar for streaming responses.", 400);
  const apiKey = openRouterApiKey();
  if (!apiKey) throw statusError("ROUTELAB_OPENROUTER_API_KEY is not configured.", 503);
  const route = await runRoute(request);
  const upstream = await fetch(openRouterChatUrl(), {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "RouteLab Hosted Sidecar Demo",
    },
    body: JSON.stringify(routedChatRequest({ ...request, stream: false }, route, decisionMode())),
  });
  const payload = await upstream.json().catch(() => ({
    error: { message: `OpenRouter returned a non-JSON response with HTTP ${upstream.status}.` },
  }));
  return { status: upstream.status, headers: routeHeaders(route), payload };
}

export function runtimeError(error: unknown) {
  return {
    status: Number((error as any)?.statusCode ?? 500),
    payload: {
      error: {
        message: error instanceof Error ? error.message : "RouteLab hosted sidecar request failed.",
        type: Number((error as any)?.statusCode ?? 500) >= 500 ? "sidecar_error" : "invalid_request_error",
      },
    },
  };
}
