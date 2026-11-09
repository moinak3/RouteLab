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
    initialization = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS routelab_overview_insights (
        workspace_id text NOT NULL,
        insight_id text NOT NULL,
        question text NOT NULL,
        title text NOT NULL,
        description text NOT NULL,
        openui text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        position integer NOT NULL DEFAULT 0,
        PRIMARY KEY (workspace_id, insight_id)
      )`;
      await sql`ALTER TABLE routelab_overview_insights ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0`;
    })();
  }
  return { sql, ready: initialization };
}

type InsightRow = {
  insight_id: string;
  question: string;
  title: string;
  description: string;
  openui: string;
  position: number;
  created_at: string | Date;
  updated_at: string | Date;
};

const envelope = (row: InsightRow): OverviewInsight => ({
  id: String(row.insight_id),
  question: String(row.question),
  title: String(row.title),
  description: String(row.description),
  openui: String(row.openui),
  position: Number(row.position),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export async function listOverviewInsights(databaseUrl: string, workspaceId: string) {
  const database = store(databaseUrl);
  await database.ready;
  const rows = await database.sql`
    SELECT insight_id, question, title, description, openui, position, created_at, updated_at
    FROM routelab_overview_insights
    WHERE workspace_id = ${workspaceId}
    ORDER BY position ASC, created_at ASC
    LIMIT 12
  `;
  return rows.map((row) => envelope(row as InsightRow));
}

export async function saveOverviewInsight(databaseUrl: string, workspaceId: string, insight: SaveOverviewInsightInput) {
  const database = store(databaseUrl);
  await database.ready;
  const positions = await database.sql`SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM routelab_overview_insights WHERE workspace_id = ${workspaceId}`;
  const position = Number(positions[0]?.next_position ?? 0);
  const rows = await database.sql`
    INSERT INTO routelab_overview_insights (workspace_id, insight_id, question, title, description, openui, position, created_at, updated_at)
    VALUES (${workspaceId}, ${insight.id}, ${insight.question}, ${insight.title}, ${insight.description}, ${insight.openui}, ${position}, now(), now())
    ON CONFLICT (workspace_id, insight_id) DO UPDATE SET
      question = EXCLUDED.question,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      openui = EXCLUDED.openui,
      updated_at = now()
    RETURNING insight_id, question, title, description, openui, position, created_at, updated_at
  `;
  return envelope(rows[0] as InsightRow);
}

export async function reorderOverviewInsights(databaseUrl: string, workspaceId: string, orderedIds: string[]) {
  const database = store(databaseUrl);
  await database.ready;
  for (const [position, insightId] of orderedIds.entries()) {
    await database.sql`UPDATE routelab_overview_insights SET position = ${position}, updated_at = now() WHERE workspace_id = ${workspaceId} AND insight_id = ${insightId}`;
  }
  return listOverviewInsights(databaseUrl, workspaceId);
}

export async function removeOverviewInsight(databaseUrl: string, workspaceId: string, insightId: string) {
  const database = store(databaseUrl);
  await database.ready;
  await database.sql`
    DELETE FROM routelab_overview_insights
    WHERE workspace_id = ${workspaceId} AND insight_id = ${insightId}
  `;
}
