import { useEffect, useMemo, useState } from "react";
import type { dashboardMetrics } from "../core/analysis";
import { monthlyBuckets } from "../core/time";
import type { recommendPolicy } from "../core/recommendations";
import type { DistinctTaskBucket, Trace, TraceJudgeResult } from "../types";
import { money, pct } from "../lib/format";
import { LineChart } from "../components/LineChart";
import { TraceTable } from "../components/TraceTable";

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

export function Overview({ metrics, distinctTaskBuckets, traces, traceJudgeResults, workflowCount, policy }: { metrics: ReturnType<typeof dashboardMetrics>; distinctTaskBuckets: DistinctTaskBucket[]; traces: Trace[]; traceJudgeResults: TraceJudgeResult[]; workflowCount: number; policy: ReturnType<typeof recommendPolicy> }) {
  const [segmentType,setSegmentType]=useState<"all"|"model"|"task">("all");
  const [segmentValue,setSegmentValue]=useState("all");
  const max = Math.max(...Object.values(metrics.byModel).map((item) => item.cost));
  const activeRules=policy.rules.filter(rule=>rule.strategy.type!=="keep_current").length;
  const protectedRules=policy.rules.length-activeRules;
  const rejectedAlternatives=policy.rules.filter(rule=>rule.rejected_alternative).length;
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
  void workflowCount;
  return <><section className="hero exec-hero"><div className="exec-copy"><p className="eyebrow">Executive summary</p><h2>Potential safe savings</h2><strong>{money(policy.estimated_monthly_savings_usd)}<small>/mo</small></strong><p>Guardrail-approved routing policy after quality, latency, risk, tool-use, and uncertainty checks.</p></div><div className="exec-kpis"><article><small>Readiness score</small><b>82/100</b><span>Policy is deployable with eval-backed guardrails.</span></article><article><small>Routing changes</small><b>{activeRules}/{policy.rules.length}</b><span>Distinct Tasks can safely move or cascade.</span></article><article><small>Protected workloads</small><b>{protectedRules}</b><span>High-risk or unresolved failure buckets stay current.</span></article><article><small>Rejected savings</small><b>{rejectedAlternatives}</b><span>Cheap options blocked by latency or quality guardrails.</span></article></div></section>
    <section className="panel trend-panel"><div className="panelhead"><div><p className="eyebrow">Six-month traffic trend</p><h2>Monthly LLM usage, spend, latency and quality</h2></div><div className="trend-filters"><select aria-label="Segment charts by" value={segmentType} onChange={event=>setSegmentType(event.target.value as "all"|"model"|"task")}><option value="all">All traffic</option><option value="model">Segment by model</option><option value="task">Segment by Distinct Task</option></select>{segmentType!=="all"&&<select aria-label={`Select ${segmentType}`} value={segmentValue} onChange={event=>setSegmentValue(event.target.value)}><option value="all">All</option>{segmentOptions.map(option=><option value={option} key={option}>{segmentType==="task"?distinctTaskBuckets.find(bucket=>bucket.bucket_id===option)?.bucket_name:option}</option>)}</select>}</div></div><div className="trend-grid"><LineChart title="LLM calls" series={chartSeries} metric="calls" format={value=>value.toLocaleString()} icon={<span className="stat-icon calls"><StatIcon name="calls" /></span>} /><LineChart title="Spend" series={chartSeries} metric="spend" format={money} icon={<span className="stat-icon spend"><StatIcon name="spend" /></span>} /><LineChart title="Total tokens" series={chartSeries} metric="tokens" format={value=>value.toLocaleString()} icon={<span className="stat-icon tokens"><StatIcon name="tokens" /></span>} /><LineChart title="Average latency" series={chartSeries} metric="latency" format={value=>`${value.toFixed(0)}ms`} summaryValue={averageLatency(scopedTraces)} icon={<span className="stat-icon latency"><StatIcon name="latency" /></span>} /><LineChart title="Agent quality score" series={qualityChartSeries} metric="quality" format={value=>pct(value*100)} icon={<span className="stat-icon quality"><StatIcon name="quality" /></span>} /></div></section>
    <section className="grid two"><article className="panel"><div className="panelhead"><div><p className="eyebrow">Spend analysis</p><h2>Cost by model</h2></div><span>Current traffic</span></div><div className="bars">{Object.entries(metrics.byModel).sort((a,b)=>b[1].cost-a[1].cost).map(([model, item]) => <div className="barrow" key={model}><div><b>{model}</b><span>{money(item.cost)}</span></div><div className="bar"><i style={{ width: `${item.cost / max * 100}%` }} /></div></div>)}</div></article>
    <article className="panel"><div className="panelhead"><div><p className="eyebrow">Workload map</p><h2>Top Distinct Tasks</h2></div><span>{distinctTaskBuckets.length} tasks</span></div>{[...distinctTaskBuckets].sort((a,b)=>b.total_cost_usd-a.total_cost_usd).slice(0,8).map((bucket) => <div className="clusterrow" key={bucket.bucket_id}><span className={`risk ${bucket.risk_level}`}>{bucket.risk_level}</span><div><b>{bucket.bucket_name}</b><small>{bucket.trace_count.toLocaleString()} traces · {pct(bucket.avg_confidence*100)} confidence</small></div><strong>{money(bucket.total_cost_usd)}</strong></div>)}</article></section>
    <section className="panel"><div className="panelhead"><div><p className="eyebrow">Cost outliers</p><h2>Most expensive traces</h2></div></div><TraceTable traces={[...traces].sort((a,b)=>(b.cost_usd??0)-(a.cost_usd??0)).slice(0,5)} /></section></>;
}
