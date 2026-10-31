import { useMemo, useState } from "react";
import { calibrateGoldenDataset, parseGoldenDatasetCsv, updateGoldenDatasetCell } from "../core/goldenDatasets";
import { preview } from "../lib/format";
import type { GoldenDataset as GoldenDatasetType, Trace, TraceJudgeResult } from "../types";

type Props = {
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  datasets: GoldenDatasetType[];
  onUpload: (dataset: GoldenDatasetType) => void;
  onUpdate: (dataset: GoldenDatasetType) => void;
  onDelete: (id: string) => void;
  onOpenEvalLibrary: () => void;
  onOpenReviewQueue: () => void;
};

const cellValue = (value: unknown) => value === null || value === undefined ? "" : String(value);
const pct = (value: number) => `${value.toFixed(1)}%`;
const formatDelta = (value: number) => value ? value.toFixed(2) : "0.00";
const PREVIEW_ROW_COUNT = 2;
const PREFERRED_PREVIEW_COLUMNS = ["trace_id", "task_group", "evaluation_scope", "trajectory_status", "human_passed", "human_score"];

const jsonCount = (value?: string) => {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.length;
    return parsed === null ? 0 : 1;
  } catch {
    return 0;
  }
};
const prettyEvidence = (value?: string) => {
  if (!value) return "No evidence recorded";
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
};

export function GoldenDataset({ traces, traceJudgeResults, datasets, onUpload, onUpdate, onDelete, onOpenEvalLibrary, onOpenReviewQueue }: Props) {
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const selectedDataset = datasets.find((dataset) => dataset.id === selectedDatasetId) ?? datasets[0];
  const calibration = useMemo(() => calibrateGoldenDataset(selectedDataset, traces, traceJudgeResults), [selectedDataset, traces, traceJudgeResults]);
  const trajectoryEvidenceRows = useMemo(() => selectedDataset?.rows.filter((row) => row.evaluation_scope === "full_trajectory" && row.evidence_fingerprint).length ?? 0, [selectedDataset]);
  const previewColumns = useMemo(() => {
    if (!selectedDataset) return [];
    if (mode === "edit") return selectedDataset.columns;
    const preferred = PREFERRED_PREVIEW_COLUMNS.filter((column) => selectedDataset.columns.includes(column));
    return preferred.length >= 3 ? preferred : selectedDataset.columns.slice(0, 5);
  }, [mode, selectedDataset]);
  const evaluatorChanges = useMemo(() => {
    if (!selectedDataset || calibration.matched_rows === 0) return [];
    const changes: Array<{ title: string; detail: string }> = [];
    if (calibration.coverage_pct < 100) changes.push({
      title: "Finish evaluator coverage",
      detail: `The judge has scored ${pct(calibration.coverage_pct)} of this golden dataset. Run the same eval version on the remaining rows before changing its prompt or threshold.`,
    });
    if (calibration.false_pass_rate > 0) changes.push({
      title: "Tighten failure rules",
      detail: `${pct(calibration.false_pass_rate)} of comparable rows were false passes. Add explicit hard-failure checks and use these human failures as negative examples.`,
    });
    if (calibration.false_fail_rate > 0) changes.push({
      title: "Clarify acceptable outcomes",
      detail: `${pct(calibration.false_fail_rate)} of comparable rows were false fails. Add positive examples and clarify which answer variations should still pass.`,
    });
    if (calibration.avg_score_delta >= 0.15) changes.push({
      title: "Add score anchors",
      detail: `The average human-to-judge score gap is ${formatDelta(calibration.avg_score_delta)}. Define concrete examples for low, partial, and full-credit scores.`,
    });
    if (!changes.length) changes.push({
      title: "Validate on held-out labels",
      detail: "Agreement is strong on the current rows. Keep a separate human-labeled set for the next evaluator version so prompt tuning does not overfit this dataset.",
    });
    return changes.slice(0, 3);
  }, [calibration, selectedDataset]);

  async function uploadDataset(file?: File) {
    if (!file) return;
    try {
      const dataset = parseGoldenDatasetCsv(await file.text(), file.name);
      onUpload(dataset);
      setSelectedDatasetId(dataset.id);
      setMode("view");
      setUploadError(null);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Unable to parse CSV.");
    }
  }

  return <div className="golden-page">
    <section className="panel golden-hero">
      <div>
        <p className="eyebrow">Golden Dataset</p>
        <h2>Calibrate humans and judges on the same evidence.</h2>
      <p>Each trajectory row can include the request, instructions, conversation history, available tools, retrieved context, tool calls and results, execution spans, final response, and outcome. Human labels stay separate from that evidence and are never exposed to the judge.</p>
      </div>
      <div className="golden-hero-actions">
        <label className="upload golden-upload primary">Upload golden CSV<input type="file" accept=".csv" onChange={(event) => uploadDataset(event.target.files?.[0])} /></label>
        <a className="ghost-link" href="/samples/personal-agent-trajectory-golden-20.csv" download>Download 20-row trajectory CSV</a>
      </div>
    </section>

    {uploadError && <div className="notice golden-error"><span>!</span>{uploadError}</div>}

    <section className="panel calibration-panel">
      <div className="panelhead">
        <div>
          <p className="eyebrow">Eval calibration</p>
          <h2>Human labels vs LLM-as-judge results.</h2>
          <p className="calibration-copy">Use this to decide whether your automated evaluator is reliable enough for routing and simulation decisions.</p>
        </div>
        {selectedDataset && <span>{calibration.matched_rows.toLocaleString()} matched rows</span>}
      </div>
      {selectedDataset ? <>
        <div className={`notice golden-evidence-parity ${trajectoryEvidenceRows === selectedDataset.row_count ? "complete" : "legacy"}`}>
          <b>{trajectoryEvidenceRows.toLocaleString()} of {selectedDataset.row_count.toLocaleString()} rows snapshot full-trajectory evidence.</b>
          <span>{trajectoryEvidenceRows === selectedDataset.row_count
            ? "Human reviewers and the LLM judge can inspect the same versioned evidence packet. Fingerprints prevent changed traces from being compared silently."
            : "Rows without a trajectory snapshot remain compatible, but they cannot prove evidence parity. Re-export or re-review them before using agreement as a routing gate."}</span>
        </div>
        {calibration.invalid_rows > 0 && <div className="notice golden-consistency-warning" role="alert">
          <b>{calibration.invalid_rows} inconsistent golden row{calibration.invalid_rows === 1 ? "" : "s"} excluded from calibration.</b>
          <span>A failed human label cannot use the exact same candidate and reference answer. Edit the label or provide the corrected human answer.</span>
        </div>}
        <div className="calibration-metrics">
          <article><span>Coverage</span><b>{pct(calibration.coverage_pct)}</b><small>Golden rows with judge result</small></article>
          <article><span>Agreement</span><b>{pct(calibration.agreement_rate)}</b><small>Human pass/fail matches judge</small></article>
          <article><span>False pass</span><b>{pct(calibration.false_pass_rate)}</b><small>Judge passed human failures</small></article>
          <article><span>False fail</span><b>{pct(calibration.false_fail_rate)}</b><small>Judge failed human passes</small></article>
          <article><span>Avg score delta</span><b>{formatDelta(calibration.avg_score_delta)}</b><small>Absolute score distance</small></article>
          <article><span>Severity agreement</span><b>{pct(calibration.severity_agreement_rate)}</b><small>When both severities exist</small></article>
        </div>
        <div className="calibration-workbench">
          <div className="calibration-guidance">
            <p className="eyebrow">Recommended evaluator changes</p>
            <h3>Turn disagreements into a better evaluator.</h3>
            <div className="calibration-change-list">
              {evaluatorChanges.map((change, index) => <article key={change.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><b>{change.title}</b><p>{change.detail}</p></div>
              </article>)}
            </div>
          </div>
          <div className="calibration-loop">
            <p className="eyebrow">Human calibration loop</p>
            <ol>
              <li><b>Review disagreements</b><span>Confirm the human verdict and corrected answer.</span></li>
              <li><b>Edit the evaluator</b><span>Change its rubric, hard-failure rules, examples, or threshold.</span></li>
              <li><b>Create a new version</b><span>Rerun historical labels and compare agreement before activation.</span></li>
            </ol>
            <div className="calibration-actions">
              <button type="button" className="primary" onClick={onOpenEvalLibrary}>Edit evaluator</button>
              <button type="button" onClick={onOpenReviewQueue}>Review human labels</button>
            </div>
          </div>
        </div>
        <div className="calibration-disagreements">
          <div className="panelhead compact">
            <div>
              <p className="eyebrow">Disagreement queue</p>
              <h3>{calibration.disagreements.length ? `${calibration.disagreements.length} rows need review` : "No human/judge disagreements"}</h3>
            </div>
          </div>
          {calibration.disagreements.length ? calibration.disagreements.slice(0, 6).map((row) => <article key={row.trace_id}>
            <div className="calibration-case">
              <code>{row.trace_id}</code>
              <p>{preview(row.prompt, 190)}</p>
              <div className="calibration-answer-pair">
                <div><span>Agent response</span><p>{row.agent_answer}</p></div>
                <div><span>Human reference</span><p>{row.human_answer}</p></div>
              </div>
              {row.evidence_scope === "full_trajectory" && <details className="calibration-evidence">
                <summary>Same trajectory evidence and response-quality rubric reviewed by both human and judge</summary>
                <div>
                  <span><b>{jsonCount(row.system_instructions)}</b> system instruction{jsonCount(row.system_instructions) === 1 ? "" : "s"}</span>
                  <span><b>{jsonCount(row.prior_conversation)}</b> prior message{jsonCount(row.prior_conversation) === 1 ? "" : "s"}</span>
                  <span><b>{jsonCount(row.available_tools)}</b> available tool{jsonCount(row.available_tools) === 1 ? "" : "s"}</span>
                  <span><b>{jsonCount(row.tool_calls)}</b> recorded tool call{jsonCount(row.tool_calls) === 1 ? "" : "s"}</span>
                  <span><b>{jsonCount(row.tool_results)}</b> tool result{jsonCount(row.tool_results) === 1 ? "" : "s"}</span>
                  <span><b>{jsonCount(row.execution_spans)}</b> execution span{jsonCount(row.execution_spans) === 1 ? "" : "s"}</span>
                  <span><b>{row.trajectory_status || "unknown"}</b> trajectory status</span>
                  <span><b>{row.evidence_match === false ? "Mismatch" : "Matched"}</b> evidence fingerprint</span>
                </div>
                <section className="calibration-evidence-detail">
                  <details><summary>System instructions</summary><pre>{prettyEvidence(row.system_instructions)}</pre></details>
                  <details><summary>Prior conversation</summary><pre>{prettyEvidence(row.prior_conversation)}</pre></details>
                  <details><summary>Available tools</summary><pre>{prettyEvidence(row.available_tools)}</pre></details>
                  <details><summary>Retrieved context</summary><pre>{prettyEvidence(row.retrieved_context)}</pre></details>
                  <details><summary>Tool calls</summary><pre>{prettyEvidence(row.tool_calls)}</pre></details>
                  <details><summary>Tool results</summary><pre>{prettyEvidence(row.tool_results)}</pre></details>
                  <details><summary>Execution spans</summary><pre>{prettyEvidence(row.execution_spans)}</pre></details>
                </section>
              </details>}
            </div>
            <div className="calibration-verdicts">
              <span>Human: <b>{row.human_passed ? "pass" : "fail"}</b>{row.human_score !== undefined ? ` · ${row.human_score}` : ""}</span>
              <span>Judge: <b>{row.judge_passed ? "pass" : "fail"}</b>{row.judge_score !== undefined ? ` · ${row.judge_score}` : ""}</span>
              {row.human_rationale && <small><b>Human:</b> {row.human_rationale}</small>}
              {row.judge_rationale && <small><b>Judge:</b> {row.judge_rationale}</small>}
            </div>
          </article>) : <p className="muted">Upload human labels with trace IDs to compare them against the current LLM-as-judge eval.</p>}
        </div>
      </> : <div className="empty-state"><h3>Upload a golden dataset to see eval calibration.</h3><p>Rows with `trace_id` and `human_passed` or `human_score` will be compared against current LLM-as-judge results.</p></div>}
    </section>

    <section className="panel golden-datasets-panel">
      <div className="panelhead golden-panelhead">
        <div>
          <p className="eyebrow">Calibration evidence</p>
          <h2>{datasets.length ? `${datasets.length} uploaded golden dataset${datasets.length === 1 ? "" : "s"}` : "No golden datasets yet"}</h2>
          <p className="calibration-copy">A compact preview of the human labels used above. Use the review queue for individual corrections or upload a revised CSV for bulk changes.</p>
        </div>
        {selectedDataset && <div className="golden-actions">
          <button type="button" className={mode === "view" ? "primary" : ""} onClick={() => setMode("view")}>Preview</button>
          <button type="button" className={mode === "edit" ? "primary" : ""} onClick={() => setMode("edit")}>Edit sample</button>
          <button type="button" className="danger-button" onClick={() => { onDelete(selectedDataset.id); setSelectedDatasetId(""); }}>Delete</button>
        </div>}
      </div>

      {datasets.length ? <div className="golden-browser">
        <div className="dataset-list" aria-label="Golden datasets">
          {datasets.map((dataset) => <button type="button" className={selectedDataset?.id === dataset.id ? "active" : ""} key={dataset.id} onClick={() => { setSelectedDatasetId(dataset.id); setMode("view"); }}>
            <b>{dataset.name}</b>
            <span>{dataset.row_count.toLocaleString()} rows · {dataset.columns.length} columns</span>
          </button>)}
        </div>
        {selectedDataset && <div className="dataset-preview">
          <div className="dataset-summary">
            <b>{selectedDataset.name}</b>
            <span>Showing {Math.min(selectedDataset.rows.length, PREVIEW_ROW_COUNT)} of {selectedDataset.rows.length.toLocaleString()} rows · {mode === "edit" ? "all fields editable in sample" : `${previewColumns.length} calibration fields`}</span>
          </div>
          <div className="tablewrap golden-tablewrap">
            <table className="golden-table">
              <thead><tr>{previewColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>{selectedDataset.rows.slice(0, PREVIEW_ROW_COUNT).map((row, rowIndex) => <tr key={rowIndex}>{previewColumns.map((column) => <td key={column}>{mode === "edit"
                ? <input aria-label={`${column} row ${rowIndex + 1}`} value={cellValue(row[column])} onChange={(event) => onUpdate(updateGoldenDatasetCell(selectedDataset, rowIndex, column, event.target.value))} />
                : preview(cellValue(row[column]), 80)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>}
      </div> : <div className="empty-state"><h3>Upload a CSV to create your first golden dataset.</h3><p>Start with the trajectory sample. It includes a versioned evidence snapshot, a fingerprint, and human labels for each trace.</p></div>}
    </section>
  </div>;
}
