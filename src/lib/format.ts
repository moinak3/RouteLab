const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const formatCurrency = (value: number) => Math.abs(value) >= 1
  ? currency.format(value)
  : `$${Number(value).toPrecision(4).replace(/0+$/, "").replace(/\.$/, "")}`;
export const money = formatCurrency;
export const formatInteger = (value: number) => integer.format(value);
export const formatLatency = (value: number) => value >= 1_000 ? `${(value / 1_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s` : `${integer.format(value)} ms`;
export const formatPercent = (value: number, n = 100) => `${value.toLocaleString("en-US", { minimumFractionDigits: n >= 100 ? 1 : 0, maximumFractionDigits: n >= 100 ? 1 : 0 })}%`;
export const pct = formatPercent;
export const formatPoints = (value: number) => `${value > 0 ? "+" : ""}${integer.format(value)} pts`;
export const formatCostDelta = (value: number) => `${value > 0 ? "+" : ""}${integer.format(value)}%`;
export const formatDate = (value: string | Date) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
