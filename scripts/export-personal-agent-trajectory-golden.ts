import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { goldenEvidenceFieldsFromTrace } from "../src/core/evaluationEvidence";
import type { GoldenDatasetRow, Trace } from "../src/types";

const root = process.cwd();
const tracesPath = path.join(root, "datasets/personal-agent/personal-agent-traces-300.jsonl");
const labelsPath = path.join(root, "datasets/personal-agent/personal-agent-golden-calibration-100.csv");
const outputPaths = [
  path.join(root, "datasets/personal-agent/personal-agent-trajectory-golden-20.csv"),
  path.join(root, "public/samples/personal-agent-trajectory-golden-20.csv"),
];

const traces = fs.readFileSync(tracesPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Trace);
const traceById = new Map(traces.map((trace) => [trace.id, trace]));
const parsed = Papa.parse<Record<string, string>>(fs.readFileSync(labelsPath, "utf8"), { header: true, skipEmptyLines: true });

const labels = parsed.data.filter((row) => traceById.has(row.trace_id));
const groups = [...new Set(labels.map((row) => row.task_group))];
const selected: Array<Record<string, string>> = [];
for (const group of groups) {
  const groupRows = labels.filter((row) => row.task_group === group);
  const passing = groupRows.find((row) => row.human_passed === "true");
  const failing = groupRows.find((row) => row.human_passed === "false");
  if (passing) selected.push(passing);
  if (failing) selected.push(failing);
  if (selected.length >= 20) break;
}
for (const row of labels) {
  if (selected.length >= 20) break;
  if (!selected.some((selectedRow) => selectedRow.trace_id === row.trace_id)) selected.push(row);
}

const booleanValue = (value: string) => value.trim().toLowerCase() === "true";
const numberValue = (value: string) => value.trim() === "" ? null : Number(value);

const rows: GoldenDatasetRow[] = selected.slice(0, 20).map((label) => {
  const trace = traceById.get(label.trace_id)!;
  return {
    ...goldenEvidenceFieldsFromTrace(trace),
    task_type: label.task_type,
    task_group: label.task_group,
    model: label.model,
    prompt: label.prompt,
    human_answer: label.human_answer,
    human_passed: booleanValue(label.human_passed),
    human_score: numberValue(label.human_score),
    human_severity: label.human_severity || null,
    human_rationale: label.human_rationale,
    case_type: label.case_type,
    risk_level: label.risk_level,
    label_source: "curated_synthetic_fixture",
    review_status: "prefilled_needs_human_confirmation",
  };
});

const columns = [
  "evidence_schema_version", "evaluation_scope", "evidence_fingerprint", "trace_id", "task_type", "task_group", "model",
  "user_request", "system_instructions_json", "prior_conversation_json", "available_tools_json", "retrieved_context_json",
  "execution_spans_json", "tool_calls_json", "tool_results_json", "prompt", "agent_answer", "trajectory_status", "workflow_json",
  "evidence_metadata_json", "human_answer", "human_passed", "human_score", "human_severity", "human_rationale", "case_type",
  "risk_level", "label_source", "review_status",
];
const csv = `${Papa.unparse(rows, { columns })}\n`;
for (const outputPath of outputPaths) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, csv);
}
console.log(`Wrote ${rows.length} trajectory-labeled rows to ${outputPaths.map((value) => path.relative(root, value)).join(" and ")}.`);
