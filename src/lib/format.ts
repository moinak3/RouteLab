const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const formatCurrency = (value: number) => {
  if (Math.abs(value) >= 1) return currency.format(value);
  if (value === 0) return "$0";
  if (Math.abs(value) < .001) {
    const cents = Number(value * 100).toPrecision(4).replace(/0+$/, "").replace(/\.$/, "");
    return `${cents}¢`;
  }
  return `$${Number(value).toPrecision(4).replace(/0+$/, "").replace(/\.$/, "")}`;
};
export const money = formatCurrency;
export const formatInteger = (value: number) => integer.format(value);
export const formatDecimal = (value: number, maximumFractionDigits = 1) => value.toLocaleString("en-US", { maximumFractionDigits, minimumFractionDigits: maximumFractionDigits });
export const formatLatency = (value: number) => value >= 1_000 ? `${(value / 1_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s` : `${integer.format(value)} ms`;
export const formatPercent = (value: number, n = 100) => `${value.toLocaleString("en-US", { minimumFractionDigits: n >= 100 ? 1 : 0, maximumFractionDigits: n >= 100 ? 1 : 0 })}%`;
export const pct = formatPercent;
export const formatPoints = (value: number) => `${value > 0 ? "+" : ""}${integer.format(value)} pts`;
export const formatCostDelta = (value: number) => `${value > 0 ? "+" : ""}${integer.format(value)}%`;
export const formatDate = (value: string | Date) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const formatModelPrice = (input: number, output: number) => `${formatCurrency(input)} input / ${formatCurrency(output)} output per 1M tokens`;
export const formatSignedMonthlyEconomics = (value: number) => value >= 0
  ? { text: `${formatCurrency(value)}/mo`, label: "savings", favorable: true }
  : { text: `+${formatCurrency(Math.abs(value))}/mo`, label: "vs routing", favorable: false };

export const preview = (value = "", length = 360) => value.length > length ? `${value.slice(0, length).trim()}...` : value;

export const stripJudgeMarker = (value = "") => value;

export const compareText = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

export const download = (name: string, content: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
};
