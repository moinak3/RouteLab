import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { modelCatalog } from "../core/catalog";
import { familyCascade, MONTHLY_MULTIPLIER, monthlyDistinctTaskBreakdown, replay } from "../core/simulations";
import { filterTracesByRange, type DateRange } from "../core/time";
import type { DistinctTaskBucket, Trace, Model } from "../types";
import { money, pct } from "../lib/format";
import { distinctTaskValue } from "../components/DistinctTaskDisplay";
import { ModelOptions } from "../components/ModelOptions";

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

export function Simulations({ traces,distinctTaskBuckets,candidate,setCandidate,catalogVersion,activeModels }: { traces:Trace[];distinctTaskBuckets:DistinctTaskBucket[];candidate:string;setCandidate:(v:string)=>void;catalogVersion:number;activeModels:Model[] }) {
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
