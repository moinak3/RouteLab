import { useEffect, useMemo, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { buildReviewQueue, type ReviewLane } from "../core/reviewQueue";
import { reviewChoicesForVerdict } from "../core/reviewAdjudication";
import { reviewLaneHref, type PersistedReview, type SaveReviewInput } from "../core/reviewPersistence";
import type { DistinctTaskBucket, GoldenDataset, Trace, TraceJudgeResult } from "../types";
import type { ReviewDecision, ReviewQueueFilter } from "../types/ui";
import { money, pct, preview } from "../lib/format";
import { distinctTaskFieldColumns, distinctTaskValue } from "../components/DistinctTaskDisplay";
import { traceUserFeedback, traceUserFeedbackLabel } from "../core/traceFeedback";

const laneOrder: ReviewLane[] = ["representative", "unusual", "uncovered"];
const laneLabels: Record<ReviewLane, string> = {
  representative: "Stratified sample",
  unusual: "Unusual within coverage",
  uncovered: "Outside of coverage",
};
const laneDescriptions: Record<ReviewLane, string> = {
  representative: "A balanced sample across task groups, risk levels, and models. Use this lane to estimate overall quality without selection bias.",
  unusual: "Known task groups with safety alerts, negative feedback, rare tool paths, errors, long sessions, latency spikes, or eval flags.",
  uncovered: "Conversations from task groups that do not yet have human-labeled examples in the golden dataset.",
};

type PersistenceState = "loading" | "ready" | "saving" | "unavailable";

export function ReviewQueue({
  traces,
  traceJudgeResults,
  distinctTaskBuckets,
  goldenDatasets,
  filter = "representative",
  onFilterChange,
  weeklyBudget = 60,
  persistedReviews = [],
  persistenceState = "loading",
  persistenceError = null,
  onWeeklyBudgetChange,
  onSaveReview,
}: {
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  distinctTaskBuckets: DistinctTaskBucket[];
  goldenDatasets: GoldenDataset[];
  filter: ReviewQueueFilter;
  onFilterChange: (filter: ReviewQueueFilter) => void;
  weeklyBudget: number;
  persistedReviews: PersistedReview[];
  persistenceState: PersistenceState;
  persistenceError: string | null;
  onWeeklyBudgetChange: (weeklyBudget: number) => Promise<void>;
  onSaveReview: (input: SaveReviewInput) => Promise<PersistedReview>;
}) {
  const [index, setIndex] = useState(0);
  const [budgetDraft, setBudgetDraft] = useState(String(weeklyBudget));
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [reviewRationale, setReviewRationale] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const selection = useMemo(
    () => buildReviewQueue(traces, traceJudgeResults, distinctTaskBuckets, goldenDatasets, weeklyBudget),
    [traces, traceJudgeResults, distinctTaskBuckets, goldenDatasets, weeklyBudget],
  );
  const reviewItems = useMemo(() => (selection.reviewItems ?? []).filter((item) => item.lane === filter), [selection, filter]);
  const unusedSlots = selection.capacity - selection.reviewItems.length;
  const reviewByTrace = useMemo(() => new Map(persistedReviews.map((review) => [review.traceId, review])), [persistedReviews]);
  const reviewed = reviewItems.filter((item) => reviewByTrace.has(item.trace.id)).length;

  useEffect(() => setBudgetDraft(String(weeklyBudget)), [weeklyBudget]);
  useEffect(() => {
    setIndex(0);
    setCorrectionOpen(false);
    setLocalError(null);
  }, [filter, traces]);

  const current = reviewItems[Math.min(index, Math.max(reviewItems.length - 1, 0))];
  const savedReview = current ? reviewByTrace.get(current.trace.id) : undefined;
  const userFeedback = current ? traceUserFeedback(current.trace) : "none";
  const workflowTraces = current?.trace.workflow_id
    ? traces.filter((trace) => trace.workflow_id === current.trace.workflow_id)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    : [];
  const choices = reviewChoicesForVerdict(current?.judge?.passed);
  const automatedVerdict = current?.judge ? current.judge.passed ? "Pass" : "Needs review" : "Not scored";
  const decisionLabel = savedReview
    ? choices.find(([value]) => value === savedReview.decision)?.[1] ?? savedReview.decision
    : undefined;

  useEffect(() => {
    setCorrectionOpen(false);
    setCorrectAnswer(savedReview?.correctAnswer ?? "");
    setReviewRationale(savedReview?.rationale ?? "");
    setLocalError(null);
  }, [current?.trace.id, savedReview?.correctAnswer, savedReview?.rationale]);

  const selectLane = (lane: ReviewLane) => (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onFilterChange(lane);
  };

  const advance = () => setIndex((previous) => Math.min(previous + 1, reviewItems.length - 1));

  async function saveDecision(decision: ReviewDecision, answer = "", rationale = "") {
    if (!current || savingReview) return;
    setSavingReview(true);
    setLocalError(null);
    try {
      await onSaveReview({ trace: current.trace, judge: current.judge, lane: current.lane, decision, correctAnswer: answer, rationale });
      setCorrectionOpen(false);
      advance();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The review could not be saved.");
    } finally {
      setSavingReview(false);
    }
  }

  function applyDecision(decision: ReviewDecision) {
    if (decision === "incorrect") {
      setCorrectionOpen(true);
      setLocalError(null);
      return;
    }
    void saveDecision(decision);
  }

  function submitCorrection(event: FormEvent) {
    event.preventDefault();
    if (!correctAnswer.trim()) {
      setLocalError("Provide the corrected answer before adding this conversation to the golden dataset.");
      return;
    }
    void saveDecision("incorrect", correctAnswer.trim(), reviewRationale.trim());
  }

  async function saveBudget(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    try {
      await onWeeklyBudgetChange(Number(budgetDraft));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The review budget could not be saved.");
    }
  }

  return <div className="review-page">
    <section className="review-budget panel">
      <div><p className="eyebrow">Weekly review plan</p><h2>How many conversations can your team review each week?</h2><p>RouteLab uses this budget to build three review lanes. The split stays explicit so representative quality measurement is not mixed with targeted failure finding.</p></div>
      <form onSubmit={saveBudget}>
        <label htmlFor="weekly-review-budget">Conversations per week</label>
        <div><input id="weekly-review-budget" type="number" min="3" max="300" step="1" value={budgetDraft} onChange={(event) => setBudgetDraft(event.target.value)} /><button type="submit" disabled={persistenceState === "saving"}>Save budget</button></div>
        <small>{persistenceState === "loading" ? "Loading saved budget..." : persistenceState === "saving" ? "Saving..." : persistenceState === "ready" ? "Saved for this workspace" : "Cloud persistence is unavailable"}</small>
      </form>
    </section>

    <section className="review-method panel">
      <div className="review-method-head"><div><p className="eyebrow">How this queue is built</p><h2>{weeklyBudget.toLocaleString()} conversation weekly budget</h2></div><span>{selection.reviewItems.length.toLocaleString()} selected</span></div>
      <nav className="review-tabs" aria-label="Review lanes">
        {laneOrder.map((lane) => <a href={reviewLaneHref(lane)} className={filter === lane ? "active" : ""} aria-current={filter === lane ? "page" : undefined} onClick={selectLane(lane)} key={lane}>
          <span>{laneLabels[lane]}</span>
          <b>{selection.laneCounts[lane].toLocaleString()} <small>/ {selection.laneTargets[lane].toLocaleString()} target</small></b>
          <p>{laneDescriptions[lane]}</p>
        </a>)}
      </nav>
      {unusedSlots > 0 && <small className="review-shortfall">{unusedSlots.toLocaleString()} {unusedSlots === 1 ? "slot is" : "slots are"} unused because the current trace set does not have enough eligible conversations to fill every lane without inventing findings.</small>}
      <small className="review-method-note">Golden eval coverage: {selection.coverage.coveredSignatures}/{selection.coverage.totalSignatures} task groups across {selection.coverage.goldenDatasets} dataset{selection.coverage.goldenDatasets === 1 ? "" : "s"}. A judge score alone is not coverage. Safety alerts come from recorded trace metadata. Latency outliers are compared with the same task group and model.</small>
    </section>

    <section className="review-shell">
      <div className="review-top"><div><p className="eyebrow">Human review</p><h2>{laneLabels[filter]}</h2><small>{laneDescriptions[filter]}</small></div><span>{reviewed}/{reviewItems.length.toLocaleString()} reviewed</span></div>
      {(localError || persistenceError) && <div className="review-error" role="alert">{localError ?? persistenceError}</div>}
      {!current ? <div className="panel review-empty"><h2>No conversations in this lane</h2><p>{filter === "unusual" ? "No covered conversations currently meet the unusual-signal criteria." : filter === "uncovered" ? "Every observed task group currently has human-labeled eval coverage." : "Upload traces to build a stratified review sample."}</p></div> : <>
        <article className="review-card">
          <div className="review-score"><div><small>Automated verdict</small><b>{automatedVerdict}</b>{current.judge && <span>{pct(current.judge.score * 100)} score{current.judge.severity ? ` · ${current.judge.severity} severity` : ""}</span>}</div><span className={`risk ${current.bucket?.risk_level ?? "medium"}`}>{current.bucket?.risk_level ?? "unknown"} risk</span></div>
          <section className="review-why"><small>Why this conversation was chosen</small><b>{laneLabels[current.lane]}</b><p>{current.reviewReason}</p></section>
          <section className="review-facts"><div><small>Actual trace</small><b>{current.trace.id}</b><span>{current.trace.model} · {current.trace.status} · {current.trace.total_tokens.toLocaleString()} tokens · {current.trace.latency_ms ?? 0} ms</span></div><div><small>Source response</small><b>{current.trace.model}</b><span>{money(current.trace.cost_usd ?? 0)} · {current.trace.latency_ms ?? 0} ms · {current.trace.status}</span></div></section>
          <section className={`review-user-feedback ${userFeedback}`}><small>User feedback</small><b>{traceUserFeedbackLabel(userFeedback)}</b><span>{current.trace.metadata?.user_id ? `From ${String(current.trace.metadata.user_id)}` : "No user ID captured"}</span></section>
          <section><small>Prompt</small><p>{preview(current.trace.prompt_text, 900)}</p></section>
          <section><small>Answer provided by agent</small><p>{preview(current.trace.response_text ?? "No response captured", 900)}</p></section>
          {workflowTraces.length > 1 && <details className="review-workflow"><summary>Workflow context · {workflowTraces.length} trace steps</summary><div>{workflowTraces.map((trace) => <p key={trace.id}><b>{trace.id === current.trace.id ? "Current step" : trace.workflow_role ?? "Step"}</b> · {trace.id} · {preview(trace.prompt_text, 120)}</p>)}</div></details>}
          <section><small>Classification / Task Group</small><p>{current.bucket ? current.bucket.bucket_name : "No task group assigned"}</p>{current.bucket && <div className="review-tags">{distinctTaskFieldColumns.map(({ field }) => <span key={field}>{distinctTaskValue(field, current.bucket!.task[field])}</span>)}</div>}</section>
          <section className={`review-judge-result ${current.judge ? current.judge.passed ? "pass" : "fail" : "unscored"}`}><small>Judge rationale</small><p>{current.judge ? <><b>{current.judge.evaluator_type.replaceAll("_", " ")}</b><span>{automatedVerdict} · {pct(current.judge.score * 100)}</span>{current.judge.rationale}</> : "No full rubric result is available for this trace yet."}</p></section>
          {decisionLabel && <div className="review-decision">Saved human review: <b>{decisionLabel}</b>{savedReview?.reviewedAt ? ` · ${new Date(savedReview.reviewedAt).toLocaleString()}` : ""}{savedReview?.goldenRow ? " · included in Human-reviewed conversations" : ""}</div>}

          {correctionOpen ? <form className="review-correction" onSubmit={submitCorrection}>
            <div><p className="eyebrow">Correct the record</p><h3>What should the agent have answered?</h3><p>The original prompt, agent answer, your correction, and this human verdict will be saved as a golden-dataset example.</p></div>
            <label htmlFor="correct-answer">Correct answer <span>required</span></label>
            <textarea id="correct-answer" rows={6} value={correctAnswer} onChange={(event) => setCorrectAnswer(event.target.value)} placeholder="Enter the complete response the agent should have provided." autoFocus />
            <label htmlFor="review-rationale">What was wrong? <span>optional</span></label>
            <textarea id="review-rationale" rows={3} value={reviewRationale} onChange={(event) => setReviewRationale(event.target.value)} placeholder="Describe the factual, policy, tool-use, or completeness issue." />
            <div><button type="button" onClick={() => setCorrectionOpen(false)} disabled={savingReview}>Cancel</button><button type="submit" disabled={savingReview || !correctAnswer.trim()}>{savingReview ? "Saving..." : "Save correction to golden dataset"}</button></div>
          </form> : <div className="review-actions" aria-label="Review choices">{choices.map(([value, label, hint]) => <button type="button" className={`review-choice ${value}`} onClick={() => applyDecision(value)} disabled={savingReview} key={value}><b>{label}</b><span>{hint}</span></button>)}</div>}
        </article>
        <div className="review-nav"><button type="button" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>Previous</button><span>{Math.min(index + 1, reviewItems.length).toLocaleString()} of {reviewItems.length.toLocaleString()}</span><button type="button" onClick={() => setIndex(Math.min(reviewItems.length - 1, index + 1))} disabled={index >= reviewItems.length - 1}>Next</button></div>
      </>}
    </section>
  </div>;
}
