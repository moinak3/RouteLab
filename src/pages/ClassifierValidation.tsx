import { useEffect, useId, useMemo, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { buildClassifierValidationReport, classifierValidationReadiness, createDemoClassifierValidationExamples } from "../core/classifierValidation";
import { loadDraftRoutingPolicy } from "../core/routingDraft";
import { fetchPublishedPolicyHistory, fetchRoutingPolicyDraft } from "../core/routingPolicyPersistence";
import type { KnownTaskSignature } from "../types";
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

type PersonalValidationEvidence = {
  state: "loading" | "ready" | "unavailable";
  simulationEvidenceCount: number;
  overrideCount: number;
  signedPolicyCount: number;
};

function PersonalClassifierValidation({ workspaceId, defaultModelId, onOpenSimulations }: {
  workspaceId: string;
  defaultModelId: string;
  onOpenSimulations: () => void;
}) {
  const localDraft = useMemo(() => loadDraftRoutingPolicy(defaultModelId, workspaceId), [defaultModelId, workspaceId]);
  const localOverrides = Object.values(localDraft.overrides);
  const [evidence, setEvidence] = useState<PersonalValidationEvidence>({
    state: "loading",
    simulationEvidenceCount: localOverrides.filter((override) => override.replayCount > 0).length,
    overrideCount: localOverrides.length,
    signedPolicyCount: 0,
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    Promise.allSettled([
      fetchRoutingPolicyDraft(workspaceId, controller.signal),
      fetchPublishedPolicyHistory(workspaceId, controller.signal),
    ]).then(([draftResult, historyResult]) => {
      if (!active) return;
      const draft = draftResult.status === "fulfilled" && draftResult.value.draft
        ? draftResult.value.draft
        : localDraft;
      const overrides = Object.values(draft.overrides);
      setEvidence({
        state: draftResult.status === "rejected" && historyResult.status === "rejected" ? "unavailable" : "ready",
        simulationEvidenceCount: overrides.filter((override) => override.replayCount > 0).length,
        overrideCount: overrides.length,
        signedPolicyCount: historyResult.status === "fulfilled" ? historyResult.value.versions.length : 0,
      });
    });
    return () => { active = false; controller.abort(); };
  }, [localDraft, workspaceId]);

  const readiness = classifierValidationReadiness({
    simulationEvidenceCount: evidence.simulationEvidenceCount,
    overrideCount: evidence.overrideCount,
    signedPolicyCount: evidence.signedPolicyCount,
    reviewedLabelCount: 0,
  });

  return <div className="classifier-validation-page classifier-validation-empty">
    <section className="panel classifier-validation-empty-card">
      <p className="eyebrow">Classifier validation</p>
      <h2>No workspace validation report yet</h2>
      <p>RouteLab will not show bundled classifier metrics in My Workspace. Validation appears only from this workspace's measured routing evidence and an independently reviewed set of task labels.</p>
      <div className="classifier-validation-readiness" aria-label="Classifier validation prerequisites">
        {readiness.prerequisites.map((item, index) => <article className={item.complete ? "complete" : "pending"} key={item.id}>
          <span>{item.complete ? "✓" : String(index + 1).padStart(2, "0")}</span>
          <div><b>{item.label}</b><small>{item.detail}</small></div>
        </article>)}
      </div>
      <div className="classifier-validation-empty-actions">
        <button type="button" className="primary" onClick={onOpenSimulations}>Open Routing Simulations</button>
        <span>{evidence.state === "loading" ? "Checking workspace evidence…" : evidence.state === "unavailable" ? "Cloud evidence is unavailable; local draft checked." : `${readiness.completedCount} of ${readiness.prerequisites.length} prerequisites complete`}</span>
      </div>
    </section>
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

export function ClassifierValidation({ signatures, workspace, workspaceId, defaultModelId, onOpenSimulations, onOpenCalibration = onOpenSimulations }: {
  signatures: KnownTaskSignature[];
  workspace: "personal" | "demo";
  workspaceId: string;
  defaultModelId: string;
  onOpenSimulations: () => void;
  onOpenCalibration?: () => void;
}) {
  return workspace === "demo"
    ? <DemoClassifierValidation signatures={signatures} onOpenCalibration={onOpenCalibration} />
    : <PersonalClassifierValidation workspaceId={workspaceId} defaultModelId={defaultModelId} onOpenSimulations={onOpenSimulations} />;
}
