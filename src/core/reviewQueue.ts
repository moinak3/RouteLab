import type { CandidateRun, EvalResult, Trace, DistinctTaskBucket } from "../types";

export type ReviewQueueItem = { trace: Trace; run: CandidateRun; evalResult: EvalResult; bucket?: DistinctTaskBucket; reviewReason: string };
export type ReviewQueueResult = { reviewItems: ReviewQueueItem[]; lowScoreCount: number; distinctTaskCount: number };

export const REVIEW_LOW_SCORE_THRESHOLD = .85;
export const REVIEW_QUEUE_MAX = 60;
export const REVIEW_PER_SIGNATURE_TARGET = 3;

export function buildReviewQueue(
  traces: Trace[],
  runs: CandidateRun[],
  evals: EvalResult[],
  distinctTaskBuckets: DistinctTaskBucket[],
  maxItems = REVIEW_QUEUE_MAX,
): ReviewQueueResult {
  const traceById = new Map(traces.map((trace) => [trace.id, trace]));
  const runByTrace = new Map(runs.map((run) => [run.trace_id, run]));
  const bucketByTrace = new Map<string, DistinctTaskBucket>();
  distinctTaskBuckets.forEach((bucket) => bucket.traces.forEach((traceId) => bucketByTrace.set(traceId, bucket)));
  const scored = evals
    .map((evaluation): ReviewQueueItem | null => {
      const trace = traceById.get(evaluation.trace_id);
      const run = runByTrace.get(evaluation.trace_id);
      return trace && run ? { trace, run, evalResult: evaluation, bucket: bucketByTrace.get(evaluation.trace_id), reviewReason: "" } : null;
    })
    .filter((item): item is ReviewQueueItem => item !== null);
  const lowScore = scored
    .filter((item) => !item.evalResult.passed || item.evalResult.score < REVIEW_LOW_SCORE_THRESHOLD)
    .sort((a, b) => (a.evalResult.score - b.evalResult.score) || ((b.bucket?.risk_level === "high" ? 1 : 0) - (a.bucket?.risk_level === "high" ? 1 : 0)));
  const groups = new Map<string, ReviewQueueItem[]>();
  lowScore.forEach((item) => {
    const key = item.bucket?.bucket_id ?? "unbucketed";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  const selected: ReviewQueueItem[] = [];
  const selectedIds = new Set<string>();
  const sortedGroups = [...groups.entries()]
    .sort((a, b) => (b[1][0]?.bucket?.risk_level === "high" ? 1 : 0) - (a[1][0]?.bucket?.risk_level === "high" ? 1 : 0) || a[0].localeCompare(b[0]))
  for (const [, items] of sortedGroups) {
    const item = items[0];
    if (selected.length >= maxItems) break;
    selected.push({ ...item, reviewReason: "Low eval score from distinct task" });
    selectedIds.add(item.evalResult.id);
  }
  for (const [, items] of sortedGroups) {
    for (const item of items.slice(1, REVIEW_PER_SIGNATURE_TARGET)) {
      if (selected.length >= maxItems) break;
      if (!selectedIds.has(item.evalResult.id)) {
        selected.push({ ...item, reviewReason: "Additional low eval score from distinct task" });
        selectedIds.add(item.evalResult.id);
      }
    }
    if (selected.length >= maxItems) break;
  }
  for (const item of lowScore) {
    if (selected.length >= maxItems) break;
    if (!selectedIds.has(item.evalResult.id)) {
      selected.push({ ...item, reviewReason: "Lowest remaining failure" });
      selectedIds.add(item.evalResult.id);
    }
  }
  return { reviewItems: selected, lowScoreCount: lowScore.length, distinctTaskCount: groups.size };
}
