import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTraceEvaluationEvidence, evaluationEvidenceFingerprint, goldenEvidenceMatchesTrace } from "../src/core/evaluationEvidence";
import { parseGoldenDatasetCsv } from "../src/core/goldenDatasets";
import { ingestText } from "../src/core/ingestion";
import type { Trace } from "../src/types";

const traces = fs.readFileSync("datasets/personal-agent/personal-agent-traces-300.jsonl", "utf8")
  .trim().split("\n").map((line) => JSON.parse(line) as Trace);
const traceById = new Map(traces.map((trace) => [trace.id, trace]));

describe("evaluation evidence parity", () => {
  it("builds one trajectory packet without leaking labels", () => {
    const evidence = buildTraceEvaluationEvidence(traces[0]);
    const serialized = JSON.stringify(evidence);

    expect(evidence.evaluation_scope).toBe("full_trajectory");
    expect(evidence.system_instructions).toHaveLength(1);
    expect(evidence.execution_spans).toHaveLength(1);
    expect(evidence.tool_calls).toHaveLength(1);
    expect(evidence.tool_results).toHaveLength(1);
    expect(serialized).not.toContain("eval_passed");
    expect(serialized).not.toContain("eval_rationale");
    expect(serialized).not.toContain("human_feedback");
  });

  it("ships 20 uploadable golden rows whose fingerprints match imported traces", () => {
    const dataset = parseGoldenDatasetCsv(
      fs.readFileSync("datasets/personal-agent/personal-agent-trajectory-golden-20.csv", "utf8"),
      "personal-agent-trajectory-golden-20.csv",
    );

    expect(dataset.row_count).toBe(20);
    expect(dataset.columns).toEqual(expect.arrayContaining([
      "evidence_schema_version", "evaluation_scope", "evidence_fingerprint", "system_instructions_json",
      "prior_conversation_json", "available_tools_json", "execution_spans_json", "tool_calls_json", "tool_results_json",
      "agent_answer", "trajectory_status", "human_passed", "human_rationale",
    ]));
    expect(new Set(dataset.rows.map((row) => row.task_group)).size).toBe(10);
    expect(dataset.rows.some((row) => row.human_passed === true)).toBe(true);
    expect(dataset.rows.some((row) => row.human_passed === false)).toBe(true);
    const imported = ingestText(fs.readFileSync("datasets/personal-agent/personal-agent-traces-300.jsonl", "utf8"), "personal-agent-traces-300.jsonl");
    const importedById = new Map(imported.traces.map((trace) => [trace.id, trace]));
    for (const row of dataset.rows) {
      const trace = traceById.get(String(row.trace_id));
      expect(trace).toBeDefined();
      expect(goldenEvidenceMatchesTrace(row, trace)).toBe(true);
      expect(goldenEvidenceMatchesTrace(row, importedById.get(String(row.trace_id)))).toBe(true);
      expect(row.evidence_fingerprint).toBe(evaluationEvidenceFingerprint(buildTraceEvaluationEvidence(trace!)));
      expect(() => JSON.parse(String(row.execution_spans_json))).not.toThrow();
      expect(() => JSON.parse(String(row.tool_calls_json))).not.toThrow();
      expect(() => JSON.parse(String(row.tool_results_json))).not.toThrow();
    }
  });
});
