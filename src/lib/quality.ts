import type { GoldenDatasetCalibration, TraceJudgeResult } from "../types";

export type RateInterval = { rate: number; lower: number; upper: number; n: number };

export function wilsonInterval(successes: number, total: number, z = 1.96): RateInterval {
  if (total <= 0) return { rate: 0, lower: 0, upper: 0, n: 0 };
  const rate = successes / total;
  const denominator = 1 + z * z / total;
  const center = (rate + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((rate * (1 - rate) + z * z / (4 * total)) / total) / denominator;
  return { rate, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin), n: total };
}

export function qualitySummary(results: TraceJudgeResult[]) {
  const scored = results.length;
  const passed = results.filter((result) => result.passed).length;
  const score = scored ? results.reduce((sum, result) => sum + result.score, 0) / scored : 0;
  return { scored, passed, failed: scored - passed, averageScore: score, passRate: wilsonInterval(passed, scored), judgeCoverage: scored ? 1 : 0 };
}

export function calibrationSummary(calibration: GoldenDatasetCalibration) {
  const comparable = calibration.rows.filter((row) => row.human_passed !== undefined && row.judge_passed !== undefined);
  const agreed = comparable.filter((row) => row.human_passed === row.judge_passed).length;
  const humanFails = comparable.filter((row) => row.human_passed === false);
  const humanPasses = comparable.filter((row) => row.human_passed === true);
  const falsePasses = humanFails.filter((row) => row.judge_passed === true).length;
  const falseFails = humanPasses.filter((row) => row.judge_passed === false).length;
  return {
    agreement: wilsonInterval(agreed, comparable.length),
    falsePasses: { count: falsePasses, denominator: humanFails.length, rate: humanFails.length ? falsePasses / humanFails.length : 0 },
    falseFails: { count: falseFails, denominator: humanPasses.length, rate: humanPasses.length ? falseFails / humanPasses.length : 0 },
    confusion: {
      truePass: humanPasses.filter((row) => row.judge_passed === true).length,
      falsePass: falsePasses,
      trueFail: humanFails.filter((row) => row.judge_passed === false).length,
      falseFail: falseFails,
    },
  };
}

export function overrideEligibility(input: {
  successes: number;
  total: number;
  qualityBar: number;
  costDeltaPct: number;
  latencyDeltaPct: number;
  maximumLatencyIncreasePct: number;
}) {
  const interval = wilsonInterval(input.successes, input.total);
  const checks = [
    { label: "Quality", passed: interval.lower >= input.qualityBar, detail: `${Math.round(interval.lower * 100)}% lower bound vs ${Math.round(input.qualityBar * 100)}% bar` },
    { label: "Cost", passed: input.costDeltaPct < 0, detail: `${Math.abs(Math.round(input.costDeltaPct))}% ${input.costDeltaPct < 0 ? "lower" : "higher or unchanged"} cost` },
    { label: "Latency", passed: input.latencyDeltaPct <= input.maximumLatencyIncreasePct, detail: `${input.latencyDeltaPct > 0 ? "+" : ""}${Math.round(input.latencyDeltaPct)}% vs +${input.maximumLatencyIncreasePct}% maximum` },
  ];
  return { eligible: checks.every((check) => check.passed), interval, checks };
}
