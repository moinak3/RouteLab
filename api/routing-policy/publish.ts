import { sendJson } from "../live/_shared.js";
import { JEV_RISK_THRESHOLDS } from "../../src/core/jevSignatureGate.js";
import { getModel } from "../../src/core/catalog.js";
import { ROUTING_POLICY_SCHEMA_VERSION, isPublishedTaskSignature, validatePublishableDraft, type RoutingPolicyBundle } from "../../src/core/publishedRoutingPolicy.js";
import { PolicySigningUnavailableError, signRoutingPolicy } from "./_signing.js";
import { routingPolicyDatabaseUrl, routingPolicySigningConfig, routingPolicyWorkspaceId } from "./_config.js";
import { getRoutingPolicyDraft, nextRoutingPolicyVersion, PolicyStoreUnavailableError, publishRoutingPolicyVersion } from "./_store.js";

const dynamicOpenRouterModel = /^(openai|anthropic|google|mistralai|deepseek)\/[a-z0-9][a-z0-9._:-]*$/i;

const openRouterModelId = (modelId: string, configured?: string) => {
  const explicit = String(configured ?? "").trim();
  if (explicit) return dynamicOpenRouterModel.test(explicit) ? explicit : "";
  const model = getModel(modelId);
  const catalogTarget = String(model?.pricing_source_model_id ?? "").trim();
  if (catalogTarget) return catalogTarget;
  const dynamicTarget = modelId.startsWith("openrouter:") ? modelId.slice("openrouter:".length) : modelId;
  return dynamicOpenRouterModel.test(dynamicTarget) ? dynamicTarget : "";
};

const openRouterProvider = (providerId?: string, providerName?: string) => {
  const key = String(providerId ?? providerName ?? "").trim().toLowerCase();
  if (!key || ["openrouter", "vercel-ai-gateway", "litellm-gateway"].includes(key)) return undefined;
  const names: Record<string, string> = {
    "openai-direct": "OpenAI",
    "anthropic-direct": "Anthropic",
    "google-ai-studio": "Google AI Studio",
    "vertex-ai": "Google Vertex",
    "mistral-direct": "Mistral",
    "deepseek-direct": "DeepSeek",
    "together-ai": "Together",
    "fireworks-ai": "Fireworks",
    "aws-bedrock": "Amazon Bedrock",
    "azure-ai-foundry": "Azure",
    deepinfra: "DeepInfra",
  };
  return names[key];
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  try {
    const databaseUrl = routingPolicyDatabaseUrl();
    const workspaceId = routingPolicyWorkspaceId(req);
    const current = await getRoutingPolicyDraft(databaseUrl, workspaceId);
    const expectedRevision = Number(req.body?.expectedRevision);
    const signatures = Array.isArray(req.body?.signatures) ? req.body.signatures : [];
    if (!current.draft) return sendJson(res, 409, { error: "Save a routing policy draft before publishing." });
    if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) {
      return sendJson(res, 409, { error: "The cloud draft changed. Reload it before publishing.", current });
    }
    if (!signatures.every(isPublishedTaskSignature)) return sendJson(res, 400, { error: "The task signature catalog is invalid." });
    const errors = validatePublishableDraft(current.draft, signatures);
    const defaultOpenRouterModelId = current.draft.defaultStrategyType === "fixed_model"
      ? openRouterModelId(current.draft.defaultModelId, current.draft.defaultOpenRouterModelId)
      : "openrouter/auto";
    const emergencyOpenRouterModelId = openRouterModelId(current.draft.emergencyFallbackModelId, current.draft.emergencyFallbackOpenRouterModelId);
    if (!defaultOpenRouterModelId) errors.push("The fixed default model does not have an OpenRouter runtime target.");
    if (!emergencyOpenRouterModelId) errors.push("The emergency fallback model does not have an OpenRouter runtime target.");
    for (const override of Object.values(current.draft.overrides)) {
      if (!openRouterModelId(override.modelId, override.openRouterModelId)) errors.push(`${override.taskName} does not have an OpenRouter runtime target.`);
    }
    if (errors.length) return sendJson(res, 422, { error: "The routing policy is not publishable.", details: errors });
    const version = await nextRoutingPolicyVersion(databaseUrl, workspaceId);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt);
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 90);
    const bundle: RoutingPolicyBundle = {
      schemaVersion: ROUTING_POLICY_SCHEMA_VERSION,
      workspaceId,
      policyId: crypto.randomUUID(),
      version,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      classifier: {
        provider: "openrouter",
        model: String(process.env.ROUTELAB_JEV_MODEL ?? "typesafe/jev-1.14").trim(),
        endpoint: "https://openrouter.ai/api/alpha/decisions",
        timeoutMs: 1_500,
        unknownSignatureId: "unknown",
        riskThresholds: JEV_RISK_THRESHOLDS,
      },
      defaultStrategy: current.draft.defaultStrategyType === "openrouter_auto"
        ? { type: "openrouter_auto", openRouterModelId: "openrouter/auto", costTier: current.draft.autoRouterCostTier }
        : { type: "fixed_model", target: { modelId: current.draft.defaultModelId, openRouterModelId: defaultOpenRouterModelId } },
      emergencyFallback: { modelId: current.draft.emergencyFallbackModelId, openRouterModelId: emergencyOpenRouterModelId },
      guardrails: {
        minimumPassRate: current.draft.minimumPassRate,
        maximumLatencyIncreasePct: current.draft.maximumLatencyIncreasePct,
        minimumReplayCount: 3,
      },
      signatures,
      overrides: Object.values(current.draft.overrides).map((override) => ({
        taskId: override.taskId,
        modelId: override.modelId,
        openRouterModelId: openRouterModelId(override.modelId, override.openRouterModelId),
        ...(override.provider ? { provider: override.provider } : {}),
        ...(openRouterProvider(override.providerId, override.provider) ? { openRouterProvider: openRouterProvider(override.providerId, override.provider) } : {}),
        evidence: {
          passRate: override.passRate,
          costDeltaPct: override.costDeltaPct,
          latencyDeltaPct: override.latencyDeltaPct,
          replayCount: override.replayCount,
          measuredAt: override.updatedAt,
        },
      })),
    };
    const signed = await signRoutingPolicy(bundle, routingPolicySigningConfig());
    const published = await publishRoutingPolicyVersion(databaseUrl, workspaceId, signed);
    return sendJson(res, 201, published);
  } catch (error) {
    if (error instanceof PolicyStoreUnavailableError || error instanceof PolicySigningUnavailableError) return sendJson(res, 503, { error: error.message });
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Policy publishing failed." });
  }
}
