import Ajv from "ajv";
import type { EvalResult, Trace } from "../types";

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const result = (type: string, passed: boolean, score: number, severity?: EvalResult["severity"], explanation?: string): Omit<EvalResult, "id" | "trace_id" | "candidate_run_id"> =>
  ({ evaluator_type: type, passed, score, severity, explanation });
export const exactMatch = (candidate: string, expected: string) => result("exact_match", normalize(candidate) === normalize(expected), normalize(candidate) === normalize(expected) ? 1 : 0);
export function jsonSchema(candidate: string, schema: object) {
  try {
    const valid = new Ajv().validate(schema, JSON.parse(candidate));
    return result("json_schema", valid, valid ? 1 : 0, valid ? undefined : "major");
  } catch { return result("json_schema", false, 0, "major", "Response is not valid JSON"); }
}
export const regexEval = (candidate: string, pattern: string) => {
  const passed = new RegExp(pattern).test(candidate);
  return result("regex", passed, passed ? 1 : 0);
};
export function mockJudge(candidate: string) {
  if (candidate.includes("[PASS]")) return result("mock_judge", true, 1);
  if (candidate.includes("[FAIL_MINOR]")) return result("mock_judge", true, .75, "minor");
  if (candidate.includes("[FAIL_MAJOR]")) return result("mock_judge", false, .4, "major");
  if (candidate.includes("[FAIL_CRITICAL]")) return result("mock_judge", false, 0, "critical");
  return result("mock_judge", false, .5);
}
export function evaluateTrace(trace: Trace, candidate: string) {
  const expected = String(trace.metadata?.expected_answer ?? trace.response_text ?? "");
  if (normalize(candidate) === normalize(expected)) return result("exact_match", true, 1);
  return trace.metadata?.task_type === "extraction" ? exactMatch(candidate, expected) : mockJudge(candidate);
}
