import type { LibrarySpec, SystemPromptOptions } from "@openuidev/lang-core";
import type { AskRouteLabMetricKey, AskRouteLabMetricsData } from "./askChatLab.js";

export const askRouteLabOpenUISpec: LibrarySpec = {
  id: "routelab-metrics-v1",
  root: "Dashboard",
  components: {
    Dashboard: {
      signature: "Dashboard(children: (MetricCard | Summary | TrendChart | TaskGroupChart | QualityComparison)[])",
      description: "Responsive root layout for an Ask RouteLab metrics answer.",
    },
    Summary: {
      signature: 'Summary(focus: "overview" | "requests" | "classifier" | "cost" | "latency" | "quality")',
      description: "A concise deterministic summary of the selected metric focus.",
    },
    MetricCard: {
      signature: 'MetricCard(metric: "requests" | "classifier_requests" | "cost" | "latency" | "quality")',
      description: "A grounded RouteLab KPI card. The metric value comes from RouteLab data, never from the model.",
    },
    TrendChart: {
      signature: 'TrendChart(metric: "requests" | "classifier_requests" | "cost" | "latency" | "quality", style?: "line" | "bar")',
      description: "An eight-week RouteLab trend chart backed by deterministic workspace metrics.",
    },
    TaskGroupChart: {
      signature: 'TaskGroupChart(metric: "requests" | "classifier_requests" | "cost" | "latency" | "quality")',
      description: "A comparison of the largest Task Groups using grounded RouteLab metrics.",
    },
    QualityComparison: {
      signature: "QualityComparison()",
      description: "A deterministic comparison of Task Group quality against the scored workspace average.",
    },
  },
  componentGroups: [
    { name: "Summary", components: ["Summary", "MetricCard"] },
    {
      name: "Charts",
      components: ["TrendChart", "TaskGroupChart", "QualityComparison"],
      notes: ["Every response must include at least one chart.", "Use TrendChart for change over time, TaskGroupChart for general workload comparisons, and QualityComparison for below-average Task Group questions."],
    },
    { name: "Layout", components: ["Dashboard"] },
  ],
};

export const askRouteLabOpenUIPromptOptions: SystemPromptOptions = {
  preamble: "You compose concise RouteLab metric dashboards using OpenUI Lang. RouteLab components read all values from trusted application data.",
  additionalRules: [
    "Return only OpenUI Lang.",
    "Use 2 to 4 MetricCard components and at least one chart in every response.",
    "Choose metrics relevant to the user's question. For a broad metrics question, include requests, quality, latency, and cost with two complementary charts.",
    "For classifier status, classifier traffic, or classified-request questions, use Summary classifier and classifier_requests. Never use total requests as the classifier-processed count.",
    "For questions asking whether any Task Groups are worse, below average, lagging, or underperforming, use Summary quality and QualityComparison. Do not substitute a generic TaskGroupChart.",
    "Never write or calculate metric values. Components load values from RouteLab.",
    "Do not use quality components when quality data is unavailable.",
    "Keep dashboards compact: one Summary, at most four MetricCards, and at most two charts.",
  ],
  examples: [
    'root = Dashboard([summary, requests, quality, trend, groups])\nsummary = Summary("overview")\nrequests = MetricCard("requests")\nquality = MetricCard("quality")\ntrend = TrendChart("requests", "line")\ngroups = TaskGroupChart("quality")',
    'root = Dashboard([summary, cost, trend, groups])\nsummary = Summary("cost")\ncost = MetricCard("cost")\ntrend = TrendChart("cost", "bar")\ngroups = TaskGroupChart("cost")',
    'root = Dashboard([summary, processed, trend, groups])\nsummary = Summary("classifier")\nprocessed = MetricCard("classifier_requests")\ntrend = TrendChart("classifier_requests", "line")\ngroups = TaskGroupChart("classifier_requests")',
    'root = Dashboard([summary, quality, comparison])\nsummary = Summary("quality")\nquality = MetricCard("quality")\ncomparison = QualityComparison()',
  ],
};

export function fallbackAskRouteLabOpenUI(question: string, hasQuality: boolean) {
  const normalized = question.toLowerCase();
  const qualityComparison = /task group|task groups|workload|workloads/.test(normalized) && /worse|below|underperform|lowest|lagging/.test(normalized);
  if (qualityComparison) return [
    "root = Dashboard([summary, quality, comparison])",
    'summary = Summary("quality")',
    'quality = MetricCard("quality")',
    "comparison = QualityComparison()",
  ].join("\n");
  const classifier = /classifier|classification|classified/.test(normalized);
  const focus: AskRouteLabMetricKey = classifier
    ? "classifier_requests"
    : /cost|spend|price/.test(normalized)
    ? "cost"
    : /latency|slow|speed|fast/.test(normalized)
      ? "latency"
      : /quality|score|eval/.test(normalized) && hasQuality
        ? "quality"
        : "requests";
  const secondary: AskRouteLabMetricKey = focus === "classifier_requests" ? "requests" : focus === "requests" && hasQuality ? "quality" : focus === "cost" ? "requests" : "cost";
  const groupMetric = focus === "requests" ? secondary : focus;
  return [
    "root = Dashboard([summary, primary, secondary, trend, groups])",
    `summary = Summary("${focus === "classifier_requests" ? "classifier" : focus === "requests" ? "overview" : focus}")`,
    `primary = MetricCard("${focus}")`,
    `secondary = MetricCard("${secondary}")`,
    `trend = TrendChart("${focus}", "line")`,
    `groups = TaskGroupChart("${groupMetric}")`,
  ].join("\n");
}

export type AskRouteLabOpenUIResponse = { openui: string; renderer: "openui"; model: string };
export type AskRouteLabOpenUIMessage = { openui: string; metrics: AskRouteLabMetricsData };
