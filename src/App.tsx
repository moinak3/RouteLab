import { useEffect, useMemo, useState, type DragEvent } from "react";
import { dashboardMetrics } from "./core/analysis";
import { OPENROUTER_AUTO_MODEL, enabledModels, registerOpenRouterModels, updateFamilyEnabled, updateModelEnabled, updateModelPricing } from "./core/catalog";
import { createDistinctTaskBuckets } from "./core/distinctTasks";
import { createSimulatedGoldenDataset } from "./core/goldenDatasets";
import { buildWorkflowTrees, ingestText } from "./core/ingestion";
import { applyJevSignatureDecisions, classifyTraceSignaturesWithJev } from "./core/jevSignatureGate";
import { recommendPolicy } from "./core/recommendations";
import { mergeRuntimeTraces } from "./core/runtimeTraces";
import { createSeedTraces, knownDistinctTaskSignatures } from "./core/seed";
import { createTraceJudgeResults } from "./core/traceJudge";
import { DistinctTasks } from "./pages/DistinctTasks";
import { ClassifierValidation } from "./pages/ClassifierValidation";
import { Evals } from "./pages/Evals";
import { FineTuning } from "./pages/FineTuning";
import { FrontierModelLab } from "./pages/FrontierModelLab";
import { GoldenDataset } from "./pages/GoldenDataset";
import { Home } from "./pages/Home";
import { ModelCatalog } from "./pages/ModelCatalog";
import { Overview } from "./pages/Overview";
import { Recommendations } from "./pages/Recommendations";
import { ReviewQueue } from "./pages/ReviewQueue";
import { Simulations } from "./pages/Simulations";
import { Traces } from "./pages/Traces";
import type { FineTuneJob, GatewayProvider, GoldenDataset as GoldenDatasetType, Model, Trace, TraceJudgeResult } from "./types";
import type { Page, ReviewQueueFilter } from "./types/ui";

const initialTraces = createSeedTraces();
const initialTraceJudgeResults = createTraceJudgeResults(initialTraces);
const initialGoldenDatasets = [createSimulatedGoldenDataset(initialTraces, initialTraceJudgeResults)];
const DEEPSEEK_RECOMMENDATION_SCOPE = "deepseek_family";
const APP_PASSWORD = "Mochinder";

type NavDestination = {
  label: string;
  page: Page;
  pages: Page[];
  icon: string;
  children?: Array<{ label: string; page: Page }>;
};
const workflowNav: NavDestination[] = [
  { label: "Overview", page: "Overview", pages: ["Overview"], icon: "O" },
  { label: "Workloads", page: "Traces", pages: ["Traces", "Distinct Tasks"], icon: "W", children: [{ label: "Traces", page: "Traces" }, { label: "Task Signatures", page: "Distinct Tasks" }] },
  { label: "Quality", page: "Evals", pages: ["Evals", "Golden Dataset", "Review Queue", "Classifier Validation"], icon: "Q", children: [{ label: "Eval Library", page: "Evals" }, { label: "Human Calibration", page: "Golden Dataset" }, { label: "Classifier Validation", page: "Classifier Validation" }, { label: "Review Queue", page: "Review Queue" }] },
  { label: "Routing Simulations", page: "Simulations", pages: ["Simulations"], icon: "M" },
];
const advancedNav: NavDestination[] = [
  { label: "Routes", page: "Recommendations", pages: ["Recommendations", "Fine-Tuning"], icon: "R", children: [{ label: "Routing Decisions", page: "Recommendations" }, { label: "Fine-Tuning Opportunities", page: "Fine-Tuning" }] },
  { label: "Benchmarking", page: "Benchmarking", pages: ["Benchmarking"], icon: "B" },
  { label: "Settings", page: "Model Catalog", pages: ["Model Catalog"], icon: "S" },
];
const allNav = [...workflowNav, ...advancedNav];
const topLevelLabel = (page: Page) => allNav.find((item) => item.pages.includes(page))?.label ?? page;

export default function App() {
  const [page, setPage] = useState<Page>("Home");
  const [expandedNav, setExpandedNav] = useState<Record<string, boolean>>({ Workloads: true, Quality: false, Routes: false });
  const [traces, setTraces] = useState<Trace[]>(initialTraces);
  const [traceJudgeResults, setTraceJudgeResults] = useState<TraceJudgeResult[]>(initialTraceJudgeResults);
  const [candidate, setCandidate] = useState("deepseek-r1");
  const [recommendationCandidate, setRecommendationCandidate] = useState(DEEPSEEK_RECOMMENDATION_SCOPE);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [openRouterModels, setOpenRouterModels] = useState<Model[] | null>(null);
  const [familyApiKeys, setFamilyApiKeys] = useState<Partial<Record<Model["family"], string>>>({});
  const [gatewayApiKeys, setGatewayApiKeys] = useState<Partial<Record<GatewayProvider, string>>>({});
  const [serverGatewayKeys, setServerGatewayKeys] = useState<Partial<Record<GatewayProvider, boolean>>>({});
  const [reviewQueueFilter, setReviewQueueFilter] = useState<ReviewQueueFilter>("all");
  const [goldenDatasets, setGoldenDatasets] = useState<GoldenDatasetType[]>(initialGoldenDatasets);
  const [fineTuneJobs, setFineTuneJobs] = useState<FineTuneJob[]>([]);
  const [notice, setNotice] = useState<string | null>("Example dataset loaded locally");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const activeModels = useMemo(() => enabledModels(), [catalogVersion]);
  const activeModelIds = useMemo(() => activeModels.map((model) => model.id), [activeModels]);
  const simulationModels = useMemo(() => [...(openRouterModels ?? activeModels).filter((model) => model.id !== OPENROUTER_AUTO_MODEL.id), OPENROUTER_AUTO_MODEL], [openRouterModels, activeModels]);
  const simulationModelIds = useMemo(() => simulationModels.map((model) => model.id), [simulationModels]);
  const distinctTaskBuckets = useMemo(() => createDistinctTaskBuckets(traces), [traces]);
  const metrics = useMemo(() => dashboardMetrics(traces), [traces]);
  const workflows = useMemo(() => buildWorkflowTrees(traces), [traces]);
  const deepSeekModelIds = useMemo(() => activeModels.filter((model) => model.family === "DeepSeek").map((model) => model.id), [activeModels]);
  const recommendationCandidateIds = useMemo(() => recommendationCandidate === DEEPSEEK_RECOMMENDATION_SCOPE ? deepSeekModelIds : [recommendationCandidate], [recommendationCandidate, deepSeekModelIds]);
  const policy = useMemo(() => recommendPolicy(traces, distinctTaskBuckets, recommendationCandidateIds.length ? recommendationCandidateIds : activeModelIds), [traces, distinctTaskBuckets, recommendationCandidateIds, activeModelIds, catalogVersion]);
  const activeSectionChildren = allNav.find((item) => item.pages.includes(page))?.children ?? [];

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [page]);

  useEffect(() => {
    const activeGroup = allNav.find((item) => item.children?.length && item.pages.includes(page));
    if (activeGroup) setExpandedNav((expanded) => ({ ...expanded, [activeGroup.label]: true }));
  }, [page]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/live/key-status")
      .then(response => response.ok ? response.json() : undefined)
      .then((payload: { gateways?: Partial<Record<GatewayProvider, boolean>> } | undefined) => {
        if (!cancelled && payload?.gateways) setServerGatewayKeys(payload.gateways);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (page !== "Overview" && page !== "Traces" && page !== "Review Queue") return;
    let cancelled = false;
    fetch("/api/runtime-traces?limit=500", { cache: "no-store" })
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as { traces?: Trace[] };
        if (!response.ok || !Array.isArray(payload.traces)) throw new Error("Runtime traces are unavailable.");
        return payload.traces;
      })
      .then(runtimeTraces => {
        if (!cancelled && runtimeTraces.length) setTraces(current => mergeRuntimeTraces(current, runtimeTraces));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [page]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/openrouter/models")
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as { models?: Model[]; error?: unknown };
        if (!response.ok || !Array.isArray(payload.models) || !payload.models.length) throw new Error(String(payload.error ?? "OpenRouter catalog unavailable."));
        return payload.models;
      })
      .then(models => {
        if (cancelled) return;
        registerOpenRouterModels([OPENROUTER_AUTO_MODEL, ...models]);
        setOpenRouterModels(models);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!simulationModels.length) return;
    if (!simulationModelIds.includes(candidate)) setCandidate(simulationModels[0].id);
    if (recommendationCandidate !== DEEPSEEK_RECOMMENDATION_SCOPE && !activeModelIds.includes(recommendationCandidate)) setRecommendationCandidate(DEEPSEEK_RECOMMENDATION_SCOPE);
  }, [simulationModels, simulationModelIds, activeModelIds, candidate, recommendationCandidate]);

  async function applyUploadedText(text: string, fileName: string) {
    const result = ingestText(text, fileName);
    setUploadErrors(result.errors.slice(0, 8).map((error) => `Row ${error.row}: ${error.reason}`));
    if (result.traces.length) {
      setNotice(`Classifying ${result.traces.length.toLocaleString()} incoming traces with Jev...`);
      let classifiedTraces = result.traces;
      let gateSummary = "Jev unavailable; all requests use the broadly capable fallback";
      try {
        const gate = await classifyTraceSignaturesWithJev(result.traces, knownDistinctTaskSignatures);
        classifiedTraces = applyJevSignatureDecisions(result.traces, gate.decisions);
        gateSummary = `${gate.summary.matched} signature routes · ${gate.summary.fallback} fallback routes`;
      } catch {
        gateSummary = "Jev unavailable; all requests use the broadly capable fallback";
      }
      setTraces(classifiedTraces);
      setTraceJudgeResults(createTraceJudgeResults(classifiedTraces));
      setPage("Overview");
      setUploadOpen(false);
      setNotice(`${result.traces.length} traces ingested → ${createDistinctTaskBuckets(classifiedTraces).length} distinct tasks · ${gateSummary}${result.errors.length ? ` · ${result.errors.length} rows skipped` : ""}`);
    } else {
      setNotice(result.errors.length ? `${result.errors.length} rows could not be ingested` : "No LLM calls found in upload");
    }
  }

  async function upload(file?: File) {
    if (!file) return;
    await applyUploadedText(await file.text(), file.name);
  }

  function loadExampleDataset() {
    setTraces(initialTraces);
    setTraceJudgeResults(initialTraceJudgeResults);
    setPage("Overview");
    setUploadOpen(false);
    setUploadErrors([]);
    setNotice(`${initialTraces.length} traces ingested → ${createDistinctTaskBuckets(initialTraces).length} distinct tasks classified`);
  }

  function downloadTemplate(name: string, content: string) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function dropUpload(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void upload(event.dataTransfer.files?.[0]);
  }

  function enterApp(password: string) {
    if (password === APP_PASSWORD) {
      setPage("Overview");
      return true;
    }
    return false;
  }

  function addGoldenDataset(dataset: GoldenDatasetType) {
    setGoldenDatasets((items) => [dataset, ...items]);
    setNotice(`${dataset.name} uploaded · ${dataset.row_count.toLocaleString()} golden rows`);
  }

  function updateGoldenDataset(dataset: GoldenDatasetType) {
    setGoldenDatasets((items) => items.map((item) => item.id === dataset.id ? dataset : item));
  }

  function deleteGoldenDataset(id: string) {
    setGoldenDatasets((items) => items.filter((item) => item.id !== id));
    setFineTuneJobs((items) => items.filter((job) => job.dataset_id !== id));
    setNotice("Golden dataset deleted");
  }

  async function startFineTune(dataset: GoldenDatasetType, baseModel: string, provider: string) {
    const now = new Date();
    const job: FineTuneJob = {
      id: `ft_${now.getTime()}`,
      dataset_id: dataset.id,
      dataset_name: dataset.name,
      base_model: baseModel,
      provider,
      status: "running",
      created_at: now.toISOString(),
      mode: provider === "BaseTen" ? "baseten" : "simulated",
    };
    setFineTuneJobs((items) => [job, ...items]);
    if (provider === "BaseTen") {
      setNotice(`Creating BaseTen training job for ${baseModel}`);
      try {
        const response = await fetch("/api/fine-tuning/baseten", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataset, baseModel, provider }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error ?? "BaseTen fine-tuning request failed.");
        const trainingJob = payload.training_job ?? {};
        const trainingProject = payload.training_project ?? {};
        setFineTuneJobs((items) => items.map((item) => item.id === job.id ? {
          ...item,
          status: "queued",
          external_job_id: String(trainingJob.id ?? ""),
          external_project_id: String(trainingProject.id ?? trainingJob.training_project_id ?? ""),
          external_url: trainingJob.id ? "https://app.baseten.co/" : undefined,
        } : item));
        setNotice(`BaseTen training job created${trainingJob.id ? `: ${trainingJob.id}` : ""}`);
      } catch (error) {
        setFineTuneJobs((items) => items.map((item) => item.id === job.id ? {
          ...item,
          status: "failed",
          error: error instanceof Error ? error.message : "BaseTen fine-tuning failed.",
        } : item));
        setNotice(error instanceof Error ? error.message : "BaseTen fine-tuning failed.");
      }
      return;
    }

    setNotice(`Simulated fine-tuning started: ${baseModel} on ${provider}`);
    window.setTimeout(() => {
      setFineTuneJobs((items) => items.map((item) => item.id === job.id ? { ...item, status: "completed", completed_at: new Date().toISOString() } : item));
      setNotice(`Simulated fine-tuning completed: ${baseModel}`);
    }, 900);
  }

  function deployFineTune(jobId: string, target: string) {
    setFineTuneJobs((items) => items.map((item) => item.id === jobId ? { ...item, deployment_target: target } : item));
    setNotice(`${target} selected for fine-tuned model`);
  }

  if (page === "Home") {
    return <Home onGetStarted={enterApp} />;
  }

  return <div className="shell">
    <aside>
      <div className="brand"><span className="brandmark">R</span><div><b>RouteLab</b><small>Routing intelligence</small></div></div>
      <nav aria-label="Primary navigation">
        <small className="nav-group-label">Workflow</small>
        {workflowNav.map((item) => item.children ? <div className="nav-collapsible" key={item.label}>
          <button
            type="button"
            className={`nav-parent ${item.pages.includes(page) ? "active" : ""}`}
            onClick={() => setExpandedNav((expanded) => ({ ...expanded, [item.label]: !expanded[item.label] }))}
            aria-expanded={Boolean(expandedNav[item.label])}
            aria-controls={`${item.label.toLowerCase()}-submenu`}
          >
            <span>{item.icon}</span>{item.label}<i className="nav-caret" aria-hidden="true">{expandedNav[item.label] ? "-" : "+"}</i>
          </button>
          {expandedNav[item.label] && <div className="nav-submenu" id={`${item.label.toLowerCase()}-submenu`}>
            {item.children.map((child) => <button type="button" className={page === child.page ? "active" : ""} onClick={() => setPage(child.page)} key={child.page}>{child.label}</button>)}
          </div>}
        </div> : <button type="button" className={item.pages.includes(page) ? "active" : ""} onClick={() => setPage(item.page)} key={item.label}><span>{item.icon}</span>{item.label}</button>)}
        <small className="nav-group-label advanced">Advanced</small>
        {advancedNav.map((item) => item.children ? <div className="nav-collapsible" key={item.label}>
          <button
            type="button"
            className={`nav-parent ${item.pages.includes(page) ? "active" : ""}`}
            onClick={() => setExpandedNav((expanded) => ({ ...expanded, [item.label]: !expanded[item.label] }))}
            aria-expanded={Boolean(expandedNav[item.label])}
            aria-controls={`${item.label.toLowerCase()}-submenu`}
          >
            <span>{item.icon}</span>{item.label}<i className="nav-caret" aria-hidden="true">{expandedNav[item.label] ? "-" : "+"}</i>
          </button>
          {expandedNav[item.label] && <div className="nav-submenu" id={`${item.label.toLowerCase()}-submenu`}>
            {item.children.map((child) => <button type="button" className={page === child.page ? "active" : ""} onClick={() => setPage(child.page)} key={child.page}>{child.label}</button>)}
          </div>}
        </div> : <button type="button" className={item.pages.includes(page) ? "active" : ""} onClick={() => setPage(item.page)} key={item.label}><span>{item.icon}</span>{item.label}</button>)}
        <a className="nav-external" href="/support-console/" target="_blank" rel="noreferrer"><span>C</span>Support Console</a>
      </nav>
    </aside>
    <main>
      {page !== "Benchmarking" ? <header><h1>{topLevelLabel(page)}</h1></header> : null}
      <div className="mobile-nav" aria-label="Mobile navigation">{allNav.map(item=><button type="button" className={item.pages.includes(page)?"active":""} onClick={()=>setPage(item.page)} key={item.label}>{item.label}</button>)}<a href="/support-console/" target="_blank" rel="noreferrer">Support Console</a></div>
      {activeSectionChildren.length > 0 && <nav className="group-mobile-subnav" aria-label={`${topLevelLabel(page)} sections`}>{activeSectionChildren.map((child) => <button type="button" className={page === child.page ? "active" : ""} onClick={() => setPage(child.page)} key={child.page}>{child.label}</button>)}</nav>}
      {notice && <div className="notice"><span>✓</span>{notice}</div>}
      {page === "Overview" && <Overview metrics={metrics} distinctTaskBuckets={distinctTaskBuckets} traces={traces} traceJudgeResults={traceJudgeResults} workflowCount={workflows.length} />}
      {page === "Traces" && <Traces traces={traces} traceJudgeResults={traceJudgeResults} />}
      {page === "Distinct Tasks" && <DistinctTasks traces={traces} traceJudgeResults={traceJudgeResults} />}
      {page === "Evals" && <Evals traces={traces} traceJudgeResults={traceJudgeResults} onReviewFilter={(filter) => { setReviewQueueFilter(filter); setPage("Review Queue"); }} />}
      {page === "Golden Dataset" && <GoldenDataset traces={traces} traceJudgeResults={traceJudgeResults} datasets={goldenDatasets} onUpload={addGoldenDataset} onUpdate={updateGoldenDataset} onDelete={deleteGoldenDataset} />}
      {page === "Review Queue" && <ReviewQueue traces={traces} traceJudgeResults={traceJudgeResults} distinctTaskBuckets={distinctTaskBuckets} goldenDatasets={goldenDatasets} filter={reviewQueueFilter} onFilterChange={setReviewQueueFilter} />}
      {page === "Classifier Validation" && <ClassifierValidation signatures={knownDistinctTaskSignatures} />}
      {page === "Simulations" && <Simulations traces={traces} traceJudgeResults={traceJudgeResults} distinctTaskBuckets={distinctTaskBuckets} candidate={candidate} setCandidate={setCandidate} catalogVersion={catalogVersion} activeModels={activeModels} candidateModels={simulationModels} familyApiKeys={familyApiKeys} gatewayApiKeys={gatewayApiKeys} serverGatewayKeys={serverGatewayKeys} />}
      {page === "Benchmarking" && <FrontierModelLab serverGatewayKey={serverGatewayKeys.OpenRouter} />}
      {page === "Recommendations" && <Recommendations policy={policy} activeModels={activeModels} traceCount={traces.length} />}
      {page === "Fine-Tuning" && <FineTuning traces={traces} distinctTaskBuckets={distinctTaskBuckets} traceJudgeResults={traceJudgeResults} datasets={goldenDatasets} jobs={fineTuneJobs} onStartFineTune={startFineTune} onDeployFineTune={deployFineTune} />}
      {page === "Model Catalog" && <ModelCatalog catalogVersion={catalogVersion} familyApiKeys={familyApiKeys} gatewayApiKeys={gatewayApiKeys} onFamilyApiKey={(family,key)=>setFamilyApiKeys(keys=>({...keys,[family]:key}))} onGatewayApiKey={(gateway,key)=>setGatewayApiKeys(keys=>({...keys,[gateway]:key}))} onModelEnabled={(id:string,enabled:boolean)=>{updateModelEnabled(id,enabled);setCatalogVersion(value=>value+1)}} onFamilyEnabled={(family:Model["family"],enabled:boolean)=>{updateFamilyEnabled(family,enabled);setCatalogVersion(value=>value+1)}} onPricing={(id:string,input:number,output:number)=>{updateModelPricing(id,input,output);setCatalogVersion(value=>value+1)}} />}
      {uploadOpen&&<div className="modal-layer" role="presentation" onClick={(event)=>{if(event.target===event.currentTarget)setUploadOpen(false)}}><section className="upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-traces-title"><div className="modal-head"><div><p className="eyebrow">Trace ingestion</p><h2 id="upload-traces-title">Upload traces</h2></div><button type="button" onClick={()=>setUploadOpen(false)} aria-label="Close upload modal">×</button></div><p>Expected columns: id, timestamp, model, prompt, response/messages, input_tokens, output_tokens, latency_ms, cost, optional workflow_id, parent_step, metadata JSON. CSV, JSONL, OpenAI, Anthropic, and LiteLLM-like exports are accepted; unfamiliar headers are normalized where possible.</p><div className="upload-dropzone" onDragOver={(event)=>event.preventDefault()} onDrop={dropUpload}><b>Drop CSV or JSONL here</b><span>or choose a file from your machine</span><label className="upload-choice">Choose file<input type="file" accept=".csv,.json,.jsonl" onChange={(event)=>void upload(event.target.files?.[0])} /></label></div><div className="upload-tools"><button type="button" onClick={()=>downloadTemplate("routelab-trace-template.csv","id,timestamp,model,prompt,response,input_tokens,output_tokens,latency_ms,cost,workflow_id,parent_step,metadata\ntrace_001,2026-06-01T12:00:00Z,gpt-5.5-pro,\"Classify this ticket\",\"intent=billing\",800,120,1800,0.12,workflow_001,root,\"{\\\"task_type\\\":\\\"classification_tagging\\\"}\"\n")}>Download CSV template</button><button type="button" onClick={()=>downloadTemplate("routelab-trace-template.jsonl",JSON.stringify({id:"trace_001",timestamp:"2026-06-01T12:00:00Z",model:"gpt-5.5-pro",prompt_text:"Classify this ticket",response_text:"intent=billing",input_tokens:800,output_tokens:120,latency_ms:1800,cost_usd:.12,workflow_id:"workflow_001",parent_step:"root",metadata:{task_type:"classification_tagging"}})+"\n")}>Download JSONL template</button><button type="button" className="primary" onClick={loadExampleDataset}>Load example dataset</button></div>{uploadErrors.length>0&&<div className="upload-errors"><b>Rows needing attention</b>{uploadErrors.map((error)=><span key={error}>{error}</span>)}</div>}</section></div>}
    </main>
  </div>;
}
