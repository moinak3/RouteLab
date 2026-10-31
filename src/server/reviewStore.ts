import { neon } from "@neondatabase/serverless";
import type { GoldenDatasetRow } from "../types.js";
import type { ReviewDecision } from "../types/ui.js";
import type { ReviewLane } from "../core/reviewQueue.js";
import type { ReviewCycle, TaskGroupReviewOutcome } from "../core/reviewPersistence.js";

export class ReviewStoreUnavailableError extends Error {}

export type StoredReview = {
  traceId: string;
  lane: ReviewLane;
  decision: ReviewDecision;
  correctAnswer: string | null;
  rationale: string | null;
  reviewedAt: string;
  goldenRow: GoldenDatasetRow | null;
};

export type StoredTaskGroupReview = {
  traceId: string;
  lane: ReviewLane;
  outcome: TaskGroupReviewOutcome;
  taskGroupId: string | null;
  taskGroupName: string | null;
  rationale: string | null;
  reviewedAt: string;
};

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
      sql`
        CREATE TABLE IF NOT EXISTS routelab_task_group_reviews (
          workspace_id text NOT NULL,
          trace_id text NOT NULL,
          lane text NOT NULL,
          outcome text NOT NULL,
          task_group_id text,
          task_group_name text,
          rationale text,
          trace jsonb NOT NULL,
          reviewed_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (workspace_id, trace_id)
        )
      `,
      sql`
        CREATE TABLE IF NOT EXISTS routelab_review_cycles (
          workspace_id text PRIMARY KEY,
          cycle_id text NOT NULL,
          weekly_budget integer NOT NULL,
          assignments jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `,
    ]);
  }
  return { sql, ready: initialization };
}

type ReviewRow = {
  trace_id: string;
  lane: ReviewLane;
  decision: ReviewDecision;
  correct_answer: string | null;
  rationale: string | null;
  reviewed_at: string | Date;
  golden_row: GoldenDatasetRow | null;
};

const reviewEnvelope = (row: ReviewRow): StoredReview => ({
  traceId: String(row.trace_id),
  lane: row.lane,
  decision: row.decision,
  correctAnswer: row.correct_answer == null ? null : String(row.correct_answer),
  rationale: row.rationale == null ? null : String(row.rationale),
  reviewedAt: new Date(row.reviewed_at).toISOString(),
  goldenRow: row.golden_row ?? null,
});

type TaskGroupReviewRow = {
  trace_id: string;
  lane: ReviewLane;
  outcome: TaskGroupReviewOutcome;
  task_group_id: string | null;
  task_group_name: string | null;
  rationale: string | null;
  reviewed_at: string | Date;
};

const taskGroupReviewEnvelope = (row: TaskGroupReviewRow): StoredTaskGroupReview => ({
  traceId: String(row.trace_id),
  lane: row.lane,
  outcome: row.outcome,
  taskGroupId: row.task_group_id == null ? null : String(row.task_group_id),
  taskGroupName: row.task_group_name == null ? null : String(row.task_group_name),
  rationale: row.rationale == null ? null : String(row.rationale),
  reviewedAt: new Date(row.reviewed_at).toISOString(),
});

export async function getReviewWorkflow(databaseUrl: string, workspaceId: string, defaultBudget: number) {
  const database = store(databaseUrl);
  await database.ready;
  const [settings, reviews, taskGroupReviews, cycles] = await Promise.all([
    database.sql`SELECT weekly_budget, updated_at FROM routelab_review_settings WHERE workspace_id = ${workspaceId} LIMIT 1`,
    database.sql`
      SELECT trace_id, lane, decision, correct_answer, rationale, reviewed_at, golden_row
      FROM routelab_review_results
      WHERE workspace_id = ${workspaceId}
      ORDER BY reviewed_at DESC
    `,
    database.sql`
      SELECT trace_id, lane, outcome, task_group_id, task_group_name, rationale, reviewed_at
      FROM routelab_task_group_reviews
      WHERE workspace_id = ${workspaceId}
      ORDER BY reviewed_at DESC
    `,
    database.sql`
      SELECT cycle_id, weekly_budget, assignments, created_at
      FROM routelab_review_cycles
      WHERE workspace_id = ${workspaceId}
      LIMIT 1
    `,
  ]);
  return {
    weeklyBudget: settings.length ? Number(settings[0].weekly_budget) : defaultBudget,
    updatedAt: settings.length ? new Date(settings[0].updated_at as string | Date).toISOString() : null,
    reviews: reviews.map((row) => reviewEnvelope(row as ReviewRow)),
    taskGroupReviews: taskGroupReviews.map((row) => taskGroupReviewEnvelope(row as TaskGroupReviewRow)),
    currentCycle: cycles.length ? {
      id: String(cycles[0].cycle_id),
      weeklyBudget: Number(cycles[0].weekly_budget),
      assignments: cycles[0].assignments as ReviewCycle["assignments"],
      createdAt: new Date(cycles[0].created_at as string | Date).toISOString(),
    } : null,
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

export async function saveReviewCycle(databaseUrl: string, workspaceId: string, cycle: ReviewCycle, defaultBudget: number) {
  const database = store(databaseUrl);
  await database.ready;
  const assignments = JSON.stringify(cycle.assignments);
  await database.sql`
    INSERT INTO routelab_review_cycles (workspace_id, cycle_id, weekly_budget, assignments, created_at)
    VALUES (${workspaceId}, ${cycle.id}, ${cycle.weeklyBudget}, ${assignments}::jsonb, ${cycle.createdAt})
    ON CONFLICT (workspace_id) DO UPDATE SET
      cycle_id = EXCLUDED.cycle_id,
      weekly_budget = EXCLUDED.weekly_budget,
      assignments = EXCLUDED.assignments,
      created_at = EXCLUDED.created_at
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
  lane: ReviewLane;
  decision: ReviewDecision;
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

export async function saveTaskGroupReviewResult({
  databaseUrl,
  workspaceId,
  traceId,
  lane,
  outcome,
  taskGroupId,
  taskGroupName,
  rationale,
  trace,
}: {
  databaseUrl: string;
  workspaceId: string;
  traceId: string;
  lane: ReviewLane;
  outcome: TaskGroupReviewOutcome;
  taskGroupId: string | null;
  taskGroupName: string | null;
  rationale: string | null;
  trace: unknown;
}) {
  const database = store(databaseUrl);
  await database.ready;
  const traceJson = JSON.stringify(trace);
  const rows = await database.sql`
    INSERT INTO routelab_task_group_reviews (
      workspace_id, trace_id, lane, outcome, task_group_id, task_group_name, rationale, trace, reviewed_at
    ) VALUES (
      ${workspaceId}, ${traceId}, ${lane}, ${outcome}, ${taskGroupId}, ${taskGroupName}, ${rationale}, ${traceJson}::jsonb, now()
    )
    ON CONFLICT (workspace_id, trace_id) DO UPDATE SET
      lane = EXCLUDED.lane,
      outcome = EXCLUDED.outcome,
      task_group_id = EXCLUDED.task_group_id,
      task_group_name = EXCLUDED.task_group_name,
      rationale = EXCLUDED.rationale,
      trace = EXCLUDED.trace,
      reviewed_at = now()
    RETURNING trace_id, lane, outcome, task_group_id, task_group_name, rationale, reviewed_at
  `;
  return taskGroupReviewEnvelope(rows[0] as TaskGroupReviewRow);
}
