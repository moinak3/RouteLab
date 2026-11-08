import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money } from "../lib/format";
import { RouteLabChartTooltip, routeLabChartTheme } from "./charts/RouteLabChartPrimitives";

export function RoutingMixChart({ overrides, fallback, fallbackLabel }: { overrides: number; fallback: number; fallbackLabel: string }) {
  const total = overrides + fallback;
  const data = [{ name: "Routing mix", Overrides: overrides, [fallbackLabel]: fallback }];
  return <div className="overview-routing-chart" role="img" aria-label={total ? `${overrides} requests used Task Group overrides and ${fallback} used ${fallbackLabel}` : "No recorded routing decisions"}>
    <ResponsiveContainer width="100%" height={18}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }} accessibilityLayer>
        <XAxis type="number" hide domain={[0, Math.max(total, 1)]} />
        <YAxis type="category" dataKey="name" hide />
        <Tooltip cursor={false} content={<RouteLabChartTooltip valueFormatter={(value) => value.toLocaleString()} />} />
        <Bar dataKey="Overrides" stackId="routing" fill="#58a66c" radius={[6, 0, 0, 6]} isAnimationActive={false} />
        <Bar dataKey={fallbackLabel} stackId="routing" fill="#477ac4" radius={[0, 6, 6, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}

export function ModelCostChart({ items }: { items: Array<{ model: string; cost: number }> }) {
  const height = Math.max(170, items.length * 42 + 26);
  return <div className="overview-model-cost-chart" role="img" aria-label="Observed cost by model">
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={items} layout="vertical" margin={{ top: 4, right: 18, bottom: 4, left: 4 }} accessibilityLayer>
        <CartesianGrid horizontal={false} stroke={routeLabChartTheme.grid} strokeDasharray="3 5" />
        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: routeLabChartTheme.axis, fontSize: 11 }} tickFormatter={(value) => money(Number(value))} />
        <YAxis type="category" dataKey="model" width={132} axisLine={false} tickLine={false} tick={{ fill: routeLabChartTheme.axis, fontSize: 11 }} tickFormatter={(value) => String(value).length > 20 ? `${String(value).slice(0, 19)}…` : String(value)} />
        <Tooltip cursor={{ fill: routeLabChartTheme.cursor }} content={<RouteLabChartTooltip valueFormatter={(value) => money(value)} />} />
        <Bar dataKey="cost" name="Observed cost" fill="#58a66c" radius={[0, 5, 5, 0]} maxBarSize={20} animationDuration={450} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
