import { useEffect, useMemo, useState } from "react";
import { dashboardMetrics } from "./core/analysis";
import { enabledModels, updateFamilyEnabled, updateModelEnabled, updateModelPricing } from "./core/catalog";
import { createDistinctTaskBuckets } from "./core/distinctTasks";
import { buildWorkflowTrees, ingestText } from "./core/ingestion";
import { recommendPolicy } from "./core/recommendations";
import { createSeedTraces } from "./core/seed";
import { DistinctTasks } from "./pages/DistinctTasks";
import { ModelCatalog } from "./pages/ModelCatalog";
import { Overview } from "./pages/Overview";
import { Recommendations } from "./pages/Recommendations";
import { ReviewQueue } from "./pages/ReviewQueue";
import { Simulations } from "./pages/Simulations";
import { Traces } from "./pages/Traces";
import type { Model, Trace } from "./types";
import type { Page } from "./types/ui";

export default function App() {
  const [page, setPage] = useState<Page>("Overview");
  const [traces, setTraces] = useState<Trace[]>(createSeedTraces);
  const [candidate, setCandidate] = useState("deepseek-r1");
  const [recommendationCandidate, setRecommendationCandidate] = useState("auto");
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [familyApiKeys, setFamilyApiKeys] = useState<Partial<Record<Model["family"], string>>>({});
  const [notice, setNotice] = useState<string | null>("Example dataset loaded locally");
  const activeModels = useMemo(() => enabledModels(), [catalogVersion]);
  const activeModelIds = useMemo(() => activeModels.map((model) => model.id), [activeModels]);
  const distinctTaskBuckets = useMemo(() => createDistinctTaskBuckets(traces), [traces]);
  const metrics = useMemo(() => dashboardMetrics(traces), [traces]);
  const workflows = useMemo(() => buildWorkflowTrees(traces), [traces]);
  const policy = useMemo(() => recommendPolicy(traces, distinctTaskBuckets, recommendationCandidate === "auto" ? activeModelIds : [recommendationCandidate]), [traces, distinctTaskBuckets, recommendationCandidate, activeModelIds, catalogVersion]);
  const nav: Page[] = ["Overview", "Traces", "Distinct Tasks", "Review Queue", "Simulations", "Recommendations", "Model Catalog"];
  const pageLabel = (item: Page) => item;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!activeModels.length) return;
    if (!activeModelIds.includes(candidate)) setCandidate(activeModels[0].id);
    if (recommendationCandidate !== "auto" && !activeModelIds.includes(recommendationCandidate)) setRecommendationCandidate("auto");
  }, [activeModels, activeModelIds, candidate, recommendationCandidate]);

  async function upload(file?: File) {
    if (!file) return;
    const result = ingestText(await file.text(), file.name);
    if (result.traces.length) setTraces(result.traces);
    setNotice(`${result.traces.length} LLM calls loaded · ${result.workflows.length} workflow trees preserved${result.errors.length ? ` · ${result.errors.length} rows need attention` : ""}`);
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
      {page === "Overview" && <Overview metrics={metrics} distinctTaskBuckets={distinctTaskBuckets} traces={traces} workflowCount={workflows.length} policy={policy} />}
      {page === "Traces" && <Traces traces={traces} />}
      {page === "Distinct Tasks" && <DistinctTasks traces={traces} />}
      {page === "Review Queue" && <ReviewQueue traces={traces} distinctTaskBuckets={distinctTaskBuckets} candidate={candidate} />}
      {page === "Simulations" && <Simulations traces={traces} distinctTaskBuckets={distinctTaskBuckets} candidate={candidate} setCandidate={setCandidate} catalogVersion={catalogVersion} activeModels={activeModels} />}
      {page === "Recommendations" && <Recommendations policy={policy} candidate={recommendationCandidate} setCandidate={setRecommendationCandidate} activeModels={activeModels} />}
      {page === "Model Catalog" && <ModelCatalog catalogVersion={catalogVersion} familyApiKeys={familyApiKeys} onFamilyApiKey={(family,key)=>setFamilyApiKeys(keys=>({...keys,[family]:key}))} onModelEnabled={(id:string,enabled:boolean)=>{updateModelEnabled(id,enabled);setCatalogVersion(value=>value+1)}} onFamilyEnabled={(family:Model["family"],enabled:boolean)=>{updateFamilyEnabled(family,enabled);setCatalogVersion(value=>value+1)}} onPricing={(id:string,input:number,output:number)=>{updateModelPricing(id,input,output);setCatalogVersion(value=>value+1)}} />}
    </main>
  </div>;
}
