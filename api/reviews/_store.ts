import { neon } from "@neondatabase/serverless";
import type { GoldenDatasetRow } from "../../src/types.js";
import type { PersistedReview } from "../../src/core/reviewPersistence.js";

export class ReviewStoreUnavailableError extends Error {}

let initializedForUrl = "";
let initialization: Promise<unknown> | null = null;

function store(databaseUrl: string) {
  if (!databaseUrl) throw new ReviewStoreUnavailableError("Persistent review storage is not configured.");
  const sql = neon(databaseUrl);
  if (initializedForUrl !== databaseUrl || !initialization) {
    initializedForUrl = databaseUrl;
    initialization = Promise.all([
      sql`
        CREATE TABLE IF NOT EXISTS routelab_review_settings (
          workspace_id text PRIMARY KEY,
          weekly_budget integer NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `,
      sql`
        CREATE TABLE IF NOT EXISTS routelab_review_results (
          workspace_id text NOT NULL,
          trace_id text NOT NULL,
          lane text NOT NULL,
          decision text NOT NULL,
          correct_answer text,
          rationale text,
          trace jsonb NOT NULL,
          judge jsonb,
          golden_row jsonb,
          reviewed_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (workspace_id, trace_id)
        )
      `,
    ]);
  }
  return { sql, ready: initialization };
}

type ReviewRow = {
  trace_id: string;
  lane: PersistedReview["lane"];
  decision: PersistedReview["decision"];
  correct_answer: string | null;
  rationale: string | null;
  reviewed_at: string | Date;
  golden_row: GoldenDatasetRow | null;
};

const reviewEnvelope = (row: ReviewRow): PersistedReview => ({
  traceId: String(row.trace_id),
  lane: row.lane,
  decision: row.decision,
  correctAnswer: row.correct_answer == null ? null : String(row.correct_answer),
  rationale: row.rationale == null ? null : String(row.rationale),
  reviewedAt: new Date(row.reviewed_at).toISOString(),
  goldenRow: row.golden_row ?? null,
});

export async function getReviewWorkflow(databaseUrl: string, workspaceId: string, defaultBudget: number) {
  const database = store(databaseUrl);
  await database.ready;
  const [settings, reviews] = await Promise.all([
    database.sql`SELECT weekly_budget, updated_at FROM routelab_review_settings WHERE workspace_id = ${workspaceId} LIMIT 1`,
    database.sql`
      SELECT trace_id, lane, decision, correct_answer, rationale, reviewed_at, golden_row
      FROM routelab_review_results
      WHERE workspace_id = ${workspaceId}
      ORDER BY reviewed_at DESC
    `,
  ]);
  return {
    weeklyBudget: settings.length ? Number(settings[0].weekly_budget) : defaultBudget,
    updatedAt: settings.length ? new Date(settings[0].updated_at as string | Date).toISOString() : null,
    reviews: reviews.map((row) => reviewEnvelope(row as ReviewRow)),
  };
}

export async function saveWeeklyReviewBudget(databaseUrl: string, workspaceId: string, weeklyBudget: number, defaultBudget: number) {
  const database = store(databaseUrl);
  await database.ready;
  await database.sql`
    INSERT INTO routelab_review_settings (workspace_id, weekly_budget, updated_at)
    VALUES (${workspaceId}, ${weeklyBudget}, now())
    ON CONFLICT (workspace_id) DO UPDATE
    SET weekly_budget = EXCLUDED.weekly_budget, updated_at = now()
  `;
  return getReviewWorkflow(databaseUrl, workspaceId, defaultBudget);
}

export async function saveReviewResult({
  databaseUrl,
  workspaceId,
  traceId,
  lane,
  decision,
  correctAnswer,
  rationale,
  trace,
  judge,
  goldenRow,
}: {
  databaseUrl: string;
  workspaceId: string;
  traceId: string;
  lane: PersistedReview["lane"];
  decision: PersistedReview["decision"];
  correctAnswer: string | null;
  rationale: string | null;
  trace: unknown;
  judge: unknown;
  goldenRow: GoldenDatasetRow | null;
}) {
  const database = store(databaseUrl);
  await database.ready;
  const traceJson = JSON.stringify(trace);
  const judgeJson = judge == null ? null : JSON.stringify(judge);
  const goldenJson = goldenRow == null ? null : JSON.stringify(goldenRow);
  const rows = await database.sql`
    INSERT INTO routelab_review_results (
      workspace_id, trace_id, lane, decision, correct_answer, rationale, trace, judge, golden_row, reviewed_at
    ) VALUES (
      ${workspaceId}, ${traceId}, ${lane}, ${decision}, ${correctAnswer}, ${rationale},
      ${traceJson}::jsonb, ${judgeJson}::jsonb, ${goldenJson}::jsonb, now()
    )
    ON CONFLICT (workspace_id, trace_id) DO UPDATE SET
      lane = EXCLUDED.lane,
      decision = EXCLUDED.decision,
      correct_answer = EXCLUDED.correct_answer,
      rationale = EXCLUDED.rationale,
      trace = EXCLUDED.trace,
      judge = EXCLUDED.judge,
      golden_row = EXCLUDED.golden_row,
      reviewed_at = now()
    RETURNING trace_id, lane, decision, correct_answer, rationale, reviewed_at, golden_row
  `;
  return reviewEnvelope(rows[0] as ReviewRow);
}
