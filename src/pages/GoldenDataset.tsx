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
};

const cellValue = (value: unknown) => value === null || value === undefined ? "" : String(value);
const pct = (value: number) => `${value.toFixed(1)}%`;
const formatDelta = (value: number) => value ? value.toFixed(2) : "0.00";

export function GoldenDataset({ traces, traceJudgeResults, datasets, onUpload, onUpdate, onDelete }: Props) {
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const selectedDataset = datasets.find((dataset) => dataset.id === selectedDatasetId) ?? datasets[0];
  const calibration = useMemo(() => calibrateGoldenDataset(selectedDataset, traces, traceJudgeResults), [selectedDataset, traces, traceJudgeResults]);

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
        <h2>Upload human-labeled examples to calibrate your evals.</h2>
        <p>Golden datasets are the ground-truth layer for RouteLab. Upload prompts, agent answers, expected answers, and human pass or score labels, then compare them against the current LLM-as-judge eval.</p>
      </div>
      <div className="golden-hero-actions">
        <label className="upload golden-upload">Upload golden CSV<input type="file" accept=".csv" onChange={(event) => uploadDataset(event.target.files?.[0])} /></label>
        <a className="ghost-link" href="/samples/routelab-simulated-golden-dataset.csv" download>Download sample CSV</a>
      </div>
    </section>

    {uploadError && <div className="notice golden-error"><span>!</span>{uploadError}</div>}

    <section className="panel">
      <div className="panelhead golden-panelhead">
        <div>
          <p className="eyebrow">Uploaded datasets</p>
          <h2>{datasets.length ? `${datasets.length} golden dataset${datasets.length === 1 ? "" : "s"}` : "No golden datasets yet"}</h2>
        </div>
        {selectedDataset && <div className="golden-actions">
          <button type="button" className={mode === "view" ? "primary" : ""} onClick={() => setMode("view")}>View</button>
          <button type="button" className={mode === "edit" ? "primary" : ""} onClick={() => setMode("edit")}>Edit</button>
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
            <span>Created {new Date(selectedDataset.created_at).toLocaleDateString()} · previewing {Math.min(selectedDataset.rows.length, 8)} rows</span>
          </div>
          <div className="tablewrap">
            <table className="golden-table">
              <thead><tr>{selectedDataset.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>{selectedDataset.rows.slice(0, 8).map((row, rowIndex) => <tr key={rowIndex}>{selectedDataset.columns.map((column) => <td key={column}>{mode === "edit"
                ? <input aria-label={`${column} row ${rowIndex + 1}`} value={cellValue(row[column])} onChange={(event) => onUpdate(updateGoldenDatasetCell(selectedDataset, rowIndex, column, event.target.value))} />
                : preview(cellValue(row[column]), 140)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>}
      </div> : <div className="empty-state"><h3>Upload a CSV to create your first golden dataset.</h3><p>Recommended columns: prompt, expected_response, task_type, rubric, pass_criteria.</p></div>}
    </section>

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
        <div className="calibration-metrics">
          <article><span>Coverage</span><b>{pct(calibration.coverage_pct)}</b><small>Golden rows with judge result</small></article>
          <article><span>Agreement</span><b>{pct(calibration.agreement_rate)}</b><small>Human pass/fail matches judge</small></article>
          <article><span>False pass</span><b>{pct(calibration.false_pass_rate)}</b><small>Judge passed human failures</small></article>
          <article><span>False fail</span><b>{pct(calibration.false_fail_rate)}</b><small>Judge failed human passes</small></article>
          <article><span>Avg score delta</span><b>{formatDelta(calibration.avg_score_delta)}</b><small>Absolute score distance</small></article>
          <article><span>Severity agreement</span><b>{pct(calibration.severity_agreement_rate)}</b><small>When both severities exist</small></article>
        </div>
        <div className="calibration-disagreements">
          <div className="panelhead compact">
            <div>
              <p className="eyebrow">Disagreement queue</p>
              <h3>{calibration.disagreements.length ? `${calibration.disagreements.length} rows need review` : "No human/judge disagreements"}</h3>
            </div>
          </div>
          {calibration.disagreements.length ? calibration.disagreements.slice(0, 6).map((row) => <article key={row.trace_id}>
            <div>
              <code>{row.trace_id}</code>
              <p>{preview(row.prompt, 190)}</p>
            </div>
            <div className="calibration-verdicts">
              <span>Human: <b>{row.human_passed ? "pass" : "fail"}</b>{row.human_score !== undefined ? ` · ${row.human_score}` : ""}</span>
              <span>Judge: <b>{row.judge_passed ? "pass" : "fail"}</b>{row.judge_score !== undefined ? ` · ${row.judge_score}` : ""}</span>
            </div>
            {row.judge_rationale && <small>{row.judge_rationale}</small>}
          </article>) : <p className="muted">Upload human labels with trace IDs to compare them against the current LLM-as-judge eval.</p>}
        </div>
      </> : <div className="empty-state"><h3>Upload a golden dataset to see eval calibration.</h3><p>Rows with `trace_id` and `human_passed` or `human_score` will be compared against current LLM-as-judge results.</p></div>}
    </section>
  </div>;
}
