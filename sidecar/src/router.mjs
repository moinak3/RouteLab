const textContent = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part?.type === "text") return String(part.text ?? "");
    if (part?.type === "image_url") return "[image]";
    return JSON.stringify(part);
  }).join("\n");
};

const toolDefinition = (tool) => ({
  type: String(tool?.type ?? "function"),
  name: String(tool?.function?.name ?? tool?.name ?? "unknown_tool"),
  description: String(tool?.function?.description ?? tool?.description ?? ""),
  parameters: tool?.function?.parameters ?? tool?.parameters ?? {},
});

export function conversationState(request) {
  const messages = Array.isArray(request?.messages) ? request.messages : [];
  const tools = Array.isArray(request?.tools) ? request.tools : [];
  return {
    conversation: messages.map((message) => ({
      role: String(message?.role ?? "user"),
      content: textContent(message?.content),
      tool_calls: Array.isArray(message?.tool_calls)
        ? message.tool_calls.map((call) => ({ name: call?.function?.name, arguments: call?.function?.arguments }))
        : undefined,
      tool_call_id: message?.tool_call_id,
    })),
    latest_user_prompt: [...messages].reverse().find((message) => message?.role === "user")?.content ?? "",
    available_tools: tools.map(toolDefinition),
    tool_choice: request?.tool_choice,
    response_format: request?.response_format,
    session_id: request?.session_id,
  };
}

const title = (value) => String(value ?? "").replace(/_/g, " ");

export function signatureCriteria(signatures, unknownSignatureId = "unknown") {
  const criteria = Object.fromEntries(signatures.map((signature) => {
    const task = signature.task
      ? ` Taxonomy: task=${title(signature.task.task_type)}, domain=${title(signature.task.domain)}, complexity=${signature.task.complexity}, session=${title(signature.task.temporal_context)}, tool use=${title(signature.task.tool_use)}, grounding=${title(signature.task.grounding_requirement)}, output=${title(signature.task.output_format)}.`
      : "";
    const examples = Array.isArray(signature.examples) && signature.examples.length
      ? ` Representative prompts: ${signature.examples.map((example) => JSON.stringify(example)).join("; ")}.`
      : "";
    return [signature.id, `${signature.description}.${task}${examples}`];
  }));
  criteria[unknownSignatureId] = "The conversation does not reliably match any published RouteLab trace bucket, or there is not enough evidence to decide.";
  return criteria;
}

const failedDecision = (status, reason, latencyMs = 0) => ({
  signatureId: "unknown",
  signatureLabel: "Unknown or new trace bucket",
  confidence: 0,
  probabilities: {},
  threshold: 1,
  status,
  latencyMs,
  reason,
});

export async function classifyConversation({ request, bundle, apiKey, fetchImpl = fetch }) {
  if (!apiKey) return failedDecision("provider_unavailable", "OPENROUTER_API_KEY is not configured; classifier failure requires the emergency fallback.");
  const started = Date.now();
  const controller = new AbortController();
  const timeoutMs = Math.max(250, Math.min(10_000, Number(bundle.classifier.timeoutMs) || 1_500));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(bundle.classifier.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "RouteLab Sidecar Classifier",
      },
      body: JSON.stringify({
        model: bundle.classifier.model,
        state: conversationState(request),
        questions: {
          trace_bucket: {
            type: "choice",
            instructions: "Map this incoming conversation to exactly one published RouteLab trace bucket. Consider the prompt, prior turns, available tools, requested output, grounding needs, and workflow state. Choose unknown when no bucket is a reliable match.",
            criteria: signatureCriteria(bundle.signatures, bundle.classifier.unknownSignatureId),
          },
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? `OpenRouter Decisions HTTP ${response.status}`);
    const answer = payload?.answers?.trace_bucket;
    if (!answer || answer.type !== "choice" || typeof answer.choice !== "string") throw new Error("OpenRouter returned no trace-bucket decision.");
    const signature = bundle.signatures.find((item) => item.id === answer.choice);
    const isUnknown = answer.choice === bundle.classifier.unknownSignatureId || !signature;
    const threshold = signature ? Number(bundle.classifier.riskThresholds?.[signature.riskLevel] ?? .8) : 1;
    const confidence = Number(answer.confidence ?? answer.probabilities?.[answer.choice] ?? 0);
    const lowConfidence = !isUnknown && confidence < threshold;
    return {
      signatureId: signature?.id ?? bundle.classifier.unknownSignatureId,
      signatureLabel: signature?.label ?? "Unknown or new trace bucket",
      confidence,
      probabilities: answer.probabilities ?? {},
      threshold,
      status: isUnknown ? "unknown" : lowConfidence ? "low_confidence" : "matched",
      latencyMs: Date.now() - started,
      reason: isUnknown
        ? "No published trace bucket matched reliably; using the configured default strategy."
        : lowConfidence
          ? `Classification confidence ${confidence.toFixed(3)} is below the ${threshold.toFixed(3)} ${signature.riskLevel}-risk threshold; using the configured default strategy unless the task requires the high-risk emergency route.`
          : `Matched ${signature.label} above its ${threshold.toFixed(3)} routing threshold.`,
    };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError";
    return failedDecision(timeout ? "timeout" : "error", `${timeout ? `Classification exceeded ${timeoutMs}ms` : error instanceof Error ? error.message : "Classification failed"}; using the emergency fallback.`, Date.now() - started);
  } finally {
    clearTimeout(timer);
  }
}

export function selectRoute(bundle, decision) {
  const signature = bundle.signatures.find((item) => item.id === decision.signatureId);
  const override = decision.status === "matched"
    ? bundle.overrides.find((item) => item.taskId === decision.signatureId)
    : undefined;
  const classifierFailed = ["provider_unavailable", "timeout", "error"].includes(decision.status);
  const constrainedHighRisk = decision.status === "low_confidence" && signature?.riskLevel === "high";
  const emergency = classifierFailed || constrainedHighRisk;
  const legacyFallback = bundle.fallback;
  const defaultStrategy = bundle.defaultStrategy ?? (legacyFallback ? { type: "fixed_model", target: legacyFallback } : undefined);
  const emergencyFallback = bundle.emergencyFallback ?? legacyFallback;
  const defaultTarget = defaultStrategy?.type === "openrouter_auto"
    ? { modelId: "openrouter-auto", openRouterModelId: defaultStrategy.openRouterModelId }
    : defaultStrategy?.target;
  const target = override ?? (emergency ? emergencyFallback : defaultTarget);
  if (!target) throw new Error("The policy has no usable route target.");
  const source = override ? "task_override" : emergency ? "emergency_fallback" : "default_strategy";
  const openRouterModelId = String(target.openRouterModelId ?? target.modelId).replace(/^openrouter:/, "");
  return {
    source,
    taskBucketId: decision.signatureId,
    taskBucketLabel: decision.signatureLabel,
    modelId: target.modelId,
    openRouterModelId,
    provider: target.provider,
    openRouterProvider: target.openRouterProvider,
    policyId: bundle.policyId,
    policyVersion: bundle.version,
    decision,
    reason: override
      ? `${decision.reason} Applying the published override for ${decision.signatureLabel}.`
      : emergency
        ? `${decision.reason} Applying the fixed emergency fallback.`
        : `${decision.reason}${decision.status === "matched" ? " This bucket has no approved override." : ""} Applying the configured default strategy.`,
  };
}

export async function routeConversation(options) {
  const decision = await classifyConversation(options);
  return selectRoute(options.bundle, decision);
}

export function routedChatRequest(request, route, decisionMode = "enforce") {
  const enforce = decisionMode !== "shadow" || !String(request?.model ?? "").trim();
  const provider = route.openRouterProvider
    ? { ...(request?.provider ?? {}), order: [route.openRouterProvider], allow_fallbacks: true }
    : request?.provider;
  return {
    ...request,
    model: enforce ? route.openRouterModelId : request.model,
    ...(provider ? { provider } : {}),
  };
}
