import { runJevSignatureGate } from "./_runner.js";
import { sendJson, serverOpenRouterKey } from "../live/_shared.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  try {
    const body = req.body ?? {};
    const traces = Array.isArray(body.traces) ? body.traces : [];
    const signatures = Array.isArray(body.signatures) ? body.signatures : [];
    if (!traces.length) return sendJson(res, 400, { error: "No incoming traces were provided to the Jev gate." });
    if (!signatures.length) return sendJson(res, 400, { error: "No known task signatures were provided to the Jev gate." });
    return sendJson(res, 200, await runJevSignatureGate({
      traces,
      signatures,
      apiKey: serverOpenRouterKey(),
      baseThreshold: Number(body.baseThreshold ?? .8),
    }));
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Jev signature gate failed." });
  }
}
