import type { GoldenDatasetRow, Trace, TraceJudgeResult } from "../types.js";
import type { ReviewDecision } from "../types/ui.js";
import type { ReviewLane } from "../core/reviewQueue.js";
import {
  getReviewWorkflow,
  ReviewStoreUnavailableError,
  saveReviewResult,
  saveWeeklyReviewBudget,
} from "./reviewStore.js";

const DEFAULT_WEEKLY_REVIEW_BUDGET = 60;
const MIN_WEEKLY_REVIEW_BUDGET = 3;
const MAX_WEEKLY_REVIEW_BUDGET = 300;
const lanes: ReviewLane[] = ["representative", "unusual", "uncovered"];
const decisions: ReviewDecision[] = ["correct", "incorrect", "escalate", "skip"];

const workspaceId = () => String(process.env.ROUTELAB_POLICY_WORKSPACE_ID ?? "demo").trim() || "demo";
const databaseUrl = () => String(process.env.DATABASE_URL ?? "").trim();
const isObject = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const normalizedReviewBudget = (value: number) => Math.min(MAX_WEEKLY_REVIEW_BUDGET, Math.max(MIN_WEEKLY_REVIEW_BUDGET, Math.round(Number.isFinite(value) ? value : DEFAULT_WEEKLY_REVIEW_BUDGET)));

function goldenRowForReview(trace: Trace, judge: TraceJudgeResult | undefined, lane: ReviewLane, decision: ReviewDecision, correctAnswer: string | null, rationale: string | null): GoldenDatasetRow | null {
  if (decision !== "correct" && decision !== "incorrect") return null;
  const humanPassed = decision === "correct";
  return {
    trace_id: trace.id,
    task_type: String(trace.metadata?.task_type ?? trace.metadata?.distinct_task_label ?? trace.signature_decision?.signature_label ?? ""),
    trace_signature: String(trace.metadata?.task_bucket_id ?? trace.signature_decision?.signature_id ?? ""),
    model: trace.model,
    prompt: trace.prompt_text,
    agent_answer: trace.response_text ?? "",
    human_answer: humanPassed ? trace.response_text ?? "" : correctAnswer ?? "",
    human_passed: humanPassed,
    human_score: humanPassed ? 1 : 0,
    human_severity: humanPassed ? null : judge?.severity ?? "major",
    human_rationale: rationale || (humanPassed
      ? "Human reviewer confirmed that the agent response is correct."
      : "Human reviewer marked the agent response incorrect and supplied a corrected answer."),
    review_lane: lane,
    reviewed_at: new Date().toISOString(),
  };
}

const sendJson = (res: any, status: number, payload: unknown) => res.status(status).json(payload);

export default async function reviewHandler(req: any, res: any) {
  try {
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
      return sendJson(res, 200, await getReviewWorkflow(databaseUrl(), workspaceId(), DEFAULT_WEEKLY_REVIEW_BUDGET));
    }
    if (req.method === "PUT") {
      const weeklyBudget = normalizedReviewBudget(Number(req.body?.weeklyBudget));
      return sendJson(res, 200, await saveWeeklyReviewBudget(databaseUrl(), workspaceId(), weeklyBudget, DEFAULT_WEEKLY_REVIEW_BUDGET));
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });

    const trace = req.body?.trace as Trace | undefined;
    const judge = req.body?.judge as TraceJudgeResult | undefined;
    const lane = req.body?.lane as ReviewLane;
    const decision = req.body?.decision as ReviewDecision;
    const correctAnswer = String(req.body?.correctAnswer ?? "").trim() || null;
    const rationale = String(req.body?.rationale ?? "").trim() || null;
    if (!isObject(trace) || typeof trace.id !== "string" || !trace.id.trim()) return sendJson(res, 400, { error: "A valid trace is required." });
    if (!lanes.includes(lane)) return sendJson(res, 400, { error: "A valid review lane is required." });
    if (!decisions.includes(decision)) return sendJson(res, 400, { error: "A valid review decision is required." });
    if (decision === "incorrect" && !correctAnswer) return sendJson(res, 400, { error: "Provide the corrected answer before adding this conversation to the golden dataset." });

    const goldenRow = goldenRowForReview(trace, judge, lane, decision, correctAnswer, rationale);
    const review = await saveReviewResult({
      databaseUrl: databaseUrl(), workspaceId: workspaceId(), traceId: trace.id, lane, decision,
      correctAnswer, rationale, trace, judge: judge ?? null, goldenRow,
    });
    return sendJson(res, 200, { review });
  } catch (error) {
    if (error instanceof ReviewStoreUnavailableError) return sendJson(res, 503, { error: error.message });
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Review workflow storage failed." });
  }
}
