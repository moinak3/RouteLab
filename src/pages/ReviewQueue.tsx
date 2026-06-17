import { useEffect, useMemo, useState } from "react";
import { buildReviewQueue, type ReviewQueueItem } from "../core/reviewQueue";
import { replay } from "../core/simulations";
import type { CandidateRun, DistinctTaskBucket, EvalResult, Trace, TraceJudgeResult } from "../types";
import type { ReviewDecision, ReviewQueueFilter } from "../types/ui";
import { money, pct, preview } from "../lib/format";
import { distinctTaskFieldColumns, distinctTaskValue } from "../components/DistinctTaskDisplay";

const MAX_TRACE_JUDGE_ITEMS = 120;

function traceJudgeReviewQueue(
  traces: Trace[],
  traceJudgeResults: TraceJudgeResult[],
  distinctTaskBuckets: DistinctTaskBucket[],
  filter: Exclude<ReviewQueueFilter, "all">,
): ReviewQueueItem[] {
  const traceById = new Map(traces.map((trace) => [trace.id, trace]));
  const bucketByTrace = new Map<string, DistinctTaskBucket>();
  distinctTaskBuckets.forEach((bucket) => bucket.traces.forEach((traceId) => bucketByTrace.set(traceId, bucket)));

  return traceJudgeResults
    .filter((result) => filter === "passing" ? result.passed : !result.passed)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, MAX_TRACE_JUDGE_ITEMS)
    .map((result): ReviewQueueItem | null => {
      const trace = traceById.get(result.trace_id);
      if (!trace) return null;
      const run: CandidateRun = {
        id: `source_${trace.id}`,
        trace_id: trace.id,
        candidate_model: trace.model,
        response_text: trace.response_text ?? "No response captured on the source trace",
        input_tokens: trace.input_tokens,
        output_tokens: trace.output_tokens,
        latency_ms: trace.latency_ms ?? 0,
        cost_usd: trace.cost_usd ?? 0,
        status: trace.status,
      };
      const evalResult: EvalResult = {
        id: result.id,
        trace_id: result.trace_id,
        candidate_run_id: run.id,
        evaluator_type: result.evaluator_type,
        score: result.score,
        passed: result.passed,
        explanation: result.rationale,
        severity: result.severity,
      };
      return {
        trace,
        run,
        evalResult,
        bucket: bucketByTrace.get(trace.id),
        reviewReason: filter === "passing" ? "Passing LLM judge result" : "Needs review from LLM judge",
      };
    })
    .filter((item): item is ReviewQueueItem => item !== null);
}

const filterLabel = (filter: ReviewQueueFilter) => {
  if (filter === "passing") return "Passing prompts";
  if (filter === "needs_review") return "Needs review prompts";
  return "Smart trace check";
};

export function ReviewQueue({
  traces,
  traceJudgeResults,
  distinctTaskBuckets,
  candidate,
  filter,
  onFilterChange,
}: {
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  distinctTaskBuckets: DistinctTaskBucket[];
  candidate: string;
  filter: ReviewQueueFilter;
  onFilterChange: (filter: ReviewQueueFilter) => void;
}) {
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>({});

  useEffect(() => setIndex(0), [filter]);

  const { reviewItems, lowScoreCount, distinctTaskCount } = useMemo(() => {
    if (filter !== "all") {
      const items = traceJudgeReviewQueue(traces, traceJudgeResults, distinctTaskBuckets, filter);
      const distinctTasks = new Set(items.map((item) => item.bucket?.bucket_id ?? "unbucketed"));
      return { reviewItems: items, lowScoreCount: items.length, distinctTaskCount: distinctTasks.size };
    }
    const replayResult = replay(traces, candidate);
    return buildReviewQueue(traces, replayResult.runs, replayResult.evals, distinctTaskBuckets);
  }, [traces, traceJudgeResults, distinctTaskBuckets, candidate, filter]);

  const current = reviewItems[Math.min(index, Math.max(reviewItems.length - 1, 0))];
  const reviewed = Object.keys(decisions).filter((id) => reviewItems.some((item) => item.evalResult.id === id)).length;
  const applyDecision = (decision: ReviewDecision) => {
    if (!current) return;
    setDecisions({ ...decisions, [current.evalResult.id]: decision });
    setIndex(Math.min(index + 1, Math.max(reviewItems.length - 1, 0)));
  };
  const choiceLabels: Array<[ReviewDecision, string, string]> = [
    ["approve", "Approve", "Eval is wrong"],
    ["reject", "Reject", "Real failure"],
    ["escalate", "Flag for review", "Needs expert"],
    ["skip", "Skip", "Not enough context"],
  ];

  if (!current) {
    return <section className="panel review-empty"><p className="eyebrow">Human review</p><h2>No prompts match this review filter</h2><p>{filter === "all" ? `All simulated evals for ${candidate} are currently passing the low-score review threshold.` : `No ${filterLabel(filter).toLowerCase()} are available from the active LLM judge run.`}</p></section>;
  }

  const decision = decisions[current.evalResult.id];
  const subtitle = filter === "all"
    ? `Sampling ${reviewItems.length.toLocaleString()} traces from ${lowScoreCount.toLocaleString()} low-score evals across ${distinctTaskCount.toLocaleString()} Distinct Tasks`
    : `Showing ${reviewItems.length.toLocaleString()} ${filterLabel(filter).toLowerCase()} from the active LLM judge run across ${distinctTaskCount.toLocaleString()} Distinct Tasks`;

  return <section className="review-shell"><div className="review-top"><div><p className="eyebrow">Human review</p><h2>{filterLabel(filter)}</h2><small>{subtitle}</small></div><div className="review-filter-actions"><button type="button" className={filter === "all" ? "active" : ""} onClick={() => onFilterChange("all")}>All</button><button type="button" className={filter === "passing" ? "active" : ""} onClick={() => onFilterChange("passing")}>Passing</button><button type="button" className={filter === "needs_review" ? "active" : ""} onClick={() => onFilterChange("needs_review")}>Needs review</button></div><span>{reviewed}/{reviewItems.length.toLocaleString()} reviewed</span></div><article className="review-card"><div className="review-score"><div><small>Judge score</small><b>{pct(current.evalResult.score * 100)}</b></div><span className={`risk ${current.bucket?.risk_level ?? "medium"}`}>{current.bucket?.risk_level ?? "unknown"} risk</span></div><section className="review-facts"><div><small>Actual trace</small><b>{current.trace.id}</b><span>{current.trace.model} · {current.trace.status} · {current.trace.total_tokens.toLocaleString()} tokens · {current.trace.latency_ms ?? 0}ms</span></div><div><small>{filter === "all" ? "Candidate run" : "Source run"}</small><b>{current.run.candidate_model}</b><span>{money(current.run.cost_usd)} · {current.run.latency_ms}ms · {current.run.status}</span></div></section><section><small>Prompt</small><p>{preview(current.trace.prompt_text, 900)}</p></section><section><small>Answer provided by agent</small><p>{preview(current.run.response_text, 900)}</p></section><section><small>Classification / Distinct Task</small><p>{current.bucket ? `${current.bucket.bucket_name} (${current.bucket.bucket_id})` : "No distinct task bucket assigned"}</p>{current.bucket && <div className="review-tags">{distinctTaskFieldColumns.map(({ field }) => <span key={field}>{distinctTaskValue(field, current.bucket!.task[field])}</span>)}</div>}</section><section><small>LLM-as-judge result</small><p><b>{current.evalResult.evaluator_type.replaceAll("_", " ")}</b> scored this {pct(current.evalResult.score * 100)}. {current.evalResult.explanation ?? `${current.evalResult.severity ?? "Low"} eval outcome on ${current.run.candidate_model}.`}</p></section><details><summary>Reference answer</summary><p>{preview(current.trace.response_text || "No response captured on the source trace", 900)}</p></details>{decision && <div className="review-decision">Marked: <b>{decision === "escalate" ? "flag for review" : decision}</b></div>}<div className="review-actions" aria-label="Review choices">{choiceLabels.map(([value, label, hint]) => <button type="button" className={`review-choice ${value}`} onClick={() => applyDecision(value)} key={value}><b>{label}</b><span>{hint}</span></button>)}</div></article><div className="review-nav"><button type="button" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>Previous</button><span>{Math.min(index + 1, reviewItems.length).toLocaleString()} of {reviewItems.length.toLocaleString()}</span><button type="button" onClick={() => setIndex(Math.min(reviewItems.length - 1, index + 1))} disabled={index >= reviewItems.length - 1}>Next</button></div></section>;
}
