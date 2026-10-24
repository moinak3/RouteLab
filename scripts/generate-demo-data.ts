import { mkdirSync, writeFileSync } from "node:fs";
import { modelCatalog } from "../src/core/catalog";
import { createSimulatedGoldenDataset } from "../src/core/goldenDatasets";
import { createSeedTraces, REPRESENTED_MONTHLY_CALLS } from "../src/core/seed";
import { createTraceJudgeResults } from "../src/core/traceJudge";

const traces = createSeedTraces();
const judges = createTraceJudgeResults(traces);
const golden = createSimulatedGoldenDataset(traces, judges);

mkdirSync("fixtures", { recursive: true });
writeFileSync("fixtures/seed_traces.jsonl", `${traces.map((trace) => JSON.stringify(trace)).join("\n")}\n`);
writeFileSync("fixtures/seed_model_catalog.json", `${JSON.stringify(modelCatalog, null, 2)}\n`);
writeFileSync("fixtures/seed_golden_dataset.json", `${JSON.stringify(golden, null, 2)}\n`);

console.log(`Generated ${traces.length.toLocaleString()} deterministic traces representing ${REPRESENTED_MONTHLY_CALLS.toLocaleString()} monthly calls, ${golden.row_count} golden rows, and ${modelCatalog.length} catalog models.`);
