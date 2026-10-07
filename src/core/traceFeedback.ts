import type { Trace } from "../types";

export type TraceUserFeedback = "thumbs_up" | "thumbs_down" | "none";

export function traceUserFeedback(trace: Trace): TraceUserFeedback {
  const metadata = trace.metadata ?? {};
  const value = metadata.user_feedback;
  if (value === "thumbs_down" || metadata.thumbs_down === true) return "thumbs_down";
  if (value === "thumbs_up" || metadata.thumbs_up === true) return "thumbs_up";
  return "none";
}

export function traceUserFeedbackLabel(feedback: TraceUserFeedback): string {
  if (feedback === "thumbs_up") return "Thumbs up";
  if (feedback === "thumbs_down") return "Thumbs down";
  return "No feedback recorded";
}
