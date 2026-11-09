import { neon } from "@neondatabase/serverless";
import type { OverviewInsight, SaveOverviewInsightInput } from "../core/overviewInsights.js";

export class OverviewInsightStoreUnavailableError extends Error {}

let initializedForUrl = "";
let initialization: Promise<unknown> | null = null;

function store(databaseUrl: string) {
  if (!databaseUrl) throw new OverviewInsightStoreUnavailableError("Persistent Overview insight storage is not configured.");
  const sql = neon(databaseUrl);
  if (initializedForUrl !== databaseUrl || !initialization) {
    initializedForUrl = databaseUrl;
    initialization = sql`
      CREATE TABLE IF NOT EXISTS routelab_overview_insights (
        workspace_id text NOT NULL,
        insight_id text NOT NULL,
        question text NOT NULL,
        title text NOT NULL,
        description text NOT NULL,
        openui text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, insight_id)
      )
    `;
  }
  return { sql, ready: initialization };
}

type InsightRow = {
  insight_id: string;
  question: string;
  title: string;
  description: string;
  openui: string;
  created_at: string | Date;
  updated_at: string | Date;
};

const envelope = (row: InsightRow): OverviewInsight => ({
  id: String(row.insight_id),
  question: String(row.question),
  title: String(row.title),
  description: String(row.description),
  openui: String(row.openui),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export async function listOverviewInsights(databaseUrl: string, workspaceId: string) {
  const database = store(databaseUrl);
  await database.ready;
  const rows = await database.sql`
    SELECT insight_id, question, title, description, openui, created_at, updated_at
    FROM routelab_overview_insights
    WHERE workspace_id = ${workspaceId}
    ORDER BY updated_at DESC
    LIMIT 12
  `;
  return rows.map((row) => envelope(row as InsightRow));
}

export async function saveOverviewInsight(databaseUrl: string, workspaceId: string, insight: SaveOverviewInsightInput) {
  const database = store(databaseUrl);
  await database.ready;
  const rows = await database.sql`
    INSERT INTO routelab_overview_insights (workspace_id, insight_id, question, title, description, openui, created_at, updated_at)
    VALUES (${workspaceId}, ${insight.id}, ${insight.question}, ${insight.title}, ${insight.description}, ${insight.openui}, now(), now())
    ON CONFLICT (workspace_id, insight_id) DO UPDATE SET
      question = EXCLUDED.question,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      openui = EXCLUDED.openui,
      updated_at = now()
    RETURNING insight_id, question, title, description, openui, created_at, updated_at
  `;
  return envelope(rows[0] as InsightRow);
}

export async function removeOverviewInsight(databaseUrl: string, workspaceId: string, insightId: string) {
  const database = store(databaseUrl);
  await database.ready;
  await database.sql`
    DELETE FROM routelab_overview_insights
    WHERE workspace_id = ${workspaceId} AND insight_id = ${insightId}
  `;
}
