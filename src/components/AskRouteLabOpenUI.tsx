import { createContext, useContext } from "react";
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { z } from "zod/v4";
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AskRouteLabMetricKey, AskRouteLabMetricsData } from "../core/askChatLab";
import { RouteLabChartTooltip, routeLabChartTheme } from "./charts/RouteLabChartPrimitives";

const emptyMetrics: AskRouteLabMetricsData = {
  summary: { totalTraces: 0, classifierActive: false, classifiedRequests: 0, classifierMatchedRequests: 0, classifierFallbackRequests: 0, recentTraces: 0, priorTraces: 0, totalCostUsd: 0, averageLatencyMs: 0, scoredTraces: 0, averageQuality: null },
  weekly: [],
  taskGroups: [],
  qualityComparison: { workspaceAverage: null, scoredTaskGroupCount: 0, belowAverage: [] },
};

const MetricsContext = createContext<AskRouteLabMetricsData>(emptyMetrics);
const metricSchema = z.enum(["requests", "classifier_requests", "cost", "latency", "quality"]);
const formatMoney = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const metricMeta: Record<AskRouteLabMetricKey, { label: string; color: string; format: (value: number) => string }> = {
  requests: { label: "Requests", color: "#2876d2", format: (value) => Math.round(value).toLocaleString() },
  classifier_requests: { label: "Classifier requests", color: "#25834a", format: (value) => Math.round(value).toLocaleString() },
  cost: { label: "Observed cost", color: "#b16a16", format: formatMoney },
  latency: { label: "Latency", color: "#8257b8", format: (value) => `${Math.round(value)}ms` },
  quality: { label: "Average quality", color: "#25834a", format: formatPercent },
};

function metricValue(data: AskRouteLabMetricsData, metric: AskRouteLabMetricKey) {
  if (metric === "requests") return data.summary.totalTraces;
  if (metric === "classifier_requests") return data.summary.classifiedRequests;
  if (metric === "cost") return data.summary.totalCostUsd;
  if (metric === "latency") return data.summary.averageLatencyMs;
  return data.summary.averageQuality;
}

const MetricCard = defineComponent({
  name: "MetricCard",
  description: "A grounded RouteLab KPI card. The metric value comes from RouteLab data, never from the model.",
  props: z.object({ metric: metricSchema }),
  component: ({ props }) => {
    const data = useContext(MetricsContext);
    const meta = metricMeta[props.metric];
    const value = metricValue(data, props.metric);
    const detail = props.metric === "requests"
      ? `${data.summary.recentTraces.toLocaleString()} in the latest week`
      : props.metric === "classifier_requests"
        ? `${data.summary.classifiedRequests.toLocaleString()} of ${data.summary.totalTraces.toLocaleString()} workspace traces`
      : props.metric === "quality"
        ? `${data.summary.scoredTraces.toLocaleString()} scored traces`
        : props.metric === "latency"
          ? "Average across observed traces"
          : "Total observed trace cost";
    return <section className="ask-openui-metric"><small>{meta.label}</small><strong>{value === null ? "Not scored" : meta.format(value)}</strong><span>{detail}</span></section>;
  },
});

const Summary = defineComponent({
  name: "Summary",
  description: "A concise deterministic summary of the selected metric focus.",
  props: z.object({ focus: z.enum(["overview", "requests", "classifier", "cost", "latency", "quality"]) }),
  component: ({ props }) => {
    const data = useContext(MetricsContext);
    const change = data.summary.recentTraces - data.summary.priorTraces;
    const text = props.focus === "classifier"
      ? `The classifier is ${data.summary.classifierActive ? "active" : "inactive"}. It has processed ${data.summary.classifiedRequests.toLocaleString()} of ${data.summary.totalTraces.toLocaleString()} workspace traces; ${Math.max(0, data.summary.totalTraces - data.summary.classifiedRequests).toLocaleString()} imported traces have no recorded classifier decision.`
      : props.focus === "requests" || props.focus === "overview"
      ? `${data.summary.totalTraces.toLocaleString()} traces are in this workspace. The latest week is ${change === 0 ? "unchanged" : `${Math.abs(change).toLocaleString()} ${change > 0 ? "higher" : "lower"}`} than the previous week.`
      : props.focus === "cost"
        ? `${formatMoney(data.summary.totalCostUsd)} in observed trace cost across ${data.summary.totalTraces.toLocaleString()} traces.`
        : props.focus === "latency"
          ? `Average observed latency is ${Math.round(data.summary.averageLatencyMs).toLocaleString()}ms.`
          : data.summary.averageQuality === null
            ? "No traces have a quality score from the active eval yet."
            : `Average quality is ${formatPercent(data.summary.averageQuality)} across ${data.summary.scoredTraces.toLocaleString()} scored traces.`;
    return <p className="ask-openui-summary">{text}</p>;
  },
});

function ChartShell({ title, subtitle, labels, values, metric, style }: { title: string; subtitle: string; labels: string[]; values: Array<number | null>; metric: AskRouteLabMetricKey; style: "line" | "bar" }) {
  const meta = metricMeta[metric];
  const data = labels.map((label, index) => ({ label, value: values[index] }));
  const shared = <>
    <CartesianGrid vertical={false} stroke={routeLabChartTheme.grid} strokeDasharray="3 5" />
    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: routeLabChartTheme.axis, fontSize: 10 }} interval="preserveStartEnd" dy={7} />
    <YAxis hide domain={metric === "quality" ? [0, 1] : [0, "auto"]} />
    <Tooltip cursor={{ fill: routeLabChartTheme.cursor }} content={<RouteLabChartTooltip valueFormatter={(value) => meta.format(value)} />} />
  </>;
  return <section className="ask-openui-chart"><div className="ask-openui-chart-header"><b>{title}</b><span>{subtitle}</span></div><div className="ask-openui-chart-stage" role="img" aria-label={`${title}: ${meta.label}`}>
    <ResponsiveContainer width="100%" height={190}>
      {style === "bar" ? <RechartsBarChart data={data} margin={{ top: 12, right: 8, bottom: 2, left: 8 }} accessibilityLayer>
        {shared}
        <Bar dataKey="value" name={meta.label} fill={meta.color} radius={[5, 5, 1, 1]} maxBarSize={34} animationDuration={450} />
      </RechartsBarChart> : <RechartsLineChart data={data} margin={{ top: 12, right: 8, bottom: 2, left: 8 }} accessibilityLayer>
        {shared}
        <Line type="monotone" dataKey="value" name={meta.label} stroke={meta.color} strokeWidth={3} dot={{ r: 4, fill: meta.color, stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls={false} animationDuration={450} />
      </RechartsLineChart>}
    </ResponsiveContainer>
  </div></section>;
}

const TrendChart = defineComponent({
  name: "TrendChart",
  description: "An eight-week RouteLab trend chart backed by deterministic workspace metrics.",
  props: z.object({ metric: metricSchema, style: z.enum(["line", "bar"]).optional() }),
  component: ({ props }) => {
    const data = useContext(MetricsContext);
    return <ChartShell title={`${metricMeta[props.metric].label} over time`} subtitle="Eight weekly windows" labels={data.weekly.map((item) => item.label)} values={data.weekly.map((item) => item[props.metric])} metric={props.metric} style={props.style ?? "line"} />;
  },
});

const TaskGroupChart = defineComponent({
  name: "TaskGroupChart",
  description: "A comparison of the largest Task Groups using grounded RouteLab metrics.",
  props: z.object({ metric: metricSchema }),
  component: ({ props }) => {
    const data = useContext(MetricsContext);
    return <ChartShell title={`${metricMeta[props.metric].label} by Task Group`} subtitle="Largest groups by request volume" labels={data.taskGroups.map((item) => item.label)} values={data.taskGroups.map((item) => item[props.metric])} metric={props.metric} style="bar" />;
  },
});

const QualityComparison = defineComponent({
  name: "QualityComparison",
  description: "A deterministic comparison of Task Group quality against the scored workspace average.",
  props: z.object({}),
  component: () => {
    const { qualityComparison } = useContext(MetricsContext);
    if (qualityComparison.workspaceAverage === null) return <section className="ask-openui-comparison"><div><b>Task Group quality comparison</b><span>No active-eval scores are available.</span></div></section>;
    const chartHeight = Math.max(150, qualityComparison.belowAverage.length * 46 + 48);
    return <section className="ask-openui-comparison" aria-label="Task Groups below workspace average quality">
      <header><div><b>Below workspace average</b><span>{qualityComparison.belowAverage.length} of {qualityComparison.scoredTaskGroupCount} scored Task Groups</span></div><strong>{formatPercent(qualityComparison.workspaceAverage)} average</strong></header>
      {qualityComparison.belowAverage.length ? <div className="ask-openui-comparison-chart" role="img" aria-label="Quality scores for Task Groups below the workspace average">
        <ul className="routelab-chart-data">{qualityComparison.belowAverage.map((group) => <li key={group.label}>{group.label}: {formatPercent(group.quality)}, {(group.gapFromAverage * 100).toFixed(1)} pts, {group.scoredTraces.toLocaleString()} scored traces</li>)}</ul>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <RechartsBarChart data={qualityComparison.belowAverage} layout="vertical" margin={{ top: 8, right: 12, bottom: 8, left: 4 }} accessibilityLayer>
            <CartesianGrid horizontal={false} stroke={routeLabChartTheme.grid} strokeDasharray="3 5" />
            <XAxis type="number" domain={[0, 1]} axisLine={false} tickLine={false} tick={{ fill: routeLabChartTheme.axis, fontSize: 10 }} tickFormatter={(value) => formatPercent(Number(value))} />
            <YAxis type="category" dataKey="label" width={118} axisLine={false} tickLine={false} tick={{ fill: routeLabChartTheme.axis, fontSize: 10 }} tickFormatter={(value) => String(value).length > 18 ? `${String(value).slice(0, 17)}…` : String(value)} />
            <Tooltip cursor={{ fill: routeLabChartTheme.cursor }} content={<RouteLabChartTooltip valueFormatter={(value, _name, source) => {
              const group = source as { scoredTraces?: number; gapFromAverage?: number };
              return `${formatPercent(value)} · ${(group.scoredTraces ?? 0).toLocaleString()} scored · ${Math.abs((group.gapFromAverage ?? 0) * 100).toFixed(1)} pts below`;
            }} />} />
            <ReferenceLine x={qualityComparison.workspaceAverage} stroke="#dc765d" strokeWidth={2} strokeDasharray="4 4" label={{ value: "Average", position: "insideTopRight", fill: "#9c3f34", fontSize: 10 }} />
            <Bar dataKey="quality" name="Average quality" fill="#58a66c" radius={[0, 5, 5, 0]} maxBarSize={22} animationDuration={450} />
          </RechartsBarChart>
        </ResponsiveContainer>
      </div> : <p className="ask-openui-comparison-empty">No scored Task Group is below the workspace average.</p>}
    </section>;
  },
});

const DashboardChild = z.union([MetricCard.ref, Summary.ref, TrendChart.ref, TaskGroupChart.ref, QualityComparison.ref]);
const Dashboard = defineComponent({
  name: "Dashboard",
  description: "Responsive root layout for an Ask RouteLab metrics answer.",
  props: z.object({ children: z.array(DashboardChild) }),
  component: ({ props, renderNode }) => <div className="ask-openui-dashboard">{renderNode(props.children)}</div>,
});

export const askRouteLabOpenUILibrary = createLibrary({
  id: "routelab-metrics-v1",
  root: "Dashboard",
  components: [Dashboard, Summary, MetricCard, TrendChart, TaskGroupChart, QualityComparison],
  componentGroups: [
    { name: "Summary", components: ["Summary", "MetricCard"] },
    { name: "Charts", components: ["TrendChart", "TaskGroupChart", "QualityComparison"], notes: ["Every response must include at least one chart.", "Use TrendChart for change over time, TaskGroupChart for general workload comparisons, and QualityComparison for below-average Task Group questions."] },
    { name: "Layout", components: ["Dashboard"] },
  ],
});

export function AskRouteLabOpenUI({ response, data }: { response: string; data: AskRouteLabMetricsData }) {
  return <MetricsContext.Provider value={data}><div className="ask-openui-renderer" data-renderer="openui"><Renderer response={response} library={askRouteLabOpenUILibrary} isStreaming={false} /></div></MetricsContext.Provider>;
}
