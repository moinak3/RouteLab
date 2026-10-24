import { useEffect, useMemo, useState } from "react";
import type { dashboardMetrics } from "../core/analysis";
import { monthlyBuckets } from "../core/time";
import type { DistinctTaskBucket, RoutingPolicy, Trace, TraceJudgeResult } from "../types";
import { formatInteger, formatLatency, money, pct } from "../lib/format";
import { approvedMonthlySavings } from "../lib/economics";
import { qualitySummary } from "../lib/quality";
import { LineChart } from "../components/LineChart";
import { TraceTable } from "../components/TraceTable";
import { modelCatalog } from "../core/catalog";
import { useRoutingPolicyDraft } from "../core/useRoutingPolicyDraft";

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

function StatIcon({ name }: { name: StatIconName }) {
  const paths: Record<StatIconName, string> = {
    calls: "M8 11h11a5 5 0 0 1 0 10h-2l-5 4v-4H8a5 5 0 0 1 0-10Z",
    spend: "M16 5v22M22 10.5c-1.2-1.3-3.1-2.1-5.4-2.1-3.2 0-5.4 1.5-5.4 3.8 0 5.5 11.4 2.5 11.4 8.1 0 2.4-2.3 4-5.8 4-2.8 0-5.1-.9-6.7-2.6",
    tokens: "M7 9.5 16 5l9 4.5-9 4.5-9-4.5Zm0 6.5 9 4.5 9-4.5M7 22.5 16 27l9-4.5",
    latency: "M16 27a11 11 0 1 0 0-22 11 11 0 0 0 0 22Zm0-17v7l5 3",
    quality: "M16 5 25 9v7c0 6.2-3.8 9.7-9 11-5.2-1.3-9-4.8-9-11V9l9-4Zm-4.5 11.2 3 3 6-6.3",
  };
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d={paths[name]} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

const averageLatency = (items: Trace[]) => {
  const values = items.flatMap((trace) => trace.latency_ms === undefined ? [] : [trace.latency_ms]);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
};

export function Overview({ metrics, distinctTaskBuckets, traces, traceJudgeResults, workflowCount, recommendationPolicy, onOpenPolicy }: {
  metrics: ReturnType<typeof dashboardMetrics>;
  distinctTaskBuckets: DistinctTaskBucket[];
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  workflowCount: number;
  recommendationPolicy: RoutingPolicy;
  onOpenPolicy: () => void;
}) {
  const [segmentType, setSegmentType] = useState<"all" | "model" | "task">("all");
  const [segmentValue, setSegmentValue] = useState("all");
  const maximumModelCost = Math.max(...Object.values(metrics.byModel).map((item) => item.cost));
  const defaultFallbackModelId = useMemo(() => {
    const counts = new Map<string, number>();
    traces.forEach((trace) => counts.set(trace.model, (counts.get(trace.model) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? modelCatalog[0]?.id ?? "";
  }, [traces]);
  const { draftPolicy, status } = useRoutingPolicyDraft(defaultFallbackModelId, { readOnly: true });
  const fallbackName = modelCatalog.find((model) => model.id === draftPolicy.fallbackModelId)?.display_name ?? draftPolicy.fallbackModelId;
  const overrides = Object.values(draftPolicy.overrides);
  const quality = qualitySummary(traceJudgeResults);
  const savings = approvedMonthlySavings(recommendationPolicy);
  const segmentOptions = useMemo(() => segmentType === "model" ? [...new Set(traces.map((trace) => trace.model))].sort() : segmentType === "task" ? distinctTaskBuckets.map((bucket) => bucket.bucket_id) : [], [segmentType, traces, distinctTaskBuckets]);
  const scopedTraces = useMemo(() => {
    if (segmentType === "all" || segmentValue === "all") return traces;
    if (segmentType === "model") return traces.filter((trace) => trace.model === segmentValue);
    const bucket = distinctTaskBuckets.find((item) => item.bucket_id === segmentValue);
    return bucket ? traces.filter((trace) => bucket.traces.includes(trace.id)) : [];
  }, [traces, distinctTaskBuckets, segmentType, segmentValue]);
  const chartSeries = useMemo(() => {
    if (segmentType === "all") return [{ name: "All traffic", buckets: monthlyBuckets(traces) }];
    const selected = segmentValue === "all" ? segmentOptions : [segmentValue];
    return selected.map((value) => ({ name: segmentType === "task" ? distinctTaskBuckets.find((bucket) => bucket.bucket_id === value)?.bucket_name ?? value : value, buckets: monthlyBuckets(traces.filter((trace) => segmentType === "model" ? trace.model === value : distinctTaskBuckets.find((bucket) => bucket.bucket_id === value)?.traces.includes(trace.id))) }));
  }, [traces, distinctTaskBuckets, segmentType, segmentValue, segmentOptions]);
  const qualityChartSeries = useMemo(() => {
    if (segmentType === "all") return [{ name: "All traffic", buckets: monthlyQualityBuckets(traces, traceJudgeResults) }];
    const selected = segmentValue === "all" ? segmentOptions : [segmentValue];
    return selected.map((value) => {
      const selection = traces.filter((trace) => segmentType === "model" ? trace.model === value : distinctTaskBuckets.find((bucket) => bucket.bucket_id === value)?.traces.includes(trace.id));
      return { name: segmentType === "task" ? distinctTaskBuckets.find((bucket) => bucket.bucket_id === value)?.bucket_name ?? value : value, buckets: monthlyQualityBuckets(selection, traceJudgeResults) };
    });
  }, [traces, traceJudgeResults, distinctTaskBuckets, segmentType, segmentValue, segmentOptions]);
  useEffect(() => setSegmentValue("all"), [segmentType]);
  void workflowCount;

  return <>
    <section className="overview-decision-summary" aria-label="Decision summary">
      <article className="panel"><small>Policy</small><strong>Draft v{draftPolicy.version}</strong><span>{status.state === "saved" ? "Saved · not published" : "Not published"}</span></article>
      <article className="panel"><small>Tasks overridden</small><strong>{formatInteger(overrides.length)} of {formatInteger(distinctTaskBuckets.length)}</strong><span>Everything else uses {fallbackName}</span></article>
      <article className="panel"><small>Approved monthly savings</small><strong>{money(savings)}</strong><span>Only routes that clear every guardrail</span></article>
      <article className="panel"><small>Current quality</small><strong>{pct(quality.passRate.rate * 100, quality.scored)}</strong><span>Quality bar {pct(draftPolicy.minimumPassRate * 100)} · n={formatInteger(quality.scored)}</span></article>
      <article className="panel overview-next-action"><small>Next action</small><strong>{overrides.length ? "Review and publish" : "Approve an eligible route"}</strong><button type="button" className="primary" onClick={onOpenPolicy}>Open policy</button></article>
    </section>
    <section className="panel overview-routing-state">
      <div className="panelhead"><div><p className="eyebrow">Current policy</p><h2>Fallback plus approved exceptions</h2><p className="impact-explainer">Draft v{draftPolicy.version} · not published</p></div><button type="button" onClick={onOpenPolicy}>Edit policy</button></div>
      <div className="overview-route-list">{[...distinctTaskBuckets].sort((a, b) => b.trace_count - a.trace_count).map((bucket) => { const override = draftPolicy.overrides[bucket.bucket_id]; return <div key={bucket.bucket_id}><span className={`risk ${bucket.risk_level}`}>{bucket.risk_level}</span><p><b>{bucket.bucket_name}</b><small>{formatInteger(bucket.trace_count)} traces</small></p><em>{override ? `${override.modelName}${override.provider ? ` via ${override.provider}` : ""}` : `Fallback · ${fallbackName}`}</em></div>; })}</div>
    </section>
    <section className="panel trend-panel"><div className="panelhead"><div><p className="eyebrow">Six-month trend</p><h2>Usage, spend, latency and quality</h2></div><div className="trend-filters"><select aria-label="Segment charts by" value={segmentType} onChange={(event) => setSegmentType(event.target.value as "all" | "model" | "task")}><option value="all">All traffic</option><option value="model">By model</option><option value="task">By task</option></select>{segmentType !== "all" && <select aria-label={`Select ${segmentType}`} value={segmentValue} onChange={(event) => setSegmentValue(event.target.value)}><option value="all">All</option>{segmentOptions.map((option) => <option value={option} key={option}>{segmentType === "task" ? distinctTaskBuckets.find((bucket) => bucket.bucket_id === option)?.bucket_name : modelCatalog.find((model) => model.id === option)?.display_name ?? option}</option>)}</select>}</div></div>
      <div className="trend-grid"><LineChart title="LLM calls" series={chartSeries} metric="calls" format={formatInteger} icon={<span className="stat-icon calls"><StatIcon name="calls" /></span>} /><LineChart title="Spend" series={chartSeries} metric="spend" format={money} icon={<span className="stat-icon spend"><StatIcon name="spend" /></span>} /><LineChart title="Total tokens" series={chartSeries} metric="tokens" format={formatInteger} icon={<span className="stat-icon tokens"><StatIcon name="tokens" /></span>} /><LineChart title="Average latency" series={chartSeries} metric="latency" format={formatLatency} summaryValue={averageLatency(scopedTraces)} icon={<span className="stat-icon latency"><StatIcon name="latency" /></span>} /><LineChart title="Agent quality" series={qualityChartSeries} metric="quality" format={(value) => pct(value * 100)} icon={<span className="stat-icon quality"><StatIcon name="quality" /></span>} /></div>
    </section>
    <section className="grid two"><article className="panel"><div className="panelhead"><div><p className="eyebrow">Spend analysis</p><h2>Cost by model</h2></div><span>Current sample</span></div><div className="bars">{Object.entries(metrics.byModel).sort((a, b) => b[1].cost - a[1].cost).map(([model, item]) => <div className="barrow" key={model}><div><b>{modelCatalog.find((entry) => entry.id === model)?.display_name ?? model}</b><span>{money(item.cost)}</span></div><div className="bar"><i style={{ width: `${item.cost / maximumModelCost * 100}%` }} /></div></div>)}</div></article>
      <article className="panel"><div className="panelhead"><div><p className="eyebrow">Task map</p><h2>Highest-cost tasks</h2></div><span>{formatInteger(distinctTaskBuckets.length)} tasks</span></div>{[...distinctTaskBuckets].sort((a, b) => b.total_cost_usd - a.total_cost_usd).slice(0, 8).map((bucket) => <div className="clusterrow" key={bucket.bucket_id}><span className={`risk ${bucket.risk_level}`}>{bucket.risk_level}</span><div><b>{bucket.bucket_name}</b><small>{formatInteger(bucket.trace_count)} traces</small></div><strong>{money(bucket.total_cost_usd)}</strong></div>)}</article>
    </section>
    <section className="panel"><div className="panelhead"><div><p className="eyebrow">Cost outliers</p><h2>Most expensive traces</h2></div></div><TraceTable traces={[...traces].sort((a, b) => (b.cost_usd ?? 0) - (a.cost_usd ?? 0)).slice(0, 5)} /></section>
  </>;
}
