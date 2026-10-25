import { sendJson } from "../live/_shared.js";
import { loadPolicyBundle, runtimeError } from "../sidecar/_runtime.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
  try {
    const bundle = await loadPolicyBundle();
    return sendJson(res, 200, {
      connected: true,
      status: "ready",
      policyVersion: bundle.version,
      policyId: bundle.policyId,
      mode: String(process.env.ROUTELAB_DECISION_MODE ?? "enforce"),
      runtime: "vercel-demo",
    });
  } catch (error) {
    const failure = runtimeError(error);
    return sendJson(res, failure.status, { connected: false, status: "unavailable", ...failure.payload });
  }
}
