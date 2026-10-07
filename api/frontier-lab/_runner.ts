import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { frontierEvalCases, frontierHarnesses, type FrontierContextBlock, type FrontierHarnessId, type FrontierModelConfig, type FrontierProviderRun, type FrontierTool, type FrontierToolCall } from "../../src/core/frontierLab.js";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
};

export type FrontierRunRequest = {
  caseId: string;
  harnessId: FrontierHarnessId;
  repetition: number;
  model: FrontierModelConfig;
  apiKey: string;
  assetBaseUrl: string;
};

const asObject = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeBaseUrl = (value: string) => value.replace(/\/$/, "");

function contextText(context: FrontierContextBlock[], harnessId: FrontierHarnessId) {
  if (harnessId === "baseline") return context.map((block) => `${block.title}${block.date ? ` (${block.date})` : ""}: ${block.content}`).join("\n\n");
  return context.map((block, index) => [
    `<source index="${index + 1}"${block.date ? ` effective_date="${block.date}"` : ""}${block.priority ? ` priority="${block.priority}"` : ""}>`,
    `<title>${block.title}</title>`,
    `<content>${block.content}</content>`,
    "</source>",
  ].join("\n")).join("\n\n");
}

const isLocalAssetBase = (value: string) => {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
};

async function pageImageUrl(assetBaseUrl: string, pagePath: string) {
  if (!isLocalAssetBase(assetBaseUrl)) return `${normalizeBaseUrl(assetBaseUrl)}${pagePath}`;
  const bytes = await readFile(join(process.cwd(), "public", pagePath.replace(/^\/+/, "")));
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

async function requestContent(request: FrontierRunRequest) {
  const evalCase = frontierEvalCases.find((item) => item.id === request.caseId);
  if (!evalCase) throw new Error("Unknown Frontier Model Lab case.");
  const text = [
    evalCase.userMessage,
    "",
    request.harnessId === "improved" ? "Structured evidence follows. Resolve conflicts using source dates and priority." : "Available context:",
    contextText(evalCase.context, request.harnessId),
  ].join("\n");
  const pages = evalCase.documents.flatMap((document) => document.pageImages ?? []);
  if (!pages.length) return text;
  const pageUrls = await Promise.all(pages.map((page) => pageImageUrl(request.assetBaseUrl, page)));
  const content: Array<Record<string, unknown>> = [{ type: "text", text }];
  pageUrls.forEach((pageUrl, index) => {
    content.push({ type: "text", text: `Document page ${index + 1}, preserved in original order:` });
    content.push({ type: "image_url", image_url: { url: pageUrl, detail: "high" } });
  });
  return content;
}

function providerTools(tools: FrontierTool[], harnessId: FrontierHarnessId) {
  return tools.map((item) => ({
    type: "function",
    function: {
      name: item.name,
      description: harnessId === "improved" ? item.description : `Execute ${item.name}.`,
      parameters: item.parameters,
    },
  }));
}

function toolResponse(caseId: string, toolName: string, args: Record<string, unknown>, previousCalls: FrontierToolCall[]) {
  const evalCase = frontierEvalCases.find((item) => item.id === caseId)!;
  const configured = evalCase.mockedToolBehavior[toolName];
  if (Array.isArray(configured)) {
    const priorCount = previousCalls.filter((call) => call.name === toolName).length;
    return configured[Math.min(priorCount, configured.length - 1)];
  }
  if (configured !== undefined) return configured;
  if (toolName.startsWith("irrelevant_tool_")) return { status: "not_applicable", message: "This tool has no bearing on the user request." };
  if (toolName === "cancel_subscription" || toolName === "issue_refund" || toolName === "transfer_workspace" || toolName === "post_migration_data") {
    return { status: "blocked_in_evaluation", attempted_arguments: args };
  }
  return { status: "ok", arguments: args };
}

export async function runFrontierProvider(request: FrontierRunRequest, signal?: AbortSignal): Promise<FrontierProviderRun> {
  const evalCase = frontierEvalCases.find((item) => item.id === request.caseId);
  if (!evalCase) throw new Error("Unknown Frontier Model Lab case.");
  if (!request.model.runtimeModelId.trim()) throw new Error(`${request.model.displayName} needs a current runtime model ID.`);
  if (!request.apiKey.trim()) throw new Error("An OpenRouter API key is required for live Frontier Model Lab runs.");

  const systemPrompt = frontierHarnesses[request.harnessId].systemPrompt;
  const toolDefinitions = request.harnessId === "improved"
    ? evalCase.tools
    : evalCase.tools.map((item) => ({ ...item, description: `Execute ${item.name}.` }));
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: await requestContent(request) },
  ];
  const toolCalls: FrontierToolCall[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let providerReportedCostUsd = 0;
  let hasProviderCost = false;
  let finalAnswer = "";
  const started = Date.now();

  for (let turn = 0; turn < 10; turn++) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": request.assetBaseUrl,
        "X-Title": "RouteLab Frontier Model Lab",
        "X-OpenRouter-Metadata": "enabled",
      },
      body: JSON.stringify({
        model: request.model.runtimeModelId,
        messages,
        tools: evalCase.tools.length ? providerTools(evalCase.tools, request.harnessId) : undefined,
        tool_choice: evalCase.tools.length ? "auto" : undefined,
        max_tokens: 1800,
        usage: { include: true },
      }),
    });
    const payload = await response.json().catch(() => ({ error: { message: "Provider returned a non-JSON response." } })) as any;
    if (!response.ok) throw new Error(String(payload.error?.message ?? payload.message ?? `OpenRouter HTTP ${response.status}`));
    const usage = payload.usage ?? {};
    inputTokens += Number(usage.prompt_tokens ?? 0);
    outputTokens += Number(usage.completion_tokens ?? 0);
    if (Number.isFinite(Number(usage.cost))) {
      providerReportedCostUsd += Number(usage.cost);
      hasProviderCost = true;
    }
    const message = payload.choices?.[0]?.message ?? {};
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    messages.push({ role: "assistant", content: message.content ?? "", tool_calls: rawCalls });
    if (!rawCalls.length) {
      finalAnswer = String(message.content ?? "");
      break;
    }
    for (const rawCall of rawCalls) {
      const name = String(rawCall.function?.name ?? "");
      const args = asObject(String(rawCall.function?.arguments ?? "{}"));
      const result = toolResponse(evalCase.id, name, args, toolCalls);
      const record: FrontierToolCall = {
        id: String(rawCall.id ?? `${name}_${toolCalls.length + 1}`),
        name,
        arguments: args,
        response: result,
        sequence: toolCalls.length + 1,
      };
      toolCalls.push(record);
      messages.push({ role: "tool", tool_call_id: record.id, content: JSON.stringify(result) });
    }
  }
  if (!finalAnswer) finalAnswer = "The model did not return a final answer before the bounded agent loop ended.";
  const retryCount = Math.max(0, toolCalls.filter((call) => call.name === "get_billing_history").length - 1);
  return {
    caseId: evalCase.id,
    modelAliasId: request.model.id,
    modelDisplayName: request.model.displayName,
    runtimeModelId: request.model.runtimeModelId,
    harnessId: request.harnessId,
    repetition: request.repetition,
    provider: "OpenRouter",
    finalAnswer,
    toolCalls,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - started,
    providerReportedCostUsd: hasProviderCost ? providerReportedCostUsd : undefined,
    retries: retryCount,
    inputNormalization: evalCase.documents.length ? "Identical ordered page images sent through the OpenRouter multimodal chat format." : "Identical text context and OpenAI-compatible tool schemas sent through OpenRouter.",
    systemPrompt,
    contextSent: evalCase.context,
    toolDefinitions,
    status: "success",
  };
}
