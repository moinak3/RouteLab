import type { Trace, TraceJudgeResult } from "../types";

const passRationales = [
  "Answer preserves the billing verification requirement and avoids promising an unapproved refund.",
  "Answer includes the required policy condition and keeps the next step customer-safe.",
  "Structured labels match the support taxonomy and include priority, queue, and sentiment.",
  "Response is grounded in the provided source and cites the relevant support-policy constraint.",
  "Tool-dependent answer reflects the returned account state without adding unsupported claims.",
  "Handoff summary keeps the operational blocker and escalation need intact.",
  "Customer-facing draft is concise, accurate, and avoids timeline guarantees.",
  "Translation preserves the support intent and does not introduce policy changes.",
  "Compliance review correctly identifies the risky promise or data-handling issue.",
  "Legal review captures the material obligation and flags the right escalation path.",
  "Troubleshooting flow is ordered, actionable, and does not skip the verification step.",
  "Churn-risk tagging reflects the customer signal and routes to the correct queue.",
  "Knowledge-base extraction returns the missing article topic, question, and title cleanly.",
  "Security verification answer depends on verified admin or entitlement state as required.",
  "Macro draft keeps a customer-ready tone without exposing internal policy language.",
  "RAG answer uses the retrieved constraint and avoids broad policy generalization.",
];
const majorRationales = [
  "Omits the verification step required before billing or refund action.",
  "Drops the 14-day deferral limit and makes the support policy look more permissive than it is.",
  "Misses the escalation reason needed for the next support owner to act.",
  "Gives a plausible answer but does not preserve the required source-backed condition.",
  "Classifies the intent but misses the high-priority renewal or compliance signal.",
  "Summarizes the ticket but leaves out the current blocker that determines routing.",
  "Uses an acceptable tone but fails to state the account-verification requirement.",
  "Returns structured data with one required support field missing or under-specified.",
];
const criticalRationales = [
  "Promises refund approval before eligibility review, which violates billing policy.",
  "Suggests sharing customer data outside approved systems.",
  "Asks for password disclosure instead of using approved account-recovery verification.",
  "Says legal review is unnecessary despite an uncapped or unusual contract obligation.",
  "Claims any downtime qualifies for credit and contradicts the SLA threshold.",
];

const judgeOutcome = (index: number) => {
  const slot = index % 20;
  if (slot < 14) {
    return {
      score: 1,
      passed: true,
      rationale: passRationales[index % passRationales.length],
    };
  }
  if (slot < 18) {
    return {
      score: .5,
      passed: false,
      severity: "major" as const,
      rationale: majorRationales[index % majorRationales.length],
    };
  }
  return {
    score: 0,
    passed: false,
    severity: "critical" as const,
    rationale: criticalRationales[index % criticalRationales.length],
  };
};

export function createTraceJudgeResults(traces: Trace[]): TraceJudgeResult[] {
  return traces.map((trace, index) => ({
    id: `judge_${trace.id}`,
    trace_id: trace.id,
    evaluator_type: "trace_quality_llm_judge (gpt-5.5-pro)",
    created_at: trace.timestamp,
    ...judgeOutcome(index),
  }));
}

export const traceJudgeResultsByTraceId = (results: TraceJudgeResult[]) => new Map(results.map((result) => [result.trace_id, result]));
