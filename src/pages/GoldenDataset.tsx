import { useMemo, useState } from "react";
import { analyzeFineTuneOpportunity, parseGoldenDatasetCsv, updateGoldenDatasetCell } from "../core/goldenDatasets";
import { preview } from "../lib/format";
import type { FineTuneJob, GoldenDataset as GoldenDatasetType, Trace } from "../types";

const openWeightModels = ["Mistral Small 3.2", "Mistral Large 3", "LLaMA 3.3 70B", "LLaMA 3.1 8B", "Qwen 2.5 32B"];
const inferenceProviders = ["BaseTen", "AWS SageMaker", "AWS Bedrock", "Modal", "Together Dedicated"];
const deploymentTargets = ["Deploy to BaseTen", "Deploy to AWS SageMaker", "Export for local hosting"];

type Props = {
  traces: Trace[];
  datasets: GoldenDatasetType[];
  jobs: FineTuneJob[];
  onUpload: (dataset: GoldenDatasetType) => void;
  onUpdate: (dataset: GoldenDatasetType) => void;
  onDelete: (id: string) => void;
  onStartFineTune: (dataset: GoldenDatasetType, baseModel: string, provider: string) => void;
  onDeployFineTune: (jobId: string, target: string) => void;
};

const cellValue = (value: unknown) => value === null || value === undefined ? "" : String(value);

export function GoldenDataset({ traces, datasets, jobs, onUpload, onUpdate, onDelete, onStartFineTune, onDeployFineTune }: Props) {
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [baseModel, setBaseModel] = useState(openWeightModels[0]);
  const [provider, setProvider] = useState(inferenceProviders[0]);
  const selectedDataset = datasets.find((dataset) => dataset.id === selectedDatasetId) ?? datasets[0];
  const fineTuneSignal = useMemo(() => analyzeFineTuneOpportunity(traces), [traces]);
  const datasetJobs = jobs.filter((job) => !selectedDataset || job.dataset_id === selectedDataset.id);

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
        <h2>Upload evaluation-ready examples for fine-tuning.</h2>
        <p>Bring in CSV rows with prompts, expected answers, labels, rubrics, or other target outputs. RouteLab keeps a lightweight preview and uses the dataset as the input to the fine-tuning workflow.</p>
      </div>
      <label className="upload golden-upload">Upload golden CSV<input type="file" accept=".csv" onChange={(event) => uploadDataset(event.target.files?.[0])} /></label>
    </section>

    {uploadError && <div className="notice golden-error"><span>!</span>{uploadError}</div>}

    <section className={`panel fine-tune-signal ${fineTuneSignal.should_suggest ? "active" : ""}`}>
      <div>
        <p className="eyebrow">Trace monitor</p>
        <h2>{fineTuneSignal.should_suggest ? "Fine-tuning opportunity detected" : "Monitoring for fine-tuning opportunities"}</h2>
        <p>{fineTuneSignal.reason}</p>
      </div>
      <div className="signal-stats">
        <span><b>{fineTuneSignal.matching_traces.toLocaleString()}</b>context-heavy traces</span>
        <span><b>{fineTuneSignal.estimated_context_tokens.toLocaleString()}</b>avg context tokens</span>
        <span><b>{fineTuneSignal.stable_pattern_count}</b>stable patterns</span>
      </div>
    </section>

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

    <section className="panel fine-tune-workflow">
      <div className="panelhead">
        <div>
          <p className="eyebrow">Fine-tuning workflow</p>
          <h2>Train a smaller open-weight model for stable work.</h2>
        </div>
        <span>{jobs.length.toLocaleString()} jobs</span>
      </div>
      <div className="fine-tune-controls">
        <label>Golden dataset<select value={selectedDataset?.id ?? ""} onChange={(event) => setSelectedDatasetId(event.target.value)}>{datasets.length ? datasets.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}</option>) : <option value="">Upload a dataset first</option>}</select></label>
        <label>Base open-weight model<select value={baseModel} onChange={(event) => setBaseModel(event.target.value)}>{openWeightModels.map((model) => <option value={model} key={model}>{model}</option>)}</select></label>
        <label>Inference provider<select value={provider} onChange={(event) => setProvider(event.target.value)}>{inferenceProviders.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        <button type="button" className="primary" disabled={!selectedDataset} onClick={() => selectedDataset && onStartFineTune(selectedDataset, baseModel, provider)}>Start Fine-Tuning</button>
      </div>
      <div className="fine-tune-jobs">
        {datasetJobs.length ? datasetJobs.map((job) => <article key={job.id}>
          <div><b>{job.base_model}</b><span>{job.dataset_name} · {job.provider}</span></div>
          <strong className={job.status}>{job.status}</strong>
          {job.status === "completed" && <div className="deploy-options">{deploymentTargets.map((target) => <button type="button" className={job.deployment_target === target ? "primary" : ""} key={target} onClick={() => onDeployFineTune(job.id, target)}>{job.deployment_target === target ? `Selected: ${target}` : target}</button>)}</div>}
        </article>) : <p>No fine-tuning jobs yet. Select a dataset, model, and provider to start.</p>}
      </div>
    </section>
  </div>;
}
