import { useEffect, useMemo, useState } from "react";
import type { dashboardMetrics } from "../core/analysis";
import { monthlyBuckets } from "../core/time";
import type { recommendPolicy } from "../core/recommendations";
import type { DistinctTaskBucket, Trace } from "../types";
import { money, pct } from "../lib/format";
import { LineChart } from "../components/LineChart";
import { TraceTable } from "../components/TraceTable";

export function Overview({ metrics, distinctTaskBuckets, traces, workflowCount, policy }: { metrics: ReturnType<typeof dashboardMetrics>; distinctTaskBuckets: DistinctTaskBucket[]; traces: Trace[]; workflowCount: number; policy: ReturnType<typeof recommendPolicy> }) {
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
