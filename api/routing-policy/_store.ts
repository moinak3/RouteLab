import { neon } from "@neondatabase/serverless";
import { normalizeDraftRoutingPolicy, type DraftRoutingPolicy } from "../../src/core/routingDraft.js";
import type { PublishedPolicyHistory, SignedRoutingPolicyEnvelope } from "../../src/core/publishedRoutingPolicy.js";

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
    initialization = Promise.all([
      sql`
        CREATE TABLE IF NOT EXISTS routing_policy_drafts (
          workspace_id text PRIMARY KEY,
          revision integer NOT NULL DEFAULT 1,
          policy jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `,
      sql`
        CREATE TABLE IF NOT EXISTS routing_policy_versions (
          workspace_id text NOT NULL,
          version integer NOT NULL,
          policy_id text NOT NULL,
          envelope jsonb NOT NULL,
          published_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (workspace_id, version),
          UNIQUE (policy_id)
        )
      `,
      sql`
        CREATE TABLE IF NOT EXISTS routing_policy_active (
          workspace_id text PRIMARY KEY,
          version integer NOT NULL,
          activated_at timestamptz NOT NULL DEFAULT now()
        )
      `,
    ]);
  }
  return { sql, ready: initialization };
}

function envelope(row?: { policy: DraftRoutingPolicy; revision: number; updated_at: string | Date }): StoredRoutingPolicyDraft {
  return row
    ? { draft: normalizeDraftRoutingPolicy(row.policy, (row.policy as DraftRoutingPolicy & { fallbackModelId?: string }).fallbackModelId ?? ""), revision: Number(row.revision), updatedAt: new Date(row.updated_at).toISOString() }
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

export async function nextRoutingPolicyVersion(databaseUrl: string, workspaceId: string) {
  const database = store(databaseUrl);
  await database.ready;
  const rows = await database.sql`SELECT COALESCE(MAX(version), 0) + 1 AS version FROM routing_policy_versions WHERE workspace_id = ${workspaceId}`;
  return Number(rows[0]?.version ?? 1);
}

export async function publishRoutingPolicyVersion(databaseUrl: string, workspaceId: string, signed: SignedRoutingPolicyEnvelope) {
  const database = store(databaseUrl);
  await database.ready;
  const envelopeJson = JSON.stringify(signed);
  const rows = await database.sql`
    INSERT INTO routing_policy_versions (workspace_id, version, policy_id, envelope, published_at)
    VALUES (${workspaceId}, ${signed.bundle.version}, ${signed.bundle.policyId}, ${envelopeJson}::jsonb, now())
    RETURNING published_at
  `;
  return { ...signed, publishedAt: new Date(rows[0].published_at as string | Date).toISOString() };
}

export async function getPublishedRoutingPolicy(databaseUrl: string, workspaceId: string, version?: number | "active") {
  const database = store(databaseUrl);
  await database.ready;
  const rows = version === "active" || version === undefined
    ? await database.sql`
        SELECT versions.envelope
        FROM routing_policy_versions versions
        JOIN routing_policy_active active
          ON active.workspace_id = versions.workspace_id AND active.version = versions.version
        WHERE versions.workspace_id = ${workspaceId}
        LIMIT 1
      `
    : await database.sql`
        SELECT envelope FROM routing_policy_versions
        WHERE workspace_id = ${workspaceId} AND version = ${version}
        LIMIT 1
      `;
  return rows[0]?.envelope as SignedRoutingPolicyEnvelope | undefined;
}

export async function activateRoutingPolicyVersion(databaseUrl: string, workspaceId: string, version: number) {
  const database = store(databaseUrl);
  await database.ready;
  const exists = await database.sql`SELECT 1 FROM routing_policy_versions WHERE workspace_id = ${workspaceId} AND version = ${version} LIMIT 1`;
  if (!exists.length) return null;
  const rows = await database.sql`
    INSERT INTO routing_policy_active (workspace_id, version, activated_at)
    VALUES (${workspaceId}, ${version}, now())
    ON CONFLICT (workspace_id) DO UPDATE SET version = EXCLUDED.version, activated_at = now()
    RETURNING version, activated_at
  `;
  return { version: Number(rows[0].version), activatedAt: new Date(rows[0].activated_at as string | Date).toISOString() };
}

export async function getPublishedRoutingPolicyHistory(databaseUrl: string, workspaceId: string): Promise<PublishedPolicyHistory> {
  const database = store(databaseUrl);
  await database.ready;
  const [versions, activeRows] = await Promise.all([
    database.sql`SELECT envelope, published_at FROM routing_policy_versions WHERE workspace_id = ${workspaceId} ORDER BY version DESC`,
    database.sql`SELECT version, activated_at FROM routing_policy_active WHERE workspace_id = ${workspaceId} LIMIT 1`,
  ]);
  const activeVersion = activeRows.length ? Number(activeRows[0].version) : null;
  const activatedAt = activeRows.length ? new Date(activeRows[0].activated_at as string | Date).toISOString() : null;
  return {
    activeVersion,
    versions: versions.map((row) => {
      const signed = row.envelope as SignedRoutingPolicyEnvelope;
      const defaultStrategyLabel = signed.bundle.defaultStrategy?.type === "openrouter_auto"
        ? "OpenRouter Auto Router"
        : signed.bundle.defaultStrategy?.type === "fixed_model"
          ? signed.bundle.defaultStrategy.target.modelId
          : signed.bundle.fallback?.modelId ?? "Unknown";
      return {
        policyId: signed.bundle.policyId,
        version: signed.bundle.version,
        publishedAt: new Date(row.published_at as string | Date).toISOString(),
        activatedAt: activeVersion === signed.bundle.version ? activatedAt : null,
        active: activeVersion === signed.bundle.version,
        defaultStrategyLabel,
        overrideCount: signed.bundle.overrides.length,
        signatureCount: signed.bundle.signatures.length,
        expiresAt: signed.bundle.expiresAt,
      };
    }),
  };
}
