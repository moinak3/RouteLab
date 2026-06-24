import Papa from "papaparse";
import type { FineTuneSignal, GoldenDataset, GoldenDatasetRow, Trace } from "../types";

export const EXTRA_CONTEXT_TOKEN_THRESHOLD = 1200;
const STABLE_PATTERN_MIN_TRACES = 6;
const TOKEN_CHARS = 4;

const normalizeCell = (value: unknown) => {
  if (value === undefined || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    if (trimmed.toLowerCase() === "true") return true;
    if (trimmed.toLowerCase() === "false") return false;
    return trimmed;
  }
  return value as GoldenDatasetRow[string];
};

export function parseGoldenDatasetCsv(text: string, name: string, now = new Date()): GoldenDataset {
  const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), normalizeCell(value)]).filter(([key]) => key)),
  ) as GoldenDatasetRow[];
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (!rows.length) throw new Error("CSV must include at least one data row.");
  if (!columns.length) throw new Error("CSV must include headers.");
  return {
    id: `golden_${now.getTime()}`,
    name,
    created_at: now.toISOString(),
    row_count: rows.length,
    columns,
    rows,
  };
}

export function updateGoldenDatasetCell(dataset: GoldenDataset, rowIndex: number, column: string, value: string): GoldenDataset {
  const rows = dataset.rows.map((row, index) => index === rowIndex ? { ...row, [column]: normalizeCell(value) } : row);
  return { ...dataset, rows, row_count: rows.length, columns: Array.from(new Set([...dataset.columns, column])) };
}

export function analyzeFineTuneOpportunity(traces: Trace[], thresholdTokens = EXTRA_CONTEXT_TOKEN_THRESHOLD): FineTuneSignal {
  const contextHeavy = traces.filter((trace) => {
    const prompt = trace.prompt_text.toLowerCase();
    const estimatedContextTokens = Math.max(trace.input_tokens, Math.ceil(trace.prompt_text.length / TOKEN_CHARS));
    const hasExtraContext = /few-shot|few shot|example|examples|instruction|instructions|context \[|retrieved context|policy/.test(prompt);
    return hasExtraContext && estimatedContextTokens >= thresholdTokens;
  });
  const stablePatterns = new Map<string, number>();
  contextHeavy.forEach((trace) => {
    const key = String(trace.metadata?.task_type ?? trace.workflow_role ?? trace.model ?? "unknown");
    stablePatterns.set(key, (stablePatterns.get(key) ?? 0) + 1);
  });
  const stablePatternCount = [...stablePatterns.values()].filter((count) => count >= STABLE_PATTERN_MIN_TRACES).length;
  const avgContextTokens = contextHeavy.length ? Math.round(contextHeavy.reduce((sum, trace) => sum + Math.max(trace.input_tokens, Math.ceil(trace.prompt_text.length / TOKEN_CHARS)), 0) / contextHeavy.length) : 0;
  const shouldSuggest = contextHeavy.length >= STABLE_PATTERN_MIN_TRACES && stablePatternCount > 0;
  return {
    should_suggest: shouldSuggest,
    threshold_tokens: thresholdTokens,
    matching_traces: contextHeavy.length,
    total_traces: traces.length,
    stable_pattern_count: stablePatternCount,
    estimated_context_tokens: avgContextTokens,
    reason: shouldSuggest
      ? `${contextHeavy.length} traces repeatedly include extra context above ${thresholdTokens.toLocaleString()} tokens across ${stablePatternCount} stable pattern${stablePatternCount === 1 ? "" : "s"}. Fine-tuning could move instructions and examples into weights and reduce token cost.`
      : `No stable context-heavy pattern currently exceeds ${thresholdTokens.toLocaleString()} tokens often enough to recommend fine-tuning.`,
  };
}
