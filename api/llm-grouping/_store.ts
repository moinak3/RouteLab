import { neon } from "@neondatabase/serverless";
import { parseLLMGroupingRun, type LLMGroupingRun } from "../../src/core/llmGrouping.js";

export class LLMGroupingStoreUnavailableError extends Error {}

let initializedForUrl = "";
let initialization: Promise<unknown> | null = null;

function store(databaseUrl: string) {
  if (!databaseUrl) throw new LLMGroupingStoreUnavailableError("Persistent LLM grouping storage is not configured.");
  const sql = neon(databaseUrl);
  if (initializedForUrl !== databaseUrl || !initialization) {
    initializedForUrl = databaseUrl;
    initialization = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS routelab_llm_grouping_runs (
          workspace_id text NOT NULL,
          run_id text NOT NULL,
          snapshot_hash text NOT NULL,
          completed_at timestamptz NOT NULL,
          result jsonb NOT NULL,
          PRIMARY KEY (workspace_id, run_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS routelab_llm_grouping_runs_latest
        ON routelab_llm_grouping_runs (workspace_id, completed_at DESC)
      `;
    })();
  }
  return { sql, ready: initialization };
}

export const parseStoredLLMGroupingRun = (value: unknown) => parseLLMGroupingRun(value);

export async function saveLLMGroupingRun(databaseUrl: string, workspaceId: string, run: LLMGroupingRun) {
  const database = store(databaseUrl);
  await database.ready;
  const resultJson = JSON.stringify(run);
  const rows = await database.sql`
    INSERT INTO routelab_llm_grouping_runs (workspace_id, run_id, snapshot_hash, completed_at, result)
    VALUES (${workspaceId}, ${run.runId}, ${run.snapshot.hash}, ${run.completedAt}, ${resultJson}::jsonb)
    ON CONFLICT (workspace_id, run_id) DO UPDATE
    SET snapshot_hash = EXCLUDED.snapshot_hash, completed_at = EXCLUDED.completed_at, result = EXCLUDED.result
    RETURNING result
  `;
  return parseStoredLLMGroupingRun(rows[0]?.result);
}

export async function getLatestLLMGroupingRun(databaseUrl: string, workspaceId: string) {
  const database = store(databaseUrl);
  await database.ready;
  const rows = await database.sql`
    SELECT result FROM routelab_llm_grouping_runs
    WHERE workspace_id = ${workspaceId}
    ORDER BY completed_at DESC
    LIMIT 1
  `;
  return rows.length ? parseStoredLLMGroupingRun(rows[0].result) : null;
}
