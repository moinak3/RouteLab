import { sendJson } from "../live/_shared.js";
import { routingPolicyDatabaseUrl, routingPolicyWorkspaceId } from "./_config.js";
import { getPublishedRoutingPolicy, PolicyStoreUnavailableError } from "./_store.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
  try {
    const requested = String(req.query?.version ?? "active");
    const version = requested === "active" ? "active" : Number(requested);
    if (version !== "active" && (!Number.isInteger(version) || version < 1)) return sendJson(res, 400, { error: "Use version=active or a positive policy version." });
    const signed = await getPublishedRoutingPolicy(routingPolicyDatabaseUrl(), routingPolicyWorkspaceId(req), version);
    if (!signed) return sendJson(res, 404, { error: version === "active" ? "No active policy is available." : "Policy version not found." });
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("ETag", `\"${signed.bundle.policyId}\"`);
    if (req.headers?.["if-none-match"] === `\"${signed.bundle.policyId}\"`) return res.status(304).end();
    if (String(req.query?.download ?? "") === "1") res.setHeader("Content-Disposition", `attachment; filename=\"routelab-policy-v${signed.bundle.version}.json\"`);
    return sendJson(res, 200, signed);
  } catch (error) {
    if (error instanceof PolicyStoreUnavailableError) return sendJson(res, 503, { error: error.message });
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Policy bundle export failed." });
  }
}
