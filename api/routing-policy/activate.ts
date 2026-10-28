import { sendJson } from "../live/_shared.js";
import { routingPolicyDatabaseUrl, routingPolicyWorkspaceId } from "./_config.js";
import { activateRoutingPolicyVersion, PolicyStoreUnavailableError } from "./_store.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  try {
    const version = Number(req.body?.version);
    if (!Number.isInteger(version) || version < 1) return sendJson(res, 400, { error: "A valid policy version is required." });
    const activated = await activateRoutingPolicyVersion(routingPolicyDatabaseUrl(), routingPolicyWorkspaceId(req), version);
    if (!activated) return sendJson(res, 404, { error: "That published policy version does not exist." });
    return sendJson(res, 200, activated);
  } catch (error) {
    if (error instanceof PolicyStoreUnavailableError) return sendJson(res, 503, { error: error.message });
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Policy activation failed." });
  }
}
