import { isDraftRoutingPolicy } from "../../src/core/routingDraft.js";
import { sendJson } from "../live/_shared.js";
import { getRoutingPolicyDraft, PolicyStoreConflictError, PolicyStoreUnavailableError, saveRoutingPolicyDraft } from "./_store.js";
import { routingPolicyDatabaseUrl, routingPolicyWorkspaceId } from "./_config.js";

export default async function handler(req: any, res: any) {
  try {
    const workspaceId = routingPolicyWorkspaceId(req);
    if (req.method === "GET") return sendJson(res, 200, await getRoutingPolicyDraft(routingPolicyDatabaseUrl(), workspaceId));
    if (req.method !== "PUT") return sendJson(res, 405, { error: "Method not allowed." });
    const draft = req.body?.draft;
    const expectedRevision = Number(req.body?.expectedRevision);
    if (!isDraftRoutingPolicy(draft) || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return sendJson(res, 400, { error: "A valid routing policy draft and expected revision are required." });
    }
    return sendJson(res, 200, await saveRoutingPolicyDraft(routingPolicyDatabaseUrl(), workspaceId, draft, expectedRevision));
  } catch (error) {
    if (error instanceof PolicyStoreUnavailableError) return sendJson(res, 503, { error: error.message });
    if (error instanceof PolicyStoreConflictError) return sendJson(res, 409, error.current);
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Routing policy storage failed." });
  }
}
