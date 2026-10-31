import { useEffect, useId, useMemo, useState, type FocusEvent, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { buildClassifierValidationReport, classifierValidationReadiness, createDemoClassifierValidationExamples } from "../core/classifierValidation";
import {
  appendAssignmentValidationSample,
  classifierExamplesFromAssignments,
  decisionAssignments,
  emptyAssignmentValidationWorkflow,
  taskGroupSignatures,
  type AssignmentValidationLabel,
  type AssignmentValidationWorkflow,
  type HumanAssignmentOutcome,
} from "../core/assignmentValidation";
import {
  fetchAssignmentValidation,
  loadLocalAssignmentValidation,
  persistAssignmentValidation,
  runStrongClassifierComparator,
  saveLocalAssignmentValidation,
} from "../core/assignmentValidationPersistence";
import { classifyTraceSignaturesWithJev, JEV_RISK_THRESHOLDS } from "../core/jevSignatureGate";
import type { DistinctTaskBucket, KnownTaskSignature, Trace } from "../types";
import { pct } from "../lib/format";

const shortLabel = (value: string) => value === "unknown" || value === "abstain"
  ? value
  : value.split("_").slice(0, 2).join(" ");

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function HoverExplanation({ children, explanation, className = "" }: {
  children: ReactNode;
  explanation: string;
  className?: string;
}) {
  const tooltipId = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const show = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    setPosition({
      left: Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12),
      top: Math.min(rect.bottom + 10, window.innerHeight - 190),
    });
  };
  return <span
    className={`classifier-explainable ${className}`.trim()}
    tabIndex={0}
    aria-describedby={position ? tooltipId : undefined}
    onMouseEnter={show}
    onMouseLeave={() => setPosition(null)}
    onFocus={show}
    onBlur={() => setPosition(null)}
    onClick={show}
    onKeyDown={(event) => { if (event.key === "Escape") setPosition(null); }}
  >
    {children}
    {position && createPortal(<span id={tooltipId} role="tooltip" className="classifier-explanation-tooltip" style={position}>{explanation}</span>, document.body)}
  </span>;
}

function matrixExplanation({ actualLabel, predictedLabel, count, reviewedCount, isCorrect }: {
  actualLabel: string;
  predictedLabel: string;
  count: number;
  reviewedCount: number;
  isCorrect: boolean;
}) {
  if (predictedLabel === "abstain") {
    return count === 0
      ? `None of the ${countLabel(reviewedCount, "example")} reviewed as “${actualLabel}” fell below Jev's confidence threshold.`
      : `Reviewers labeled ${countLabel(reviewedCount, "example")} as “${actualLabel}.” ${countLabel(count, "example")} did not clear Jev's confidence threshold, so RouteLab sent ${count === 1 ? "it" : "them"} to the default or review path.`;
  }
  if (count === 0) {
    return `No examples reviewed as “${actualLabel}” were classified by Jev as “${predictedLabel}” after the confidence gate.`;
  }
  if (isCorrect) {
    return `Reviewers labeled ${countLabel(reviewedCount, "example")} as “${actualLabel}.” Jev also classified ${countLabel(count, "example")} as “${predictedLabel},” so ${count === 1 ? "this is" : "these are"} correct accepted ${count === 1 ? "match" : "matches"}.`;
  }
  return `Reviewers labeled ${countLabel(count, "example")} as “${actualLabel},” but Jev classified ${count === 1 ? "it" : "them"} as “${predictedLabel}” after the confidence gate. ${count === 1 ? "This is an accepted misclassification" : "These are accepted misclassifications"}.`;
}

const outcomeLabels: Record<HumanAssignmentOutcome, string> = {
  task_group: "Known Task Group",
  unknown: "Unknown",
  ambiguous: "Ambiguous",
  needs_new_group: "Needs new group",
};

function PersonalClassifierValidation({ workspaceId, traces, taskGroups, onOpenResponseReview }: {
  workspaceId: string;
  traces: Trace[];
  taskGroups: DistinctTaskBucket[];
  onOpenResponseReview: () => void;
}) {
  const signatures = useMemo(() => taskGroupSignatures(taskGroups), [taskGroups]);
  const traceById = useMemo(() => new Map(traces.map((trace) => [trace.id, trace])), [traces]);
  const [workflow, setWorkflow] = useState<AssignmentValidationWorkflow | null>(() => loadLocalAssignmentValidation(workspaceId));
  const [sampleSize, setSampleSize] = useState("50");
  const [outcome, setOutcome] = useState<HumanAssignmentOutcome>("task_group");
  const [selectedSignature, setSelectedSignature] = useState("");
  const [rationale, setRationale] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "saving" | "running" | "unavailable">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setWorkflow(loadLocalAssignmentValidation(workspaceId));
    setState("loading");
    fetchAssignmentValidation(workspaceId, controller.signal).then((saved) => {
      if (saved) {
        saveLocalAssignmentValidation(workspaceId, saved);
        setWorkflow(saved);
      }
      setState("ready");
    }).catch(() => setState(loadLocalAssignmentValidation(workspaceId) ? "unavailable" : "ready"));
    return () => controller.abort();
  }, [workspaceId]);

  const sampledTraces = useMemo(() => (workflow?.sampleTraceIds ?? []).map((id) => traceById.get(id)).filter((trace): trace is Trace => Boolean(trace)), [workflow?.sampleTraceIds, traceById]);
  const labelByTrace = useMemo(() => new Map((workflow?.labels ?? []).map((label) => [label.traceId, label])), [workflow?.labels]);
  const currentTrace = sampledTraces.find((trace) => !labelByTrace.has(trace.id));
  const labelingComplete = Boolean(workflow?.sampleTraceIds.length) && (workflow?.labels.length ?? 0) >= (workflow?.sampleTraceIds.length ?? 0);
  const thresholdBySignature = useMemo(() => Object.fromEntries(signatures.map((signature) => [signature.id, JEV_RISK_THRESHOLDS[signature.risk_level]])), [signatures]);
  const jevExamples = workflow ? classifierExamplesFromAssignments(workflow, traces, workflow.jevAssignments, thresholdBySignature) : [];
  const llmExamples = workflow ? classifierExamplesFromAssignments(workflow, traces, workflow.llmAssignments) : [];
  const reportMetadata = { datasetLabel: "Workspace held-out assignment set", signatureCatalogVersion: `workspace-${taskGroups.length}`, testSplit: "Blind human-reviewed set", thresholdTuningSplit: "Keep threshold tuning separate from this report" };
  const jevReport = jevExamples.length ? buildClassifierValidationReport(jevExamples, signatures, { ...reportMetadata, classifierModel: workflow?.jevAssignments[0]?.model ?? "typesafe/jev" }) : null;
  const llmReport = llmExamples.length ? buildClassifierValidationReport(llmExamples, signatures, { ...reportMetadata, classifierModel: workflow?.llmAssignments[0]?.model ?? "strong LLM" }) : null;
  const labelNames = useMemo(() => new Map(signatures.map((signature) => [signature.id, signature.label])), [signatures]);
  const meaningfulJevLabels = jevReport?.labels.filter((label) => label === "abstain" || label === "unknown" || jevExamples.some((example) => example.reviewedSignatureId === label || example.predictedSignatureId === label)) ?? [];

  async function save(next: AssignmentValidationWorkflow) {
    saveLocalAssignmentValidation(workspaceId, next);
    setWorkflow(next);
    setState("saving");
    try {
      const saved = await persistAssignmentValidation(workspaceId, next);
      saveLocalAssignmentValidation(workspaceId, saved);
      setWorkflow(saved);
      setState("ready");
    } catch (saveError) {
      setState("unavailable");
      setError(saveError instanceof Error ? `${saveError.message} Saved in this browser.` : "Saved in this browser; cloud storage is unavailable.");
    }
  }

  function createSet() {
    setError(null);
    if (!traces.length || !taskGroups.length) {
      setError("Import traces and create Task Groups before starting assignment validation.");
      return;
    }
    void save(emptyAssignmentValidationWorkflow(traces, taskGroups, Number(sampleSize) || 50));
  }

  function submitLabel(event: FormEvent) {
    event.preventDefault();
    if (!workflow || !currentTrace) return;
    if (outcome === "task_group" && !selectedSignature) {
      setError("Choose the Task Group that best matches this request.");
      return;
    }
    const label: AssignmentValidationLabel = {
      traceId: currentTrace.id,
      outcome,
      signatureId: outcome === "task_group" ? selectedSignature : null,
      rationale: rationale.trim() || null,
      reviewedAt: new Date().toISOString(),
    };
    const next = { ...workflow, labels: [...workflow.labels.filter((item) => item.traceId !== label.traceId), label], updatedAt: label.reviewedAt };
    setSelectedSignature("");
    setOutcome("task_group");
    setRationale("");
    setError(null);
    void save(next);
  }

  async function runJev() {
    if (!workflow || !labelingComplete) return;
    setState("running");
    setError(null);
    try {
      const result = await classifyTraceSignaturesWithJev(sampledTraces, signatures);
      await save({ ...workflow, jevAssignments: decisionAssignments(result.decisions), updatedAt: new Date().toISOString() });
    } catch (runError) {
      setState("ready");
      setError(runError instanceof Error ? runError.message : "Jev comparison failed.");
    }
  }

  async function runComparator() {
    if (!workflow || !labelingComplete) return;
    setState("running");
    setError(null);
    try {
      const result = await runStrongClassifierComparator(workspaceId, sampledTraces, signatures);
      await save({ ...workflow, llmAssignments: result.assignments, updatedAt: new Date().toISOString() });
    } catch (runError) {
      setState("ready");
      setError(runError instanceof Error ? runError.message : "Strong-model comparison failed.");
    }
  }

  function addRecentTraces() {
    if (!workflow) return;
    const next = appendAssignmentValidationSample(workflow, traces, taskGroups, 15);
    if (next.sampleTraceIds.length === workflow.sampleTraceIds.length) setError("No new traces are available for the ongoing validation set.");
    else void save(next);
  }

  const readiness = classifierValidationReadiness({ reviewedLabelCount: workflow?.labels.length ?? 0, jevComparisonCount: workflow?.jevAssignments.length ?? 0 });
  return <div className="classifier-validation-page">
    <section className="panel classifier-evidence-map">
      <div><p className="eyebrow">Two evidence loops</p><h2>Humans establish truth; automated systems are measured against it</h2><p>Task assignment and response quality are different decisions. RouteLab keeps their labels, calibration reports, and ongoing metrics separate.</p></div>
      <div className="classifier-evidence-grid"><b>Decision</b><b>Human truth</b><b>Calibration</b><b>Ongoing monitoring</b><span>Request → Task Group</span><span>Blind assignment labels</span><span>Human vs Jev vs strong LLM</span><span>New and drifting requests</span><span>Request + response → quality</span><span>Correctness and corrected answer</span><span>Judge vs human agreement</span><button type="button" onClick={onOpenResponseReview}>Open response review</button></div>
    </section>

    {!workflow ? <section className="panel classifier-validation-empty-card">
      <p className="eyebrow">Task Group assignment validation</p><h2>Create an independently reviewed validation set</h2>
      <p>RouteLab selects a balanced held-out set across your Task Groups. Reviewers see only the request and pre-inference context; Jev and comparator predictions stay hidden until the human label is saved.</p>
      <div className="classifier-validation-readiness">{readiness.prerequisites.map((item, index) => <article className={item.complete ? "complete" : "pending"} key={item.id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{item.label}</b><small>{item.detail}</small></div></article>)}</div>
      <div className="classifier-create-set"><label>Initial review budget<input type="number" min="10" max={Math.max(10, traces.length)} value={sampleSize} onChange={(event) => setSampleSize(event.target.value)} /></label><button type="button" className="primary" onClick={createSet}>Create validation set</button></div>
      {error && <div className="review-error">{error}</div>}
    </section> : <>
      <section className="panel classifier-workflow-status"><div><p className="eyebrow">Assignment validation</p><h2>{workflow.labels.length} of {workflow.sampleTraceIds.length} independently reviewed</h2><p>Predictions remain hidden until each human decision is recorded.</p></div><div className="classifier-progress"><i style={{ width: `${workflow.sampleTraceIds.length ? workflow.labels.length / workflow.sampleTraceIds.length * 100 : 0}%` }} /><span>{state === "saving" ? "Saving…" : state === "running" ? "Running comparison…" : state === "unavailable" ? "Saved locally" : "Saved"}</span></div></section>
      {error && <div className="review-error">{error}</div>}
      {currentTrace ? <section className="panel assignment-labeler">
        <div className="panelhead"><div><p className="eyebrow">Blind human label</p><h2>What outcome is this request trying to achieve?</h2></div><span>{workflow.labels.length + 1} of {workflow.sampleTraceIds.length}</span></div>
        <article><small>Request</small><p>{currentTrace.prompt_text}</p>{currentTrace.messages.filter((message) => message.role !== "assistant").length > 1 && <details><summary>Prior conversation and system context</summary>{currentTrace.messages.filter((message) => message.role !== "assistant").map((message, index) => <p key={`${message.role}-${index}`}><b>{message.role}</b> {message.content}</p>)}</details>}</article>
        <form onSubmit={submitLabel}>
          <fieldset><legend>Human decision</legend>{(Object.keys(outcomeLabels) as HumanAssignmentOutcome[]).map((value) => <label className={outcome === value ? "selected" : ""} key={value}><input type="radio" name="assignment-outcome" value={value} checked={outcome === value} onChange={() => setOutcome(value)} />{outcomeLabels[value]}</label>)}</fieldset>
          {outcome === "task_group" && <label>Task Group<select value={selectedSignature} onChange={(event) => setSelectedSignature(event.target.value)}><option value="">Choose the best match</option>{signatures.map((signature) => <option value={signature.id} key={signature.id}>{signature.label}</option>)}</select></label>}
          <label>Reviewer note <span>(optional)</span><textarea rows={3} value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder={outcome === "needs_new_group" ? "Describe the missing group boundary." : "Record why this label fits or what made it ambiguous."} /></label>
          <button type="submit" className="primary" disabled={state === "saving"}>Save label and continue</button>
        </form>
      </section> : <section className="panel classifier-comparison-controls">
        <div><p className="eyebrow">Human baseline complete</p><h2>Now compare automated assignment against the same held-out labels</h2><p>Jev and the strong comparator receive the same request-only evidence and the same Task Group catalog. Human labels remain the source of truth.</p></div>
        <div><button type="button" className="primary" onClick={runJev} disabled={state === "running"}>{workflow.jevAssignments.length ? "Rerun Jev" : "Run Jev comparison"}</button><button type="button" onClick={runComparator} disabled={state === "running"}>{workflow.llmAssignments.length ? "Rerun strong LLM" : "Run strong LLM comparison"}</button></div>
      </section>}
      {(jevReport || llmReport) && <section className="classifier-comparator-grid">
        {[{ name: "Jev", report: jevReport, examples: jevExamples }, { name: "Strong LLM", report: llmReport, examples: llmExamples }].map(({ name, report, examples }) => <article className="panel" key={name}><small>{name}</small>{report ? <><b>{pct(report.acceptedPrecision * 100)}</b><span>precision among accepted assignments</span><dl><div><dt>Exact agreement</dt><dd>{examples.filter((item) => item.reviewedSignatureId === item.predictedSignatureId).length}/{examples.length}</dd></div><div><dt>Coverage</dt><dd>{pct(report.coverage * 100)}</dd></div><div><dt>Wrong accepted</dt><dd>{report.errors.filter((item) => item.accepted).length}</dd></div></dl></> : <p>Not run yet</p>}</article>)}
      </section>}
      {jevReport && <section className="panel classifier-signature-table"><div className="panelhead"><div><p className="eyebrow">Human vs Jev</p><h2>Performance by Task Group</h2></div><span>{jevExamples.length} reviewed examples</span></div><p className="classifier-interaction-hint">Hover, tap, or focus a metric to see exactly how the reviewed examples produced it.</p><div className="tablewrap"><table><thead><tr><th>Task Group</th><th><HoverExplanation explanation="Of the requests Jev confidently assigned to this Task Group, precision is the share that human reviewers assigned to the same group.">Accepted precision</HoverExplanation></th><th><HoverExplanation explanation="Of the requests humans assigned to this Task Group, recall is the share Jev correctly found and confidently accepted.">Recall</HoverExplanation></th><th><HoverExplanation explanation="The number of independently reviewed requests whose human label was this Task Group.">Human-reviewed examples</HoverExplanation></th></tr></thead><tbody>{jevReport.perSignature.filter((row) => row.support || row.acceptedPredictionCount).map((row) => {
        const precisionExplanation = row.acceptedPredictionCount
          ? `Jev confidently assigned ${countLabel(row.acceptedPredictionCount, "request")} to “${row.label}.” Humans agreed on ${row.correctAcceptedCount}. Precision = ${row.correctAcceptedCount} ÷ ${row.acceptedPredictionCount} = ${pct(row.precision * 100)}.`
          : `Jev did not confidently assign any reviewed request to “${row.label},” so accepted precision is not yet measurable.`;
        const recallExplanation = row.support
          ? `Humans assigned ${countLabel(row.support, "request")} to “${row.label}.” Jev correctly found and accepted ${row.correctAcceptedCount}. Recall = ${row.correctAcceptedCount} ÷ ${row.support} = ${pct(row.recall * 100)}.`
          : `Humans did not assign any held-out request to “${row.label},” so recall is not yet measurable.`;
        return <tr key={row.signatureId}><td><b>{row.label}</b></td><td><HoverExplanation className="classifier-metric-explainer" explanation={precisionExplanation}>{pct(row.precision * 100)}</HoverExplanation></td><td><HoverExplanation className="classifier-metric-explainer" explanation={recallExplanation}>{pct(row.recall * 100)}</HoverExplanation></td><td><HoverExplanation className="classifier-metric-explainer" explanation={`${countLabel(row.support, "held-out request")} ${row.support === 1 ? "was" : "were"} independently reviewed as “${row.label}.”`}>{row.support}</HoverExplanation></td></tr>;
      })}</tbody></table></div></section>}
      {jevReport && <details className="panel classifier-advanced">
        <summary><span><small>Assignment errors</small><b>See the human vs Jev confusion matrix</b></span><i aria-hidden="true">+</i></summary>
        <div className="classifier-advanced-body"><section className="classifier-confusion"><div className="panelhead"><div><p className="eyebrow">Error structure</p><h2>Which Task Groups does Jev confuse?</h2></div><span>Rows = human label · columns = Jev decision</span></div><p className="classifier-interaction-hint">The diagonal shows agreement. A value outside the diagonal is a specific mismatch to investigate. An abstention means Jev kept the request on the default or review path.</p><div className="tablewrap"><table><thead><tr><th>Human-reviewed Task Group</th>{meaningfulJevLabels.map((label) => <th title={labelNames.get(label) ?? label} key={label}>{shortLabel(label)}</th>)}</tr></thead><tbody>{meaningfulJevLabels.filter((label) => label !== "abstain").map((actual) => {
          const actualLabel = labelNames.get(actual) ?? actual;
          const reviewedCount = Object.values(jevReport.confusion[actual] ?? {}).reduce((sum, value) => sum + value, 0);
          return <tr key={actual}><th title={actualLabel}>{actualLabel}</th>{meaningfulJevLabels.map((predicted) => {
            const count = jevReport.confusion[actual]?.[predicted] ?? 0;
            const predictedLabel = labelNames.get(predicted) ?? predicted;
            return <td className={actual === predicted ? "correct" : count ? "error" : ""} key={predicted}><HoverExplanation className="classifier-cell-explainer" explanation={matrixExplanation({ actualLabel, predictedLabel, count, reviewedCount, isCorrect: actual === predicted })}>{count}</HoverExplanation></td>;
          })}</tr>;
        })}</tbody></table></div></section></div>
      </details>}
      {labelingComplete && <section className="panel classifier-next-step"><div><p className="eyebrow">Ongoing validation</p><h2>Keep the assignment set current as traffic changes</h2><p>Add a small held-out batch from new traffic. RouteLab preserves the original baseline and recomputes drift and per-group performance after review.</p></div><button type="button" onClick={addRecentTraces}>Add 15 recent traces</button></section>}
    </>}
  </div>;
}

function DemoClassifierValidation({ signatures, onOpenCalibration }: { signatures: KnownTaskSignature[]; onOpenCalibration: () => void }) {
  const examples = useMemo(() => createDemoClassifierValidationExamples(signatures), [signatures]);
  const report = useMemo(() => buildClassifierValidationReport(examples, signatures, {
    datasetLabel: "Bundled demo held-out set",
    classifierModel: "typesafe/jev-1.14",
    signatureCatalogVersion: "seed-catalog-v1",
    testSplit: "Demo held-out test split; replace with independently reviewed labels",
    thresholdTuningSplit: "Separate calibration split; no test examples used for tuning",
  }), [examples, signatures]);
  const labelNames = new Map(signatures.map((signature) => [signature.id, signature.label]));
  const meaningfulLabels = report.labels.filter((label) => label === "abstain" || label === "unknown" || examples.some((example) => example.reviewedSignatureId === label || example.predictedSignatureId === label));
  const accepted = examples.filter((example) => example.accepted);
  const correctAcceptedCount = accepted.filter((example) => example.predictedSignatureId === example.reviewedSignatureId).length;
  const acceptedErrorCount = accepted.length - correctAcceptedCount;
  const abstainedCount = examples.length - accepted.length;
  const unknownExamples = examples.filter((example) => example.reviewedSignatureId === "unknown");
  const unknownFalseAcceptCount = unknownExamples.filter((example) => example.accepted && example.predictedSignatureId !== "unknown").length;
  const prioritizedErrors = [...report.errors].sort((left, right) => Number(right.accepted) - Number(left.accepted));
  const taskGroupPerformance = [...report.perSignature].sort((left, right) =>
    left.recall - right.recall
    || left.precision - right.precision
    || left.support - right.support
    || left.label.localeCompare(right.label),
  );
  return <div className="classifier-validation-page">
    <section className="panel classifier-decision-summary">
      <div className="classifier-decision-copy">
        <p className="eyebrow">Decision summary</p>
        <h2>Can Jev reliably assign requests to the right Task Group?</h2>
        <p className="classifier-verdict"><span>Not production-ready yet</span> This demo still contains accepted routing mistakes and is not based on your independently reviewed labels.</p>
        <p>Jev made {correctAcceptedCount} correct confident matches, accepted {acceptedErrorCount} wrong assignments, and sent {abstainedCount} examples to the default or review path. {unknownFalseAcceptCount} of {unknownExamples.length} unfamiliar requests was incorrectly assigned to a known Task Group.</p>
      </div>
      <span className="classifier-demo-badge">Demo dataset</span>
    </section>
    <section className="classifier-validation-metrics" aria-label="Classifier validation results">
      <article className="panel correct"><small>Correct confident matches</small><b>{correctAcceptedCount}</b><span>{pct(report.acceptedPrecision*100)} precision among accepted routes</span></article>
      <article className="panel error"><small>Wrong routes accepted</small><b>{acceptedErrorCount}</b><span>Requests that would have reached the wrong Task Group</span></article>
      <article className="panel fallback"><small>Sent to default or review</small><b>{abstainedCount}</b><span>{pct(report.abstention*100)} of the reviewed sample</span></article>
      <article className="panel unknown"><small>Unfamiliar work accepted</small><b>{unknownFalseAcceptCount} of {unknownExamples.length}</b><span>{pct(report.unknownFalseAcceptance*100)} unknown false acceptance</span></article>
    </section>
    <section className="panel classifier-error-examples">
      <div className="panelhead"><div><p className="eyebrow">Where Jev needs work</p><h2>Review mistakes before trusting the route</h2></div><span>{report.errors.length} examples need attention</span></div>
      <p className="classifier-section-intro">Accepted mistakes are the highest priority because they would send a request down the wrong Task Group route. Abstentions are safer: they stay on the default or review path.</p>
      {prioritizedErrors.length?<div>{prioritizedErrors.map((example)=>{
        const reviewedLabel = labelNames.get(example.reviewedSignatureId) ?? example.reviewedSignatureId;
        const predictedLabel = labelNames.get(example.predictedSignatureId) ?? example.predictedSignatureId;
        return <article className={example.accepted ? "accepted-error" : "abstained"} key={example.id}>
          <div><b>{example.accepted ? "Wrong route accepted" : "Sent to fallback"}</b><span>{pct(example.confidence*100)} confidence</span></div>
          <p>{example.promptPreview}</p>
          <dl><div><dt>Human reviewed</dt><dd>{reviewedLabel}</dd></div><div><dt>Jev decision</dt><dd>{example.accepted ? predictedLabel : "No Task Group accepted"}</dd></div></dl>
        </article>;
      })}</div>:<p>No errors in this test set.</p>}
    </section>
    <section className="panel classifier-signature-table">
      <div className="panelhead"><div><p className="eyebrow">Task Group performance</p><h2>Where classification is reliable or weak</h2></div><span>Weakest recall shown first</span></div>
      <p className="classifier-interaction-hint">Hover, tap, or focus a metric to see the reviewed examples behind it. Add more reviewed examples where support is low.</p>
      <div className="tablewrap"><table><thead><tr><th>Task Group</th><th><HoverExplanation explanation="Precision asks: of everything Jev confidently classified as this Task Group, how many did human reviewers agree truly belonged here?">Accepted precision</HoverExplanation></th><th><HoverExplanation explanation="Recall asks: of everything human reviewers labeled as this Task Group, how many did Jev correctly find and confidently accept?">Recall</HoverExplanation></th><th><HoverExplanation explanation="Reviewed examples is the number of independently human-labeled examples available for this Task Group in the held-out test set.">Reviewed examples</HoverExplanation></th></tr></thead><tbody>{taskGroupPerformance.map((row)=>{
        const precisionExplanation = row.acceptedPredictionCount
          ? `Jev confidently predicted “${row.label}” ${row.acceptedPredictionCount} times. Reviewers agreed ${row.correctAcceptedCount} times. Precision = ${row.correctAcceptedCount} ÷ ${row.acceptedPredictionCount} = ${pct(row.precision*100)}.`
          : `Jev did not confidently predict “${row.label}” for any reviewed example, so there are no accepted predictions from which to measure precision.`;
        const recallExplanation = row.support
          ? `Reviewers labeled ${countLabel(row.support, "example")} as “${row.label}.” Jev correctly found and accepted ${row.correctAcceptedCount}. Recall = ${row.correctAcceptedCount} ÷ ${row.support} = ${pct(row.recall*100)}.`
          : `No held-out examples were reviewed as “${row.label},” so recall cannot yet be measured.`;
        return <tr key={row.signatureId}><td><b>{row.label}</b></td><td><HoverExplanation className="classifier-metric-explainer" explanation={precisionExplanation}>{pct(row.precision*100)}</HoverExplanation></td><td><HoverExplanation className="classifier-metric-explainer" explanation={recallExplanation}>{pct(row.recall*100)}</HoverExplanation></td><td><HoverExplanation className="classifier-metric-explainer" explanation={`${countLabel(row.support, "held-out example")} ${row.support === 1 ? "was" : "were"} independently reviewed and labeled as “${row.label}.”`}>{row.support}</HoverExplanation></td></tr>;
      })}</tbody></table></div>
    </section>
    <details className="panel classifier-advanced">
      <summary><span><small>Advanced diagnostics</small><b>Protocol, thresholds, and full confusion matrix</b></span><i aria-hidden="true">+</i></summary>
      <div className="classifier-advanced-body">
        <section className="classifier-validation-meta">
          <div><small>Sample</small><b>{report.metadata.sampleSize} examples</b><span>{report.metadata.datasetLabel}</span></div>
          <div><small>Classifier</small><b>{report.metadata.classifierModel}</b><span>Catalog {report.metadata.signatureCatalogVersion}</span></div>
          <div><small>Thresholds</small><b>{pct(report.metadata.thresholds.low*100)} / {pct(report.metadata.thresholds.medium*100)} / {pct(report.metadata.thresholds.high*100)}</b><span>Low / medium / high risk</span></div>
          <div><small>Protocol</small><b>Pre-inference inputs only</b><span>{report.metadata.thresholdTuningSplit}</span></div>
        </section>
        <section className="classifier-confusion">
          <div className="panelhead"><div><p className="eyebrow">Error structure</p><h2>Confusion matrix</h2></div><span>Rows = human review · columns = Jev decision</span></div>
          <p className="classifier-interaction-hint">Each box compares a human-reviewed Task Group with Jev's gated classification. Hover, tap, or focus any number for a plain-language explanation.</p>
          <div className="tablewrap"><table><thead><tr><th>Human-reviewed Task Group</th>{meaningfulLabels.map((label)=><th title={labelNames.get(label)??label} key={label}>{shortLabel(label)}</th>)}</tr></thead><tbody>{meaningfulLabels.filter((label)=>label!=="abstain").map((actual)=>{
            const actualLabel = labelNames.get(actual) ?? actual;
            const reviewedCount = Object.values(report.confusion[actual] ?? {}).reduce((sum, value) => sum + value, 0);
            return <tr key={actual}><th title={actualLabel}>{actualLabel}</th>{meaningfulLabels.map((predicted)=>{
              const count = report.confusion[actual]?.[predicted] ?? 0;
              const predictedLabel = labelNames.get(predicted) ?? predicted;
              return <td className={actual===predicted?"correct":count?"error":""} key={predicted}><HoverExplanation className="classifier-cell-explainer" explanation={matrixExplanation({ actualLabel, predictedLabel, count, reviewedCount, isCorrect: actual === predicted })}>{count}</HoverExplanation></td>;
            })}</tr>;
          })}</tbody></table></div>
        </section>
      </div>
    </details>
    <section className="panel classifier-next-step">
      <div><p className="eyebrow">Next action</p><h2>Validate Jev with your own reviewed labels</h2><p>Build a held-out set in Human Calibration, keep threshold-tuning examples separate, and rerun this report before a classifier can unlock task-specific routes.</p></div>
      <button type="button" className="primary" onClick={onOpenCalibration}>Open Human Calibration</button>
    </section>
  </div>;
}

export function ClassifierValidation({ signatures, workspace, workspaceId, traces, taskGroups, onOpenResponseReview, onOpenCalibration = onOpenResponseReview }: {
  signatures: KnownTaskSignature[];
  workspace: "personal" | "demo";
  workspaceId: string;
  traces: Trace[];
  taskGroups: DistinctTaskBucket[];
  onOpenResponseReview: () => void;
  onOpenCalibration?: () => void;
}) {
  return workspace === "demo"
    ? <DemoClassifierValidation signatures={signatures} onOpenCalibration={onOpenCalibration} />
    : <PersonalClassifierValidation workspaceId={workspaceId} traces={traces} taskGroups={taskGroups} onOpenResponseReview={onOpenResponseReview} />;
}
