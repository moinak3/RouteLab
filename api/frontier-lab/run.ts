import { runFrontierProvider, type FrontierRunRequest } from "./_runner.js";
import { sendJson, serverOpenRouterKey } from "../live/_shared.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  try {
    const body = req.body ?? {};
    const apiKey = serverOpenRouterKey();
    const host = String(req.headers?.["x-forwarded-host"] ?? req.headers?.host ?? "");
    const protocol = String(req.headers?.["x-forwarded-proto"] ?? "https");
    const request: FrontierRunRequest = {
      caseId: String(body.caseId ?? ""),
      harnessId: body.harnessId === "baseline" ? "baseline" : "improved",
      repetition: Math.max(1, Number(body.repetition ?? 1)),
      model: body.model,
      apiKey,
      assetBaseUrl: String(body.assetBaseUrl ?? "").trim() || `${protocol}://${host}`,
    };
    const result = await runFrontierProvider(request);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Frontier Model Lab run failed." });
  }
}
