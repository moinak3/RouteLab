import { useMemo, useState } from "react";
import { analyzeFineTuneOpportunity } from "../core/goldenDatasets";
import type { FineTuneJob, GoldenDataset as GoldenDatasetType, Trace } from "../types";

const openWeightModels = ["Mistral Small 3.2", "Mistral Large 3", "LLaMA 3.3 70B", "LLaMA 3.1 8B", "Qwen 2.5 32B"];
const inferenceProviders = ["BaseTen", "AWS SageMaker", "AWS Bedrock", "Modal", "Together Dedicated"];
const deploymentTargets = ["Deploy to BaseTen", "Deploy to AWS SageMaker", "Export for local hosting"];

type Props = {
  traces: Trace[];
  datasets: GoldenDatasetType[];
  jobs: FineTuneJob[];
  onStartFineTune: (dataset: GoldenDatasetType, baseModel: string, provider: string) => void;
  onDeployFineTune: (jobId: string, target: string) => void;
};

export function FineTuning({ traces, datasets, jobs, onStartFineTune, onDeployFineTune }: Props) {
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [baseModel, setBaseModel] = useState(openWeightModels[0]);
  const [provider, setProvider] = useState(inferenceProviders[0]);
  const selectedDataset = datasets.find((dataset) => dataset.id === selectedDatasetId) ?? datasets[0];
  const fineTuneSignal = useMemo(() => analyzeFineTuneOpportunity(traces), [traces]);
  const datasetJobs = jobs.filter((job) => !selectedDataset || job.dataset_id === selectedDataset.id);

  return <div className="golden-page">
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

    <section className="panel fine-tune-workflow">
      <div className="panelhead">
        <div>
          <p className="eyebrow">Fine-tuning workflow</p>
          <h2>Train a smaller open-weight model for stable work.</h2>
          <p className="calibration-copy">Use a calibrated golden dataset to move repeated instructions, examples, and style constraints into model weights.</p>
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
        </article>) : <p>No fine-tuning jobs yet. Upload a golden dataset, then select a model and provider to start.</p>}
      </div>
    </section>
  </div>;
}
