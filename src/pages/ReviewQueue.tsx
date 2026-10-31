import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { buildReviewQueue, type ReviewLane, type ReviewQueueItem, type ReviewTask } from "../core/reviewQueue";
import { reviewChoicesForVerdict } from "../core/reviewAdjudication";
import {
  currentReviewCycleId, reviewLaneHref, type PersistedReview, type PersistedTaskGroupReview,
  type ReviewCycle, type ReviewTaskFilter, type SaveReviewInput, type SaveTaskGroupReviewInput,
  type TaskGroupReviewOutcome,
} from "../core/reviewPersistence";
import type { DistinctTaskBucket, GoldenDataset, Trace, TraceJudgeResult } from "../types";
import type { ReviewDecision, ReviewQueueFilter } from "../types/ui";
import { money, pct, preview } from "../lib/format";
import { distinctTaskFieldColumns, distinctTaskValue } from "../components/DistinctTaskDisplay";
import { traceUserFeedback, traceUserFeedbackLabel } from "../core/traceFeedback";

const laneOrder: ReviewLane[] = ["representative", "unusual", "uncovered"];
const laneLabels: Record<ReviewLane, string> = { representative: "Representative sample", unusual: "Unusual behavior", uncovered: "Coverage gaps" };
const laneDescriptions: Record<ReviewLane, string> = {
  representative: "A balanced sample used to estimate classifier accuracy and response quality without selection bias.",
  unusual: "Known work with negative feedback, safety signals, rare tool paths, errors, latency spikes, or evaluator flags.",
  uncovered: "Requests missing confident classifier coverage, calibrated response-quality coverage, or both.",
};
const taskLabels: Record<ReviewTask, string> = { task_group: "Task Group", response_quality: "Response quality" };
const taskFilterLabels: Record<ReviewTaskFilter, string> = { all: "All conversations", task_group: "Task Group", response_quality: "Response quality", both: "Both decisions" };
const taskOutcomeLabels: Record<TaskGroupReviewOutcome, string> = {
  task_group: "Choose an existing Task Group", unknown: "Unknown", ambiguous: "Ambiguous", needs_new_group: "Needs a new Task Group",
};
type PersistenceState = "loading" | "ready" | "saving" | "unavailable";
const matchesTaskFilter = (item: ReviewQueueItem, filter: ReviewTaskFilter) => filter === "all" || (filter === "both" ? item.requiredTasks.length === 2 : item.requiredTasks.includes(filter));

export function ReviewQueue({
  traces, traceJudgeResults, distinctTaskBuckets, goldenDatasets, filter = "representative", taskFilter = "all", onFilterChange,
  weeklyBudget = 60, persistedReviews = [], persistedTaskGroupReviews = [], currentCycle = null, persistenceState = "loading",
  persistenceError = null, onWeeklyBudgetChange, onSaveCycle, onSaveReview, onSaveTaskGroupReview, onOpenClassifierValidation,
}: {
  traces: Trace[]; traceJudgeResults: TraceJudgeResult[]; distinctTaskBuckets: DistinctTaskBucket[]; goldenDatasets: GoldenDataset[];
  filter: ReviewQueueFilter; taskFilter: ReviewTaskFilter; onFilterChange: (filter: ReviewQueueFilter, task?: ReviewTaskFilter) => void;
  weeklyBudget: number; persistedReviews: PersistedReview[]; persistedTaskGroupReviews: PersistedTaskGroupReview[]; currentCycle: ReviewCycle | null;
  persistenceState: PersistenceState; persistenceError: string | null; onWeeklyBudgetChange: (weeklyBudget: number) => Promise<void>;
  onSaveCycle: (cycle: ReviewCycle) => Promise<void>; onSaveReview: (input: SaveReviewInput) => Promise<PersistedReview>;
  onSaveTaskGroupReview: (input: SaveTaskGroupReviewInput) => Promise<PersistedTaskGroupReview>; onOpenClassifierValidation: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [budgetDraft, setBudgetDraft] = useState(String(weeklyBudget));
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [reviewRationale, setReviewRationale] = useState("");
  const [taskOutcome, setTaskOutcome] = useState<TaskGroupReviewOutcome>("task_group");
  const [taskGroupId, setTaskGroupId] = useState("");
  const [taskGroupRationale, setTaskGroupRationale] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const cycleSaveAttempt = useRef("");
  const baseSelection = useMemo(() => buildReviewQueue(traces, traceJudgeResults, distinctTaskBuckets, goldenDatasets, weeklyBudget), [traces, traceJudgeResults, distinctTaskBuckets, goldenDatasets, weeklyBudget]);
  const cycleId = currentReviewCycleId();
  const proposedCycle = useMemo<ReviewCycle>(() => ({
    id: cycleId, weeklyBudget, createdAt: new Date().toISOString(),
    assignments: baseSelection.reviewItems.map((item) => ({ traceId: item.trace.id, lane: item.lane, reviewReason: item.reviewReason, requiredTasks: item.requiredTasks, coverageGaps: item.coverageGaps })),
  }), [baseSelection.reviewItems, cycleId, weeklyBudget]);
  const baseByTrace = useMemo(() => new Map(baseSelection.reviewItems.map((item) => [item.trace.id, item])), [baseSelection.reviewItems]);
  const fallbackByTrace = useMemo(() => {
    const bucketByTrace = new Map<string, DistinctTaskBucket>();
    distinctTaskBuckets.forEach((bucket) => bucket.traces.forEach((id) => bucketByTrace.set(id, bucket)));
    const judgeByTrace = new Map(traceJudgeResults.map((judge) => [judge.trace_id, judge]));
    return new Map(traces.map((trace): [string, ReviewQueueItem] => [trace.id, {
      trace, bucket: bucketByTrace.get(trace.id), judge: judgeByTrace.get(trace.id), lane: "representative", reviewReason: "Selected for this weekly review cycle.",
      requiredTasks: ["task_group", "response_quality"], coverageGaps: [],
    }]));
  }, [traces, distinctTaskBuckets, traceJudgeResults]);
  const cycleIsCurrent = currentCycle?.id === cycleId && currentCycle.weeklyBudget === weeklyBudget;
  const allReviewItems = useMemo(() => {
    if (!cycleIsCurrent || !currentCycle) return baseSelection.reviewItems;
    return currentCycle.assignments.flatMap((assignment) => {
      const source = baseByTrace.get(assignment.traceId) ?? fallbackByTrace.get(assignment.traceId);
      return source ? [{ ...source, ...assignment }] : [];
    });
  }, [baseByTrace, baseSelection.reviewItems, currentCycle, cycleIsCurrent, fallbackByTrace]);
  const laneCounts = useMemo(() => laneOrder.reduce((counts, lane) => ({ ...counts, [lane]: allReviewItems.filter((item) => item.lane === lane).length }), {} as Record<ReviewLane, number>), [allReviewItems]);
  const taskCounts = useMemo(() => ({
    task_group: allReviewItems.filter((item) => item.requiredTasks.includes("task_group")).length,
    response_quality: allReviewItems.filter((item) => item.requiredTasks.includes("response_quality")).length,
    both: allReviewItems.filter((item) => item.requiredTasks.length === 2).length,
  }), [allReviewItems]);
  const reviewItems = useMemo(() => allReviewItems.filter((item) => item.lane === filter && matchesTaskFilter(item, taskFilter)), [allReviewItems, filter, taskFilter]);
  const responseReviewByTrace = useMemo(() => new Map(persistedReviews.map((review) => [review.traceId, review])), [persistedReviews]);
  const taskReviewByTrace = useMemo(() => new Map(persistedTaskGroupReviews.map((review) => [review.traceId, review])), [persistedTaskGroupReviews]);
  const isComplete = (item: ReviewQueueItem) => item.requiredTasks.every((task) => task === "task_group" ? taskReviewByTrace.has(item.trace.id) : responseReviewByTrace.has(item.trace.id));
  const completedConversations = allReviewItems.filter(isComplete).length;
  const reviewed = reviewItems.filter(isComplete).length;

  useEffect(() => setBudgetDraft(String(weeklyBudget)), [weeklyBudget]);
  useEffect(() => {
    if (persistenceState !== "ready" || !traces.length || cycleIsCurrent) return;
    const attemptKey = `${proposedCycle.id}:${proposedCycle.weeklyBudget}`;
    if (cycleSaveAttempt.current === attemptKey) return;
    cycleSaveAttempt.current = attemptKey;
    void onSaveCycle(proposedCycle).catch(() => { cycleSaveAttempt.current = ""; });
  }, [cycleIsCurrent, onSaveCycle, persistenceState, proposedCycle, traces.length]);
  useEffect(() => { setIndex(0); setCorrectionOpen(false); setLocalError(null); }, [filter, taskFilter, traces]);

  const current = reviewItems[Math.min(index, Math.max(reviewItems.length - 1, 0))];
  const savedResponseReview = current ? responseReviewByTrace.get(current.trace.id) : undefined;
  const savedTaskReview = current ? taskReviewByTrace.get(current.trace.id) : undefined;
  const userFeedback = current ? traceUserFeedback(current.trace) : "none";
  const workflowTraces = current?.trace.workflow_id ? traces.filter((trace) => trace.workflow_id === current.trace.workflow_id).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)) : [];
  const choices = reviewChoicesForVerdict(current?.judge?.passed);
  const automatedVerdict = current?.judge ? current.judge.passed ? "Pass" : "Needs review" : "Not scored";
  const responseDecisionLabel = savedResponseReview ? choices.find(([value]) => value === savedResponseReview.decision)?.[1] ?? savedResponseReview.decision : undefined;
  const taskReviewPending = Boolean(current?.requiredTasks.includes("task_group") && !savedTaskReview);
  const blindTaskPending = Boolean(taskReviewPending && current?.lane === "representative");

  useEffect(() => {
    setCorrectionOpen(false); setCorrectAnswer(savedResponseReview?.correctAnswer ?? ""); setReviewRationale(savedResponseReview?.rationale ?? "");
    setTaskOutcome(savedTaskReview?.outcome ?? "task_group"); setTaskGroupId(savedTaskReview?.taskGroupId ?? ""); setTaskGroupRationale(savedTaskReview?.rationale ?? ""); setLocalError(null);
  }, [current?.trace.id, savedResponseReview, savedTaskReview]);

  const selectLane = (lane: ReviewLane) => (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onFilterChange(lane, taskFilter);
  };
  const advance = () => setIndex((previous) => Math.min(previous + 1, reviewItems.length - 1));
  async function saveResponseDecision(decision: ReviewDecision, answer = "", rationale = "") {
    if (!current || savingReview) return;
    setSavingReview(true); setLocalError(null);
    try { await onSaveReview({ trace: current.trace, judge: current.judge, lane: current.lane, decision, correctAnswer: answer, rationale }); setCorrectionOpen(false); advance(); }
    catch (error) { setLocalError(error instanceof Error ? error.message : "The response-quality review could not be saved."); }
    finally { setSavingReview(false); }
  }
  function applyDecision(decision: ReviewDecision) { if (decision === "incorrect") { setCorrectionOpen(true); setLocalError(null); return; } void saveResponseDecision(decision); }
  function submitCorrection(event: FormEvent) { event.preventDefault(); if (!correctAnswer.trim()) { setLocalError("Provide the corrected answer before adding this conversation to the golden dataset."); return; } void saveResponseDecision("incorrect", correctAnswer.trim(), reviewRationale.trim()); }
  async function submitTaskGroupReview(event: FormEvent) {
    event.preventDefault(); if (!current || savingReview) return;
    if (taskOutcome === "task_group" && !taskGroupId) { setLocalError("Choose the Task Group that best matches this request."); return; }
    setSavingReview(true); setLocalError(null);
    try {
      const chosen = distinctTaskBuckets.find((bucket) => bucket.bucket_id === taskGroupId);
      await onSaveTaskGroupReview({ trace: current.trace, lane: current.lane, outcome: taskOutcome, taskGroupId: taskOutcome === "task_group" ? taskGroupId : undefined, taskGroupName: taskOutcome === "task_group" ? chosen?.bucket_name : undefined, rationale: taskGroupRationale.trim() });
      if (!current.requiredTasks.includes("response_quality") || taskFilter === "task_group") advance();
    } catch (error) { setLocalError(error instanceof Error ? error.message : "The Task Group review could not be saved."); }
    finally { setSavingReview(false); }
  }
  async function saveBudget(event: FormEvent) { event.preventDefault(); setLocalError(null); try { await onWeeklyBudgetChange(Number(budgetDraft)); } catch (error) { setLocalError(error instanceof Error ? error.message : "The review budget could not be saved."); } }
  const unusedSlots = baseSelection.capacity - allReviewItems.length;

  return <div className="review-page">
    <section className="panel review-cycle-summary"><div><p className="eyebrow">This week&apos;s review batch · {cycleId}</p><h2>One conversation queue, two independent human decisions</h2><p>Every conversation is selected once. RouteLab then asks for a Task Group label, a response-quality judgment, or both, and sends each answer to the matching calibration report.</p></div><div className="review-cycle-progress"><b>{completedConversations}/{allReviewItems.length}</b><span>conversations complete</span><i><em style={{ width: `${allReviewItems.length ? completedConversations / allReviewItems.length * 100 : 0}%` }} /></i><button type="button" onClick={onOpenClassifierValidation}>View classifier calibration</button></div></section>
    <section className="review-budget panel"><div><p className="eyebrow">Weekly capacity</p><h2>How many conversations can your team review?</h2><p>This is one conversation budget, not two competing queues. A selected conversation may produce both a classifier label and a response-quality label.</p></div><form onSubmit={saveBudget}><label htmlFor="weekly-review-budget">Conversations per week</label><div><input id="weekly-review-budget" type="number" min="3" max="300" step="1" value={budgetDraft} onChange={(event) => setBudgetDraft(event.target.value)} /><button type="submit" disabled={persistenceState === "saving"}>Save budget</button></div><small>{persistenceState === "loading" ? "Loading saved batch..." : persistenceState === "saving" ? "Saving..." : persistenceState === "ready" ? "Saved for this workspace" : "Cloud persistence is unavailable"}</small></form></section>
    <section className="review-method panel"><div className="review-method-head"><div><p className="eyebrow">Why these conversations were selected</p><h2>{allReviewItems.length.toLocaleString()} frozen for this week</h2></div><span>{weeklyBudget.toLocaleString()} conversation capacity</span></div><nav className="review-tabs" aria-label="Review selection reasons">{laneOrder.map((lane) => <a href={reviewLaneHref(lane, taskFilter)} className={filter === lane ? "active" : ""} aria-current={filter === lane ? "page" : undefined} onClick={selectLane(lane)} key={lane}><span>{laneLabels[lane]}</span><b>{laneCounts[lane].toLocaleString()} <small>/ {baseSelection.laneTargets[lane].toLocaleString()} target</small></b><p>{laneDescriptions[lane]}</p></a>)}</nav><div className="review-task-filter"><div><small>What decision needs review?</small><p>Selection reason and review task are separate.</p></div><nav aria-label="Review task filters">{(["all", "task_group", "response_quality", "both"] as ReviewTaskFilter[]).map((task) => <button type="button" className={taskFilter === task ? "active" : ""} onClick={() => onFilterChange(filter, task)} key={task}>{taskFilterLabels[task]} <b>{task === "all" ? allReviewItems.length : taskCounts[task]}</b></button>)}</nav></div>{unusedSlots > 0 && <small className="review-shortfall">{unusedSlots.toLocaleString()} {unusedSlots === 1 ? "slot is" : "slots are"} unused because there are not enough eligible conversations to fill every lane without inventing findings.</small>}<small className="review-method-note">Only the representative lane estimates overall accuracy and quality. Unusual and coverage-gap reviews measure issue yield and expand calibration coverage.</small></section>
    <section className="review-shell"><div className="review-top"><div><p className="eyebrow">Human review</p><h2>{laneLabels[filter]}</h2><small>{laneDescriptions[filter]}</small></div><span>{reviewed}/{reviewItems.length.toLocaleString()} complete</span></div>{(localError || persistenceError) && <div className="review-error" role="alert">{localError ?? persistenceError}</div>}{!current ? <div className="panel review-empty"><h2>No conversations match these filters</h2><p>Try another selection reason or review task. RouteLab will not duplicate conversations merely to fill a target.</p></div> : <><article className="review-card">
      <header className="review-assignment-header"><div><small>Selected because</small><b>{laneLabels[current.lane]}</b><p>{blindTaskPending ? "Selected through a balanced random sample across Task Groups, risk levels, and models." : current.reviewReason}</p></div><div><small>Decisions required</small><div>{current.requiredTasks.map((task) => <span className={(task === "task_group" ? savedTaskReview : savedResponseReview) ? "complete" : "pending"} key={task}>{taskLabels[task]}</span>)}</div></div></header>
      {!taskReviewPending && <><div className="review-score"><div><small>Automated response verdict</small><b>{automatedVerdict}</b>{current.judge && <span>{pct(current.judge.score * 100)} score{current.judge.severity ? ` · ${current.judge.severity} severity` : ""}</span>}</div><span className={`risk ${current.bucket?.risk_level ?? "medium"}`}>{current.bucket?.risk_level ?? "unknown"} risk</span></div>
      <section className="review-facts"><div><small>Actual trace</small><b>{current.trace.id}</b><span>{current.trace.model} · {current.trace.status} · {current.trace.total_tokens.toLocaleString()} tokens · {current.trace.latency_ms ?? 0} ms</span></div><div><small>Source response</small><b>{current.trace.model}</b><span>{money(current.trace.cost_usd ?? 0)} · {current.trace.latency_ms ?? 0} ms · {current.trace.status}</span></div></section>
      <section className={`review-user-feedback ${userFeedback}`}><small>User feedback</small><b>{traceUserFeedbackLabel(userFeedback)}</b><span>{current.trace.metadata?.user_id ? `From ${String(current.trace.metadata.user_id)}` : "No user ID captured"}</span></section></>}
      <section><small>Request-time evidence</small><p>{preview(current.trace.prompt_text, 900)}</p></section>
      {current.requiredTasks.includes("task_group") && <section className="review-task-group-step"><div className="review-step-heading"><span>1</span><div><small>Task Group assignment</small><h3>What outcome is this request trying to achieve?</h3><p>{current.lane === "representative" ? "Jev's answer stays hidden until you submit an independent human label." : "Confirm the current assignment or replace it using request-time evidence only."}</p></div></div>{savedTaskReview ? <div className="review-task-saved"><b>Human label: {savedTaskReview.outcome === "task_group" ? savedTaskReview.taskGroupName : taskOutcomeLabels[savedTaskReview.outcome]}</b><span>Saved {new Date(savedTaskReview.reviewedAt).toLocaleString()}</span>{current.trace.signature_decision && <p>Jev: {current.trace.signature_decision.signature_label} · {pct(current.trace.signature_decision.confidence * 100)} confidence · {current.trace.signature_decision.status.replaceAll("_", " ")}</p>}</div> : <form className="review-task-form" onSubmit={submitTaskGroupReview}><fieldset><legend>Human decision</legend>{(Object.keys(taskOutcomeLabels) as TaskGroupReviewOutcome[]).map((outcome) => <label className={taskOutcome === outcome ? "selected" : ""} key={outcome}><input type="radio" name="task-outcome" checked={taskOutcome === outcome} onChange={() => setTaskOutcome(outcome)} />{taskOutcomeLabels[outcome]}</label>)}</fieldset>{taskOutcome === "task_group" && <label>Task Group<select value={taskGroupId} onChange={(event) => setTaskGroupId(event.target.value)}><option value="">Choose the best match</option>{distinctTaskBuckets.map((bucket) => <option value={bucket.bucket_id} key={bucket.bucket_id}>{bucket.bucket_name}</option>)}</select></label>}<label>Reviewer note <span>(optional)</span><textarea rows={2} value={taskGroupRationale} onChange={(event) => setTaskGroupRationale(event.target.value)} placeholder="Why does this group fit, or what boundary is missing?" /></label><button type="submit" className="primary" disabled={savingReview}>{savingReview ? "Saving..." : "Save Task Group label"}</button></form>}</section>}
      {taskReviewPending ? <section className="review-evidence-lock"><small>Response-quality evidence locked</small><p>Save the Task Group label using request-time evidence first. The agent answer, trajectory, current assignment, and automated verdict will then be revealed for the separate quality decision.</p></section> : <><section><small>Answer provided by agent</small><p>{preview(current.trace.response_text ?? "No response captured", 900)}</p></section>{workflowTraces.length > 1 && <details className="review-workflow"><summary>Workflow context · {workflowTraces.length} trace steps</summary><div>{workflowTraces.map((trace) => <p key={trace.id}><b>{trace.id === current.trace.id ? "Current step" : trace.workflow_role ?? "Step"}</b> · {trace.id} · {preview(trace.prompt_text, 120)}</p>)}</div></details>}<section><small>Current classification / Task Group</small><p>{current.bucket ? current.bucket.bucket_name : "No Task Group assigned"}</p>{current.bucket && <div className="review-tags">{distinctTaskFieldColumns.map(({ field }) => <span key={field}>{distinctTaskValue(field, current.bucket!.task[field])}</span>)}</div>}</section><section className={`review-judge-result ${current.judge ? current.judge.passed ? "pass" : "fail" : "unscored"}`}><small>Judge rationale</small><p>{current.judge ? <><b>{current.judge.evaluator_type.replaceAll("_", " ")}</b><span>{automatedVerdict} · {pct(current.judge.score * 100)}</span>{current.judge.rationale}</> : "No full rubric result is available for this trace yet."}</p></section>
        {current.requiredTasks.includes("response_quality") && <section className="review-response-step"><div className="review-step-heading"><span>{current.requiredTasks.includes("task_group") ? "2" : "1"}</span><div><small>Response quality</small><h3>Was the agent response correct?</h3><p>Review the same trajectory evidence used by the automated evaluator.</p></div></div>{responseDecisionLabel && <div className="review-decision">Saved human review: <b>{responseDecisionLabel}</b>{savedResponseReview?.reviewedAt ? ` · ${new Date(savedResponseReview.reviewedAt).toLocaleString()}` : ""}{savedResponseReview?.goldenRow ? " · included in Human-reviewed conversations" : ""}</div>}{correctionOpen ? <form className="review-correction" onSubmit={submitCorrection}><div><p className="eyebrow">Correct the record</p><h3>What should the agent have answered?</h3><p>The request, trajectory evidence, agent answer, correction, and human verdict will be saved as a golden-dataset example.</p></div><label htmlFor="correct-answer">Correct answer <span>required</span></label><textarea id="correct-answer" rows={6} value={correctAnswer} onChange={(event) => setCorrectAnswer(event.target.value)} placeholder="Enter the complete response the agent should have provided." autoFocus /><label htmlFor="review-rationale">What was wrong? <span>optional</span></label><textarea id="review-rationale" rows={3} value={reviewRationale} onChange={(event) => setReviewRationale(event.target.value)} placeholder="Describe the factual, policy, tool-use, or completeness issue." /><div><button type="button" onClick={() => setCorrectionOpen(false)} disabled={savingReview}>Cancel</button><button type="submit" disabled={savingReview || !correctAnswer.trim()}>{savingReview ? "Saving..." : "Save correction to golden dataset"}</button></div></form> : <div className="review-actions" aria-label="Response quality choices">{choices.map(([value, label, hint]) => <button type="button" className={`review-choice ${value}`} onClick={() => applyDecision(value)} disabled={savingReview} key={value}><b>{label}</b><span>{hint}</span></button>)}</div>}</section>}
      </>}
    </article><div className="review-nav"><button type="button" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>Previous</button><span>{Math.min(index + 1, reviewItems.length).toLocaleString()} of {reviewItems.length.toLocaleString()}</span><button type="button" onClick={() => setIndex(Math.min(reviewItems.length - 1, index + 1))} disabled={index >= reviewItems.length - 1}>Next</button></div></>}</section>
  </div>;
}
