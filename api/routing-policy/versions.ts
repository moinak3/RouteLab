import { sendJson } from "../live/_shared.js";
import { routingPolicyDatabaseUrl, routingPolicyWorkspaceId } from "./_config.js";
import { getPublishedRoutingPolicyHistory, PolicyStoreUnavailableError } from "./_store.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
  try {
    return sendJson(res, 200, await getPublishedRoutingPolicyHistory(routingPolicyDatabaseUrl(), routingPolicyWorkspaceId()));
  } catch (error) {
    if (error instanceof PolicyStoreUnavailableError) return sendJson(res, 503, { error: error.message });
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Policy history failed." });
  }
}
