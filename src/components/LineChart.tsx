import type { ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlyBucket } from "../core/time";
import {
  RouteLabChartLegend,
  RouteLabChartTooltip,
  routeLabChartColors,
  routeLabChartTheme,
} from "./charts/RouteLabChartPrimitives";

type ChartMetric = "calls" | "spend" | "tokens" | "quality" | "latency";
type ChartSeries = Array<{ name: string; buckets: MonthlyBucket[] }>;

export function LineChart({
  title,
  series,
  metric,
  format,
  icon,
  summaryValue,
}: {
  title: string;
  series: ChartSeries;
  metric: ChartMetric;
  format: (value: number) => string;
  icon?: ReactNode;
  summaryValue?: number;
}) {
  const labels = series[0]?.buckets ?? [];
  const allValues = series.flatMap((item) => item.buckets.map((bucket) => bucket[metric]));
  const total = summaryValue ?? (metric === "quality" || metric === "latency"
    ? (allValues.length ? allValues.reduce((sum, value) => sum + value, 0) / allValues.length : 0)
    : allValues.reduce((sum, value) => sum + value, 0));
  const data = labels.map((bucket, index) => {
    const row: Record<string, string | number> = { key: bucket.key, label: bucket.label };
    series.forEach((item) => { row[item.name] = item.buckets[index]?.[metric] ?? 0; });
    return row;
  });

  return <article className="trend-chart">
    <div className="trend-chart-head"><span>{icon}</span><b>{title}</b><strong>{format(total)}</strong></div>
    <div className="chart-stage routelab-chart-stage" role="img" aria-label={`${title} monthly line chart`}>
      <ResponsiveContainer width="100%" height={142}>
        <RechartsLineChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 8 }} accessibilityLayer>
          <defs>
            <filter id={`chart-glow-${metric}`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <CartesianGrid vertical={false} stroke={routeLabChartTheme.grid} strokeDasharray="3 5" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: routeLabChartTheme.axis, fontSize: 11 }} dy={7} />
          <YAxis hide domain={metric === "quality" ? [0, 1] : [0, "auto"]} />
          <Tooltip
            cursor={{ stroke: routeLabChartTheme.axis, strokeDasharray: "3 4", strokeWidth: 1 }}
            content={<RouteLabChartTooltip valueFormatter={(value) => format(value)} />}
          />
          {series.map((item, index) => <Line
            key={item.name}
            type="monotone"
            dataKey={item.name}
            name={item.name}
            stroke={routeLabChartColors[index % routeLabChartColors.length]}
            strokeWidth={3}
            dot={{ r: 3, fill: routeLabChartColors[index % routeLabChartColors.length], stroke: "#0b1118", strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
            filter={index === 0 ? `url(#chart-glow-${metric})` : undefined}
            connectNulls={false}
            isAnimationActive
            animationDuration={450}
          />)}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
    {series.length > 1 ? <RouteLabChartLegend items={series.map((item, index) => ({ label: item.name, color: routeLabChartColors[index % routeLabChartColors.length] }))} /> : null}
  </article>;
}
