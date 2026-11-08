import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money, pct } from "../lib/format";
import type { DistinctTaskBucket, Trace, TraceJudgeResult } from "../types";
import {
  taskGroupCostSeries,
  taskGroupPerformanceHistory,
  type TaskGroupPerformancePoint,
} from "../core/taskGroupPerformance";
import {
  RouteLabChartLegend,
  RouteLabChartTooltip,
  routeLabChartColors,
  routeLabChartTheme,
} from "./charts/RouteLabChartPrimitives";

const traceLabel = (count: number) => `${count} ${count === 1 ? "trace" : "traces"}`;

function QualityLatencyChart({ points }: { points: TaskGroupPerformancePoint[] }) {
  const data = points.map((point) => ({
    month: point.month.label,
    "Average quality": point.averageQuality,
    "P95 latency": point.p95LatencyMs,
    scoredTraceCount: point.scoredTraceCount,
    traceCount: point.traceCount,
  }));
  return <div className="task-performance-chart-wrap routelab-chart-surface" role="img" aria-label="Monthly average quality and P95 latency for the selected Task Group">
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 22, right: 18, bottom: 8, left: 4 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke={routeLabChartTheme.grid} strokeDasharray="3 5" />
        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: routeLabChartTheme.axis, fontSize: 12 }} dy={8} />
        <YAxis
          yAxisId="quality"
          domain={[0, 1]}
          axisLine={false}
          tickLine={false}
          width={54}
          tick={{ fill: routeLabChartTheme.axis, fontSize: 11 }}
          tickFormatter={(value) => pct(Number(value) * 100)}
          label={{ value: "Average quality", angle: -90, position: "insideLeft", fill: routeLabChartTheme.axis, fontSize: 11 }}
        />
        <YAxis
          yAxisId="latency"
          orientation="right"
          domain={[0, "auto"]}
          axisLine={false}
          tickLine={false}
          width={62}
          tick={{ fill: routeLabChartTheme.axis, fontSize: 11 }}
          tickFormatter={(value) => `${Math.round(Number(value))}ms`}
          label={{ value: "P95 latency", angle: 90, position: "insideRight", fill: routeLabChartTheme.axis, fontSize: 11 }}
        />
        <Tooltip
          cursor={{ stroke: routeLabChartTheme.axis, strokeDasharray: "3 4" }}
          content={<RouteLabChartTooltip valueFormatter={(value, name, source) => {
            const row = source as { scoredTraceCount?: number; traceCount?: number };
            const formatted = name === "Average quality" ? pct(value * 100) : `${Math.round(value)}ms`;
            const count = name === "Average quality" ? row.scoredTraceCount : row.traceCount;
            return count === undefined ? formatted : `${formatted} · ${traceLabel(count)}`;
          }} />}
        />
        <Line yAxisId="quality" type="monotone" dataKey="Average quality" stroke="#58a66c" strokeWidth={3} dot={{ r: 4, fill: "#58a66c", stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls={false} animationDuration={450} />
        <Line yAxisId="latency" type="monotone" dataKey="P95 latency" stroke="#477ac4" strokeWidth={3} dot={{ r: 4, fill: "#477ac4", stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls={false} animationDuration={450} />
      </LineChart>
    </ResponsiveContainer>
  </div>;
}

function CostChart({ series, months }: { series: ReturnType<typeof taskGroupCostSeries>; months: Array<{ key: string; label: string }> }) {
  const data = months.map((month, monthIndex) => {
    const row: Record<string, string | number | null> = { month: month.label };
    series.forEach((item) => { row[item.id] = item.points[monthIndex]?.averageCostUsd ?? null; });
    return row;
  });
  return <>
    <RouteLabChartLegend items={series.map((item, index) => ({ label: item.label, color: routeLabChartColors[index % routeLabChartColors.length] }))} />
    <div className="task-performance-chart-wrap routelab-chart-surface" role="img" aria-label="Monthly average trace cost by Task Group">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 22, right: 18, bottom: 8, left: 6 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke={routeLabChartTheme.grid} strokeDasharray="3 5" />
          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: routeLabChartTheme.axis, fontSize: 12 }} dy={8} />
          <YAxis axisLine={false} tickLine={false} width={68} tick={{ fill: routeLabChartTheme.axis, fontSize: 11 }} tickFormatter={(value) => money(Number(value))} />
          <Tooltip cursor={{ stroke: routeLabChartTheme.axis, strokeDasharray: "3 4" }} content={<RouteLabChartTooltip valueFormatter={(value) => money(value)} />} />
          {series.map((item, index) => <Line
            key={item.id}
            type="monotone"
            dataKey={item.id}
            name={item.label}
            stroke={routeLabChartColors[index % routeLabChartColors.length]}
            strokeWidth={3}
            dot={{ r: 4, fill: routeLabChartColors[index % routeLabChartColors.length], stroke: "#fff", strokeWidth: 2 }}
            activeDot={{ r: 6 }}
            connectNulls={false}
            animationDuration={450}
          />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  </>;
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
    <div className="task-performance-head"><div><p className="eyebrow">Task Group performance</p><h2 id="task-performance-title">Monthly quality, latency, and cost</h2><p>Compare observed production performance across the recurring work your agent handles.</p></div><div className="task-performance-tabs" role="tablist" aria-label="Task Group performance metric"><button type="button" role="tab" aria-selected={tab === "quality-latency"} className={tab === "quality-latency" ? "active" : ""} onClick={() => setTab("quality-latency")}>Quality vs latency</button><button type="button" role="tab" aria-selected={tab === "cost"} className={tab === "cost" ? "active" : ""} onClick={() => setTab("cost")}>Cost</button></div></div>
    {!history.months.length || !history.series.length ? <div className="task-performance-empty"><b>No Task Group history yet</b><span>Import traces and generate Task Groups to populate monthly performance.</span></div> : tab === "quality-latency" && selected ? <><div className="task-performance-controls"><label>Task Group<select value={selected.id} onChange={(event) => setSelectedGroupId(event.target.value)}>{history.series.map((item) => <option value={item.id} key={item.id}>{item.label} · {item.traceCount} traces</option>)}</select></label><RouteLabChartLegend items={[{ label: "Average quality", color: "#58a66c" }, { label: "P95 latency", color: "#477ac4" }]} /></div><QualityLatencyChart points={selected.points} /></> : <><div className="task-performance-note">Top five Task Groups by traffic, plus a weighted “Other Task Groups” series.</div><CostChart series={costSeries} months={history.months} /></>}
  </section>;
}
