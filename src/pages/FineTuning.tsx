import { useMemo, useState } from "react";
import { basetenOpenWeightModels } from "../core/basetenFineTuning";
import { buildFineTuningRecommendationBundle, type FineTuningRecommendationReport } from "../core/fineTuningRecommendations";
import { analyzeFineTuneOpportunity } from "../core/goldenDatasets";
import { buildPromptCachingOpportunityBundle, type PromptCachingOpportunity } from "../core/promptCaching";
import type { DistinctTaskBucket, FineTuneJob, GoldenDataset as GoldenDatasetType, Trace, TraceJudgeResult } from "../types";

const openWeightModels = basetenOpenWeightModels;
const inferenceProviders = ["BaseTen", "AWS SageMaker", "AWS Bedrock", "Modal", "Together Dedicated"];
const deploymentTargets = ["Deploy to BaseTen", "Deploy to AWS SageMaker", "Export for local hosting"];

type Props = {
  traces: Trace[];
  distinctTaskBuckets: DistinctTaskBucket[];
  traceJudgeResults: TraceJudgeResult[];
  datasets: GoldenDatasetType[];
  jobs: FineTuneJob[];
  onStartFineTune: (dataset: GoldenDatasetType, baseModel: string, provider: string) => void | Promise<void>;
  onDeployFineTune: (jobId: string, target: string) => void;
};

const recommendationLabel: Record<FineTuningRecommendationReport["recommendation"], string> = {
  do_not_fine_tune: "Continue with prompting",
  improve_prompting_or_context: "Improve prompt/context/RAG",
  use_routing: "Use model routing",
  pilot_fine_tuning: "Pilot fine-tuning",
  strongly_recommend_fine_tuning: "Strongly pursue fine-tuning",
};

const money = (value: number) => `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const preciseMoney = (value: number) => `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const pct = (value: number) => `${value.toFixed(1)}%`;

function RecommendationCard({ report, compact = false }: { report: FineTuningRecommendationReport; compact?: boolean }) {
  return <article className={`fine-tune-rec-card ${compact ? "compact" : ""}`}>
    <div className="rec-card-head">
      <div>
        <p className="eyebrow">{report.scope === "global" ? "Fine-tuning recommendation" : "Trace signature recommendation"}</p>
        <h3>{recommendationLabel[report.recommendation]}</h3>
        <span>{report.scope_name} · {report.trace_count.toLocaleString()} traces · confidence {report.confidence}</span>
      </div>
      <strong>{report.score}<small>/100</small></strong>
    </div>
    <p>{report.primary_reason}</p>
    {!compact && <div className="rec-metrics">
      <span><b>{money(report.economic_summary.monthly_savings)}</b>monthly savings</span>
      <span><b>{money(report.economic_summary.annual_savings)}</b>annual savings</span>
      <span><b>{report.economic_summary.break_even_months || "n/a"}</b>break-even months</span>
      <span><b>{pct(report.prompt_analysis.compressible_token_pct)}</b>compressible input</span>
    </div>}
    {!compact && <div className="rec-factor-list">
      {report.score_factors.map((factor) => <div key={factor.name}>
        <span>{factor.name}</span>
        <b>{factor.points}/{factor.weight}</b>
        <small>{factor.evidence}</small>
      </div>)}
    </div>}
    {!compact && <div className="rec-evidence-grid">
      <div><b>Quality rationale</b><span>Eval score {pct(report.quality_summary.current_eval_score)} · systematic failures {pct(report.quality_summary.systematic_failure_rate)}</span><small>{report.quality_summary.main_failure_modes.join(", ") || "No dominant failure mode"}</small></div>
      <div><b>Data readiness</b><span>{report.data_readiness.readiness_level} · {report.data_readiness.training_examples_available.toLocaleString()} examples</span><small>{report.data_readiness.corrected_examples_available.toLocaleString()} corrected examples · label quality {report.data_readiness.label_quality}</small></div>
      <div><b>Routing comparison</b><span>{report.routing_comparison.best_alternative_model || "No alternative"}</span><small>{report.routing_comparison.routing_recommendation}</small></div>
    </div>}
  </article>;
}

function PromptCachingCard({ opportunity }: { opportunity: PromptCachingOpportunity }) {
  const topProvider = opportunity.per_provider[0];
  return <article className={`prompt-cache-card ${opportunity.recommendation}`}>
    <div className="prompt-cache-head">
      <div>
        <p className="eyebrow">Prompt caching opportunity</p>
        <h3>{opportunity.recommendation === "add_cache_control" ? "Add cache_control markers" : opportunity.recommendation.replaceAll("_", " ")}</h3>
        <span>{opportunity.scope_name} · {opportunity.trace_count.toLocaleString()} traces · {opportunity.model_display_name}</span>
      </div>
      <strong>{topProvider ? preciseMoney(topProvider.monthly_savings) : "$0"}<small>/mo</small></strong>
    </div>
    <p>{opportunity.primary_reason}</p>
    <div className="prompt-cache-grid">
      <span><b>{opportunity.stable_prefix_tokens.toLocaleString()}</b>stable prefix tokens</span>
      <span><b>{pct(opportunity.prefix_similarity_pct)}</b>prompt similarity</span>
      <span><b>{opportunity.monthly_request_volume.toLocaleString()}</b>monthly calls</span>
    </div>
    <div className="prompt-cache-marker">
      <b>Where to place it</b>
      <code>{opportunity.suggested_cache_control_path}</code>
      <p>{opportunity.marker_instruction}</p>
      <small>{opportunity.sample_prefix_preview}</small>
    </div>
    <div className="prompt-cache-providers">
      {opportunity.per_provider.slice(0, 5).map((provider) => <div key={provider.provider_id}>
        <span>{provider.model_display_name} via {provider.provider_name}</span>
        <b>{preciseMoney(provider.monthly_savings)}/mo</b>
        <small>{provider.estimated_cache_read_discount_pct}% cache-read discount · prefix cost {preciseMoney(provider.current_monthly_prefix_cost)} → {preciseMoney(provider.projected_monthly_prefix_cost)}</small>
      </div>)}
    </div>
  </article>;
}

export function FineTuning({ traces, distinctTaskBuckets, traceJudgeResults, datasets, jobs, onStartFineTune, onDeployFineTune }: Props) {
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [baseModel, setBaseModel] = useState(openWeightModels[0]);
  const [provider, setProvider] = useState(inferenceProviders[0]);
  const selectedDataset = datasets.find((dataset) => dataset.id === selectedDatasetId) ?? datasets[0];
  const fineTuneSignal = useMemo(() => analyzeFineTuneOpportunity(traces), [traces]);
  const recommendationBundle = useMemo(() => buildFineTuningRecommendationBundle({
    traces,
    distinctTaskBuckets,
    traceJudgeResults,
    goldenDatasets: datasets,
  }), [traces, distinctTaskBuckets, traceJudgeResults, datasets]);
  const promptCachingBundle = useMemo(() => buildPromptCachingOpportunityBundle({
    traces,
    distinctTaskBuckets,
  }), [traces, distinctTaskBuckets]);
  const [selectedReportId, setSelectedReportId] = useState("global");
  const selectedReport = selectedReportId === "global"
    ? recommendationBundle.global
    : recommendationBundle.by_signature.find((report) => report.scope_id === selectedReportId) ?? recommendationBundle.global;
  const datasetJobs = jobs.filter((job) => !selectedDataset || job.dataset_id === selectedDataset.id);

  return <div className="golden-page">
    <section className="fine-tune-recommendation-layout" aria-label="Fine-tuning recommendation summary">
      <RecommendationCard report={recommendationBundle.global} />
      <aside className="fine-tune-json-panel">
        <p className="eyebrow">Structured output</p>
        <h3>Recommendation JSON</h3>
        <select value={selectedReportId} onChange={(event) => setSelectedReportId(event.target.value)} aria-label="Fine-tuning recommendation scope">
          <option value="global">All production traces</option>
          {recommendationBundle.by_signature.map((report) => <option value={report.scope_id} key={report.scope_id}>{report.scope_name}</option>)}
        </select>
        <pre>{JSON.stringify({
          recommendation: selectedReport.recommendation,
          score: selectedReport.score,
          confidence: selectedReport.confidence,
          primary_reason: selectedReport.primary_reason,
          economic_summary: selectedReport.economic_summary,
          quality_summary: selectedReport.quality_summary,
          data_readiness: selectedReport.data_readiness,
          prompt_analysis: selectedReport.prompt_analysis,
          routing_comparison: selectedReport.routing_comparison,
          risks: selectedReport.risks,
          next_steps: selectedReport.next_steps,
        }, null, 2)}</pre>
      </aside>
    </section>

    <section className="panel">
      <div className="panelhead">
        <div>
          <p className="eyebrow">Cache repeated prompt prefixes</p>
          <h2>Find where prompt caching pays back.</h2>
          <p className="calibration-copy">Without explicit cache_control markers, stable instructions and examples are billed as fresh input on every call. RouteLab finds repeated prefixes and calculates savings across provider quotes.</p>
        </div>
        <span>{promptCachingBundle.global.per_provider.length.toLocaleString()} providers priced</span>
      </div>
      <PromptCachingCard opportunity={promptCachingBundle.global} />
      <div className="prompt-cache-signatures">
        {promptCachingBundle.by_signature
          .filter((opportunity) => opportunity.recommendation === "add_cache_control")
          .slice(0, 4)
          .map((opportunity) => <PromptCachingCard key={opportunity.scope_id} opportunity={opportunity} />)}
      </div>
    </section>

    <section className="panel">
      <div className="panelhead">
        <div>
          <p className="eyebrow">Per-trace-signature recommendations</p>
          <h2>Fine-tuning decisions by stable workload.</h2>
          <p className="calibration-copy">Fine-tuning is only recommended when evidence beats prompting, RAG, and routing alternatives.</p>
        </div>
        <span>{recommendationBundle.by_signature.length.toLocaleString()} signatures</span>
      </div>
      <div className="fine-tune-signature-grid">
        {recommendationBundle.by_signature.slice(0, 6).map((report) => <button type="button" key={report.scope_id} onClick={() => setSelectedReportId(report.scope_id)}>
          <RecommendationCard report={report} compact />
        </button>)}
      </div>
    </section>

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
          <div>
            <b>{job.base_model}</b>
            <span>{job.dataset_name} · {job.provider}{job.mode === "baseten" ? " · real BaseTen job" : " · simulated"}</span>
            {job.external_job_id && <span>BaseTen job {job.external_job_id}{job.external_project_id ? ` · project ${job.external_project_id}` : ""}</span>}
            {job.error && <span className="job-error">{job.error}</span>}
            {job.external_url && <a href={job.external_url} target="_blank" rel="noreferrer">Open in BaseTen</a>}
          </div>
          <strong className={job.status}>{job.status}</strong>
          {job.status === "completed" && <div className="deploy-options">{deploymentTargets.map((target) => <button type="button" className={job.deployment_target === target ? "primary" : ""} key={target} onClick={() => onDeployFineTune(job.id, target)}>{job.deployment_target === target ? `Selected: ${target}` : target}</button>)}</div>}
        </article>) : <p>No fine-tuning jobs yet. Upload a golden dataset, then select a model and provider to start.</p>}
      </div>
    </section>
  </div>;
}
