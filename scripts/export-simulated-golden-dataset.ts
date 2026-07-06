import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createSimulatedGoldenDataset } from "../src/core/goldenDatasets";
import { createSeedTraces } from "../src/core/seed";
import { createTraceJudgeResults } from "../src/core/traceJudge";

const outputPath = resolve("public/samples/routelab-simulated-golden-dataset.csv");
const traces = createSeedTraces();
const dataset = createSimulatedGoldenDataset(traces, createTraceJudgeResults(traces));
const escapeCsv = (value: unknown) => {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, [dataset.columns, ...dataset.rows.map((row) => dataset.columns.map((column) => row[column]))].map((row) => row.map(escapeCsv).join(",")).join("\n") + "\n");
console.log(`Wrote ${dataset.row_count} rows to ${outputPath}`);
