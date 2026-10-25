import { sendJson } from "../live/_shared.js";
import { runInspectedCompletion, runtimeError } from "../sidecar/_runtime.js";

export const maxDuration = 150;

function parseToolArguments(value: unknown) {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value ?? "{}"));
  } catch {
    return {};
  }
}

function executeSupportTool(call: any) {
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

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  try {
    const request = req.body ?? {};
    const first = await runInspectedCompletion(request);
    const message = first.payload?.openRouterResponse?.choices?.[0]?.message;
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    if (first.status !== 200 || !first.payload?.ok || !toolCalls.length) return sendJson(res, first.status, first.payload);

    const toolExecutions = toolCalls.map(executeSupportTool);
    const toolMessages = toolCalls.map((call: any, index: number) => ({
      role: "tool",
      tool_call_id: call.id,
      name: toolExecutions[index].name,
      content: JSON.stringify(toolExecutions[index].result),
    }));
    const second = await runInspectedCompletion({
      ...request,
      messages: [
        ...(Array.isArray(request.messages) ? request.messages : []),
        { role: "assistant", content: message.content ?? null, tool_calls: toolCalls },
        ...toolMessages,
      ],
    });
    return sendJson(res, second.status, {
      ...second.payload,
      toolExecutions,
      routingPasses: [
        { decision: first.payload.decision, route: first.payload.route, openRouterRequest: first.payload.openRouterRequest, upstream: first.payload.upstream, timing: first.payload.timing },
        { decision: second.payload?.decision, route: second.payload?.route, openRouterRequest: second.payload?.openRouterRequest, upstream: second.payload?.upstream, timing: second.payload?.timing },
      ],
      timing: {
        ...second.payload?.timing,
        totalMs: Number(first.payload?.timing?.totalMs ?? 0) + Number(second.payload?.timing?.totalMs ?? 0),
      },
    });
  } catch (error) {
    const failure = runtimeError(error);
    return sendJson(res, failure.status, failure.payload);
  }
}
