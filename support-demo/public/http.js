export async function readApiPayload(response) {
  const body = await response.text();
  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch {
    return {
      error: {
        message: response.ok
          ? "RouteLab returned an unreadable response. Please try again."
          : "The RouteLab support service is temporarily unavailable. Please try again.",
        type: "invalid_response",
      },
    };
  }
}

export function apiErrorMessage(payload, fallback) {
  if (typeof payload?.error === "string" && payload.error.trim()) return payload.error.trim();
  if (typeof payload?.error?.message === "string" && payload.error.message.trim()) return payload.error.message.trim();
  if (typeof payload?.message === "string" && payload.message.trim()) return payload.message.trim();
  return fallback;
}

const workspaceIdPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

export function supportWorkspaceContext(search = "") {
  const params = new URLSearchParams(search);
  const requested = String(params.get("workspace") ?? "").trim();
  const workspaceId = workspaceIdPattern.test(requested) ? requested : "demo";
  const requestedLabel = String(params.get("workspaceLabel") ?? "").trim();
  const workspaceLabel = requestedLabel || (workspaceId === "demo" ? "RouteLab demo" : "My workspace");
  return { workspaceId, workspaceLabel };
}

export function supportConsolePersona(workspaceId) {
  if (workspaceId === "demo") {
    return {
      assistantName: "Support Assistant",
      greeting: "Hi, I'm your support assistant from RouteLab. I can help with orders, invoices, plans, and account settings. What can I help you with today?",
      pendingLabel: "Support assistant is responding",
      composerPlaceholder: "Ask support about an order, invoice, or plan...",
      conversationLabel: "Customer support conversation",
      promptLabel: "Customer support message",
      idleTraceLabel: "Waiting for the next support request",
      systemPrompt: "You are a concise, helpful customer support assistant. Use the available context and tools, do not invent completed actions, and clearly state when more account information is needed.",
    };
  }

  return {
    assistantName: "Personal Assistant",
    greeting: "Hi, I'm your personal assistant. I can help answer questions, organize plans, remember preferences, draft messages, and take actions when you ask. What would you like help with?",
    pendingLabel: "Personal assistant is responding",
    composerPlaceholder: "Ask for help with a question, plan, message, or task...",
    conversationLabel: "Personal assistant conversation",
    promptLabel: "Message your personal assistant",
    idleTraceLabel: "Waiting for the next personal-assistant request",
    systemPrompt: "You are a concise, helpful personal assistant. Help the user answer questions, organize plans, remember stated preferences, draft content, and use available tools when appropriate. Preserve user control: do not claim an action was completed unless a successful tool result proves it, and ask for clarification before ambiguous or consequential actions.",
  };
}

export function scopedSupportApiUrl(apiBase, path, workspaceId) {
  return `${apiBase}/${path}?workspace=${encodeURIComponent(workspaceId)}`;
}
