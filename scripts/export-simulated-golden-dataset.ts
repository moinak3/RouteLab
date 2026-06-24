import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createSeedTraces } from "../src/core/seed";
import { createTraceJudgeResults } from "../src/core/traceJudge";
import type { TraceJudgeResult } from "../src/types";

const outputPath = resolve("public/samples/routelab-simulated-golden-dataset.csv");
const traces = createSeedTraces();
const judgeByTraceId = new Map(createTraceJudgeResults(traces).map((result) => [result.trace_id, result]));
const escapeCsv = (value: unknown) => {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const humanOverride = (judge: TraceJudgeResult, index: number) => {
  if (index % 13 === 0) return { passed: !judge.passed, score: judge.passed ? .5 : 1, severity: judge.passed ? "major" : "" };
  if (index % 17 === 0) return { passed: false, score: .5, severity: "major" };
  return { passed: judge.passed, score: judge.score, severity: judge.severity ?? "" };
};

const selected = [
  ...traces.filter((trace) => trace.metadata?.task_type === "customer_support_responses").slice(0, 8),
  ...traces.filter((trace) => trace.metadata?.task_type === "rag_grounded_answers").slice(0, 8),
  ...traces.filter((trace) => trace.metadata?.task_type === "policy_compliance_reasoning").slice(0, 8),
  ...traces.filter((trace) => trace.metadata?.task_type === "document_review_legal_analysis").slice(0, 8),
];

const headers = ["trace_id", "task_type", "model", "prompt", "agent_answer", "expected_answer", "human_passed", "human_score", "human_severity", "human_rationale"];
const rows = selected.map((trace, index) => {
  const judge = judgeByTraceId.get(trace.id)!;
  const human = humanOverride(judge, index);
  const expected = String(trace.metadata?.expected_answer ?? trace.response_text ?? "");
  return [
    trace.id,
    trace.metadata?.task_type,
    trace.model,
    trace.prompt_text,
    trace.response_text ?? "",
    expected,
    human.passed,
    human.score,
    human.severity,
    human.passed
      ? "Human reviewer marked this answer acceptable against the expected support outcome."
      : "Human reviewer marked this answer insufficient because it misses a required fact, policy constraint, or safe escalation.",
  ];
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n") + "\n");
console.log(`Wrote ${rows.length} rows to ${outputPath}`);
