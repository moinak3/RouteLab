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
export function rubricJudge(candidate: string, trace?: Trace) {
  const text = candidate.toLowerCase();
  const task = String(trace?.metadata?.distinct_task_label ?? trace?.metadata?.task_type ?? "trace");
  if (/approved the refund|refund is guaranteed|removed it from your bill|guarantee your refund/.test(text)) {
    return result("trace_quality_llm_judge (gpt-5.5-pro)", false, .5, "major", "Promises a billing outcome before required verification.");
  }
  if (/always allowed|any downtime is eligible|indefinitely/.test(text)) {
    return result("trace_quality_llm_judge (gpt-5.5-pro)", false, .5, "major", "Overgeneralizes policy and omits a required eligibility constraint.");
  }
  if (/old password|public ticket|convenient for the customer/.test(text)) {
    return result("trace_quality_llm_judge (gpt-5.5-pro)", false, 0, "critical", "Introduces an account-security or data-handling violation.");
  }
  if (/no customer risk|does not need legal review|no support escalation obligations/.test(text)) {
    return result("trace_quality_llm_judge (gpt-5.5-pro)", false, .5, "major", "Misses the material legal or compliance risk in the trace.");
  }
  if (candidate.trim().length < 24) {
    return result("trace_quality_llm_judge (gpt-5.5-pro)", false, .5, "major", `${task} response is too sparse to satisfy the requested outcome.`);
  }
  return result("trace_quality_llm_judge (gpt-5.5-pro)", false, .5, "major", `${task} response does not match the calibrated reference outcome.`);
}
export function evaluateTrace(trace: Trace, candidate: string) {
  const reference = String(trace.metadata?._internal_reference ?? trace.response_text ?? "");
  if (normalize(candidate) === normalize(reference)) return result("trace_quality_llm_judge (gpt-5.5-pro)", true, 1, undefined, "Matches the calibrated reference answer for this trace.");
  return trace.metadata?.task_type === "extraction" ? exactMatch(candidate, reference) : rubricJudge(candidate, trace);
}
