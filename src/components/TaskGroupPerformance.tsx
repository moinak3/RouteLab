import { useEffect, useMemo, useState } from "react";
import { money, pct } from "../lib/format";
import type { DistinctTaskBucket, Trace, TraceJudgeResult } from "../types";
import {
  taskGroupCostSeries,
  taskGroupPerformanceHistory,
  type TaskGroupPerformancePoint,
} from "../core/taskGroupPerformance";

const chartColors = ["#58a66c", "#477ac4", "#9a6ed8", "#d6a73e", "#dc765d", "#50aaa1"];
const chartWidth = 920;
const chartHeight = 300;
const plot = { left: 58, right: 72, top: 28, bottom: 42 };
const plotWidth = chartWidth - plot.left - plot.right;
const plotHeight = chartHeight - plot.top - plot.bottom;
const traceLabel = (count: number) => `${count} ${count === 1 ? "trace" : "traces"}`;

const xFor = (index: number, count: number) => count <= 1 ? plot.left + plotWidth / 2 : plot.left + index * plotWidth / (count - 1);
const qualityY = (value: number) => plot.top + (1 - value) * plotHeight;
const scaledY = (value: number, max: number) => plot.top + (1 - value / Math.max(max, 1)) * plotHeight;
const niceMax = (value: number) => {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const ceiling = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return ceiling * magnitude;
};
const lineSegments = (points: Array<{ x: number; y: number } | null>) => {
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  points.forEach((point) => {
    if (point) {
      current.push(point);
      return;
    }
    if (current.length) segments.push(current);
    current = [];
  });
  if (current.length) segments.push(current);
  return segments;
};

function AxisGrid({ months, rightLabels }: { months: Array<{ key: string; label: string }>; rightLabels: string[] }) {
  return <>
    {[0, .25, .5, .75, 1].map((tick, index) => {
      const y = plot.top + (1 - tick) * plotHeight;
      return <g key={tick}><line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} className="task-performance-gridline"/><text x={plot.left - 10} y={y + 4} textAnchor="end">{pct(tick * 100)}</text><text x={chartWidth - plot.right + 10} y={y + 4}>{rightLabels[index]}</text></g>;
    })}
    {months.map((month, index) => <text key={month.key} x={xFor(index, months.length)} y={chartHeight - 10} textAnchor="middle">{month.label}</text>)}
  </>;
}

function QualityLatencyChart({ points }: { points: TaskGroupPerformancePoint[] }) {
  const latencyMax = niceMax(Math.max(...points.flatMap((point) => point.p95LatencyMs === null ? [] : [point.p95LatencyMs]), 1));
  const qualityPoints = points.map((point, index) => point.averageQuality === null ? null : { x: xFor(index, points.length), y: qualityY(point.averageQuality) });
  const latencyPoints = points.map((point, index) => point.p95LatencyMs === null ? null : { x: xFor(index, points.length), y: scaledY(point.p95LatencyMs, latencyMax) });
  return <div className="task-performance-chart-wrap"><svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Monthly average quality and P95 latency for the selected Task Group">
    <AxisGrid months={points.map((point) => point.month)} rightLabels={[0, .25, .5, .75, 1].map((tick) => `${Math.round(tick * latencyMax)}ms`)} />
    <text x={plot.left} y={16} className="task-performance-axis-title">Average quality</text>
    <text x={chartWidth - plot.right} y={16} textAnchor="end" className="task-performance-axis-title">P95 latency</text>
    {lineSegments(qualityPoints).map((segment, index) => <polyline key={`quality-${index}`} points={segment.map((point) => `${point.x},${point.y}`).join(" ")} className="task-performance-line quality"/>)}
    {lineSegments(latencyPoints).map((segment, index) => <polyline key={`latency-${index}`} points={segment.map((point) => `${point.x},${point.y}`).join(" ")} className="task-performance-line latency"/>)}
    {points.map((point, index) => <g key={point.month.key}>
      {point.averageQuality !== null&&<circle cx={xFor(index, points.length)} cy={qualityY(point.averageQuality)} r="5" className="task-performance-point quality"><title>{`${point.month.label}: ${pct(point.averageQuality * 100)} average quality across ${traceLabel(point.scoredTraceCount)}`}</title></circle>}
      {point.p95LatencyMs !== null&&<circle cx={xFor(index, points.length)} cy={scaledY(point.p95LatencyMs, latencyMax)} r="5" className="task-performance-point latency"><title>{`${point.month.label}: ${Math.round(point.p95LatencyMs)}ms P95 latency across ${traceLabel(point.traceCount)}`}</title></circle>}
    </g>)}
  </svg></div>;
}

function CostChart({ series, months }: { series: ReturnType<typeof taskGroupCostSeries>; months: Array<{ key: string; label: string }> }) {
  const costMax = niceMax(Math.max(...series.flatMap((item) => item.points.flatMap((point) => point.averageCostUsd === null ? [] : [point.averageCostUsd])), .000001));
  return <><div className="task-performance-legend" aria-label="Task Group cost chart legend">{series.map((item, index) => <span key={item.id}><i style={{ background: chartColors[index % chartColors.length] }}/>{item.label}</span>)}</div><div className="task-performance-chart-wrap"><svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Monthly average trace cost by Task Group">
    {[0, .25, .5, .75, 1].map((tick) => {const y=plot.top+(1-tick)*plotHeight;return <g key={tick}><line x1={plot.left} x2={chartWidth-plot.right} y1={y} y2={y} className="task-performance-gridline"/><text x={plot.left-10} y={y+4} textAnchor="end">{money(tick*costMax)}</text></g>})}
    <text x={plot.left} y={16} className="task-performance-axis-title">Average cost per trace</text>
    {months.map((month,index)=><text key={month.key} x={xFor(index,months.length)} y={chartHeight-10} textAnchor="middle">{month.label}</text>)}
    {series.map((item,seriesIndex)=>{const points=item.points.map((point,index)=>point.averageCostUsd===null?null:{x:xFor(index,months.length),y:scaledY(point.averageCostUsd,costMax)});return <g key={item.id}>{lineSegments(points).map((segment,index)=><polyline key={index} points={segment.map((point)=>`${point.x},${point.y}`).join(" ")} className="task-performance-line cost" style={{stroke:chartColors[seriesIndex%chartColors.length]}}/>)}{item.points.map((point,index)=>point.averageCostUsd===null?null:<circle key={point.month.key} cx={xFor(index,months.length)} cy={scaledY(point.averageCostUsd,costMax)} r="5" className="task-performance-point cost" style={{fill:chartColors[seriesIndex%chartColors.length]}}><title>{`${item.label} · ${point.month.label}: ${money(point.averageCostUsd)} average across ${traceLabel(point.costTraceCount)}`}</title></circle>)}</g>})}
  </svg></div></>;
}

export function TaskGroupPerformance({ traces, taskGroups, traceJudgeResults }: { traces: Trace[]; taskGroups: DistinctTaskBucket[]; traceJudgeResults: TraceJudgeResult[] }) {
  const [tab, setTab] = useState<"quality-latency" | "cost">("quality-latency");
  const history = useMemo(() => taskGroupPerformanceHistory(traces, taskGroups, traceJudgeResults), [traces, taskGroups, traceJudgeResults]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  useEffect(() => {
    if (!history.series.some((item) => item.id === selectedGroupId)) setSelectedGroupId(history.series[0]?.id ?? "");
  }, [history.series, selectedGroupId]);
  const selected = history.series.find((item) => item.id === selectedGroupId) ?? history.series[0];
  const costSeries = useMemo(() => taskGroupCostSeries(history.series), [history.series]);
  return <section className="panel task-performance-panel" aria-labelledby="task-performance-title">
    <div className="task-performance-head"><div><p className="eyebrow">Task Group performance</p><h2 id="task-performance-title">Monthly quality, latency, and cost</h2><p>Compare observed production performance across the recurring work your agent handles.</p></div><div className="task-performance-tabs" role="tablist" aria-label="Task Group performance metric"><button type="button" role="tab" aria-selected={tab==="quality-latency"} className={tab==="quality-latency"?"active":""} onClick={()=>setTab("quality-latency")}>Quality vs latency</button><button type="button" role="tab" aria-selected={tab==="cost"} className={tab==="cost"?"active":""} onClick={()=>setTab("cost")}>Cost</button></div></div>
    {!history.months.length||!history.series.length?<div className="task-performance-empty"><b>No Task Group history yet</b><span>Import traces and generate Task Groups to populate monthly performance.</span></div>:tab==="quality-latency"&&selected?<><div className="task-performance-controls"><label>Task Group<select value={selected.id} onChange={(event)=>setSelectedGroupId(event.target.value)}>{history.series.map((item)=><option value={item.id} key={item.id}>{item.label} · {item.traceCount} traces</option>)}</select></label><div className="task-performance-legend metric"><span><i className="quality"/>Average quality</span><span><i className="latency"/>P95 latency</span></div></div><QualityLatencyChart points={selected.points}/></>:<><div className="task-performance-note">Top five Task Groups by traffic, plus a weighted “Other Task Groups” series.</div><CostChart series={costSeries} months={history.months}/></>}
  </section>;
}
