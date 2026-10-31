import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { goldenEvidenceFieldsFromTrace } from "../src/core/evaluationEvidence";
import { applyPersonalAgentHumanRubricReview, PERSONAL_AGENT_CURATED_REVIEW_IDS } from "../src/core/personalAgentHumanCalibration";
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
const labelsByTraceId = new Map(parsed.data.map((row) => [row.trace_id, row]));

const rows: GoldenDatasetRow[] = PERSONAL_AGENT_CURATED_REVIEW_IDS.map((traceId) => {
  const label = labelsByTraceId.get(traceId);
  if (!label) throw new Error(`Missing source reference row for ${traceId}.`);
  const trace = traceById.get(label.trace_id)!;
  return applyPersonalAgentHumanRubricReview({
    ...goldenEvidenceFieldsFromTrace(trace),
    task_type: label.task_type,
    task_group: label.task_group,
    model: label.model,
    prompt: label.prompt,
    human_answer: label.human_answer,
    case_type: label.case_type,
    risk_level: label.risk_level,
  }, trace);
});

const columns = [
  "evidence_schema_version", "evaluation_scope", "evidence_fingerprint", "trace_id", "task_type", "task_group", "model",
  "user_request", "system_instructions_json", "prior_conversation_json", "available_tools_json", "retrieved_context_json",
  "execution_spans_json", "tool_calls_json", "tool_results_json", "prompt", "agent_answer", "trajectory_status", "workflow_json",
  "evidence_metadata_json", "human_answer", "human_passed", "human_score", "human_severity", "human_rationale",
  "human_rubric_id", "human_rubric_version", "human_review_scope", "human_evidence_fingerprint",
  "human_dimension_scores_json", "human_hard_failures_json", "case_type", "risk_level", "label_source", "review_status",
];
const csv = `${Papa.unparse(rows, { columns, newline: "\n" })}\n`;
for (const outputPath of outputPaths) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, csv);
}
console.log(`Wrote ${rows.length} trajectory-labeled rows to ${outputPaths.map((value) => path.relative(root, value)).join(" and ")}.`);
