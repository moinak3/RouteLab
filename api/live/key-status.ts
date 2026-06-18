import { sendJson, serverOpenRouterKey } from "./_shared";

export default function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }
  return sendJson(res, 200, { gateways: { OpenRouter: Boolean(serverOpenRouterKey()) } });
}
