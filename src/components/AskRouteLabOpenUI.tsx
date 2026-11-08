import { createContext, useContext } from "react";
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { z } from "zod/v4";
import type { AskRouteLabMetricKey, AskRouteLabMetricsData } from "../core/askChatLab";

const emptyMetrics: AskRouteLabMetricsData = {
  summary: { totalTraces: 0, classifierActive: false, classifiedRequests: 0, classifierMatchedRequests: 0, classifierFallbackRequests: 0, recentTraces: 0, priorTraces: 0, totalCostUsd: 0, averageLatencyMs: 0, scoredTraces: 0, averageQuality: null },
  weekly: [],
  taskGroups: [],
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

function chartGeometry(values: Array<number | null>, width: number, height: number) {
  const numeric = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const max = Math.max(...numeric, 1);
  const min = Math.min(...numeric, 0);
  const range = Math.max(max - min, max * .1, 1e-6);
  return values.map((value, index) => value === null ? null : {
    x: values.length < 2 ? width / 2 : 12 + index / (values.length - 1) * (width - 24),
    y: 10 + (max - value) / range * (height - 34),
  });
}

function ChartShell({ title, subtitle, labels, values, metric, style }: { title: string; subtitle: string; labels: string[]; values: Array<number | null>; metric: AskRouteLabMetricKey; style: "line" | "bar" }) {
  const width = 390;
  const height = 180;
  const meta = metricMeta[metric];
  const points = chartGeometry(values, width, height);
  const validPoints = points.filter((point): point is { x: number; y: number } => point !== null);
  return <section className="ask-openui-chart"><div><b>{title}</b><span>{subtitle}</span></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${meta.label}`}>
    {[.25, .5, .75].map((tick) => <line key={tick} x1="12" x2={width - 12} y1={10 + tick * (height - 34)} y2={10 + tick * (height - 34)} className="ask-openui-grid" />)}
    {style === "line" && validPoints.length > 1 ? <polyline points={validPoints.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={meta.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /> : null}
    {values.map((value, index) => {
      const point = points[index];
      if (value === null || !point) return null;
      const barWidth = Math.max(8, Math.min(30, (width - 30) / Math.max(1, values.length) - 8));
      return style === "bar"
        ? <rect key={`${labels[index]}-${value}`} x={point.x - barWidth / 2} y={point.y} width={barWidth} height={height - 24 - point.y} rx="2" fill={meta.color}><title>{`${labels[index]}: ${meta.format(value)}`}</title></rect>
        : <circle key={`${labels[index]}-${value}`} cx={point.x} cy={point.y} r="5" fill={meta.color} stroke="#fff" strokeWidth="2"><title>{`${labels[index]}: ${meta.format(value)}`}</title></circle>;
    })}
    {labels.map((label, index) => {
      const point = points[index];
      if (!point || (labels.length > 6 && index % 2)) return null;
      return <text key={label} x={point.x} y={height - 5} textAnchor="middle">{label.length > 12 ? `${label.slice(0, 11)}…` : label}</text>;
    })}
  </svg></section>;
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

const DashboardChild = z.union([MetricCard.ref, Summary.ref, TrendChart.ref, TaskGroupChart.ref]);
const Dashboard = defineComponent({
  name: "Dashboard",
  description: "Responsive root layout for an Ask RouteLab metrics answer.",
  props: z.object({ children: z.array(DashboardChild) }),
  component: ({ props, renderNode }) => <div className="ask-openui-dashboard">{renderNode(props.children)}</div>,
});

export const askRouteLabOpenUILibrary = createLibrary({
  id: "routelab-metrics-v1",
  root: "Dashboard",
  components: [Dashboard, Summary, MetricCard, TrendChart, TaskGroupChart],
  componentGroups: [
    { name: "Summary", components: ["Summary", "MetricCard"] },
    { name: "Charts", components: ["TrendChart", "TaskGroupChart"], notes: ["Every response must include at least one chart.", "Use TrendChart for change over time and TaskGroupChart for workload comparisons."] },
    { name: "Layout", components: ["Dashboard"] },
  ],
});

export function AskRouteLabOpenUI({ response, data }: { response: string; data: AskRouteLabMetricsData }) {
  return <MetricsContext.Provider value={data}><div className="ask-openui-renderer" data-renderer="openui"><Renderer response={response} library={askRouteLabOpenUILibrary} isStreaming={false} /></div></MetricsContext.Provider>;
}
