import { useEffect, useMemo, useState, type Dispatch, type FocusEvent, type MouseEvent, type ReactNode, type SetStateAction } from "react";
import { dashboardMetrics } from "./core/analysis";
import { benchmarkFamilies, buildBenchmarkPriorRecommendation } from "./core/benchmarkPriors";
import { enabledModels, isModelEnabled, modelCatalog, modelFamilies, updateFamilyEnabled, updateModelEnabled, updateModelPricing } from "./core/catalog";
import { buildWorkflowTrees, ingestText } from "./core/ingestion";
import { generateEvalPlans } from "./core/evalPlans";
import { exportLiteLlm, exportOpenRouterConfig, exportPolicyJson, exportTypeScript, recommendPolicy } from "./core/recommendations";
import { buildReviewQueue } from "./core/reviewQueue";
import { createSeedTraces } from "./core/seed";
import { familyCascade, MONTHLY_MULTIPLIER, monthlyDistinctTaskBreakdown, replay } from "./core/simulations";
import { filterTracesByRange, monthlyBuckets, type DateRange, type MonthlyBucket } from "./core/time";
import { createDistinctTaskBuckets } from "./core/distinctTasks";
import type { EvalPlan, DistinctTaskField, Trace, DistinctTaskBucket } from "./types";
import type { Model } from "./types";

type Page = "Overview" | "Traces" | "Distinct Tasks" | "Review Queue" | "Simulations" | "Recommendations" | "Model Catalog";
type ReviewDecision = "approve" | "reject" | "escalate" | "skip";
const money = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
const pct = (value: number) => `${value.toFixed(1)}%`;
const preview = (value = "", length = 360) => value.length > length ? `${value.slice(0, length).trim()}...` : value;
function FamilyLogo({family}:{family:Model["family"]}) {
  if(family==="OpenAI")return <img src="/openai-logo.png" alt="OpenAI logo" />;
  if(family==="Claude")return <svg viewBox="0 0 64 64" role="img" aria-label="Claude logo"><path d="M32 8 53 56H42l-4-10H25l-4 10H11L32 8Zm-4 29h7l-3-9-4 9Z" fill="currentColor"/></svg>;
  if(family==="Gemini")return <svg viewBox="0 0 64 64" role="img" aria-label="Gemini logo"><path d="M32 6c3 15 11 23 26 26-15 3-23 11-26 26-3-15-11-23-26-26 15-3 23-11 26-26Z" fill="currentColor"/></svg>;
  if(family==="Mistral")return <svg viewBox="0 0 64 64" role="img" aria-label="Mistral logo"><path d="M10 16h9v9h8v-9h10v9h8v-9h9v32h-9V32h-8v16H27V32h-8v16h-9V16Z" fill="currentColor"/></svg>;
  if(family==="DeepSeek")return <svg viewBox="0 0 64 64" role="img" aria-label="DeepSeek logo"><path d="M11 36c0-14 11-25 25-25 9 0 16 4 21 11-5-2-10-2-14 1-5 3-6 9-3 14 2 4 6 6 11 6-5 6-12 10-21 10-11 0-19-7-19-17Z" fill="currentColor"/><circle cx="38" cy="30" r="4" fill="#fff"/></svg>;
  return <svg viewBox="0 0 64 64" role="img" aria-label="Local model logo"><path d="M14 16h36v26H14V16Zm9 34h18M28 42v8m8-8v8" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
const distinctTaskHelp: Record<string,string> = {
  task_type:"What kind of work the model performs, such as extraction, summarization, support answering, code review, or planning_strategy_recommendations.",
  domain:"The business or knowledge area involved, such as billing, legal, engineering, marketing, or healthcare.",
  complexity:"Estimated semantic and reasoning difficulty: low, medium, or high. Input/output size contributes, but dense domains, multi-step reasoning, tools, grounding, constraints, repetition, and optional embedding or LLM difficulty scores can outweigh it.",
  temporal_context:"Whether this is a single-turn request, an early multi-turn exchange, or a later turn where accumulated context and instruction drift become important.",
  tool_use:"Whether tools were used and whether they succeeded, recovered from failure, or failed.",
  output_uncertainty:"How much uncertainty the model expresses in its output. Low uncertainty means a confident answer; high uncertainty means substantial hedging or inability to confirm.",
  output_format:"The expected response structure, such as natural language, JSON, SQL, code, a table, or a classification_tagging label.",
  grounding_requirement:"What evidence the answer must rely on, such as provided context, retrieved sources, policy, or tool results.",
};
function DistinctTaskHelp({field,label}:{field:keyof typeof distinctTaskHelp;label:string}){
  const [tooltip,setTooltip]=useState<{left:number;top:number}|null>(null);
  const showTooltip=(event:MouseEvent<HTMLElement>|FocusEvent<HTMLElement>)=>{
    const rect=event.currentTarget.getBoundingClientRect();
    const width=300;
    setTooltip({
      left:Math.min(Math.max(12,rect.left),window.innerWidth-width-12),
      top:rect.bottom+10,
    });
  };
  return <span className="task-help" tabIndex={0} onMouseEnter={showTooltip} onMouseLeave={()=>setTooltip(null)} onFocus={showTooltip} onBlur={()=>setTooltip(null)} onClick={showTooltip}>{label}<i>?</i>{tooltip&&<em className="task-help-tooltip" role="tooltip" style={{left:tooltip.left,top:tooltip.top}}>{distinctTaskHelp[field]}</em>}</span>
}
const distinctTaskFieldColumns: Array<{ field: DistinctTaskField; label: string }> = [
  { field: "task_type", label: "Task type" },
  { field: "domain", label: "Domain" },
  { field: "complexity", label: "Complexity" },
  { field: "temporal_context", label: "Session" },
  { field: "tool_use", label: "Tools" },
  { field: "output_uncertainty", label: "Uncertainty" },
  { field: "output_format", label: "Output" },
  { field: "grounding_requirement", label: "Grounding" },
];
type DistinctTaskSortKey = "bucket_name" | DistinctTaskField | "trace_count" | "total_cost_usd" | "avg_confidence" | "eval_plan";
type TraceSortKey = "trace" | "model" | "prompt" | "response" | "tokens" | "latency" | "cost" | "status";
type SortDirection = "asc" | "desc";
const distinctTaskValue = (field: DistinctTaskField, value: unknown) => {
  const normalized = String(value).replaceAll(" ", "_");
  const suffixes: Record<DistinctTaskField, string> = {
    task_type: "task",
    domain: "domain",
    complexity: "complexity",
    temporal_context: "session",
    tool_use: "tool_use",
    output_uncertainty: "uncertainty",
    output_format: "output",
    grounding_requirement: "grounding",
  };
  return `${normalized}_${suffixes[field]}`;
};
const compareText = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
const download = (name: string, content: string) => {
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  link.download = name; link.click(); URL.revokeObjectURL(link.href);
};

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
      {page === "Model Catalog" && <Catalog catalogVersion={catalogVersion} familyApiKeys={familyApiKeys} onFamilyApiKey={(family,key)=>setFamilyApiKeys(keys=>({...keys,[family]:key}))} onModelEnabled={(id:string,enabled:boolean)=>{updateModelEnabled(id,enabled);setCatalogVersion(value=>value+1)}} onFamilyEnabled={(family:Model["family"],enabled:boolean)=>{updateFamilyEnabled(family,enabled);setCatalogVersion(value=>value+1)}} onPricing={(id:string,input:number,output:number)=>{updateModelPricing(id,input,output);setCatalogVersion(value=>value+1)}} />}
    </main>
  </div>;
}

function Overview({ metrics, distinctTaskBuckets, traces, workflowCount, policy }: { metrics: ReturnType<typeof dashboardMetrics>; distinctTaskBuckets: DistinctTaskBucket[]; traces: Trace[]; workflowCount: number; policy: ReturnType<typeof recommendPolicy> }) {
  const [segmentType,setSegmentType]=useState<"all"|"model"|"task">("all");
  const [segmentValue,setSegmentValue]=useState("all");
  const max = Math.max(...Object.values(metrics.byModel).map((item) => item.cost));
  const activeRules=policy.rules.filter(rule=>rule.strategy.type!=="keep_current").length;
  const protectedRules=policy.rules.length-activeRules;
  const rejectedAlternatives=policy.rules.filter(rule=>rule.rejected_alternative).length;
  const segmentOptions=useMemo(()=>segmentType==="model"?[...new Set(traces.map(trace=>trace.model))].sort():segmentType==="task"?distinctTaskBuckets.map(bucket=>bucket.bucket_id):[],[segmentType,traces,distinctTaskBuckets]);
  const chartSeries=useMemo(()=>{
    if(segmentType==="all") return [{name:"All traffic",buckets:monthlyBuckets(traces)}];
    const selected=segmentValue==="all"?segmentOptions:[segmentValue];
    return selected.map(value=>({name:segmentType==="task"?distinctTaskBuckets.find(bucket=>bucket.bucket_id===value)?.bucket_name??value:value,buckets:monthlyBuckets(traces.filter(trace=>segmentType==="model"?trace.model===value:distinctTaskBuckets.find(bucket=>bucket.bucket_id===value)?.traces.includes(trace.id))) }));
  },[traces,distinctTaskBuckets,segmentType,segmentValue,segmentOptions]);
  useEffect(()=>{setSegmentValue("all")},[segmentType]);
  return <><section className="hero exec-hero"><div className="exec-copy"><p className="eyebrow">Executive summary</p><h2>Potential safe savings</h2><strong>{money(policy.estimated_monthly_savings_usd)}<small>/mo</small></strong><p>Guardrail-approved routing policy after quality, latency, risk, tool-use, and uncertainty checks.</p></div><div className="exec-kpis"><article><small>Readiness score</small><b>82/100</b><span>Policy is deployable with eval-backed guardrails.</span></article><article><small>Routing changes</small><b>{activeRules}/{policy.rules.length}</b><span>Distinct Tasks can safely move or cascade.</span></article><article><small>Protected workloads</small><b>{protectedRules}</b><span>High-risk or unresolved failure buckets stay current.</span></article><article><small>Rejected savings</small><b>{rejectedAlternatives}</b><span>Cheap options blocked by latency or quality guardrails.</span></article></div></section>
    <section className="stats">{[
      ["LLM calls", metrics.totalRequests.toLocaleString(), `${workflowCount} workflow trees`], ["Current spend", money(metrics.totalCost), "Observed sample"],
      ["Total tokens", (metrics.inputTokens + metrics.outputTokens).toLocaleString(), `${metrics.inputTokens.toLocaleString()} input`], ["Average latency", `${metrics.averageLatency.toFixed(0)}ms`, `p95 ${metrics.p95Latency}ms`],
    ].map(([label, value, hint]) => <article className="stat" key={label}><p>{label}</p><b>{value}</b><small>{hint}</small></article>)}</section>
    <section className="panel trend-panel"><div className="panelhead"><div><p className="eyebrow">Six-month traffic trend</p><h2>Monthly LLM usage and spend</h2></div><div className="trend-filters"><select aria-label="Segment charts by" value={segmentType} onChange={event=>setSegmentType(event.target.value as "all"|"model"|"task")}><option value="all">All traffic</option><option value="model">Segment by model</option><option value="task">Segment by Distinct Task</option></select>{segmentType!=="all"&&<select aria-label={`Select ${segmentType}`} value={segmentValue} onChange={event=>setSegmentValue(event.target.value)}><option value="all">All</option>{segmentOptions.map(option=><option value={option} key={option}>{segmentType==="task"?distinctTaskBuckets.find(bucket=>bucket.bucket_id===option)?.bucket_name:option}</option>)}</select>}</div></div><div className="trend-grid"><LineChart title="LLM calls" series={chartSeries} metric="calls" format={value=>value.toLocaleString()} /><LineChart title="Spend" series={chartSeries} metric="spend" format={money} /><LineChart title="Total tokens" series={chartSeries} metric="tokens" format={value=>value.toLocaleString()} /></div></section>
    <section className="grid two"><article className="panel"><div className="panelhead"><div><p className="eyebrow">Spend analysis</p><h2>Cost by model</h2></div><span>Current traffic</span></div><div className="bars">{Object.entries(metrics.byModel).sort((a,b)=>b[1].cost-a[1].cost).map(([model, item]) => <div className="barrow" key={model}><div><b>{model}</b><span>{money(item.cost)}</span></div><div className="bar"><i style={{ width: `${item.cost / max * 100}%` }} /></div></div>)}</div></article>
    <article className="panel"><div className="panelhead"><div><p className="eyebrow">Workload map</p><h2>Top Distinct Tasks</h2></div><span>{distinctTaskBuckets.length} tasks</span></div>{[...distinctTaskBuckets].sort((a,b)=>b.total_cost_usd-a.total_cost_usd).slice(0,8).map((bucket) => <div className="clusterrow" key={bucket.bucket_id}><span className={`risk ${bucket.risk_level}`}>{bucket.risk_level}</span><div><b>{bucket.bucket_name}</b><small>{bucket.trace_count.toLocaleString()} traces · {pct(bucket.avg_confidence*100)} confidence</small></div><strong>{money(bucket.total_cost_usd)}</strong></div>)}</article></section>
    <section className="panel"><div className="panelhead"><div><p className="eyebrow">Cost outliers</p><h2>Most expensive traces</h2></div></div><TraceTable traces={[...traces].sort((a,b)=>(b.cost_usd??0)-(a.cost_usd??0)).slice(0,5)} /></section></>;
}
const chartColors=["#79bf49","#385c9a","#dc8b3f","#8a63b8","#cf5f75","#389892","#a6883d","#697f73"];
function LineChart({title,series,metric,format}:{title:string;series:Array<{name:string;buckets:MonthlyBucket[]}>;metric:"calls"|"spend"|"tokens";format:(value:number)=>string}) {
  const [hoverIndex,setHoverIndex]=useState<number|null>(null);
  const allValues=series.flatMap(item=>item.buckets.map(bucket=>bucket[metric])); const high=Math.max(...allValues,1); const width=360; const height=130; const pad=18;
  const labels=series[0]?.buckets??[]; const total=allValues.reduce((sum,value)=>sum+value,0);
  const hoverX=hoverIndex===null?null:labels.length===1?width/2:pad+hoverIndex*(width-pad*2)/(labels.length-1);
  const handleMove=(event:MouseEvent<SVGSVGElement>)=>{if(!labels.length)return;const rect=event.currentTarget.getBoundingClientRect();const x=(event.clientX-rect.left)/rect.width*width;const index=labels.length===1?0:Math.round((x-pad)/(width-pad*2)*(labels.length-1));setHoverIndex(Math.max(0,Math.min(labels.length-1,index)))};
  return <article className="trend-chart" onMouseLeave={()=>setHoverIndex(null)}><div><b>{title}</b><strong>{format(total)}</strong></div><div className="chart-stage"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} monthly line chart`} onMouseMove={handleMove}><line x1={pad} y1={height-pad} x2={width-pad} y2={height-pad} className="chart-axis" />{series.map((item,seriesIndex)=>{const points=item.buckets.map((bucket,index)=>({bucket,x:item.buckets.length===1?width/2:pad+index*(width-pad*2)/(item.buckets.length-1),y:height-pad-bucket[metric]/high*(height-pad*2)}));return <g key={item.name}><polyline points={points.map(point=>`${point.x},${point.y}`).join(" ")} className="chart-line" style={{stroke:chartColors[seriesIndex%chartColors.length]}} />{points.map((point,index)=><circle key={point.bucket.key} cx={point.x} cy={point.y} r={hoverIndex===index?"5":"3"} className="chart-point" style={{fill:chartColors[seriesIndex%chartColors.length]}} />)}</g>})}{hoverX!==null&&<line x1={hoverX} y1={pad} x2={hoverX} y2={height-pad} className="chart-hover-line" />}{labels.map((bucket,index)=><text key={bucket.key} x={labels.length===1?width/2:pad+index*(width-pad*2)/(labels.length-1)} y={height-3} textAnchor="middle">{bucket.label}</text>)}</svg>{hoverIndex!==null&&<div className="chart-tooltip" style={{left:`${hoverX!/width*100}%`}}><b>{labels[hoverIndex]?.label}</b>{series.map((item,index)=><span key={item.name}><i style={{background:chartColors[index%chartColors.length]}} /><em>{item.name}</em><strong>{format(item.buckets[hoverIndex]?.[metric]??0)}</strong></span>)}</div>}</div>{series.length>1&&<div className="chart-legend">{series.map((item,index)=><span key={item.name}><i style={{background:chartColors[index%chartColors.length]}} />{item.name}</span>)}</div>}</article>;
}
function TraceTable({ traces, onSelect, sort, onSort }: { traces: Trace[]; onSelect?: (trace: Trace) => void; sort?: { key: TraceSortKey; direction: SortDirection }; onSort?: (key: TraceSortKey) => void }) {
  const header = (label: string, key: TraceSortKey) => sort && onSort ? <SortHeader label={label} sortKey={key} activeKey={sort.key} direction={sort.direction} onSort={onSort} /> : <th>{label}</th>;
  return <div className="tablewrap"><table><thead><tr>{header("Trace","trace")}{header("Model","model")}{header("Prompt","prompt")}{header("Response snapshot","response")}{header("Tokens","tokens")}{header("Latency","latency")}{header("Cost","cost")}{header("Status","status")}</tr></thead><tbody>{traces.map((trace) => <tr className={onSelect ? "trace-row" : ""} key={trace.id} tabIndex={onSelect ? 0 : undefined} onClick={() => onSelect?.(trace)} onKeyDown={(event) => { if (onSelect && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(trace); } }}><td>{onSelect?<span className="trace-id-action"><code>{trace.id.slice(-15)}</code><button className="trace-details-button" aria-haspopup="dialog" aria-label={`View details for ${trace.id}`} onClick={(event)=>{event.stopPropagation();onSelect(trace)}}>View details</button></span>:<code>{trace.id.slice(-15)}</code>}</td><td>{trace.model}</td><td className="prompt">{trace.prompt_text}</td><td className="response-snapshot">{trace.response_text || "No response captured"}</td><td>{trace.total_tokens}</td><td>{trace.latency_ms}ms</td><td>{money(trace.cost_usd ?? 0)}</td><td><span className={`status ${trace.status}`}>{trace.status}</span></td></tr>)}</tbody></table></div>;
}
function TraceDrawer({ trace, onClose }: { trace: Trace | null; onClose: () => void }) {
  useEffect(() => {
    if (!trace) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("keydown", closeOnEscape); document.body.style.overflow = previousOverflow; };
  }, [trace, onClose]);
  const messages=trace?.messages??[];
  const facts = trace ? [["Model", trace.model || "unknown"], ["Provider", trace.provider ?? "other"], ["Role", trace.workflow_role ?? "unclassified"], ["Status", trace.status ?? "unknown"], ["Input tokens", Number(trace.input_tokens ?? 0).toLocaleString()], ["Output tokens", Number(trace.output_tokens ?? 0).toLocaleString()], ["Latency", `${trace.latency_ms ?? 0}ms`], ["Cost", money(trace.cost_usd ?? 0)]] : [];
  return <div className={`drawer-layer ${trace?"open":""}`} aria-hidden={!trace} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="trace-drawer" role="dialog" aria-modal="true" aria-label="Trace details"><div className="drawer-head"><div><p className="eyebrow">Trace details</p><h2>{trace?.id??"Select a trace"}</h2><span>{trace?.timestamp??""}</span></div><button aria-label="Close trace details" onClick={onClose}>×</button></div>{trace&&<div className="drawer-body"><section className="drawer-facts">{facts.map(([label,value])=><div key={label}><small>{label}</small><b>{value}</b></div>)}</section><section className="drawer-section"><p className="eyebrow">Workflow context</p><div className="workflow-path"><span>{trace.workflow_id ?? "Standalone call"}</span><b>{trace.span_name ?? trace.node_id ?? trace.id}</b><small>{trace.parent_node_id ? `Parent: ${trace.parent_node_id}` : "Root node"}</small></div></section><section className="drawer-section"><p className="eyebrow">Prompt</p><pre>{trace.prompt_text || "No prompt captured"}</pre></section><section className="drawer-section"><p className="eyebrow">Response</p><pre>{trace.response_text || "No response captured"}</pre></section><section className="drawer-section"><p className="eyebrow">Messages</p>{messages.length?messages.map((message,index)=><div className="message" key={`${message.role}-${index}`}><b>{message.role}</b><span>{message.content}</span></div>):<pre>No messages captured</pre>}</section><section className="drawer-section"><p className="eyebrow">Metadata</p><pre>{JSON.stringify(trace.metadata ?? {}, null, 2)}</pre></section></div>}</aside></div>;
}
function Traces({ traces }: { traces: Trace[] }) {
  const [query,setQuery]=useState("");
  const [promptQuery,setPromptQuery]=useState("");
  const [modelFilter,setModelFilter]=useState("all");
  const [sort,setSort]=useState<{key:TraceSortKey;direction:SortDirection}>({key:"trace",direction:"asc"});
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const selected=traces.find(trace=>trace.id===selectedId)??null;
  const modelOptions=useMemo(()=>[...new Set(traces.map(trace=>trace.model))].sort(compareText),[traces]);
  const shown=useMemo(()=>{
    const globalNeedle=query.trim().toLowerCase();
    const promptNeedle=promptQuery.trim().toLowerCase();
    return traces.filter(trace=>{
      const globalMatch=!globalNeedle||`${trace.id} ${trace.model} ${trace.prompt_text} ${trace.response_text ?? ""} ${trace.status} ${trace.provider ?? ""}`.toLowerCase().includes(globalNeedle);
      const promptMatch=!promptNeedle||trace.prompt_text.toLowerCase().includes(promptNeedle);
      const modelMatch=modelFilter==="all"||trace.model===modelFilter;
      return globalMatch&&promptMatch&&modelMatch;
    });
  },[traces,query,promptQuery,modelFilter]);
  const displayed=useMemo(()=>shown.slice(0,500).sort((left,right)=>{
    const multiplier=sort.direction==="asc"?1:-1;
    let result=0;
    if(sort.key==="trace") result=compareText(left.id,right.id);
    else if(sort.key==="model") result=compareText(left.model,right.model);
    else if(sort.key==="prompt") result=compareText(left.prompt_text,right.prompt_text);
    else if(sort.key==="response") result=compareText(left.response_text ?? "",right.response_text ?? "");
    else if(sort.key==="tokens") result=left.total_tokens-right.total_tokens;
    else if(sort.key==="latency") result=(left.latency_ms ?? 0)-(right.latency_ms ?? 0);
    else if(sort.key==="cost") result=(left.cost_usd ?? 0)-(right.cost_usd ?? 0);
    else result=compareText(left.status,right.status);
    return result===0?compareText(left.id,right.id):result*multiplier;
  }),[shown,sort]);
  const updateSort=(key:TraceSortKey)=>setSort(current=>current.key===key?{key,direction:current.direction==="asc"?"desc":"asc"}:{key,direction:key==="trace"||key==="model"||key==="prompt"||key==="response"||key==="status"?"asc":"desc"});
  const clearFilters=()=>{setQuery("");setPromptQuery("");setModelFilter("all")};
  return <div className="traces-page"><section className="panel"><div className="panelhead trace-panelhead"><div><p className="eyebrow">Normalized traffic</p><h2>{shown.length.toLocaleString()} traces</h2><small className="table-limit">Showing {displayed.length.toLocaleString()} of {shown.length.toLocaleString()} matching traces · sorting applies to this visible page · click any row to inspect it</small></div><div className="trace-filter-bar"><input className="search" placeholder="Search all trace fields" value={query} onChange={event=>setQuery(event.target.value)} aria-label="Search all trace fields" /><input className="search" placeholder="Search prompt only" value={promptQuery} onChange={event=>setPromptQuery(event.target.value)} aria-label="Search prompt text only" /><select value={modelFilter} onChange={event=>setModelFilter(event.target.value)} aria-label="Filter by model"><option value="all">All models</option>{modelOptions.map(model=><option value={model} key={model}>{model}</option>)}</select><button type="button" onClick={clearFilters}>Clear</button></div></div><TraceTable traces={displayed} sort={sort} onSort={updateSort} onSelect={trace=>setSelectedId(trace.id)} /></section><TraceDrawer trace={selected} onClose={()=>setSelectedId(null)} /></div>;
}
function SortHeader<T extends string>({label,sortKey,activeKey,direction,onSort,children}:{label:string;sortKey:T;activeKey:T;direction:SortDirection;onSort:(key:T)=>void;children?:ReactNode}){
  const active=activeKey===sortKey;
  return <th aria-sort={active?(direction==="asc"?"ascending":"descending"):"none"}><button type="button" className={`sort-header ${active?"active":""}`} onClick={()=>onSort(sortKey)}><span>{children??label}</span><i aria-hidden="true">{active?(direction==="asc"?"↑":"↓"):"↕"}</i></button></th>;
}
function DistinctTasks({traces}:{traces:Trace[]}){
  const buckets=useMemo(()=>createDistinctTaskBuckets(traces),[traces]); const plans=useMemo(()=>generateEvalPlans(buckets),[buckets]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [sort,setSort]=useState<{key:DistinctTaskSortKey;direction:SortDirection}>({key:"trace_count",direction:"desc"});
  const sortedBuckets=useMemo(()=>[...buckets].sort((left,right)=>{
    const multiplier=sort.direction==="asc"?1:-1;
    let result=0;
    if(sort.key==="bucket_name") result=compareText(left.bucket_name,right.bucket_name);
    else if(sort.key==="trace_count") result=left.trace_count-right.trace_count;
    else if(sort.key==="total_cost_usd") result=left.total_cost_usd-right.total_cost_usd;
    else if(sort.key==="avg_confidence") result=left.avg_confidence-right.avg_confidence;
    else if(sort.key==="eval_plan") result=compareText(plans.get(left.bucket_id)?.human_review_required?"human review required":"ready",plans.get(right.bucket_id)?.human_review_required?"human review required":"ready");
    else result=compareText(distinctTaskValue(sort.key,left.task[sort.key]),distinctTaskValue(sort.key,right.task[sort.key]));
    return result===0?compareText(left.bucket_id,right.bucket_id):result*multiplier;
  }),[buckets,plans,sort]);
  const updateSort=(key:DistinctTaskSortKey)=>setSort(current=>current.key===key?{key,direction:current.direction==="asc"?"desc":"asc"}:{key,direction:key==="bucket_name"||distinctTaskFieldColumns.some(column=>column.field===key)?"asc":"desc"});
  const selected=buckets.find(bucket=>bucket.bucket_id===selectedId)??null; const plan=selected?plans.get(selected.bucket_id):undefined;
  return <><section className="task-intro panel"><div><p className="eyebrow">Core intelligence layer</p><h2>Traces → Distinct Tasks → Eval Plans</h2><p>RouteLab infers what each trace is, groups exact matching tasks, then recommends the evidence required before routing changes.</p></div><div><strong>{buckets.length}</strong><span>exact task buckets</span></div></section><section className="panel task-table-panel"><div className="panelhead"><div><p className="eyebrow">Exact workload tasks</p><h2>Distinct Task buckets</h2></div><span>{traces.length.toLocaleString()} traces classified</span></div><div className="tablewrap"><table className="task-table"><thead><tr><SortHeader label="Bucket name" sortKey="bucket_name" activeKey={sort.key} direction={sort.direction} onSort={updateSort} />{distinctTaskFieldColumns.map(({field,label})=><SortHeader key={field} label={label} sortKey={field} activeKey={sort.key} direction={sort.direction} onSort={updateSort}><DistinctTaskHelp field={field} label={label} /></SortHeader>)}<SortHeader label="Traces" sortKey="trace_count" activeKey={sort.key} direction={sort.direction} onSort={updateSort} /><SortHeader label="Total cost" sortKey="total_cost_usd" activeKey={sort.key} direction={sort.direction} onSort={updateSort} /><SortHeader label="Confidence" sortKey="avg_confidence" activeKey={sort.key} direction={sort.direction} onSort={updateSort} /><SortHeader label="Eval plan" sortKey="eval_plan" activeKey={sort.key} direction={sort.direction} onSort={updateSort} /></tr></thead><tbody>{sortedBuckets.map(bucket=><tr className="task-row" key={bucket.bucket_id} tabIndex={0} onClick={()=>setSelectedId(bucket.bucket_id)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();setSelectedId(bucket.bucket_id)}}}><td><b>{bucket.bucket_name}</b><small>{bucket.bucket_id}</small></td>{distinctTaskFieldColumns.map(({field})=><td key={field}>{distinctTaskValue(field,bucket.task[field])}</td>)}<td>{bucket.trace_count.toLocaleString()}</td><td>{money(bucket.total_cost_usd)}</td><td>{pct(bucket.avg_confidence*100)}</td><td><span className="eval-ready">Ready</span></td></tr>)}</tbody></table></div></section>{selected&&plan&&<DistinctTaskDetail bucket={selected} plan={plan} onClose={()=>setSelectedId(null)} />}</>;
}
function DistinctTaskDetail({bucket,plan,onClose}:{bucket:DistinctTaskBucket;plan:EvalPlan;onClose:()=>void}){
  const groups=[["Required",plan.required_evals],["Recommended",plan.recommended_evals],["Optional",plan.optional_evals]] as const;
  const benchmarkOutput=useMemo(()=>buildBenchmarkPriorRecommendation(bucket.task),[bucket.task]);
  const familyName=(id:string)=>benchmarkFamilies.find(family=>family.id===id)?.name??id.replaceAll("_"," ");
  return <div className="task-detail-layer" onClick={event=>{if(event.target===event.currentTarget)onClose()}}><aside className="task-detail" role="dialog" aria-modal="true" aria-label="Distinct Task bucket detail"><div className="task-detail-head"><div><p className="eyebrow">Distinct Task bucket</p><h2>{bucket.bucket_name}</h2><span>{bucket.bucket_id} · {bucket.trace_count.toLocaleString()} traces</span></div><button aria-label="Close task detail" onClick={onClose}>×</button></div><div className="task-detail-body"><section><div className="task-actions"><button>Confirm task</button><button>Edit task</button><button>Split bucket</button><button>Create eval set</button><button className="primary">Run simulation</button></div><h3>Distinct Task summary</h3><div className="task-summary">{distinctTaskFieldColumns.map(({field,label})=><div key={field}><small><DistinctTaskHelp field={field} label={label} /></small><b>{distinctTaskValue(field,bucket.task[field])}</b></div>)}</div></section><section><h3>Top evidence</h3><div className="evidence-list">{Object.entries(bucket.evidence).map(([field,evidence])=><div key={field}><b>{field.replaceAll("_"," ")}</b><span>{evidence.join(" · ")}</span></div>)}</div></section><section className="benchmark-priors"><div className="benchmark-head"><div><p className="eyebrow">Benchmark priors</p><h3>Suggested candidate models to simulate</h3></div><div className="eval-plan-meta"><span>Benchmark confidence: <b>{benchmarkOutput.recommendation.benchmark_confidence}</b></span><span>Model confidence: <b>{benchmarkOutput.recommendation.model_selection_confidence}</b></span></div></div><p>RouteLab maps this Distinct Task to public benchmark families, then uses those priors only to shortlist candidates for SignalEval simulation.</p><div className="benchmark-prior-list">{benchmarkOutput.benchmark_priors.slice(0,4).map(prior=><article className="benchmark-prior" key={prior.benchmark_id}><div><b>{familyName(prior.benchmark_id)}</b><span>{prior.rationale}</span></div><strong>{pct(prior.alignment_score*100)} aligned</strong><small>confidence {prior.confidence}/5</small></article>)}</div><div className="candidate-list">{benchmarkOutput.candidate_models.map(candidate=><article className="candidate-card" key={candidate.model_id}><div><b>{candidate.model_name}</b><strong>{pct(candidate.candidate_score*100)}</strong></div><p>{candidate.rationale}</p><div className="candidate-evidence">{candidate.benchmark_evidence.slice(0,3).map(evidence=><span key={`${candidate.model_id}-${evidence.benchmark_id}`}>{familyName(evidence.benchmark_id)}{evidence.rank?` rank ${evidence.rank}`:evidence.score?` score ${evidence.score}`:""}</span>)}</div><small>{candidate.caveats[0]}</small></article>)}</div></section><section><h3>Examples</h3>{bucket.examples.map(example=><article className="task-example" key={example.trace_id}><b>{example.trace_id}</b><p>{example.prompt_preview}</p><small>{example.response_preview}</small></article>)}</section><section><h3>Cost, token, and latency summary</h3><div className="task-metrics"><div><small>Total cost</small><b>{money(bucket.total_cost_usd)}</b></div><div><small>Total tokens</small><b>{bucket.total_tokens.toLocaleString()}</b></div><div><small>Avg input</small><b>{bucket.avg_input_tokens.toFixed(0)}</b></div><div><small>Avg output</small><b>{bucket.avg_output_tokens.toFixed(0)}</b></div><div><small>Avg latency</small><b>{bucket.avg_latency_ms?.toFixed(0)}ms</b></div><div><small>Low confidence</small><b>{bucket.low_confidence_count}</b></div></div></section><section className="eval-plan"><h3>{plan.plan_name}</h3><div className="eval-plan-meta"><span>Human review: <b>{plan.human_review_required?"Required":"Not required"}</b></span><span>Minimum sample: <b>{plan.minimum_sample_size}</b></span><span>Plan confidence: <b>{pct(plan.confidence*100)}</b></span></div>{groups.map(([label,evals])=><div className="eval-group" key={label}><h4>{label} evals</h4>{evals.map(item=><div key={item.eval_type}><b>{item.eval_type.replaceAll("_"," ")}</b><span>{item.reason}</span></div>)}</div>)}<div className="readiness-rule"><small>Route readiness rule</small><code>{plan.route_readiness_rule}</code></div>{plan.notes.map(note=><p key={note}>{note}</p>)}</section></div></aside></div>;
}
function ReviewQueue({traces,distinctTaskBuckets,candidate}:{traces:Trace[];distinctTaskBuckets:DistinctTaskBucket[];candidate:string}){
  const [index,setIndex]=useState(0);
  const [decisions,setDecisions]=useState<Record<string,ReviewDecision>>({});
  const {reviewItems,lowScoreCount,distinctTaskCount}=useMemo(()=>{
    const replayResult=replay(traces,candidate);
    return buildReviewQueue(traces,replayResult.runs,replayResult.evals,distinctTaskBuckets);
  },[traces,distinctTaskBuckets,candidate]);
  const current=reviewItems[Math.min(index,Math.max(reviewItems.length-1,0))];
  const reviewed=Object.keys(decisions).filter(id=>reviewItems.some(item=>item.evalResult.id===id)).length;
  const applyDecision=(decision:ReviewDecision)=>{
    if(!current)return;
    setDecisions({...decisions,[current.evalResult.id]:decision});
    setIndex(Math.min(index+1,Math.max(reviewItems.length-1,0)));
  };
  const choiceLabels: Array<[ReviewDecision,string,string]> = [
    ["approve","Approve","Eval is wrong"],
    ["reject","Reject","Real failure"],
    ["escalate","Flag for review","Needs expert"],
    ["skip","Skip","Not enough context"],
  ];
  if(!current)return <section className="panel review-empty"><p className="eyebrow">Human review</p><h2>No low-score evals need spot check</h2><p>All simulated evals for {candidate} are currently passing the low-score review threshold.</p></section>;
  const decision=decisions[current.evalResult.id];
  return <section className="review-shell"><div className="review-top"><div><p className="eyebrow">Human review</p><h2>Smart trace check</h2><small>Sampling {reviewItems.length.toLocaleString()} traces from {lowScoreCount.toLocaleString()} low-score evals across {distinctTaskCount.toLocaleString()} Distinct Tasks</small></div><span>{reviewed}/{reviewItems.length.toLocaleString()} reviewed</span></div><article className="review-card"><div className="review-score"><div><small>Judge score</small><b>{pct(current.evalResult.score*100)}</b></div><span className={`risk ${current.bucket?.risk_level??"medium"}`}>{current.bucket?.risk_level??"unknown"} risk</span></div><section className="review-facts"><div><small>Actual trace</small><b>{current.trace.id}</b><span>{current.trace.model} · {current.trace.status} · {current.trace.total_tokens.toLocaleString()} tokens · {current.trace.latency_ms??0}ms</span></div><div><small>Candidate run</small><b>{current.run.candidate_model}</b><span>{money(current.run.cost_usd)} · {current.run.latency_ms}ms · {current.run.status}</span></div></section><section><small>Prompt</small><p>{preview(current.trace.prompt_text,900)}</p></section><section><small>Answer provided by agent</small><p>{preview(current.run.response_text,900)}</p></section><section><small>Classification / Distinct Task</small><p>{current.bucket?`${current.bucket.bucket_name} (${current.bucket.bucket_id})`:"No distinct task bucket assigned"}</p>{current.bucket&&<div className="review-tags">{distinctTaskFieldColumns.map(({field})=><span key={field}>{distinctTaskValue(field,current.bucket!.task[field])}</span>)}</div>}</section><section><small>LLM-as-judge result</small><p><b>{current.evalResult.evaluator_type.replaceAll("_"," ")}</b> scored this {pct(current.evalResult.score*100)}. {current.evalResult.explanation??`${current.evalResult.severity??"Low"} eval outcome on ${candidate}.`}</p></section><details><summary>Reference answer</summary><p>{preview(current.trace.response_text||"No response captured on the source trace",900)}</p></details>{decision&&<div className="review-decision">Marked: <b>{decision==="escalate"?"flag for review":decision}</b></div>}<div className="review-actions" aria-label="Review choices">{choiceLabels.map(([value,label,hint])=><button type="button" className={`review-choice ${value}`} onClick={()=>applyDecision(value)} key={value}><b>{label}</b><span>{hint}</span></button>)}</div></article><div className="review-nav"><button type="button" onClick={()=>setIndex(Math.max(0,index-1))} disabled={index===0}>Previous</button><span>{Math.min(index+1,reviewItems.length).toLocaleString()} of {reviewItems.length.toLocaleString()}</span><button type="button" onClick={()=>setIndex(Math.min(reviewItems.length-1,index+1))} disabled={index>=reviewItems.length-1}>Next</button></div></section>;
}
function ModelOptions({ models }: { models: Model[] }) { return <>{modelFamilies.map(family=>{const familyModels=models.filter(model=>model.family===family);return familyModels.length?<optgroup label={family} key={family}>{familyModels.map(model=><option value={model.id} key={model.id}>{model.display_name} · {model.family_tier} · {model.quality_tier}</option>)}</optgroup>:null})}</> }
function DistinctTaskScopePicker({buckets,selectedIds,onChange,callCounts,totalCalls}:{buckets:DistinctTaskBucket[];selectedIds:string[];onChange:Dispatch<SetStateAction<string[]>>;callCounts:Map<string,number>;totalCalls:number}) {
  const [query,setQuery]=useState("");
  const selectedSet=new Set(selectedIds);
  const filtered=buckets.filter(bucket=>`${bucket.bucket_name} ${bucket.bucket_id} ${Object.values(bucket.task).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const filteredIds=filtered.map(bucket=>bucket.bucket_id);
  const selectedCount=selectedIds.reduce((sum,id)=>sum+(callCounts.get(id)??0),0);
  const summary=selectedIds.length?`${selectedIds.length} selected · ${selectedCount.toLocaleString()} calls`:`All Distinct Tasks · ${totalCalls.toLocaleString()} calls`;
  const toggle=(id:string)=>onChange(ids=>ids.includes(id)?ids.filter(value=>value!==id):[...ids,id]);
  const selectFiltered=()=>onChange(ids=>[...new Set([...ids,...filteredIds])]);
  return <div className="scope-picker"><label>Distinct Task scope</label><details><summary><span>{summary}</span><b>{selectedIds.length?"Filtered":"All"}</b></summary><div className="scope-menu"><input aria-label="Search Distinct Tasks" placeholder="Search Distinct Tasks" value={query} onChange={event=>setQuery(event.target.value)} /><div className="scope-menu-actions"><button type="button" onClick={selectFiltered} disabled={!filtered.length}>Select all Distinct Tasks</button><button type="button" onClick={()=>onChange([])}>All tasks</button>{selectedIds.length>0&&<button type="button" onClick={()=>onChange([])}>Clear selected</button>}</div><div className="scope-menu-count">Showing <b>{filtered.length.toLocaleString()}</b> of <b>{buckets.length.toLocaleString()}</b> Distinct Tasks</div><div className="scope-options">{filtered.length?filtered.map(bucket=>{const calls=callCounts.get(bucket.bucket_id)??0;const selected=selectedSet.has(bucket.bucket_id);return <button type="button" className={`scope-option ${selected?"selected":""}`} aria-pressed={selected} key={bucket.bucket_id} onClick={()=>toggle(bucket.bucket_id)}><input type="checkbox" tabIndex={-1} checked={selected} readOnly aria-hidden="true" /><span><b>{bucket.bucket_name}</b><small>{distinctTaskValue("task_type",bucket.task.task_type)} · {distinctTaskValue("complexity",bucket.task.complexity)}</small></span><em>{calls.toLocaleString()} calls</em></button>}):<p>No matching Distinct Tasks</p>}</div></div></details></div>;
}
function Simulations({ traces,distinctTaskBuckets,candidate,setCandidate,catalogVersion,activeModels }: { traces:Trace[];distinctTaskBuckets:DistinctTaskBucket[];candidate:string;setCandidate:(v:string)=>void;catalogVersion:number;activeModels:Model[] }) {
  const [distinctTaskBucketIds,setDistinctTaskBucketIds]=useState<string[]>([]);
  const [strategy,setStrategy]=useState<"direct"|"family_cascade">("direct");
  const [dateRange,setDateRange]=useState<DateRange>("6m");
  const [requestLimitMode,setRequestLimitMode]=useState<"count"|"percent">("percent");
  const [requestLimitValue,setRequestLimitValue]=useState("100");
  const hasActiveModels=activeModels.length>0;
  const dateTraces=useMemo(()=>filterTracesByRange(traces,dateRange),[traces,dateRange]);
  const dateTraceIds=useMemo(()=>new Set(dateTraces.map(trace=>trace.id)),[dateTraces]);
  const callCounts=useMemo(()=>new Map(distinctTaskBuckets.map(bucket=>[bucket.bucket_id,bucket.traces.filter(id=>dateTraceIds.has(id)).length])),[distinctTaskBuckets,dateTraceIds]);
  useEffect(()=>setDistinctTaskBucketIds(ids=>ids.filter(id=>distinctTaskBuckets.some(bucket=>bucket.bucket_id===id))),[distinctTaskBuckets]);
  const selectedDistinctTasks=useMemo(()=>distinctTaskBucketIds.length?distinctTaskBucketIds.map(id=>distinctTaskBuckets.find(bucket=>bucket.bucket_id===id)).filter((bucket): bucket is DistinctTaskBucket=>Boolean(bucket)):distinctTaskBuckets,[distinctTaskBucketIds,distinctTaskBuckets]);
  const selectedTraceIds=useMemo(()=>distinctTaskBucketIds.length?new Set(selectedDistinctTasks.flatMap(bucket=>bucket.traces)):undefined,[distinctTaskBucketIds.length,selectedDistinctTasks]);
  const availableTraces=useMemo(()=>selectedTraceIds?dateTraces.filter(trace=>selectedTraceIds.has(trace.id)):dateTraces,[dateTraces,selectedTraceIds]);
  const requestLimit=useMemo(()=>{
    const available=availableTraces.length;
    const raw=requestLimitValue.trim();
    if(!available)return {count:0,message:"No requests match the current scope."};
    if(!raw)return {count:available,message:"No request limit entered; simulating all matching requests."};
    const parsed=Number(raw);
    if(!Number.isFinite(parsed))return {count:available,message:"Enter a valid number; simulating all matching requests."};
    if(parsed<=0)return {count:available,message:"Enter a value above 0; simulating all matching requests."};
    if(requestLimitMode==="percent"){
      if(parsed>100)return {count:available,message:"Percent capped at 100% of matching requests."};
      return {count:Math.max(1,Math.ceil(available*parsed/100)),message:undefined};
    }
    const requested=Math.floor(parsed);
    if(requested>available)return {count:available,message:`Request count capped at ${available.toLocaleString()} matching requests.`};
    return {count:requested,message:parsed%1?"Rounded down to a whole request count.":undefined};
  },[availableTraces.length,requestLimitMode,requestLimitValue]);
  const selectedTraces=useMemo(()=>availableTraces.slice(0,requestLimit.count),[availableTraces,requestLimit.count]);
  const direct=useMemo(()=>hasActiveModels?replay(selectedTraces,candidate):undefined,[selectedTraces,candidate,catalogVersion,hasActiveModels]);
  const simulation=useMemo(()=>hasActiveModels?(strategy==="direct"?direct!:familyCascade(selectedTraces,candidate)):undefined,[strategy,direct,selectedTraces,candidate,catalogVersion,hasActiveModels]);
  const distinctTaskBreakdown=useMemo(()=>hasActiveModels?monthlyDistinctTaskBreakdown(selectedTraces,selectedDistinctTasks,candidate,strategy):[],[selectedTraces,selectedDistinctTasks,candidate,strategy,catalogVersion,hasActiveModels]);
  if(!hasActiveModels)return <section className="panel"><p className="eyebrow">Simulations</p><h2>No enabled models</h2><p>Enable at least one model in Model Catalog before running simulations.</p></section>;
  if(!simulation)return null;
  const monthlySavings=simulation.summary.estimated_savings_usd*MONTHLY_MULTIPLIER;
  const candidateName=modelCatalog.find(model=>model.id===candidate)?.display_name??candidate;
  const candidateFamily=modelCatalog.find(model=>model.id===candidate)?.family??candidateName;
  const scopeName=distinctTaskBucketIds.length===0?"All traffic":distinctTaskBucketIds.length===1?selectedDistinctTasks[0]?.bucket_name??"Selected Distinct Task":`${distinctTaskBucketIds.length} selected Distinct Tasks`;
  const delta=(value:number)=>`${value>0?"+":""}${pct(value)}`;
  const metricRows=[
    {label:"Cost (uploaded sample)",before:money(simulation.summary.baseline_cost_usd),after:money(simulation.summary.simulated_cost_usd),change:delta(-simulation.summary.estimated_savings_pct),good:simulation.summary.estimated_savings_usd>=0},
    {label:"Average latency",before:`${simulation.summary.baseline_avg_latency_ms.toFixed(0)}ms`,after:`${simulation.summary.simulated_avg_latency_ms.toFixed(0)}ms`,change:delta(simulation.summary.latency_delta_pct),good:simulation.summary.latency_delta_pct<=0},
    {label:"Quality / accuracy",before:"100.0%",after:pct(simulation.summary.pass_rate*100),change:delta((simulation.summary.pass_rate-1)*100),good:simulation.summary.pass_rate>=.95},
  ];
  return <><section className="sim-builder scenario-builder"><div className="scenario-controls"><div className="compact-select"><label>Candidate model</label><select value={candidate} onChange={e=>setCandidate(e.target.value)}><ModelOptions models={activeModels} /></select></div><DistinctTaskScopePicker buckets={distinctTaskBuckets} selectedIds={distinctTaskBucketIds} onChange={setDistinctTaskBucketIds} callCounts={callCounts} totalCalls={dateTraces.length} /><div className="range-control"><label>Simulation date range</label><div className="range-tabs" role="group" aria-label="Simulation date range">{([["7d","Last 7 days"],["30d","Last 30 days"],["6m","Last 6 months"]] as Array<[DateRange,string]>).map(([value,label])=><button type="button" aria-pressed={dateRange===value} className={dateRange===value?"active":""} onClick={()=>setDateRange(value)} key={value}>{label}</button>)}</div></div><div className={`request-limit ${requestLimit.message?"has-warning":""}`}><label>Requests to simulate</label><div><select aria-label="Request limit type" value={requestLimitMode} onChange={event=>setRequestLimitMode(event.target.value as "count"|"percent")}><option value="percent">% of requests</option><option value="count">Exact count</option></select><input aria-label="Requests to simulate" inputMode="decimal" value={requestLimitValue} onChange={event=>setRequestLimitValue(event.target.value)} placeholder={requestLimitMode==="percent"?"100":"500"} /></div>{requestLimit.message&&<small>{requestLimit.message}</small>}</div><p className="scenario-note">Deterministic mock replay · {selectedTraces.length.toLocaleString()} of {availableTraces.length.toLocaleString()} matching LLM calls in selected period · monthly projection = selected sample × {MONTHLY_MULTIPLIER}</p></div><div className={`projection ${monthlySavings<0?"projection-cost":""}`}><small>{strategy==="direct"?"Monthly direct savings":"Monthly cascade savings"}</small><strong>{money(Math.abs(monthlySavings))}</strong><span>{monthlySavings>=0?"saved per month":"additional monthly cost"} with {strategy==="direct"?candidateName:`the ${candidateFamily} family`}</span></div><div className="sim-actions"><button className={strategy==="direct"?"primary":""} onClick={()=>setStrategy("direct")}>Simulate direct routing</button><span className="cascade-action"><button className={strategy==="family_cascade"?"primary":""} onClick={()=>setStrategy("family_cascade")}>Simulate cascading</button><span className="tooltip" tabIndex={0} aria-label="About cascading simulation" title="For each query, simulate the lowest-cost enabled model in the selected family first. If its result is insufficient, check the next enabled tier.">?<span role="tooltip">For each query, simulate the lowest-cost enabled model in the selected family first. If its result is insufficient, check the next enabled tier.</span></span></span></div></section><section className="scenario-results panel"><div className="panelhead"><div><p className="eyebrow">Scenario results</p><h2>{scopeName} → {strategy==="family_cascade"?`${candidateFamily} enabled family cascade`:candidateName}</h2></div><span>{selectedTraces.length.toLocaleString()} calls</span></div><div className="scenario-metrics"><div className="scenario-metric-head"><b>Metric</b><span>Current</span><span>Simulated</span><span>Change</span></div>{metricRows.map(row=><div className="scenario-metric-row" key={row.label}><b>{row.label}</b><span>{row.before}</span><strong>{row.after}</strong><em className={row.good?"good":"warn"}>{row.change}</em></div>)}</div><div className="scenario-foot"><span>Quality score: {pct(simulation.summary.average_quality_score*100)}</span><span>Pass rate: {pct(simulation.summary.pass_rate*100)}</span>{strategy==="family_cascade"&&<span>Escalation: {pct((simulation.summary.escalation_rate??0)*100)}</span>}</div></section><section className="panel"><div className="panelhead"><div><p className="eyebrow">Monthly cost projection</p><h2>{distinctTaskBucketIds.length===1?"Selected Distinct Task":distinctTaskBucketIds.length>1?"Selected Distinct Tasks":"Breakdown by Distinct Task"}</h2></div><span>{scopeName} → {strategy==="family_cascade"?`${candidateFamily} enabled cascade`:candidate}</span></div><div className="monthly-breakdown"><div className="monthly-breakdown-head"><b>Distinct Task</b><span>Current / mo</span><span>Simulated / mo</span><span>Monthly change</span></div>{distinctTaskBreakdown.map(row=><div className="monthly-breakdown-row" key={row.distinct_task_bucket_id}><b>{row.name}</b><span>{money(row.current_monthly_cost_usd)}</span><strong>{money(row.simulated_monthly_cost_usd)}</strong><em className={row.monthly_savings_usd>=0?"good":"warn"}>{row.monthly_savings_usd>=0?"Save ":"Add "}{money(Math.abs(row.monthly_savings_usd))}</em></div>)}</div></section></>;
}
function Comparison({ comparison }: { comparison: NonNullable<ReturnType<typeof recommendPolicy>["rules"][number]["comparison"]> }) {
  const rows = [
    { label: "Cost", before: money(comparison.cost.before), after: money(comparison.cost.after), delta: comparison.cost.delta_pct },
    { label: "Latency", before: `${comparison.latency_ms.before.toFixed(0)}ms`, after: `${comparison.latency_ms.after.toFixed(0)}ms`, delta: comparison.latency_ms.delta_pct },
    { label: "Quality", before: pct(comparison.quality.before * 100), after: pct(comparison.quality.after * 100), delta: comparison.quality.delta_pct },
  ];
  return <div className="comparison"><div className="comparison-head"><span>Projected impact</span><small>Before</small><small>After</small><small>Change</small></div>{rows.map(row=><div className="comparison-row" key={row.label}><b>{row.label}</b><span>{row.before}</span><strong>{row.after}</strong><em className={row.delta <= 0 && row.label !== "Quality" || row.delta >= 0 && row.label === "Quality" ? "good" : "warn"}>{row.delta > 0 ? "+" : ""}{pct(row.delta)}</em></div>)}</div>;
}
function Recommendations({ policy,candidate,setCandidate,activeModels }: { policy: ReturnType<typeof recommendPolicy>;candidate:string;setCandidate:(value:string)=>void;activeModels:Model[] }) {
  if(!activeModels.length)return <section className="panel"><p className="eyebrow">Distinct Task routing</p><h2>No enabled models</h2><p>Enable at least one model in Model Catalog before generating recommendations.</p></section>;
  return <><section className="recommendation-controls panel"><div><p className="eyebrow">Distinct Task routing</p><h2>Choose models considered for each Distinct Task</h2><span>Auto mode evaluates enabled hosted families independently for each exact Distinct Task and selects the highest-savings option that passes quality, latency, and risk guardrails.</span></div><select value={candidate} onChange={event=>setCandidate(event.target.value)}><option value="auto">Auto-select across {activeModels.length} enabled models</option><ModelOptions models={activeModels} /></select></section><section className="hero recommendation"><div><p className="eyebrow">Recommended mixed policy savings</p><strong>{money(policy.estimated_monthly_savings_usd)}<small>/mo</small></strong><p>{money(policy.estimated_sample_savings_usd)} per uploaded sample × {policy.monthly_multiplier} monthly runs. {policy.risk_summary}</p></div><div className="export"><button onClick={()=>download("routelab-policy.json",exportPolicyJson(policy))}>Export JSON</button><button onClick={()=>download("openrouter-config.json",exportOpenRouterConfig(policy))}>OpenRouter config</button><button onClick={()=>download("litellm.yaml",exportLiteLlm(policy))}>LiteLLM config</button><button onClick={()=>download("router.ts",exportTypeScript(policy))}>TypeScript stub</button></div></section><div className="policy-note"><b>Monthly savings by Distinct Task</b><span>{policy.candidate_model_ids.length} enabled candidate model{policy.candidate_model_ids.length===1?"":"s"} evaluated. Each card shows one Distinct Task’s contribution; rejected alternatives are not counted.</span></div><div className="cards recommendations-grid">{policy.rules.map(rule=><article className="cluster-card rule" key={rule.id}><div><span className={`risk ${rule.match.risk_level}`}>{rule.match.risk_level} risk</span><span className="strategy">{rule.strategy.type.replace("_"," ")}</span></div><div className="rule-title"><h2>{rule.name}</h2><div className={rule.estimated_monthly_savings_usd>0?"monthly-saving":"monthly-saving zero"}><small>Recommended monthly savings</small><b>{money(rule.estimated_monthly_savings_usd)}</b></div></div><p>{rule.rationale}</p>{rule.comparison&&<Comparison comparison={rule.comparison} />}{rule.rejected_alternative&&<div className="rejected-alternative"><div><span>Rejected alternative</span><b>{rule.rejected_alternative.model}</b><strong className="rejected-saving">Potential savings {money(rule.rejected_alternative.potential_monthly_savings_usd)}/mo</strong></div><p>{rule.rejected_alternative.reason}</p><Comparison comparison={rule.rejected_alternative.comparison} /></div>}{rule.strategy.type==="cascade"&&<div className="route"><b>{rule.strategy.primary_model}</b><span>evaluate → fallback</span><b>{rule.strategy.fallback_model}</b></div>}{rule.strategy.type==="direct"&&<div className="route"><span>Route directly to</span><b>{rule.strategy.model}</b></div>}</article>)}</div></>
}
function Catalog({catalogVersion,familyApiKeys,onFamilyApiKey,onModelEnabled,onFamilyEnabled,onPricing}:{catalogVersion:number;familyApiKeys:Partial<Record<Model["family"],string>>;onFamilyApiKey:(family:Model["family"],key:string)=>void;onModelEnabled:(id:string,enabled:boolean)=>void;onFamilyEnabled:(family:Model["family"],enabled:boolean)=>void;onPricing:(id:string,input:number,output:number)=>void}) {
  void catalogVersion;
  return <>{modelFamilies.map(family=>{
    const familyModels=modelCatalog.filter(model=>model.family===family);
    const enabledCount=familyModels.filter(isModelEnabled).length;
    const familyEnabled=enabledCount===familyModels.length;
    const apiKeyConfigured=Boolean(familyApiKeys[family]);
    return <section className="catalog-family" key={family}><div className="panelhead"><div className="family-head"><span className={`family-logo ${family.toLowerCase()}`}><FamilyLogo family={family} /></span><div><p className="eyebrow">Model family</p><h2>{family}</h2></div></div><label className="toggle-control"><input type="checkbox" checked={familyEnabled} onChange={event=>onFamilyEnabled(family,event.target.checked)} /><span className="switch-track" aria-hidden="true"><i /></span><span>{enabledCount}/{familyModels.length} enabled</span></label></div><div className="family-api-key"><div><small>Live simulation API key</small><p>{family==="Local"?"Local models do not need a hosted provider key.":"Used when live simulations send prompts to this model family."}</p></div><label><input aria-label={`${family} API key`} type="password" autoComplete="off" placeholder={family==="Local"?"No API key required":`${family} API key`} value={familyApiKeys[family]??""} disabled={family==="Local"} onChange={event=>onFamilyApiKey(family,event.target.value)} /><span>{family==="Local"?"Local only":apiKeyConfigured?"Configured":"Not configured"}</span></label></div><div className="cards">{familyModels.map(model=>{
      const enabled=isModelEnabled(model);
      return <article className={`cluster-card model ${enabled?"":"disabled"}`} key={model.id}><div><span className="provider">{model.family_tier}</span><label className="toggle-control small"><input type="checkbox" checked={enabled} onChange={event=>onModelEnabled(model.id,event.target.checked)} /><span className="switch-track" aria-hidden="true"><i /></span><span>{enabled?"On":"Off"}</span></label></div><h2>{model.display_name}</h2><code>{model.id}</code><small className="pricing-source">{model.pricing_source}{model.pricing_source_model_id?` pricing: ${model.pricing_source_model_id}`:""}{model.pricing_updated_at?` · refreshed ${model.pricing_updated_at}`:""}</small><div className="pricing-editor compact"><label>Input / 1M tokens<input aria-label={`${model.display_name} input cost per 1M tokens`} type="number" min="0" step=".001" value={model.input_cost_per_1m} onChange={event=>onPricing(model.id,Number(event.target.value),model.output_cost_per_1m)} /></label><label>Output / 1M tokens<input aria-label={`${model.display_name} output cost per 1M tokens`} type="number" min="0" step=".001" value={model.output_cost_per_1m} onChange={event=>onPricing(model.id,model.input_cost_per_1m,Number(event.target.value))} /></label></div><dl><div><dt>Status</dt><dd>{enabled?"Considered":"Excluded"}</dd></div><div><dt>Default latency</dt><dd>{model.default_latency_ms}ms</dd></div><div><dt>Quality</dt><dd>{model.quality_tier}</dd></div></dl></article>
    })}</div></section>
  })}</>
}
