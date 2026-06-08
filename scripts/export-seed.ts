import { mkdirSync, writeFileSync } from "node:fs";
import { createSeedTraces } from "../src/core/seed";
import { modelCatalog } from "../src/core/catalog";
mkdirSync("fixtures", { recursive: true });
writeFileSync("fixtures/seed_traces.jsonl", createSeedTraces().map((trace) => JSON.stringify(trace)).join("\n") + "\n");
writeFileSync("fixtures/seed_model_catalog.json", JSON.stringify(modelCatalog, null, 2) + "\n");
console.log("Exported 540 seed traces and model catalog.");
