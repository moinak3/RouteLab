import { useEffect, useMemo, useState } from "react";
import { dashboardMetrics } from "./core/analysis";
import { enabledModels, updateFamilyEnabled, updateModelEnabled, updateModelPricing } from "./core/catalog";
import { createDistinctTaskBuckets } from "./core/distinctTasks";
import { buildWorkflowTrees, ingestText } from "./core/ingestion";
import { recommendPolicy } from "./core/recommendations";
import { createSeedTraces } from "./core/seed";
import { createTraceJudgeResults } from "./core/traceJudge";
import { DistinctTasks } from "./pages/DistinctTasks";
import { Evals } from "./pages/Evals";
import { Home } from "./pages/Home";
import { ModelCatalog } from "./pages/ModelCatalog";
import { Overview } from "./pages/Overview";
import { Recommendations } from "./pages/Recommendations";
import { ReviewQueue } from "./pages/ReviewQueue";
import { Simulations } from "./pages/Simulations";
import { Traces } from "./pages/Traces";
import type { GatewayProvider, Model, Trace, TraceJudgeResult } from "./types";
import type { Page, ReviewQueueFilter } from "./types/ui";

const initialTraces = createSeedTraces();
const DEEPSEEK_RECOMMENDATION_SCOPE = "deepseek_family";
const APP_PASSWORD = "Mochinder";

export default function App() {
  const [page, setPage] = useState<Page>("Home");
  const [traces, setTraces] = useState<Trace[]>(initialTraces);
  const [traceJudgeResults, setTraceJudgeResults] = useState<TraceJudgeResult[]>(() => createTraceJudgeResults(initialTraces));
  const [candidate, setCandidate] = useState("deepseek-r1");
  const [recommendationCandidate, setRecommendationCandidate] = useState(DEEPSEEK_RECOMMENDATION_SCOPE);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [familyApiKeys, setFamilyApiKeys] = useState<Partial<Record<Model["family"], string>>>({});
  const [gatewayApiKeys, setGatewayApiKeys] = useState<Partial<Record<GatewayProvider, string>>>({});
  const [serverGatewayKeys, setServerGatewayKeys] = useState<Partial<Record<GatewayProvider, boolean>>>({});
  const [reviewQueueFilter, setReviewQueueFilter] = useState<ReviewQueueFilter>("all");
  const [notice, setNotice] = useState<string | null>("Example dataset loaded locally");
  const activeModels = useMemo(() => enabledModels(), [catalogVersion]);
  const activeModelIds = useMemo(() => activeModels.map((model) => model.id), [activeModels]);
  const distinctTaskBuckets = useMemo(() => createDistinctTaskBuckets(traces), [traces]);
  const metrics = useMemo(() => dashboardMetrics(traces), [traces]);
  const workflows = useMemo(() => buildWorkflowTrees(traces), [traces]);
  const deepSeekModelIds = useMemo(() => activeModels.filter((model) => model.family === "DeepSeek").map((model) => model.id), [activeModels]);
  const recommendationCandidateIds = useMemo(() => recommendationCandidate === DEEPSEEK_RECOMMENDATION_SCOPE ? deepSeekModelIds : [recommendationCandidate], [recommendationCandidate, deepSeekModelIds]);
  const policy = useMemo(() => recommendPolicy(traces, distinctTaskBuckets, recommendationCandidateIds.length ? recommendationCandidateIds : activeModelIds), [traces, distinctTaskBuckets, recommendationCandidateIds, activeModelIds, catalogVersion]);
  const nav: Page[] = ["Overview", "Traces", "Distinct Tasks", "Evals", "Simulations", "Recommendations", "Model Catalog", "Review Queue"];
  const pageLabel = (item: Page) => item;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    if (!activeModels.length) return;
    if (!activeModelIds.includes(candidate)) setCandidate(activeModels[0].id);
    if (recommendationCandidate !== DEEPSEEK_RECOMMENDATION_SCOPE && !activeModelIds.includes(recommendationCandidate)) setRecommendationCandidate(DEEPSEEK_RECOMMENDATION_SCOPE);
  }, [activeModels, activeModelIds, candidate, recommendationCandidate]);

  async function upload(file?: File) {
    if (!file) return;
    const result = ingestText(await file.text(), file.name);
    if (result.traces.length) {
      setTraces(result.traces);
      setTraceJudgeResults(createTraceJudgeResults(result.traces));
    }
    setNotice(`${result.traces.length} LLM calls loaded · ${result.workflows.length} workflow trees preserved${result.errors.length ? ` · ${result.errors.length} rows need attention` : ""}`);
  }

  function enterApp(password: string) {
    if (password === APP_PASSWORD) {
      setPage("Overview");
      return true;
    }
    return false;
  }

  if (page === "Home") {
    return <Home onGetStarted={enterApp} />;
  }

  return <div className="shell">
    <aside>
      <div className="brand"><span className="brandmark">R</span><div><b>RouteLab</b><small>Routing intelligence</small></div></div>
      <nav>{nav.map((item) => <button className={page === item ? "active" : ""} onClick={() => setPage(item)} key={item}><span>{item[0]}</span>{pageLabel(item)}</button>)}</nav>
      <div className="privacy"><span className="pulse" /><b>Local mode</b><small>External models disabled</small></div>
    </aside>
    <main>
      <header><div><p className="eyebrow">Intelligent model simulations - the right model to tradeoff cost, quality and latency for your business</p><h1>{pageLabel(page)}</h1></div><div className="actions"><label className="upload">Upload traces<input type="file" accept=".csv,.json,.jsonl" onChange={(event) => upload(event.target.files?.[0])} /></label><button className="primary" onClick={() => setPage("Simulations")}>Run simulation</button></div></header>
      <div className="mobile-nav" aria-label="Mobile navigation">{nav.map(item=><button type="button" className={page===item?"active":""} onClick={()=>setPage(item)} key={item}>{pageLabel(item)}</button>)}</div>
      {notice && <div className="notice"><span>✓</span>{notice}</div>}
      {page === "Overview" && <Overview metrics={metrics} distinctTaskBuckets={distinctTaskBuckets} traces={traces} traceJudgeResults={traceJudgeResults} workflowCount={workflows.length} policy={policy} />}
      {page === "Traces" && <Traces traces={traces} traceJudgeResults={traceJudgeResults} />}
      {page === "Distinct Tasks" && <DistinctTasks traces={traces} />}
      {page === "Evals" && <Evals traces={traces} traceJudgeResults={traceJudgeResults} onReviewFilter={(filter) => { setReviewQueueFilter(filter); setPage("Review Queue"); }} />}
      {page === "Review Queue" && <ReviewQueue traces={traces} traceJudgeResults={traceJudgeResults} distinctTaskBuckets={distinctTaskBuckets} candidate={candidate} filter={reviewQueueFilter} onFilterChange={setReviewQueueFilter} />}
      {page === "Simulations" && <Simulations traces={traces} traceJudgeResults={traceJudgeResults} distinctTaskBuckets={distinctTaskBuckets} candidate={candidate} setCandidate={setCandidate} catalogVersion={catalogVersion} activeModels={activeModels} familyApiKeys={familyApiKeys} gatewayApiKeys={gatewayApiKeys} serverGatewayKeys={serverGatewayKeys} />}
      {page === "Recommendations" && <Recommendations policy={policy} activeModels={activeModels} traceCount={traces.length} />}
      {page === "Model Catalog" && <ModelCatalog catalogVersion={catalogVersion} familyApiKeys={familyApiKeys} gatewayApiKeys={gatewayApiKeys} onFamilyApiKey={(family,key)=>setFamilyApiKeys(keys=>({...keys,[family]:key}))} onGatewayApiKey={(gateway,key)=>setGatewayApiKeys(keys=>({...keys,[gateway]:key}))} onModelEnabled={(id:string,enabled:boolean)=>{updateModelEnabled(id,enabled);setCatalogVersion(value=>value+1)}} onFamilyEnabled={(family:Model["family"],enabled:boolean)=>{updateFamilyEnabled(family,enabled);setCatalogVersion(value=>value+1)}} onPricing={(id:string,input:number,output:number)=>{updateModelPricing(id,input,output);setCatalogVersion(value=>value+1)}} />}
    </main>
  </div>;
}
