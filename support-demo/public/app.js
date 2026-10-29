import { apiErrorMessage, readApiPayload } from "./http.js?v=1";

const conversation = document.querySelector("#conversation");
const composer = document.querySelector("#composer");
const prompt = document.querySelector("#prompt");
const sendButton = document.querySelector("#send-button");
const connection = document.querySelector("#connection");
const connectionLabel = document.querySelector("#connection-label");
const traceSubtitle = document.querySelector("#trace-subtitle");
const traceState = document.querySelector("#trace-state");
const apiBase = window.location.pathname.startsWith("/support-console") ? "/api/support" : "/api";
const supportSessionId = (() => {
  const key = "routelab-support-session-id";
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = `support_${window.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return `support_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
})();

const supportTools = [
  { type: "function", function: { name: "get_order_status", description: "Look up order status and shipping details.", parameters: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] } } },
  { type: "function", function: { name: "lookup_invoice", description: "Find an invoice and its payment status.", parameters: { type: "object", properties: { invoice_id: { type: "string" } } } } },
  { type: "function", function: { name: "issue_refund", description: "Issue an approved customer refund.", parameters: { type: "object", properties: { payment_id: { type: "string" }, reason: { type: "string" } }, required: ["payment_id", "reason"] } } },
  { type: "function", function: { name: "get_subscription", description: "Look up a customer's subscription and plan.", parameters: { type: "object", properties: { customer_id: { type: "string" } } } } },
];

const messages = [
  {
    role: "assistant",
    content: "Hi, I'm your support assistant from RouteLab. I can help with orders, invoices, plans, and account settings. What can I help you with today?",
    createdAt: new Date(),
  },
];

const formatTime = (date) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);

function initials(role) {
  return role === "assistant" ? "AI" : "You";
}

function renderMessages() {
  conversation.replaceChildren();
  for (const message of messages) {
    const article = document.createElement("article");
    article.className = "message";
    article.dataset.role = message.role;
    if (message.pending) article.dataset.state = "pending";

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = initials(message.role);
    avatar.setAttribute("aria-hidden", "true");

    const content = document.createElement("div");
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const author = document.createElement("span");
    author.className = "message-author";
    author.textContent = message.role === "assistant" ? "Support Assistant" : "Customer";
    const time = document.createElement("time");
    time.className = "message-time";
    time.textContent = formatTime(message.createdAt);
    meta.append(author, time);

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (message.pending) {
      bubble.setAttribute("aria-label", "Support assistant is responding");
      bubble.innerHTML = '<span class="thinking" aria-hidden="true"><span></span><span></span><span></span></span>';
    } else {
      bubble.textContent = message.content;
    }
    content.append(meta, bubble);
    article.append(avatar, content);
    conversation.append(article);
  }
  conversation.scrollTop = conversation.scrollHeight;
}

function setConnection(state, label) {
  connection.dataset.state = state;
  connectionLabel.textContent = label;
}

async function refreshStatus() {
  try {
    const response = await fetch(`${apiBase}/status`, { cache: "no-store" });
    const status = await readApiPayload(response);
    if (!response.ok || !status.connected) throw new Error(apiErrorMessage(status, "Sidecar unavailable"));
    setConnection("connected", `Sidecar connected - policy v${status.policyVersion}`);
  } catch {
    setConnection("error", "Sidecar disconnected");
  }
}

function setTraceState(state, subtitle) {
  traceState.dataset.state = state;
  traceState.textContent = state === "running" ? "Routing" : state === "complete" ? "Complete" : state === "error" ? "Failed" : "Idle";
  traceSubtitle.textContent = subtitle;
}

function step(name) {
  return document.querySelector(`[data-stage="${name}"]`);
}

function setStep(name, status, content) {
  const item = step(name);
  item.dataset.status = status;
  const target = item.querySelector(".step-content");
  const heading = target.querySelector("h2").cloneNode(true);
  target.replaceChildren(heading, content);
}

function emptyLoading() {
  const loading = document.createElement("div");
  loading.className = "empty-detail";
  loading.textContent = "Processing...";
  return loading;
}

function textNode(className, value) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = value == null || value === "" ? "-" : String(value);
  return node;
}

function details(rows) {
  const stack = document.createElement("div");
  stack.className = "detail-stack";
  for (const row of rows) {
    const line = document.createElement("div");
    line.className = "detail-row";
    line.append(textNode("detail-label", row.label), textNode(`detail-value${row.className ? ` ${row.className}` : ""}`, row.value));
    stack.append(line);
  }
  return stack;
}

function startTrace(userPrompt) {
  setTraceState("running", "The sidecar is evaluating this conversation");
  const received = document.createElement("div");
  const preview = document.createElement("p");
  preview.className = "prompt-preview";
  preview.textContent = userPrompt;
  received.append(preview, details([
    { label: "Messages", value: messages.filter((message) => !message.pending).length },
    { label: "Tools", value: `${supportTools.length} available` },
  ]));
  setStep("received", "active", received);
  for (const name of ["classified", "policy", "openrouter", "response"]) setStep(name, "active", emptyLoading());
}

const pct = (value) => `${Math.round(Number(value || 0) * 100)}%`;

function renderTrace(result) {
  const received = document.createElement("div");
  const preview = document.createElement("p");
  preview.className = "prompt-preview";
  preview.textContent = typeof result.received.latestUserPrompt === "string" ? result.received.latestUserPrompt : JSON.stringify(result.received.latestUserPrompt);
  received.append(preview, details([
    { label: "Messages", value: result.received.messageCount },
    { label: "Tools", value: `${result.received.tools.length} available` },
  ]));
  setStep("received", "complete", received);

  const classifier = document.createElement("div");
  classifier.append(details([
    { label: "Bucket", value: result.decision.signatureLabel, className: "accent" },
    { label: "Confidence", value: pct(result.decision.confidence) },
    { label: "Threshold", value: pct(result.decision.threshold) },
    { label: "Decision", value: result.decision.status },
  ]));
  const probabilities = Object.entries(result.decision.probabilities || {}).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 3);
  if (probabilities.length) {
    const list = document.createElement("div");
    list.className = "probability-list";
    for (const [name, probability] of probabilities) {
      const row = document.createElement("div");
      row.className = "probability";
      row.append(textNode("", name.replaceAll("_", " ")), textNode("", pct(probability)));
      list.append(row);
    }
    classifier.append(list);
  }
  setStep("classified", "complete", classifier);

  setStep("policy", "complete", details([
    { label: "Policy", value: `v${result.route.policyVersion}`, className: "mono" },
    { label: "Route", value: result.route.source.replaceAll("_", " ") },
    { label: "Bucket ID", value: result.route.taskBucketId, className: "mono" },
    { label: "Reason", value: result.route.reason },
  ]));

  const provider = result.openRouterRequest.provider?.order?.join(", ") || result.route.openRouterProvider || "OpenRouter automatic";
  setStep("openrouter", "complete", details([
    { label: "Model", value: result.openRouterRequest.model, className: "success mono" },
    { label: "Provider", value: provider },
    { label: "Messages", value: result.openRouterRequest.messageCount },
    { label: "Tools", value: result.openRouterRequest.tools.join(", ") || "None" },
    ...(result.toolExecutions?.length ? [{ label: "Executed", value: result.toolExecutions.map((execution) => execution.name).join(", ") }] : []),
  ]));

  const usage = result.openRouterResponse?.usage;
  const autoSelectedModel = result.openRouterRequest.model === "openrouter/auto"
    ? result.upstream?.selectedModel ?? result.openRouterResponse?.model ?? "Not reported by OpenRouter"
    : null;
  setStep("response", "complete", details([
    { label: "Status", value: result.upstream.status, className: result.ok ? "success" : "" },
    ...(autoSelectedModel ? [{ label: "Model selected", value: autoSelectedModel, className: autoSelectedModel === "Not reported by OpenRouter" ? "" : "success mono" }] : []),
    { label: "Latency", value: `${result.timing.totalMs}ms` },
    { label: "Tokens", value: usage?.total_tokens ?? "Not reported" },
    { label: "Request ID", value: result.upstream.requestId ?? result.openRouterResponse?.id ?? "Not reported", className: "mono" },
  ]));
  const routeSummary = autoSelectedModel && autoSelectedModel !== "Not reported by OpenRouter"
    ? `${result.openRouterRequest.model} selected ${autoSelectedModel}`
    : result.openRouterRequest.model;
  setTraceState(result.ok ? "complete" : "error", `${result.decision.signatureLabel} routed to ${routeSummary}`);
}

function renderTraceError(message) {
  const copy = document.createElement("div");
  copy.className = "empty-detail error-copy";
  copy.textContent = message;
  setStep("response", "complete", copy);
  setTraceState("error", "The request did not complete");
}

function assistantContent(payload) {
  const content = payload?.openRouterResponse?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? "").filter(Boolean).join("\n");
  return payload?.openRouterResponse?.error?.message || "OpenRouter returned no assistant message.";
}

function announceSavedTrace() {
  try {
    const channel = new BroadcastChannel("routelab-runtime-traces");
    channel.postMessage({ type: "trace_saved", sessionId: supportSessionId, savedAt: Date.now() });
    channel.close();
  } catch {}
}

async function sendMessage(value) {
  messages.push({ role: "user", content: value, createdAt: new Date() });
  messages.push({ role: "assistant", content: "", createdAt: new Date(), pending: true });
  renderMessages();
  startTrace(value);
  sendButton.disabled = true;
  prompt.disabled = true;

  const requestMessages = [
    { role: "system", content: "You are a concise, helpful customer support assistant. Use the available context and tools, do not invent completed actions, and clearly state when more account information is needed." },
    ...messages.filter((message) => !message.pending).map(({ role, content }) => ({ role, content })),
  ];

  try {
    const response = await fetch(`${apiBase}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: supportSessionId, messages: requestMessages, tools: supportTools, temperature: .2, max_tokens: 500, stream: false }),
    });
    const payload = await readApiPayload(response);
    if (!response.ok) throw new Error(apiErrorMessage(payload, `Request failed with HTTP ${response.status}.`));
    messages.pop();
    messages.push({ role: "assistant", content: assistantContent(payload), createdAt: new Date() });
    renderTrace(payload);
    announceSavedTrace();
  } catch (error) {
    messages.pop();
    messages.push({ role: "assistant", content: `I couldn't complete that request: ${error instanceof Error ? error.message : "Unknown error"}`, createdAt: new Date() });
    renderTraceError(error instanceof Error ? error.message : "Unknown error");
  } finally {
    renderMessages();
    sendButton.disabled = false;
    prompt.disabled = false;
    prompt.focus();
    refreshStatus();
  }
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = prompt.value.trim();
  if (!value || sendButton.disabled) return;
  prompt.value = "";
  prompt.style.height = "auto";
  sendMessage(value);
});

prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

prompt.addEventListener("input", () => {
  prompt.style.height = "auto";
  prompt.style.height = `${Math.min(prompt.scrollHeight, 170)}px`;
});

renderMessages();
refreshStatus();
