import { useEffect, useId, useMemo, useState, type FocusEvent, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { buildClassifierValidationReport, classifierValidationReadiness, createDemoClassifierValidationExamples } from "../core/classifierValidation";
import {
  classifierExamplesFromAssignments,
  createWeeklyAssignmentValidationRound,
  decisionAssignments,
  emptyAssignmentValidationWorkflow,
  reviewedSignatureId,
  taskGroupSignatures,
  type AssignmentValidationLabel,
  type AssignmentValidationRound,
  type AssignmentValidationWorkflow,
  type ComparatorAssignment,
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

function assignmentName(assignment: ComparatorAssignment | undefined, labelNames: Map<string, string>) {
  if (!assignment) return "Pending";
  return assignment.signatureId === "unknown" ? "Unknown" : labelNames.get(assignment.signatureId) ?? assignment.signatureId;
}

function humanAssignmentName(label: AssignmentValidationLabel, labelNames: Map<string, string>) {
  if (label.outcome === "task_group" && label.signatureId) return labelNames.get(label.signatureId) ?? label.signatureId;
  return outcomeLabels[label.outcome];
}

function roundStatus(round: AssignmentValidationRound) {
  if (round.labels.length < round.sampleTraceIds.length) return "Human review";
  if (round.jevAssignments.length < round.sampleTraceIds.length || round.llmAssignments.length < round.sampleTraceIds.length) return "Run comparison";
  return "Complete";
}

type AgreementOutcome = "match" | "mismatch" | "abstain" | "pending";
type AgreementCounts = Record<Exclude<AgreementOutcome, "pending">, number>;

function agreementOutcome(example: { accepted: boolean; predictedSignatureId: string; reviewedSignatureId: string } | undefined): AgreementOutcome {
  if (!example) return "pending";
  if (!example.accepted) return "abstain";
  return example.predictedSignatureId === example.reviewedSignatureId ? "match" : "mismatch";
}

function agreementCounts(examples: Array<{ accepted: boolean; predictedSignatureId: string; reviewedSignatureId: string }>): AgreementCounts {
  return examples.reduce<AgreementCounts>((counts, example) => {
    const outcome = agreementOutcome(example);
    if (outcome !== "pending") counts[outcome] += 1;
    return counts;
  }, { match: 0, mismatch: 0, abstain: 0 });
}

function AgreementStack({ label, counts, compact = false }: { label: string; counts: AgreementCounts; compact?: boolean }) {
  const total = counts.match + counts.mismatch + counts.abstain;
  const segments = [
    { key: "match" as const, label: "matched human", count: counts.match },
    { key: "mismatch" as const, label: "wrong accepted", count: counts.mismatch },
    { key: "abstain" as const, label: "abstained", count: counts.abstain },
  ];
  return <div className={`classifier-agreement-stack ${compact ? "compact" : ""}`.trim()} aria-label={`${label}: ${counts.match} matched human, ${counts.mismatch} wrong accepted, ${counts.abstain} abstained`}>
    {!compact && <div><b>{label}</b><span>{total} reviewed requests</span></div>}
    <div className="classifier-agreement-track" aria-hidden="true">{segments.map((segment) => segment.count > 0 && <i className={segment.key} style={{ width: `${total ? segment.count / total * 100 : 0}%` }} key={segment.key} />)}</div>
    <div className="classifier-agreement-counts">{segments.map((segment) => <span className={segment.key} key={segment.key}><i />{segment.count} {segment.label}</span>)}</div>
  </div>;
}

function PersonalClassifierValidation({ workspaceId, traces, taskGroups, onOpenResponseReview }: {
  workspaceId: string;
  traces: Trace[];
  taskGroups: DistinctTaskBucket[];
  onOpenResponseReview: () => void;
}) {
  const signatures = useMemo(() => taskGroupSignatures(taskGroups), [taskGroups]);
  const traceById = useMemo(() => new Map(traces.map((trace) => [trace.id, trace])), [traces]);
  const [workflow, setWorkflow] = useState<AssignmentValidationWorkflow | null>(() => loadLocalAssignmentValidation(workspaceId));
  const [sampleSize, setSampleSize] = useState("20");
  const [weeklyBudget, setWeeklyBudget] = useState("20");
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
        setWeeklyBudget(String(saved.weeklyBudget));
      }
      setState("ready");
    }).catch(() => setState(loadLocalAssignmentValidation(workspaceId) ? "unavailable" : "ready"));
    return () => controller.abort();
  }, [workspaceId]);

  const sampledTraces = useMemo(() => (workflow?.sampleTraceIds ?? []).map((id) => traceById.get(id)).filter((trace): trace is Trace => Boolean(trace)), [workflow?.sampleTraceIds, traceById]);
  const labelByTrace = useMemo(() => new Map((workflow?.labels ?? []).map((label) => [label.traceId, label])), [workflow?.labels]);
  const currentTrace = sampledTraces.find((trace) => !labelByTrace.has(trace.id));
  const currentLane = currentTrace && workflow ? workflow.laneByTraceId[currentTrace.id] : null;
  const currentJev = currentTrace && workflow ? workflow.jevAssignments.find((item) => item.traceId === currentTrace.id) : undefined;
  const labelingComplete = Boolean(workflow?.sampleTraceIds.length) && (workflow?.labels.length ?? 0) >= (workflow?.sampleTraceIds.length ?? 0);
  const comparisonsComplete = labelingComplete
    && (workflow?.jevAssignments.length ?? 0) >= (workflow?.sampleTraceIds.length ?? 0)
    && (workflow?.llmAssignments.length ?? 0) >= (workflow?.sampleTraceIds.length ?? 0);
  const thresholdBySignature = useMemo(() => Object.fromEntries(signatures.map((signature) => [signature.id, JEV_RISK_THRESHOLDS[signature.risk_level]])), [signatures]);
  const jevExamples = workflow ? classifierExamplesFromAssignments(workflow, traces, workflow.jevAssignments, thresholdBySignature) : [];
  const llmExamples = workflow ? classifierExamplesFromAssignments(workflow, traces, workflow.llmAssignments) : [];
  const jevExampleByTrace = useMemo(() => new Map(jevExamples.map((example) => [example.id, example])), [jevExamples]);
  const llmExampleByTrace = useMemo(() => new Map(llmExamples.map((example) => [example.id, example])), [llmExamples]);
  const jevAgreementCounts = useMemo(() => agreementCounts(jevExamples), [jevExamples]);
  const llmAgreementCounts = useMemo(() => agreementCounts(llmExamples), [llmExamples]);
  const reportMetadata = { datasetLabel: "Workspace held-out assignment set", signatureCatalogVersion: workflow?.catalogVersion ?? `workspace-${taskGroups.length}`, testSplit: "Blind human-reviewed set", thresholdTuningSplit: "Targeted correction examples stay separate from the blind monitoring trend" };
  const jevReport = jevExamples.length ? buildClassifierValidationReport(jevExamples, signatures, { ...reportMetadata, classifierModel: workflow?.jevAssignments[0]?.model ?? "typesafe/jev" }) : null;
  const llmReport = llmExamples.length ? buildClassifierValidationReport(llmExamples, signatures, { ...reportMetadata, classifierModel: workflow?.llmAssignments[0]?.model ?? "strong LLM" }) : null;
  const labelNames = useMemo(() => new Map(signatures.map((signature) => [signature.id, signature.label])), [signatures]);
  const meaningfulJevLabels = jevReport?.labels.filter((label) => label === "abstain" || label === "unknown" || jevExamples.some((example) => example.reviewedSignatureId === label || example.predictedSignatureId === label)) ?? [];
  const threeWayRows = useMemo(() => {
    if (!workflow) return [];
    const jevByTrace = new Map(workflow.jevAssignments.map((item) => [item.traceId, item]));
    const llmByTrace = new Map(workflow.llmAssignments.map((item) => [item.traceId, item]));
    return workflow.labels.map((label) => {
      const human = reviewedSignatureId(label);
      const jev = jevByTrace.get(label.traceId);
      const llm = llmByTrace.get(label.traceId);
      const jevStatus = agreementOutcome(jevExampleByTrace.get(label.traceId));
      const llmStatus = agreementOutcome(llmExampleByTrace.get(label.traceId));
      const jevMatch = jevStatus === "match";
      const llmMatch = llmStatus === "match";
      let finding = "Waiting for both automated comparisons";
      if (jev && llm) {
        if (jevMatch && llmMatch) finding = "All three agree";
        else if (jevStatus === "abstain" && llmMatch) finding = "Jev abstained safely; strong LLM agrees with human";
        else if (jevMatch && llmStatus === "abstain") finding = "Jev agrees with human; strong LLM abstained";
        else if (jevStatus === "abstain" && llmStatus === "abstain") finding = "Both automated systems abstained";
        else if (jevMatch) finding = "Jev agrees with human; strong LLM differs";
        else if (llmMatch) finding = "Strong LLM agrees with human; Jev needs correction";
        else if (jev.signatureId === llm.signatureId) finding = "Automated systems agree, but human differs";
        else finding = "Both automated systems differ from human";
      }
      return { label, trace: traceById.get(label.traceId), jev, llm, jevStatus, llmStatus, jevMatch, llmMatch, finding };
    });
  }, [workflow, traceById, jevExampleByTrace, llmExampleByTrace]);
  const recommendationCounts = useMemo(() => ({
    boundary: threeWayRows.filter((row) => row.llmMatch && !row.jevMatch).length,
    taxonomy: threeWayRows.filter((row) => row.jev && row.llm && !row.jevMatch && !row.llmMatch).length,
    comparator: threeWayRows.filter((row) => row.jevMatch && row.llm && !row.llmMatch).length,
    consensusConflict: threeWayRows.filter((row) => row.jev && row.llm && row.jev.signatureId === row.llm.signatureId && !row.jevMatch).length,
  }), [threeWayRows]);
  const roundHistory = useMemo(() => workflow ? [...workflow.history, workflow] : [], [workflow]);

  async function save(next: AssignmentValidationWorkflow) {
    saveLocalAssignmentValidation(workspaceId, next);
    setWorkflow(next);
    setState("saving");
    try {
      const saved = await persistAssignmentValidation(workspaceId, next);
      saveLocalAssignmentValidation(workspaceId, saved);
      setWorkflow(saved);
      setWeeklyBudget(String(saved.weeklyBudget));
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
    void save(emptyAssignmentValidationWorkflow(traces, taskGroups, Number(sampleSize) || 20));
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

  async function runComparisons() {
    if (!workflow || !labelingComplete) return;
    setState("running");
    setError(null);
    try {
      const existingJevByTrace = new Map(workflow.jevAssignments.map((item) => [item.traceId, item]));
      const missingJevTraces = sampledTraces.filter((trace) => !existingJevByTrace.has(trace.id));
      if (missingJevTraces.length) {
        const jevResult = await classifyTraceSignaturesWithJev(missingJevTraces, signatures);
        for (const assignment of decisionAssignments(jevResult.decisions)) existingJevByTrace.set(assignment.traceId, assignment);
      }
      const comparatorResult = await runStrongClassifierComparator(workspaceId, sampledTraces, signatures);
      await save({
        ...workflow,
        jevAssignments: workflow.sampleTraceIds.flatMap((id) => existingJevByTrace.get(id) ?? []),
        llmAssignments: comparatorResult.assignments,
        updatedAt: new Date().toISOString(),
      });
    } catch (runError) {
      setState("ready");
      setError(runError instanceof Error ? runError.message : "Automated classifier comparison failed.");
    }
  }

  function createWeeklyRound() {
    if (!workflow || !comparisonsComplete) return;
    const next = createWeeklyAssignmentValidationRound(workflow, traces, taskGroups, Number(weeklyBudget) || 20);
    if (!next.sampleTraceIds.length) {
      setError("No unseen traces are available for the next weekly validation round.");
      return;
    }
    setError(null);
    setSelectedSignature("");
    setOutcome("task_group");
    setRationale("");
    void save(next);
  }

  const readiness = classifierValidationReadiness({ reviewedLabelCount: workflow?.labels.length ?? 0, jevComparisonCount: workflow?.jevAssignments.length ?? 0 });
  const blindCount = workflow?.sampleTraceIds.filter((id) => workflow.laneByTraceId[id] !== "weekly_targeted").length ?? 0;
  const targetedCount = workflow?.sampleTraceIds.filter((id) => workflow.laneByTraceId[id] === "weekly_targeted").length ?? 0;
  return <div className="classifier-validation-page">
    <section className="panel classifier-evidence-map">
      <div><p className="eyebrow">Two evidence loops</p><h2>Humans establish truth; automated systems are measured against it</h2><p>Task assignment and response quality are different decisions. RouteLab keeps their labels, calibration reports, and ongoing metrics separate.</p></div>
      <div className="classifier-evidence-grid"><b>Decision</b><b>Human truth</b><b>Calibration</b><b>Ongoing monitoring</b><span>Request → Task Group</span><span>Blind assignment labels</span><span>Human vs Jev vs strong LLM</span><span>New and drifting requests</span><span>Request + response → quality</span><span>Correctness and corrected answer</span><span>Judge vs human agreement</span><button type="button" onClick={onOpenResponseReview}>Open response review</button></div>
    </section>

    {!workflow ? <section className="panel classifier-validation-empty-card">
      <p className="eyebrow">Initial calibration</p><h2>Create an independently reviewed Task Group baseline</h2>
      <p>RouteLab selects a balanced held-out set across your Task Groups. Reviewers see only request-time evidence. Jev and strong-LLM predictions stay hidden until every human label is saved.</p>
      <div className="classifier-validation-readiness">{readiness.prerequisites.map((item, index) => <article className={item.complete ? "complete" : "pending"} key={item.id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{item.label}</b><small>{item.detail}</small></div></article>)}</div>
      <div className="classifier-create-set"><label>Initial human review set<input type="number" min="10" max={Math.max(10, traces.length)} value={sampleSize} onChange={(event) => setSampleSize(event.target.value)} /></label><button type="button" className="primary" onClick={createSet}>Create blind validation set</button></div>
      <p className="classifier-protocol-note">Start with 10–20 requests to prove the workflow. Increase support before relying on per-group precision and recall.</p>
      {error && <div className="review-error">{error}</div>}
    </section> : <>
      <section className="panel classifier-lifecycle">
        <div><p className="eyebrow">{workflow.roundKind === "initial" ? "Initial calibration" : `Weekly monitoring · ${workflow.weekOf}`}</p><h2>{workflow.roundKind === "initial" ? "Establish the first trusted baseline" : "Measure drift and correct risky assignments"}</h2></div>
        <ol><li className={workflow.labels.length ? "complete" : "active"}><span>1</span><b>Human truth</b><small>{workflow.labels.length}/{workflow.sampleTraceIds.length} labeled</small></li><li className={labelingComplete ? workflow.jevAssignments.length ? "complete" : "active" : ""}><span>2</span><b>Automated comparison</b><small>Jev + strong LLM</small></li><li className={comparisonsComplete ? "active" : ""}><span>3</span><b>Diagnose</b><small>Find boundary and taxonomy errors</small></li><li><span>4</span><b>Repeat weekly</b><small>Blind trend + targeted fixes</small></li></ol>
      </section>
      <section className="panel classifier-workflow-status"><div><p className="eyebrow">Current round</p><h2>{workflow.labels.length} of {workflow.sampleTraceIds.length} independently reviewed</h2><p>{workflow.roundKind === "weekly" ? `${blindCount} blind monitoring requests · ${targetedCount} targeted corrections` : "Predictions remain hidden until each human decision is recorded."}</p></div><div className="classifier-progress"><i style={{ width: `${workflow.sampleTraceIds.length ? workflow.labels.length / workflow.sampleTraceIds.length * 100 : 0}%` }} /><span>{state === "saving" ? "Saving…" : state === "running" ? "Running Jev and strong LLM…" : state === "unavailable" ? "Saved locally" : "Saved"}</span></div></section>
      {error && <div className="review-error">{error}</div>}
      {currentTrace ? <section className="panel assignment-labeler">
        <div className="panelhead"><div><p className="eyebrow">{currentLane === "weekly_targeted" ? "Targeted correction" : "Blind human label"}</p><h2>What outcome is this request trying to achieve?</h2></div><span>{workflow.labels.length + 1} of {workflow.sampleTraceIds.length}</span></div>
        {currentLane === "weekly_targeted" && currentJev && <aside className="classifier-targeted-proposal"><div><small>Why this request was targeted</small><b>Jev assigned {assignmentName(currentJev, labelNames)} at {pct(currentJev.confidence * 100)} confidence</b><p>Inspect and confirm this choice or replace it. Targeted corrections are reported separately from the blind accuracy trend.</p></div>{currentJev.signatureId !== "unknown" && <button type="button" onClick={() => { setOutcome("task_group"); setSelectedSignature(currentJev.signatureId); }}>Use this Task Group</button>}</aside>}
        <article><small>Request-time evidence</small><p>{currentTrace.prompt_text}</p>{currentTrace.messages.filter((message) => message.role !== "assistant").length > 1 && <details><summary>Prior conversation and system context</summary>{currentTrace.messages.filter((message) => message.role !== "assistant").map((message, index) => <p key={`${message.role}-${index}`}><b>{message.role}</b> {message.content}</p>)}</details>}</article>
        <form onSubmit={submitLabel}>
          <fieldset><legend>Human decision</legend>{(Object.keys(outcomeLabels) as HumanAssignmentOutcome[]).map((value) => <label className={outcome === value ? "selected" : ""} key={value}><input type="radio" name="assignment-outcome" value={value} checked={outcome === value} onChange={() => setOutcome(value)} />{outcomeLabels[value]}</label>)}</fieldset>
          {outcome === "task_group" && <label>Task Group<select value={selectedSignature} onChange={(event) => setSelectedSignature(event.target.value)}><option value="">Choose the best match</option>{signatures.map((signature) => <option value={signature.id} key={signature.id}>{signature.label}</option>)}</select></label>}
          <label>Reviewer note <span>(optional)</span><textarea rows={3} value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder={outcome === "needs_new_group" ? "Describe the missing group boundary." : "Record why this label fits or what made it ambiguous."} /></label>
          <button type="submit" className="primary" disabled={state === "saving"}>Save label and continue</button>
        </form>
      </section> : <section className="panel classifier-comparison-controls">
        <div><p className="eyebrow">Human baseline complete</p><h2>Compare Jev and a strong LLM against the same truth set</h2><p>Both automated systems receive the identical request-time evidence and Task Group catalog. Human labels remain the source of truth; the strong LLM is a diagnostic comparator, not ground truth.</p></div>
        <button type="button" className="primary" onClick={runComparisons} disabled={state === "running"}>{comparisonsComplete ? "Rerun both comparisons" : "Run Jev + strong LLM"}</button>
      </section>}

      {(jevReport || llmReport) && <section className="classifier-comparator-grid">
        {[{ name: "Jev", report: jevReport, examples: jevExamples, counts: jevAgreementCounts }, { name: "Strong LLM comparator", report: llmReport, examples: llmExamples, counts: llmAgreementCounts }].map(({ name, report, examples, counts }) => <article className="panel" key={name}><small>{name}</small>{report ? <><b>{pct(report.acceptedPrecision * 100)}</b><span>precision among accepted assignments</span><AgreementStack label={name} counts={counts} /><dl><div><dt>Exact agreement</dt><dd>{examples.filter((item) => item.accepted && item.reviewedSignatureId === item.predictedSignatureId).length}/{examples.length}</dd></div><div><dt>Coverage</dt><dd>{pct(report.coverage * 100)}</dd></div><div><dt>Wrong accepted</dt><dd>{report.errors.filter((item) => item.accepted).length}</dd></div></dl></> : <p>Not run yet</p>}</article>)}
      </section>}

      {threeWayRows.some((row) => row.jev && row.llm) && <section className="panel classifier-three-way">
        <div className="panelhead"><div><p className="eyebrow">Three-way agreement map</p><h2>Human truth anchors every classifier decision</h2><p>Green matches the reviewed Task Group. Red is a wrong accepted route. Amber means the classifier abstained and kept the request on the default or review path.</p></div><span>Human label is truth</span></div>
        <div className="classifier-agreement-legend" aria-label="Agreement map legend"><span className="match"><i />Match</span><span className="mismatch"><i />Wrong accepted</span><span className="abstain"><i />Abstained</span></div>
        <div className="classifier-agreement-map" role="table" aria-label="Human, Jev, and strong LLM Task Group assignments">
          <div className="classifier-agreement-row header" role="row"><b role="columnheader">Reviewed request</b><b role="columnheader">Human truth</b><b role="columnheader">Jev</b><b role="columnheader">Strong LLM</b></div>
          {threeWayRows.map((row) => <article className="classifier-agreement-row" role="row" key={row.label.traceId}>
            <div className="request" role="cell"><b>{row.trace?.prompt_text ?? row.label.traceId}</b><small>{workflow.laneByTraceId[row.label.traceId]?.replaceAll("_", " ")}</small><p>{row.finding}</p></div>
            <div className="truth" role="cell"><small>Human reviewed</small><b>{humanAssignmentName(row.label, labelNames)}</b></div>
            <div className={`decision ${row.jevStatus}`} role="cell"><span><i />{row.jevStatus === "match" ? "Match" : row.jevStatus === "mismatch" ? "Wrong accepted" : row.jevStatus === "abstain" ? "Abstained" : "Pending"}</span><b>{assignmentName(row.jev, labelNames)}</b>{row.jev && <small>{pct(row.jev.confidence * 100)} confidence</small>}</div>
            <div className={`decision ${row.llmStatus}`} role="cell"><span><i />{row.llmStatus === "match" ? "Match" : row.llmStatus === "mismatch" ? "Wrong accepted" : row.llmStatus === "abstain" ? "Abstained" : "Pending"}</span><b>{assignmentName(row.llm, labelNames)}</b>{row.llm && <small>{pct(row.llm.confidence * 100)} confidence</small>}</div>
          </article>)}
        </div>
      </section>}

      {comparisonsComplete && <section className="panel classifier-improvements">
        <div className="panelhead"><div><p className="eyebrow">What to improve next</p><h2>Turn disagreement patterns into classifier changes</h2></div><span>Catalog {workflow.catalogVersion}</span></div>
        <div><article><b>Clarify Task Group boundaries</b><strong>{recommendationCounts.boundary}</strong><p>The strong LLM matched human labels where Jev did not. Add contrastive examples and sharper include/exclude language to those groups.</p></article><article><b>Revisit taxonomy or evidence</b><strong>{recommendationCounts.taxonomy}</strong><p>Neither automated system matched the human. Check whether the Task Groups overlap or whether request-time evidence is missing.</p></article><article><b>Audit comparator prompts</b><strong>{recommendationCounts.comparator}</strong><p>Jev matched the human while the strong LLM did not. Do not treat the strong LLM as truth; inspect its rationale and catalog prompt.</p></article><article><b>Resolve consensus conflicts</b><strong>{recommendationCounts.consensusConflict}</strong><p>Both automated systems agreed but the human differed. Recheck the label, then update the shared catalog if the human decision stands.</p></article></div>
      </section>}

      {jevReport && <section className="panel classifier-signature-table"><div className="panelhead"><div><p className="eyebrow">Human vs Jev</p><h2>Performance by Task Group</h2></div><span>{jevExamples.length} reviewed examples</span></div><p className="classifier-interaction-hint">Hover, tap, or focus a metric to see exactly how the reviewed examples produced it.</p><div className="tablewrap"><table><thead><tr><th>Task Group</th><th><HoverExplanation explanation="Of the requests Jev confidently assigned to this Task Group, precision is the share that human reviewers assigned to the same group.">Accepted precision</HoverExplanation></th><th><HoverExplanation explanation="Of the requests humans assigned to this Task Group, recall is the share Jev correctly found and confidently accepted.">Recall</HoverExplanation></th><th><HoverExplanation explanation="The number of independently reviewed requests whose human label was this Task Group.">Human-reviewed examples</HoverExplanation></th></tr></thead><tbody>{jevReport.perSignature.filter((row) => row.support || row.acceptedPredictionCount).map((row) => <tr key={row.signatureId}><td><b>{row.label}</b></td><td><HoverExplanation className="classifier-metric-explainer" explanation={row.acceptedPredictionCount ? `Jev confidently assigned ${countLabel(row.acceptedPredictionCount, "request")} here. Humans agreed on ${row.correctAcceptedCount}.` : "No accepted predictions yet."}>{pct(row.precision * 100)}</HoverExplanation></td><td><HoverExplanation className="classifier-metric-explainer" explanation={row.support ? `Humans assigned ${countLabel(row.support, "request")} here. Jev correctly found ${row.correctAcceptedCount}.` : "No human-reviewed support yet."}>{pct(row.recall * 100)}</HoverExplanation></td><td>{row.support}</td></tr>)}</tbody></table></div></section>}

      {jevReport && <details className="panel classifier-advanced"><summary><span><small>Assignment errors</small><b>See the human vs Jev confusion matrix</b></span><i aria-hidden="true">+</i></summary><div className="classifier-advanced-body"><section className="classifier-confusion"><div className="panelhead"><div><p className="eyebrow">Error structure</p><h2>Which Task Groups does Jev confuse?</h2></div><span>Rows = human label · columns = Jev decision</span></div><p className="classifier-interaction-hint">The diagonal shows agreement. A value outside the diagonal is a mismatch to investigate. An abstention stays on the default or review path.</p><div className="tablewrap"><table><thead><tr><th>Human-reviewed Task Group</th>{meaningfulJevLabels.map((label) => <th title={labelNames.get(label) ?? label} key={label}>{shortLabel(label)}</th>)}</tr></thead><tbody>{meaningfulJevLabels.filter((label) => label !== "abstain").map((actual) => { const actualLabel = labelNames.get(actual) ?? actual; const reviewedCount = Object.values(jevReport.confusion[actual] ?? {}).reduce((sum, value) => sum + value, 0); return <tr key={actual}><th title={actualLabel}>{actualLabel}</th>{meaningfulJevLabels.map((predicted) => { const count = jevReport.confusion[actual]?.[predicted] ?? 0; const predictedLabel = labelNames.get(predicted) ?? predicted; return <td className={actual === predicted ? "correct" : count ? "error" : ""} key={predicted}><HoverExplanation className="classifier-cell-explainer" explanation={matrixExplanation({ actualLabel, predictedLabel, count, reviewedCount, isCorrect: actual === predicted })}>{count}</HoverExplanation></td>; })}</tr>; })}</tbody></table></div></section></div></details>}

      {comparisonsComplete && <section className="panel classifier-weekly-plan">
        <div><p className="eyebrow">Ongoing classifier review</p><h2>Set a separate weekly Task Group review budget</h2><p>RouteLab puts 60% into a blind, stratified monitoring lane and 40% into targeted corrections such as low confidence, close runner-up, unknown, error, and high-risk requests.</p></div>
        <label>Classifier conversations per week<input type="number" min="5" max={Math.max(5, traces.length)} value={weeklyBudget} onChange={(event) => setWeeklyBudget(event.target.value)} /></label>
        <div className="classifier-weekly-split"><span><b>{Math.ceil((Number(weeklyBudget) || 20) * .6)}</b> blind monitoring</span><span><b>{Math.floor((Number(weeklyBudget) || 20) * .4)}</b> targeted corrections</span></div>
        <button type="button" className="primary" onClick={createWeeklyRound}>Create next weekly round</button>
      </section>}

      {roundHistory.length > 0 && <section className="panel classifier-round-history"><div className="panelhead"><div><p className="eyebrow">Validation history</p><h2>Baseline and weekly rounds</h2></div><span>{roundHistory.length} round{roundHistory.length === 1 ? "" : "s"}</span></div><div className="tablewrap"><table><thead><tr><th>Round</th><th>Catalog</th><th>Human labels</th><th>Jev</th><th>Strong LLM</th><th>Status</th></tr></thead><tbody>{roundHistory.map((round) => { const roundJevExamples = classifierExamplesFromAssignments(round, traces, round.jevAssignments, thresholdBySignature); const roundLlmExamples = classifierExamplesFromAssignments(round, traces, round.llmAssignments); const roundJev = roundJevExamples.length ? buildClassifierValidationReport(roundJevExamples, signatures, { ...reportMetadata, classifierModel: round.jevAssignments[0]?.model ?? "Jev" }) : null; const roundLlm = roundLlmExamples.length ? buildClassifierValidationReport(roundLlmExamples, signatures, { ...reportMetadata, classifierModel: round.llmAssignments[0]?.model ?? "strong LLM" }) : null; return <tr key={round.roundId}><td><b>{round.roundKind === "initial" ? "Initial baseline" : round.weekOf}</b><small>{round.roundId}</small></td><td>{round.catalogVersion}</td><td>{round.labels.length}/{round.sampleTraceIds.length}</td><td>{roundJev ? <><b>{pct(roundJev.acceptedPrecision * 100)} precision</b><small>{pct(roundJev.coverage * 100)} coverage</small><AgreementStack label="Jev" counts={agreementCounts(roundJevExamples)} compact /></> : "Pending"}</td><td>{roundLlm ? <><b>{pct(roundLlm.acceptedPrecision * 100)} precision</b><AgreementStack label="Strong LLM" counts={agreementCounts(roundLlmExamples)} compact /></> : "Pending"}</td><td>{roundStatus(round)}</td></tr>; })}</tbody></table></div></section>}
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
