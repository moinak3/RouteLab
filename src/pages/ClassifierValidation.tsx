import { useMemo } from "react";
import { buildClassifierValidationReport, createDemoClassifierValidationExamples } from "../core/classifierValidation";
import type { KnownTaskSignature } from "../types";
import { pct } from "../lib/format";

const shortLabel = (value: string) => value === "unknown" || value === "abstain"
  ? value
  : value.split("_").slice(0, 2).join(" ");

export function ClassifierValidation({ signatures }: { signatures: KnownTaskSignature[] }) {
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
  return <div className="classifier-validation-page">
    <section className="panel classifier-validation-hero">
      <div><p className="eyebrow">Jev classifier validation</p><h2>Validation protocol for independently reviewed task labels</h2><p>Jev's reported confidence is not measured classification accuracy. This demo applies the production confidence gate to a held-out fixture and shows what will be measured once a customer-reviewed test set is connected.</p></div>
      <span>Demo dataset</span>
    </section>
    <section className="classifier-validation-meta panel">
      <div><small>Sample</small><b>{report.metadata.sampleSize} examples</b><span>{report.metadata.datasetLabel}</span></div>
      <div><small>Classifier</small><b>{report.metadata.classifierModel}</b><span>Catalog {report.metadata.signatureCatalogVersion}</span></div>
      <div><small>Thresholds</small><b>{pct(report.metadata.thresholds.low*100)} / {pct(report.metadata.thresholds.medium*100)} / {pct(report.metadata.thresholds.high*100)}</b><span>Low / medium / high risk</span></div>
      <div><small>Protocol</small><b>Pre-inference inputs only</b><span>{report.metadata.thresholdTuningSplit}</span></div>
    </section>
    <section className="classifier-validation-metrics">
      <article className="panel"><small>Precision among accepted matches</small><b>{pct(report.acceptedPrecision*100)}</b><span>How often gated-in assignments are correct</span></article>
      <article className="panel"><small>Coverage</small><b>{pct(report.coverage*100)}</b><span>Traffic receiving a confident known match</span></article>
      <article className="panel"><small>Abstention</small><b>{pct(report.abstention*100)}</b><span>Traffic sent to the default or review path</span></article>
      <article className="panel"><small>Unknown false acceptance</small><b>{pct(report.unknownFalseAcceptance*100)}</b><span>Unfamiliar work incorrectly assigned as known</span></article>
    </section>
    <section className="panel classifier-signature-table">
      <div className="panelhead"><div><p className="eyebrow">Per-signature performance</p><h2>Precision and recall</h2></div><span>{report.metadata.testSplit}</span></div>
      <div className="tablewrap"><table><thead><tr><th>Signature</th><th>Precision</th><th>Recall</th><th>Reviewed support</th></tr></thead><tbody>{report.perSignature.map((row)=><tr key={row.signatureId}><td><b>{row.label}</b><small>{row.signatureId}</small></td><td>{pct(row.precision*100)}</td><td>{pct(row.recall*100)}</td><td>{row.support}</td></tr>)}</tbody></table></div>
    </section>
    <section className="panel classifier-confusion">
      <div className="panelhead"><div><p className="eyebrow">Error structure</p><h2>Confusion matrix</h2></div><span>Rows = reviewed · columns = gated prediction</span></div>
      <div className="tablewrap"><table><thead><tr><th>Reviewed label</th>{meaningfulLabels.map((label)=><th title={labelNames.get(label)??label} key={label}>{shortLabel(label)}</th>)}</tr></thead><tbody>{meaningfulLabels.filter((label)=>label!=="abstain").map((actual)=><tr key={actual}><th title={labelNames.get(actual)??actual}>{labelNames.get(actual)??actual}</th>{meaningfulLabels.map((predicted)=><td className={actual===predicted?"correct":report.confusion[actual]?.[predicted]?"error":""} key={predicted}>{report.confusion[actual]?.[predicted]??0}</td>)}</tr>)}</tbody></table></div>
    </section>
    <section className="panel classifier-error-examples">
      <div className="panelhead"><div><p className="eyebrow">Definition review</p><h2>Confusions and misses</h2></div><span>{report.errors.length} examples shown</span></div>
      {report.errors.length?<div>{report.errors.map((example)=><article key={example.id}><div><b>{example.id}</b><span>{pct(example.confidence*100)} confidence · {example.accepted?"accepted":"abstained"}</span></div><p>{example.promptPreview}</p><small>Reviewed: {labelNames.get(example.reviewedSignatureId)??example.reviewedSignatureId} · Predicted: {labelNames.get(example.predictedSignatureId)??example.predictedSignatureId}</small></article>)}</div>:<p>No errors in this test set.</p>}
    </section>
    <p className="classifier-validation-note">Replace this bundled demo set with a customer-reviewed held-out dataset before using these numbers for a production decision. Threshold tuning must remain separate from the final test set.</p>
  </div>;
}
