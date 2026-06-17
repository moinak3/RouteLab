export const money = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;

export const pct = (value: number) => `${value.toFixed(1)}%`;

export const preview = (value = "", length = 360) => value.length > length ? `${value.slice(0, length).trim()}...` : value;

export const stripJudgeMarker = (value = "") => value.replace(/^\[(PASS|FAIL_MINOR|FAIL_MAJOR|FAIL_CRITICAL)\]\s*/,"");

export const compareText = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

export const download = (name: string, content: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
};
