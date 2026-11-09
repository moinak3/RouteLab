export type OverviewInsight = {
  id: string;
  question: string;
  title: string;
  description: string;
  openui: string;
  createdAt: string;
  updatedAt: string;
};

export type SaveOverviewInsightInput = Pick<OverviewInsight, "id" | "question" | "title" | "description" | "openui">;

const STORAGE_PREFIX = "routelab-overview-insights-v1:";
export const OVERVIEW_INSIGHTS_CHANGED_EVENT = "routelab:overview-insights-changed";

const storage = () => typeof window === "undefined" ? null : window.localStorage;
const storageKey = (workspaceId: string) => `${STORAGE_PREFIX}${workspaceId}`;

export function isOverviewInsight(value: unknown): value is OverviewInsight {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const insight = value as Partial<OverviewInsight>;
  return [insight.id, insight.question, insight.title, insight.description, insight.openui, insight.createdAt, insight.updatedAt]
    .every((field) => typeof field === "string");
}

export function overviewInsightTitle(question: string) {
  const normalized = question.trim().replace(/[?.!]+$/g, "");
  if (!normalized) return "Ask RouteLab insight";
  const title = normalized[0].toUpperCase() + normalized.slice(1);
  return title.length > 96 ? `${title.slice(0, 93).trimEnd()}...` : title;
}

export function loadLocalOverviewInsights(workspaceId: string): OverviewInsight[] {
  try {
    const parsed = JSON.parse(storage()?.getItem(storageKey(workspaceId)) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isOverviewInsight) : [];
  } catch {
    return [];
  }
}

function saveLocalOverviewInsights(workspaceId: string, insights: OverviewInsight[]) {
  try {
    storage()?.setItem(storageKey(workspaceId), JSON.stringify(insights));
  } catch {
    // Cloud persistence remains authoritative when browser storage is unavailable.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OVERVIEW_INSIGHTS_CHANGED_EVENT, { detail: { workspaceId, insights } }));
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Overview insight persistence failed.");
  return payload;
}

export async function fetchOverviewInsights(workspaceId: string, signal?: AbortSignal): Promise<OverviewInsight[]> {
  try {
    const response = await fetch(`/api/overview-insights?workspace=${encodeURIComponent(workspaceId)}`, { cache: "no-store", signal });
    const payload = await responseJson<{ insights: OverviewInsight[] }>(response);
    const insights = Array.isArray(payload.insights) ? payload.insights.filter(isOverviewInsight) : [];
    saveLocalOverviewInsights(workspaceId, insights);
    return insights;
  } catch (error) {
    if (signal?.aborted) throw error;
    return loadLocalOverviewInsights(workspaceId);
  }
}

export async function persistOverviewInsight(workspaceId: string, input: SaveOverviewInsightInput): Promise<OverviewInsight> {
  try {
    const response = await fetch(`/api/overview-insights?workspace=${encodeURIComponent(workspaceId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await responseJson<{ insight: OverviewInsight }>(response);
    const existing = loadLocalOverviewInsights(workspaceId);
    saveLocalOverviewInsights(workspaceId, [payload.insight, ...existing.filter((item) => item.id !== payload.insight.id)]);
    return payload.insight;
  } catch {
    const now = new Date().toISOString();
    const existing = loadLocalOverviewInsights(workspaceId);
    const prior = existing.find((item) => item.id === input.id);
    const insight: OverviewInsight = { ...input, createdAt: prior?.createdAt ?? now, updatedAt: now };
    saveLocalOverviewInsights(workspaceId, [insight, ...existing.filter((item) => item.id !== insight.id)]);
    return insight;
  }
}

export async function deleteOverviewInsight(workspaceId: string, insightId: string): Promise<void> {
  try {
    const response = await fetch(`/api/overview-insights?workspace=${encodeURIComponent(workspaceId)}&id=${encodeURIComponent(insightId)}`, { method: "DELETE" });
    await responseJson<{ deleted: boolean }>(response);
  } catch {
    // Keep deletion usable in local-only development environments.
  }
  saveLocalOverviewInsights(workspaceId, loadLocalOverviewInsights(workspaceId).filter((item) => item.id !== insightId));
}
