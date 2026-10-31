import type { GoldenDataset, GoldenDatasetRow, Trace, TraceJudgeResult } from "../types";
import type { ReviewDecision } from "../types/ui";
import type { ReviewLane } from "./reviewQueue";

export const DEFAULT_WEEKLY_REVIEW_BUDGET = 60;
export const MIN_WEEKLY_REVIEW_BUDGET = 3;
export const MAX_WEEKLY_REVIEW_BUDGET = 300;
export const HUMAN_REVIEW_DATASET_ID = "golden_human_reviewed_conversations";

export type PersistedReview = {
  traceId: string;
  lane: ReviewLane;
  decision: ReviewDecision;
  correctAnswer: string | null;
  rationale: string | null;
  reviewedAt: string;
  goldenRow: GoldenDatasetRow | null;
};

export type ReviewWorkflowState = {
  weeklyBudget: number;
  updatedAt: string | null;
  reviews: PersistedReview[];
};

export type SaveReviewInput = {
  trace: Trace;
  judge?: TraceJudgeResult;
  lane: ReviewLane;
  decision: ReviewDecision;
  correctAnswer?: string;
  rationale?: string;
};

export function normalizedReviewBudget(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_WEEKLY_REVIEW_BUDGET;
  return Math.min(MAX_WEEKLY_REVIEW_BUDGET, Math.max(MIN_WEEKLY_REVIEW_BUDGET, Math.round(value)));
}

export function reviewLaneHref(lane: ReviewLane) {
  return `/quality/review-queue?lane=${lane}`;
}

export function reviewLaneFromSearch(search: string): ReviewLane {
  const lane = new URLSearchParams(search).get("lane");
  return lane === "unusual" || lane === "uncovered" ? lane : "representative";
}

export function reviewsAsGoldenDataset(reviews: PersistedReview[]): GoldenDataset | null {
  const rows = reviews.flatMap((review) => review.goldenRow ? [review.goldenRow] : []);
  if (!rows.length) return null;
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const timestamps = reviews.flatMap((review) => review.goldenRow ? [Date.parse(review.reviewedAt)] : []).filter(Number.isFinite);
  return {
    id: HUMAN_REVIEW_DATASET_ID,
    name: "Human-reviewed conversations",
    created_at: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : new Date().toISOString(),
    row_count: rows.length,
    columns,
    rows,
  };
}

export function reviewWorkflowErrorMessage(error: unknown, fallback = "Review workflow request failed."): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; error?: unknown; detail?: unknown };
    return reviewWorkflowErrorMessage(value.message ?? value.error ?? value.detail, fallback);
  }
  return fallback;
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: unknown };
  if (!response.ok) throw new Error(reviewWorkflowErrorMessage(payload.error));
  return payload;
}

function validWorkflow(payload: unknown): payload is ReviewWorkflowState {
  if (!payload || typeof payload !== "object") return false;
  const workflow = payload as Partial<ReviewWorkflowState>;
  return Number.isFinite(workflow.weeklyBudget) && Array.isArray(workflow.reviews);
}

async function workflowResponse(response: Response) {
  const payload = await responseJson<unknown>(response);
  if (!validWorkflow(payload)) throw new Error("Persistent review storage is unavailable in this environment.");
  return payload;
}

const reviewEndpoint = (workspaceId: string) => `/api/reviews?workspace=${encodeURIComponent(workspaceId)}`;

export async function fetchReviewWorkflow(workspaceId: string, signal?: AbortSignal) {
  return workflowResponse(await fetch(reviewEndpoint(workspaceId), { headers: { Accept: "application/json" }, cache: "no-store", signal }));
}

export async function persistWeeklyReviewBudget(workspaceId: string, weeklyBudget: number) {
  return workflowResponse(await fetch(reviewEndpoint(workspaceId), {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ weeklyBudget: normalizedReviewBudget(weeklyBudget) }),
  }));
}

export async function persistReview(workspaceId: string, input: SaveReviewInput) {
  return responseJson<{ review: PersistedReview }>(await fetch(reviewEndpoint(workspaceId), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  }));
}
