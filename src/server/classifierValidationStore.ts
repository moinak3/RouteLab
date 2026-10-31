import { neon } from "@neondatabase/serverless";
import type { AssignmentValidationWorkflow } from "../core/assignmentValidation.js";

export class ClassifierValidationStoreUnavailableError extends Error {}

let initializedForUrl = "";
let initialization: Promise<unknown> | null = null;

function store(databaseUrl: string) {
  if (!databaseUrl) throw new ClassifierValidationStoreUnavailableError("Persistent classifier-validation storage is not configured.");
  const sql = neon(databaseUrl);
  if (initializedForUrl !== databaseUrl || !initialization) {
    initializedForUrl = databaseUrl;
    initialization = sql`
      CREATE TABLE IF NOT EXISTS routelab_classifier_validation (
        workspace_id text PRIMARY KEY,
        workflow jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
  }
  return { sql, ready: initialization };
}

export async function getClassifierValidationWorkflow(databaseUrl: string, workspaceId: string) {
  const database = store(databaseUrl);
  await database.ready;
  const rows = await database.sql`
    SELECT workflow FROM routelab_classifier_validation WHERE workspace_id = ${workspaceId} LIMIT 1
  `;
  return rows.length ? rows[0].workflow as AssignmentValidationWorkflow : null;
}

export async function saveClassifierValidationWorkflow(databaseUrl: string, workspaceId: string, workflow: AssignmentValidationWorkflow) {
  const database = store(databaseUrl);
  await database.ready;
  const workflowJson = JSON.stringify(workflow);
  const rows = await database.sql`
    INSERT INTO routelab_classifier_validation (workspace_id, workflow, updated_at)
    VALUES (${workspaceId}, ${workflowJson}::jsonb, now())
    ON CONFLICT (workspace_id) DO UPDATE SET workflow = EXCLUDED.workflow, updated_at = now()
    RETURNING workflow
  `;
  return rows[0].workflow as AssignmentValidationWorkflow;
}
