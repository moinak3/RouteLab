import { sendJson } from "../live/_shared.js";
import { runInspectedCompletion, runtimeError, sidecarAuthorized } from "./_runtime.js";

export const maxDuration = 150;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  if (!sidecarAuthorized(req)) return sendJson(res, 401, { error: { message: "A valid RouteLab sidecar API key is required.", type: "authentication_error" } });
  try {
    const result = await runInspectedCompletion(req.body ?? {});
    Object.entries(result.headers).forEach(([name, value]) => res.setHeader(name, value));
    return sendJson(res, result.status, result.payload);
  } catch (error) {
    const failure = runtimeError(error);
    return sendJson(res, failure.status, failure.payload);
  }
}
