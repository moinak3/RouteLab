import { isAssignmentValidationWorkflow } from "../core/assignmentValidation.js";
import {
  ClassifierValidationStoreUnavailableError,
  getClassifierValidationWorkflow,
  saveClassifierValidationWorkflow,
} from "./classifierValidationStore.js";

const sendJson = (res: any, status: number, payload: unknown) => res.status(status).json(payload);
const databaseUrl = () => String(process.env.DATABASE_URL ?? "").trim();
const workspaceId = (req: any) => String(req.query?.workspace ?? process.env.ROUTELAB_POLICY_WORKSPACE_ID ?? "demo").trim() || "demo";

export default async function classifierValidationHandler(req: any, res: any) {
  try {
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
      return sendJson(res, 200, { workflow: await getClassifierValidationWorkflow(databaseUrl(), workspaceId(req)) });
    }
    if (req.method !== "PUT") return sendJson(res, 405, { error: "Method not allowed." });
    if (!isAssignmentValidationWorkflow(req.body?.workflow)) return sendJson(res, 400, { error: "A valid assignment-validation workflow is required." });
    const workflow = { ...req.body.workflow, updatedAt: new Date().toISOString() };
    return sendJson(res, 200, { workflow: await saveClassifierValidationWorkflow(databaseUrl(), workspaceId(req), workflow) });
  } catch (error) {
    if (error instanceof ClassifierValidationStoreUnavailableError) return sendJson(res, 503, { error: error.message });
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Classifier validation storage failed." });
  }
}
