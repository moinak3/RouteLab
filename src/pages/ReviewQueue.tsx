import { useEffect, useMemo, useState } from "react";
import { buildReviewQueue, type ReviewQueueItem, type ReviewLane } from "../core/reviewQueue";
import type { DistinctTaskBucket, GoldenDataset, Trace, TraceJudgeResult } from "../types";
import type { ReviewDecision, ReviewQueueFilter } from "../types/ui";
import { money, pct, preview } from "../lib/format";
import { distinctTaskFieldColumns, distinctTaskValue } from "../components/DistinctTaskDisplay";
import { traceUserFeedback, traceUserFeedbackLabel } from "../core/traceFeedback";

const MAX_JUDGE_FILTER_ITEMS = 120;
const laneLabels: Record<ReviewLane, string> = {
  representative: "Stratified random",
  unusual: "Unusual within coverage",
  uncovered: "Outside eval coverage",
};
const laneDescriptions: Record<ReviewLane, string> = {
  representative: "Across signatures, risk levels, and models.",
  unusual: "Safety alerts, feedback, tool paths or errors, long sessions, latency spikes, and eval flags.",
  uncovered: "Signatures absent from the human-labeled golden eval set.",
};

function judgeFilterItems(
  traces: Trace[],
  results: TraceJudgeResult[],
  buckets: DistinctTaskBucket[],
  filter: Exclude<ReviewQueueFilter, "all">,
): ReviewQueueItem[] {
  const traceById = new Map(traces.map((trace) => [trace.id, trace]));
  const bucketByTrace = new Map<string, DistinctTaskBucket>();
  buckets.forEach((bucket) => bucket.traces.forEach((id) => bucketByTrace.set(id, bucket)));
  return results
    .filter((result) => filter === "passing" ? result.passed : !result.passed)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, MAX_JUDGE_FILTER_ITEMS)
    .flatMap((judge): ReviewQueueItem[] => {
      const trace = traceById.get(judge.trace_id);
      return trace ? [{
        trace, judge, bucket: bucketByTrace.get(trace.id), lane: "representative",
        reviewReason: filter === "passing"
          ? "Included in this filter because the existing evaluator marked the response as passing."
          : "Included in this filter because the existing evaluator marked the response as needing review.",
      }] : [];
    });
}

export function ReviewQueue({
  traces,
  traceJudgeResults,
  distinctTaskBuckets,
  goldenDatasets,
  filter,
  onFilterChange,
}: {
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  distinctTaskBuckets: DistinctTaskBucket[];
  goldenDatasets: GoldenDataset[];
  filter: ReviewQueueFilter;
  onFilterChange: (filter: ReviewQueueFilter) => void;
}) {
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>({});
  const selection = useMemo(() => buildReviewQueue(traces, traceJudgeResults, distinctTaskBuckets, goldenDatasets), [traces, traceJudgeResults, distinctTaskBuckets, goldenDatasets]);
  const reviewItems = useMemo(() => filter === "all" ? selection.reviewItems
    : judgeFilterItems(traces, traceJudgeResults, distinctTaskBuckets, filter),
  [filter, selection, traces, traceJudgeResults, distinctTaskBuckets]);
  useEffect(() => setIndex(0), [filter, traces]);

  const current = reviewItems[Math.min(index, Math.max(reviewItems.length - 1, 0))];
  const userFeedback = current ? traceUserFeedback(current.trace) : "none";
  const reviewed = reviewItems.filter((item) => decisions[item.trace.id]).length;
  const workflowTraces = current?.trace.workflow_id
    ? traces.filter((trace) => trace.workflow_id === current.trace.workflow_id)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    : [];
  const applyDecision = (decision: ReviewDecision) => {
    if (!current) return;
    setDecisions((previous) => ({ ...previous, [current.trace.id]: decision }));
    setIndex((previous) => Math.min(previous + 1, reviewItems.length - 1));
  };
  const choices: Array<[ReviewDecision, string, string]> = current?.judge ? [
    ["approve", "Overrule judge", "Response is actually fine"],
    ["reject", "Confirm failure", "Judge is right"],
    ["escalate", "Escalate to expert", "Needs domain review"],
    ["skip", "Skip", "Not enough context"],
  ] : [
    ["approve", "Mark satisfactory", "No issue found"],
    ["reject", "Confirm issue", "Response needs correction"],
    ["escalate", "Escalate to expert", "Needs domain review"],
    ["skip", "Skip", "Not enough context"],
  ];
  const title = filter === "all" ? "Review sampling" : filter === "passing" ? "Passing prompts" : "Needs review prompts";
  const laneOrder: ReviewLane[] = ["representative", "unusual", "uncovered"];

  return <div className="review-page">
    <section className="review-method panel">
      <div className="review-method-head">
        <div><p className="eyebrow">How traces are chosen</p><h2>One-third in each review lane</h2></div>
        <span>{selection.reviewItems.length.toLocaleString()} selected</span>
      </div>
      <p>Reviews rotate between a stratified random sample, unusual traces within covered signatures, and signatures missing eval coverage. Safety/policy alerts are prioritized in the unusual lane. Each trace appears once; we keep equal thirds when the evidence supports them.</p>
      <div className="review-lanes">
        {laneOrder.map((lane) => <div className="review-lane" key={lane}>
          <span>{laneLabels[lane]}</span>
          <b>{selection.laneCounts[lane].toLocaleString()} <small>/ {selection.laneTargets[lane].toLocaleString()} target</small></b>
          <p>{laneDescriptions[lane]}</p>
        </div>)}
      </div>
      {selection.reviewItems.length < selection.capacity && <small className="review-shortfall">{(selection.capacity - selection.reviewItems.length).toLocaleString()} slots unused to preserve the split; only {selection.available.unusual.toLocaleString()} unusual covered traces are available in this upload.</small>}
      {(selection.laneCounts.unusual < selection.laneTargets.unusual || selection.laneCounts.uncovered < selection.laneTargets.uncovered) && <small className="review-shortfall">This dataset has too few eligible traces for equal thirds; the actual lane counts are shown above.</small>}
      <small className="review-method-note">Golden eval coverage: {selection.coverage.coveredSignatures}/{selection.coverage.totalSignatures} signatures across {selection.coverage.goldenDatasets} dataset{selection.coverage.goldenDatasets === 1 ? "" : "s"}. A judge score alone is not coverage. Safety/policy alerts are read from trace metadata, not independently classified here. Latency outliers use the median and upper range for the same signature and model; overall quality rates need traffic weighting.</small>
    </section>
    <section className="review-shell">
      <div className="review-top">
        <div><p className="eyebrow">Human review</p><h2>{title}</h2>
          <small>{filter === "all"
            ? "Selected from " + traces.length.toLocaleString() + " uploaded traces. Review reasons appear on every item."
            : "Showing " + reviewItems.length.toLocaleString() + " existing judge results. The three-lane mix applies to All."}</small>
        </div>
        <div className="review-filter-actions" aria-label="Review queue filters">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => onFilterChange("all")}>All</button>
          <button type="button" className={filter === "passing" ? "active" : ""} onClick={() => onFilterChange("passing")}>Passing</button>
          <button type="button" className={filter === "needs_review" ? "active" : ""} onClick={() => onFilterChange("needs_review")}>Needs review</button>
        </div>
        <span>{reviewed}/{reviewItems.length.toLocaleString()} reviewed</span>
      </div>
      {!current ? <div className="panel review-empty"><h2>No traces match this view</h2><p>{filter === "all"
        ? "Upload traces to build the review sample."
        : "No scored traces match this judge filter."}</p></div> : <>
        <article className="review-card">
          <div className="review-score">
            <div><small>{current.judge ? "Judge score" : "Evaluation status"}</small><b>{current.judge ? pct(current.judge.score * 100) : "Not scored"}</b></div>
            <span className={"risk " + (current.bucket?.risk_level ?? "medium")}>{current.bucket?.risk_level ?? "unknown"} risk</span>
          </div>
          <section className="review-why">
            <small>Why this trace was chosen</small>
            <b>{filter === "all" ? laneLabels[current.lane] : "Judge filter"}</b>
            <p>{current.reviewReason}</p>
          </section>
          <section className="review-facts">
            <div><small>Actual trace</small><b>{current.trace.id}</b><span>{current.trace.model} · {current.trace.status} · {current.trace.total_tokens.toLocaleString()} tokens · {current.trace.latency_ms ?? 0} ms</span></div>
            <div><small>Source response</small><b>{current.trace.model}</b><span>{money(current.trace.cost_usd ?? 0)} · {current.trace.latency_ms ?? 0} ms · {current.trace.status}</span></div>
          </section>
          <section className={`review-user-feedback ${userFeedback}`}><small>User feedback</small><b>{traceUserFeedbackLabel(userFeedback)}</b><span>{current.trace.metadata?.user_id ? `From ${String(current.trace.metadata.user_id)}` : "No user ID captured"}</span></section>
          <section><small>Prompt</small><p>{preview(current.trace.prompt_text, 900)}</p></section>
          <section><small>Answer provided by agent</small><p>{preview(current.trace.response_text ?? "No response captured", 900)}</p></section>
          {workflowTraces.length > 1 && <details className="review-workflow"><summary>Workflow context · {workflowTraces.length} trace steps</summary>
            <div>{workflowTraces.map((trace) => <p key={trace.id}><b>{trace.id === current.trace.id ? "Current step" : trace.workflow_role ?? "Step"}</b> · {trace.id} · {preview(trace.prompt_text, 120)}</p>)}</div>
          </details>}
          <section><small>Classification / Distinct Task</small><p>{current.bucket ? current.bucket.bucket_name : "No distinct task bucket assigned"}</p>
            {current.bucket && <div className="review-tags">{distinctTaskFieldColumns.map(({ field }) => <span key={field}>{distinctTaskValue(field, current.bucket!.task[field])}</span>)}</div>}
          </section>
          <section><small>LLM-as-judge result</small><p>{current.judge
            ? <><b>{current.judge.evaluator_type.replaceAll("_", " ")}</b> scored this {pct(current.judge.score * 100)}. {current.judge.rationale}</>
            : "No full rubric result is available for this trace yet."}</p></section>
          {decisions[current.trace.id] && <div className="review-decision">Marked: <b>{decisions[current.trace.id]}</b></div>}
          <div className="review-actions" aria-label="Review choices">{choices.map(([value, label, hint]) =>
            <button type="button" className={"review-choice " + value} onClick={() => applyDecision(value)} key={value}><b>{label}</b><span>{hint}</span></button>)}</div>
        </article>
        <div className="review-nav"><button type="button" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>Previous</button>
          <span>{Math.min(index + 1, reviewItems.length).toLocaleString()} of {reviewItems.length.toLocaleString()}</span>
          <button type="button" onClick={() => setIndex(Math.min(reviewItems.length - 1, index + 1))} disabled={index >= reviewItems.length - 1}>Next</button></div>
      </>}
    </section>
  </div>;
}
