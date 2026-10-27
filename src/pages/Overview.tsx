import { useEffect, useMemo, useState } from "react";
import type { dashboardMetrics } from "../core/analysis";
import { monthlyBuckets } from "../core/time";
import type { DistinctTaskBucket, Trace, TraceJudgeResult } from "../types";
import { money, pct } from "../lib/format";
import { LineChart } from "../components/LineChart";
import { TraceTable } from "../components/TraceTable";
import { modelCatalog } from "../core/catalog";
import { useRoutingPolicyDraft } from "../core/useRoutingPolicyDraft";
import { fetchPublishedPolicyHistory, fetchSignedRoutingPolicy } from "../core/routingPolicyPersistence";
import type { PublishedPolicyHistory, RoutingPolicyBundle } from "../core/publishedRoutingPolicy";
import { isUnknownClassifierTrace } from "../core/runtimeTraces";
import type { Page, ReviewQueueFilter } from "../types/ui";

type StatIconName = "calls" | "spend" | "tokens" | "latency" | "quality";

function monthlyQualityBuckets(traces: Trace[], traceJudgeResults: TraceJudgeResult[]) {
  const traceIds = new Set(traces.map((trace) => trace.id));
  const buckets = new Map<string, { key: string; label: string; calls: number; spend: number; tokens: number; quality: number; latency: number; scoreSum: number; scored: number }>();
  for (const result of traceJudgeResults) {
    if (!traceIds.has(result.trace_id)) continue;
    const date = new Date(result.created_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key) ?? { key, label: date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }), calls: 0, spend: 0, tokens: 0, quality: 0, latency: 0, scoreSum: 0, scored: 0 };
    bucket.scoreSum += result.score;
    bucket.scored += 1;
    bucket.quality = bucket.scoreSum / bucket.scored;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function StatIcon({name}:{name:StatIconName}) {
  if(name==="calls")return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 11h11a5 5 0 0 1 0 10h-2l-5 4v-4H8a5 5 0 0 1 0-10Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/><path d="M20 9h4a4 4 0 0 1 0 8h-1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>;
  if(name==="spend")return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 5v22M22 10.5c-1.2-1.3-3.1-2.1-5.4-2.1-3.2 0-5.4 1.5-5.4 3.8 0 5.5 11.4 2.5 11.4 8.1 0 2.4-2.3 4-5.8 4-2.8 0-5.1-.9-6.7-2.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if(name==="tokens")return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 9.5 16 5l9 4.5-9 4.5-9-4.5Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/><path d="m7 16 9 4.5 9-4.5M7 22.5 16 27l9-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if(name==="latency")return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 27a11 11 0 1 0 0-22 11 11 0 0 0 0 22Z" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M16 10v7l5 3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 6 4 9M25 6l3 3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 5 25 9v7c0 6.2-3.8 9.7-9 11-5.2-1.3-9-4.8-9-11V9l9-4Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/><path d="m11.5 16.2 3 3 6-6.3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

const averageLatency = (items: Trace[]) => {
  const latencies = items.flatMap((trace) => trace.latency_ms === undefined ? [] : [trace.latency_ms]);
  return latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0;
};

const modelName = (id: string) => modelCatalog.find((model) => model.id === id)?.display_name ?? id;
const policyDate = (value?: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
  : "Not available";
const ratio = (value: number, total: number) => total ? value / total * 100 : 0;

export function Overview({ metrics, distinctTaskBuckets, traces, traceJudgeResults, workflowCount, onNavigate, onReviewQueue }: { metrics: ReturnType<typeof dashboardMetrics>; distinctTaskBuckets: DistinctTaskBucket[]; traces: Trace[]; traceJudgeResults: TraceJudgeResult[]; workflowCount: number; onNavigate: (page: Page) => void; onReviewQueue: (filter: ReviewQueueFilter) => void }) {
  const [segmentType,setSegmentType]=useState<"all"|"model"|"task">("all");
  const [segmentValue,setSegmentValue]=useState("all");
  const max = Math.max(...Object.values(metrics.byModel).map((item) => item.cost));
  const defaultFallbackModelId=useMemo(()=>{
    const counts=new Map<string,number>();
    traces.forEach(trace=>counts.set(trace.model,(counts.get(trace.model)??0)+1));
    return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]??modelCatalog[0]?.id??"";
  },[traces]);
  const {draftPolicy:routingPolicy,status:routingPolicyStatus}=useRoutingPolicyDraft(defaultFallbackModelId,{readOnly:true});
  const [publishedHistory,setPublishedHistory]=useState<PublishedPolicyHistory|null>(null);
  const [activeBundle,setActiveBundle]=useState<RoutingPolicyBundle|null>(null);
  const [publishedState,setPublishedState]=useState<"loading"|"ready"|"unavailable">("loading");
  useEffect(()=>{
    const controller=new AbortController();
    let active=true;
    const load=async()=>{
      try {
        const history=await fetchPublishedPolicyHistory(controller.signal);
        if(!active)return;
        setPublishedHistory(history);
        if(history.activeVersion!==null){
          const signed=await fetchSignedRoutingPolicy("active",controller.signal);
          if(active)setActiveBundle(signed.bundle);
        }
        if(active)setPublishedState("ready");
      } catch {
        if(active&&!controller.signal.aborted)setPublishedState("unavailable");
      }
    };
    void load();
    return()=>{active=false;controller.abort()};
  },[]);
  const activeSummary=publishedHistory?.versions.find(version=>version.active);
  const draftDefaultName=routingPolicy.defaultStrategyType==="openrouter_auto"?"OpenRouter Auto Router":modelName(routingPolicy.defaultModelId);
  const activeDefaultName=activeBundle?.defaultStrategy?.type==="openrouter_auto"
    ? `OpenRouter Auto · ${activeBundle.defaultStrategy.costTier} cost tier`
    : activeBundle?.defaultStrategy?.type==="fixed_model"
      ? modelName(activeBundle.defaultStrategy.target.modelId)
      : activeSummary?.defaultStrategyLabel;
  const defaultStrategyName=activeDefaultName??draftDefaultName;
  const emergencyFallbackName=activeBundle?.emergencyFallback?.modelId
    ? modelName(activeBundle.emergencyFallback.modelId)
    : activeSummary?.emergencyFallbackModelId
      ? modelName(activeSummary.emergencyFallbackModelId)
      : modelName(routingPolicy.emergencyFallbackModelId);
  const overrideIds=useMemo(()=>new Set(activeBundle?.overrides.map(override=>override.taskId)??(!activeSummary?Object.keys(routingPolicy.overrides):[])),[activeBundle,activeSummary,routingPolicy.overrides]);
  const overrideCount=activeSummary?.overrideCount??Object.keys(routingPolicy.overrides).length;
  const taskGroupCount=activeSummary?.signatureCount??distinctTaskBuckets.length;
  const policyGuardrails=activeBundle?.guardrails??routingPolicy;
  const draftUpdatedAfterDeployment=Boolean(activeSummary&&Date.parse(routingPolicy.updatedAt)>Date.parse(activeSummary.publishedAt));
  const bucketByTrace=useMemo(()=>{
    const result=new Map<string,string>();
    distinctTaskBuckets.forEach(bucket=>bucket.traces.forEach(traceId=>result.set(traceId,bucket.bucket_id)));
    return result;
  },[distinctTaskBuckets]);
  const coverage=useMemo(()=>traces.reduce((summary,trace)=>{
    const fallback=trace.signature_decision?.routing_action==="fallback_model"||isUnknownClassifierTrace(trace)||trace.signature_decision?.status==="low_confidence";
    if(fallback)summary.fallback+=1;
    else if(overrideIds.has(trace.signature_decision?.signature_id??bucketByTrace.get(trace.id)??""))summary.override+=1;
    else summary.default+=1;
    return summary;
  },{override:0,default:0,fallback:0}),[traces,bucketByTrace,overrideIds]);
  const qualityPassing=traceJudgeResults.filter(result=>result.passed).length;
  const qualityRate=ratio(qualityPassing,traceJudgeResults.length);
  const spendPerThousand=metrics.totalRequests?metrics.totalCost/metrics.totalRequests*1000:0;
  const failingCount=traceJudgeResults.length-qualityPassing;
  const scoredTraceIds=new Set(traceJudgeResults.map(result=>result.trace_id));
  const unscoredGroups=distinctTaskBuckets.filter(bucket=>!bucket.traces.some(traceId=>scoredTraceIds.has(traceId))).length;
  const attentionItems=[
    coverage.fallback?{label:`${coverage.fallback.toLocaleString()} unknown or low-confidence requests`,detail:"Review outside-coverage conversations",action:()=>onReviewQueue("uncovered")} : null,
    failingCount?{label:`${failingCount.toLocaleString()} responses below the quality threshold`,detail:"Review unusual covered conversations",action:()=>onReviewQueue("unusual")} : null,
    unscoredGroups?{label:`${unscoredGroups.toLocaleString()} task groups have no scored traces`,detail:"Review outside-coverage conversations",action:()=>onReviewQueue("uncovered")} : null,
    draftUpdatedAfterDeployment?{label:"Saved draft changed after the active policy was published",detail:"Review and publish the draft",action:()=>onNavigate("Simulations")} : null,
    !activeSummary&&publishedState==="ready"?{label:"No signed policy is deployed",detail:"Publish a routing policy",action:()=>onNavigate("Simulations")} : null,
  ].filter((item):item is NonNullable<typeof item>=>Boolean(item));
  const segmentOptions=useMemo(()=>segmentType==="model"?[...new Set(traces.map(trace=>trace.model))].sort():segmentType==="task"?distinctTaskBuckets.map(bucket=>bucket.bucket_id):[],[segmentType,traces,distinctTaskBuckets]);
  const scopedTraces=useMemo(()=>{
    if(segmentType==="all"||segmentValue==="all") return traces;
    if(segmentType==="model") return traces.filter(trace=>trace.model===segmentValue);
    const bucket=distinctTaskBuckets.find(item=>item.bucket_id===segmentValue);
    return bucket?traces.filter(trace=>bucket.traces.includes(trace.id)):[];
  },[traces,distinctTaskBuckets,segmentType,segmentValue]);
  const chartSeries=useMemo(()=>{
    if(segmentType==="all") return [{name:"All traffic",buckets:monthlyBuckets(traces)}];
    const selected=segmentValue==="all"?segmentOptions:[segmentValue];
    return selected.map(value=>({name:segmentType==="task"?distinctTaskBuckets.find(bucket=>bucket.bucket_id===value)?.bucket_name??value:value,buckets:monthlyBuckets(traces.filter(trace=>segmentType==="model"?trace.model===value:distinctTaskBuckets.find(bucket=>bucket.bucket_id===value)?.traces.includes(trace.id))) }));
  },[traces,distinctTaskBuckets,segmentType,segmentValue,segmentOptions]);
  const qualityChartSeries=useMemo(()=>{
    if(segmentType==="all") return [{name:"All traffic",buckets:monthlyQualityBuckets(traces,traceJudgeResults)}];
    const selected=segmentValue==="all"?segmentOptions:[segmentValue];
    return selected.map(value=>{
      const scopedTraces=traces.filter(trace=>segmentType==="model"?trace.model===value:distinctTaskBuckets.find(bucket=>bucket.bucket_id===value)?.traces.includes(trace.id));
      return {name:segmentType==="task"?distinctTaskBuckets.find(bucket=>bucket.bucket_id===value)?.bucket_name??value:value,buckets:monthlyQualityBuckets(scopedTraces,traceJudgeResults)};
    });
  },[traces,traceJudgeResults,distinctTaskBuckets,segmentType,segmentValue,segmentOptions]);
  useEffect(()=>{setSegmentValue("all")},[segmentType]);
  const policyStatusLabel=publishedState==="loading"?"Checking deployment":activeSummary?`Policy v${activeSummary.version} deployed`:publishedState==="ready"?"No active policy":"Deployment unavailable";
  return <><section className="panel overview-policy-panel"><div className="overview-policy-head"><div><p className="eyebrow">Routing control plane</p><h2>{policyStatusLabel}</h2><p>{activeSummary?`Activated ${policyDate(activeSummary.activatedAt)} · expires ${policyDate(activeSummary.expiresAt)}`:"The saved draft is not production routing until a signed version is deployed."}</p></div><div><span className={`overview-policy-status ${activeSummary?"active":publishedState}`}>{activeSummary?"Active":publishedState}</span><button type="button" onClick={()=>onNavigate("Simulations")}>Open policy</button></div></div><div className="overview-policy-facts"><div><small>Default strategy</small><strong>{defaultStrategyName}</strong><span>{activeBundle?.defaultStrategy?.type==="openrouter_auto"?"Actual model selection varies by request":"Used when no approved task override applies"}</span></div><div><small>Emergency fallback</small><strong>{emergencyFallbackName}</strong><span>Separate route for applicable runtime failures</span></div><div><small>Task groups</small><strong>{taskGroupCount.toLocaleString()}</strong><span>{overrideCount.toLocaleString()} approved overrides · {Math.max(0,taskGroupCount-overrideCount).toLocaleString()} use default</span></div><div><small>Policy guardrails</small><strong>{pct(policyGuardrails.minimumPassRate*100)} quality</strong><span>Maximum latency increase +{policyGuardrails.maximumLatencyIncreasePct}%</span></div></div><div className={`overview-draft-state ${draftUpdatedAfterDeployment?"changed":""}`}><span>Saved draft v{routingPolicy.version} · {routingPolicyStatus.state==="saved"?"cloud":routingPolicyStatus.state}</span><small>{draftUpdatedAfterDeployment?"Updated after the active policy was published":"No newer draft change detected"}</small></div></section>
    <section className="overview-kpis" aria-label="Observed routing metrics"><article className="panel"><span className="stat-icon calls"><StatIcon name="calls" /></span><small>Observed requests</small><strong>{metrics.totalRequests.toLocaleString()}</strong><p>{workflowCount.toLocaleString()} workflow trees in the loaded traffic</p></article><article className="panel"><span className="stat-icon quality"><StatIcon name="quality" /></span><small>Quality pass rate</small><strong>{traceJudgeResults.length?pct(qualityRate):"No scores"}</strong><p>{traceJudgeResults.length.toLocaleString()} scored traces · target {pct(policyGuardrails.minimumPassRate*100)}</p></article><article className="panel"><span className="stat-icon latency"><StatIcon name="latency" /></span><small>P95 latency</small><strong>{metrics.p95Latency.toFixed(0)}ms</strong><p>Average {metrics.averageLatency.toFixed(0)}ms across loaded traces</p></article><article className="panel"><span className="stat-icon spend"><StatIcon name="spend" /></span><small>Spend per 1,000 calls</small><strong>{money(spendPerThousand)}</strong><p>{money(metrics.totalCost)} total observed spend</p></article></section>
    <section className="grid two overview-decision-grid"><article className="panel overview-coverage"><div className="panelhead"><div><p className="eyebrow">Observed routing coverage</p><h2>Where loaded traffic would route</h2></div><button type="button" onClick={()=>onNavigate("Distinct Tasks")}>View task groups</button></div><div className="overview-coverage-bar" aria-label={`${coverage.override} override, ${coverage.default} default, ${coverage.fallback} fallback requests`}><i className="override" style={{width:`${ratio(coverage.override,traces.length)}%`}}/><i className="default" style={{width:`${ratio(coverage.default,traces.length)}%`}}/><i className="fallback" style={{width:`${ratio(coverage.fallback,traces.length)}%`}}/></div><div className="overview-coverage-legend"><div><i className="override"/><span>Approved override</span><strong>{coverage.override.toLocaleString()} · {pct(ratio(coverage.override,traces.length))}</strong></div><div><i className="default"/><span>Configured default</span><strong>{coverage.default.toLocaleString()} · {pct(ratio(coverage.default,traces.length))}</strong></div><div><i className="fallback"/><span>Unknown or low confidence</span><strong>{coverage.fallback.toLocaleString()} · {pct(ratio(coverage.fallback,traces.length))}</strong></div></div><p className="overview-data-note">Coverage uses the loaded trace set and the {activeSummary?"active policy":"saved draft"}. It is not measured classifier accuracy.</p></article><article className="panel overview-attention"><div className="panelhead"><div><p className="eyebrow">Needs attention</p><h2>{attentionItems.length?`${attentionItems.length} follow-ups`:"No immediate follow-ups"}</h2></div><button type="button" onClick={()=>onReviewQueue("representative")}>Open review queue</button></div>{attentionItems.length?<div>{attentionItems.slice(0,4).map(item=><button type="button" onClick={item.action} key={item.label}><span>{item.label}</span><small>{item.detail}</small><b aria-hidden="true">›</b></button>)}</div>:<p className="overview-attention-empty">The loaded evidence has no unknown classifications, quality failures, unscored groups, or unpublished draft changes.</p>}</article></section>
    <section className="panel trend-panel"><div className="panelhead"><div><p className="eyebrow">Six-month traffic trend</p><h2>Monthly LLM usage, spend, latency and quality</h2></div><div className="trend-filters"><select aria-label="Segment charts by" value={segmentType} onChange={event=>setSegmentType(event.target.value as "all"|"model"|"task")}><option value="all">All traffic</option><option value="model">Segment by model</option><option value="task">Segment by Task Group</option></select>{segmentType!=="all"&&<select aria-label={`Select ${segmentType}`} value={segmentValue} onChange={event=>setSegmentValue(event.target.value)}><option value="all">All</option>{segmentOptions.map(option=><option value={option} key={option}>{segmentType==="task"?distinctTaskBuckets.find(bucket=>bucket.bucket_id===option)?.bucket_name:option}</option>)}</select>}</div></div><div className="trend-grid"><LineChart title="LLM calls" series={chartSeries} metric="calls" format={value=>value.toLocaleString()} icon={<span className="stat-icon calls"><StatIcon name="calls" /></span>} /><LineChart title="Spend" series={chartSeries} metric="spend" format={money} icon={<span className="stat-icon spend"><StatIcon name="spend" /></span>} /><LineChart title="Total tokens" series={chartSeries} metric="tokens" format={value=>value.toLocaleString()} icon={<span className="stat-icon tokens"><StatIcon name="tokens" /></span>} /><LineChart title="Average latency" series={chartSeries} metric="latency" format={value=>`${value.toFixed(0)}ms`} summaryValue={averageLatency(scopedTraces)} icon={<span className="stat-icon latency"><StatIcon name="latency" /></span>} /><LineChart title="Agent quality score" series={qualityChartSeries} metric="quality" format={value=>pct(value*100)} icon={<span className="stat-icon quality"><StatIcon name="quality" /></span>} /></div></section>
    <section className="grid two"><article className="panel"><div className="panelhead"><div><p className="eyebrow">Spend analysis</p><h2>Cost by model</h2></div><span>Current traffic</span></div><div className="bars">{Object.entries(metrics.byModel).sort((a,b)=>b[1].cost-a[1].cost).map(([model, item]) => <div className="barrow" key={model}><div><b>{model}</b><span>{money(item.cost)}</span></div><div className="bar"><i style={{ width: `${item.cost / max * 100}%` }} /></div></div>)}</div></article>
    <article className="panel"><div className="panelhead"><div><p className="eyebrow">Workload map</p><h2>Top Task Groups</h2></div><button type="button" onClick={()=>onNavigate("Distinct Tasks")}>View all {distinctTaskBuckets.length}</button></div>{[...distinctTaskBuckets].sort((a,b)=>b.total_cost_usd-a.total_cost_usd).slice(0,5).map((bucket) => {const override=activeBundle?.overrides.find(item=>item.taskId===bucket.bucket_id)??routingPolicy.overrides[bucket.bucket_id];return <div className="clusterrow" key={bucket.bucket_id}><span className={`risk ${bucket.risk_level}`}>{bucket.risk_level}</span><div><b>{bucket.bucket_name}</b><small>{bucket.trace_count.toLocaleString()} traces · {override?`approved override: ${modelName(override.modelId)}`:`default: ${defaultStrategyName}`}</small></div><strong>{money(bucket.total_cost_usd)}</strong></div>})}</article></section>
    <section className="panel"><div className="panelhead"><div><p className="eyebrow">Cost outliers</p><h2>Most expensive traces</h2></div></div><TraceTable traces={[...traces].sort((a,b)=>(b.cost_usd??0)-(a.cost_usd??0)).slice(0,5)} /></section></>;
}
