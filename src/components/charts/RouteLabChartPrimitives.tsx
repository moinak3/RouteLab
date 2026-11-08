import type { ReactNode } from "react";
import type { TooltipContentProps } from "recharts";

export const routeLabChartColors = [
  "#58a66c",
  "#477ac4",
  "#9a6ed8",
  "#d6a73e",
  "#dc765d",
  "#50aaa1",
  "#b36b9c",
  "#6f7f78",
];

export const routeLabChartTheme = {
  grid: "rgba(82, 96, 117, .18)",
  axis: "#607086",
  cursor: "rgba(71, 122, 196, .09)",
};

type RouteLabTooltipProps = Partial<TooltipContentProps<number, string>> & {
  valueFormatter?: (value: number, name: string, source: unknown) => ReactNode;
  labelFormatter?: (label: ReactNode) => ReactNode;
};

export function RouteLabChartTooltip({
  active,
  payload,
  label,
  valueFormatter = (value) => value.toLocaleString(),
  labelFormatter = (value) => value,
}: RouteLabTooltipProps) {
  const visible = payload?.filter((entry) => typeof entry.value === "number" && Number.isFinite(entry.value));
  if (!active || !visible?.length) return null;
  return <div className="routelab-chart-tooltip">
    <b>{labelFormatter(label)}</b>
    <div>{visible.map((entry, index) => {
      const name = String(entry.name ?? entry.dataKey ?? "Value");
      const value = Number(entry.value);
      return <span key={`${name}-${index}`}>
        <i style={{ backgroundColor: entry.color ?? routeLabChartColors[index % routeLabChartColors.length] }} />
        <em>{name}</em>
        <strong>{valueFormatter(value, name, entry.payload)}</strong>
      </span>;
    })}</div>
  </div>;
}

export function RouteLabChartLegend({ items }: { items: Array<{ label: string; color: string; detail?: string }> }) {
  return <div className="routelab-chart-legend" aria-label="Chart legend">
    {items.map((item) => <span key={item.label} title={item.detail}>
      <i style={{ backgroundColor: item.color }} />
      {item.label}
    </span>)}
  </div>;
}
