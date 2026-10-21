import { neon } from "@neondatabase/serverless";
import type { DraftRoutingPolicy } from "../../src/core/routingDraft.js";

export type StoredRoutingPolicyDraft = {
  draft: DraftRoutingPolicy | null;
  revision: number;
  updatedAt: string | null;
};

export class PolicyStoreUnavailableError extends Error {}

export class PolicyStoreConflictError extends Error {
  current: StoredRoutingPolicyDraft;

  constructor(current: StoredRoutingPolicyDraft) {
    super("The routing policy draft changed in another session.");
    this.current = current;
  }
}

let initializedForUrl = "";
let initialization: Promise<unknown> | null = null;

function store(databaseUrl: string) {
  if (!databaseUrl) throw new PolicyStoreUnavailableError("Persistent policy storage is not configured.");
  const sql = neon(databaseUrl);
  if (initializedForUrl !== databaseUrl || !initialization) {
    initializedForUrl = databaseUrl;
    initialization = sql`
      CREATE TABLE IF NOT EXISTS routing_policy_drafts (
        workspace_id text PRIMARY KEY,
        revision integer NOT NULL DEFAULT 1,
        policy jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
  }
  return { sql, ready: initialization };
}

function envelope(row?: { policy: DraftRoutingPolicy; revision: number; updated_at: string | Date }): StoredRoutingPolicyDraft {
  return row
    ? { draft: row.policy, revision: Number(row.revision), updatedAt: new Date(row.updated_at).toISOString() }
    : { draft: null, revision: 0, updatedAt: null };
}

async function currentDraft(sql: ReturnType<typeof neon>, workspaceId: string) {
  const rows = await sql`SELECT policy, revision, updated_at FROM routing_policy_drafts WHERE workspace_id = ${workspaceId} LIMIT 1`;
  return envelope(rows[0] as { policy: DraftRoutingPolicy; revision: number; updated_at: string | Date } | undefined);
}

export async function getRoutingPolicyDraft(databaseUrl: string, workspaceId: string) {
  const database = store(databaseUrl);
  await database.ready;
  return currentDraft(database.sql, workspaceId);
}

export async function saveRoutingPolicyDraft(databaseUrl: string, workspaceId: string, draft: DraftRoutingPolicy, expectedRevision: number) {
  const database = store(databaseUrl);
  await database.ready;
  const policyJson = JSON.stringify(draft);
  const rows = expectedRevision === 0
    ? await database.sql`
        INSERT INTO routing_policy_drafts (workspace_id, revision, policy, updated_at)
        VALUES (${workspaceId}, 1, ${policyJson}::jsonb, now())
        ON CONFLICT (workspace_id) DO NOTHING
        RETURNING policy, revision, updated_at
      `
    : await database.sql`
        UPDATE routing_policy_drafts
        SET policy = ${policyJson}::jsonb, revision = revision + 1, updated_at = now()
        WHERE workspace_id = ${workspaceId} AND revision = ${expectedRevision}
        RETURNING policy, revision, updated_at
      `;
  if (!rows.length) throw new PolicyStoreConflictError(await currentDraft(database.sql, workspaceId));
  return envelope(rows[0] as { policy: DraftRoutingPolicy; revision: number; updated_at: string | Date });
}
