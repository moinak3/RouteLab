import { validateAskRouteLabOpenUI } from "./askRouteLab.js";
import {
  listOverviewInsights,
  OverviewInsightStoreUnavailableError,
  removeOverviewInsight,
  reorderOverviewInsights,
  saveOverviewInsight,
} from "./overviewInsightStore.js";

const databaseUrl = () => String(process.env.DATABASE_URL ?? "").trim();
const workspaceId = (req: any) => String(req.query?.workspace ?? process.env.ROUTELAB_POLICY_WORKSPACE_ID ?? "demo").trim() || "demo";
const sendJson = (res: any, status: number, payload: unknown) => res.status(status).json(payload);
const text = (value: unknown, limit: number) => String(value ?? "").trim().slice(0, limit);

export default async function overviewInsightsHandler(req: any, res: any) {
  try {
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
      return sendJson(res, 200, { insights: await listOverviewInsights(databaseUrl(), workspaceId(req)) });
    }
    if (req.method === "DELETE") {
      const id = text(req.query?.id, 160);
      if (!id) return sendJson(res, 400, { error: "An Overview insight id is required." });
      await removeOverviewInsight(databaseUrl(), workspaceId(req), id);
      return sendJson(res, 200, { deleted: true });
    }
    if (req.method === "PATCH") {
      const orderedIds = Array.isArray(req.body?.orderedIds)
        ? req.body.orderedIds.map((id: unknown) => text(id, 160)).filter(Boolean).slice(0, 12)
        : [];
      if (!orderedIds.length || new Set(orderedIds).size !== orderedIds.length) {
        return sendJson(res, 400, { error: "A unique ordered list of Overview insight ids is required." });
      }
      return sendJson(res, 200, { insights: await reorderOverviewInsights(databaseUrl(), workspaceId(req), orderedIds) });
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });

    const openui = validateAskRouteLabOpenUI(req.body?.openui);
    const input = {
      id: text(req.body?.id, 160),
      question: text(req.body?.question, 500),
      title: text(req.body?.title, 120),
      description: text(req.body?.description, 1_000),
      openui: openui ?? "",
    };
    if (!input.id || !input.question || !input.title || !input.description || !input.openui) {
      return sendJson(res, 400, { error: "A valid generated visualization, title, and description are required." });
    }
    return sendJson(res, 200, { insight: await saveOverviewInsight(databaseUrl(), workspaceId(req), input) });
  } catch (error) {
    if (error instanceof OverviewInsightStoreUnavailableError) return sendJson(res, 503, { error: error.message });
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Overview insight persistence failed." });
  }
}
