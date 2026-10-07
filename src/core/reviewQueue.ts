import type { DistinctTaskBucket, GoldenDataset, Trace, TraceJudgeResult } from "../types";
import { traceUserFeedback } from "./traceFeedback";

export type ReviewLane = "representative" | "unusual" | "uncovered";
export type ReviewQueueItem = {
  trace: Trace;
  bucket?: DistinctTaskBucket;
  judge?: TraceJudgeResult;
  lane: ReviewLane;
  reviewReason: string;
};
export type ReviewQueueResult = {
  reviewItems: ReviewQueueItem[];
  capacity: number;
  laneCounts: Record<ReviewLane, number>;
  laneTargets: Record<ReviewLane, number>;
  available: Record<ReviewLane, number>;
  coverage: { coveredSignatures: number; totalSignatures: number; goldenDatasets: number };
};

export const REVIEW_QUEUE_MAX = 60;

const hash = (value: string) => {
  let result = 2166136261;
  for (const char of value) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};
const quantile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
};
const observedAt = (trace: Trace) => {
  const value = Date.parse(trace.timestamp);
  return Number.isFinite(value) ? value : 0;
};
const signature = (item: ReviewQueueItem) => item.bucket?.bucket_id
  ?? String(item.trace.metadata?.distinct_task_label ?? item.trace.metadata?.task_type ?? "unclassified");
const signatureName = (item: ReviewQueueItem) => item.bucket?.bucket_name
  ?? String(item.trace.metadata?.distinct_task_label ?? item.trace.metadata?.task_type ?? "unclassified work").replaceAll("_", " ");
const toolPath = (trace: Trace) => (trace.spans ?? [])
  .filter((span) => span.type === "tool" || span.type === "function")
  .map((span) => span.name ?? span.type).join(" -> ");
const feedbackValue = (value: unknown): boolean => {
  if (value === true) return true;
  if (typeof value === "number") return value <= 2;
  if (typeof value === "string") return /^(thumbs.down|dislike|negative|complaint|poor|bad|1|2)$/i.test(value.trim());
  return false;
};
const negativeFeedback = (trace: Trace) => {
  const metadata = trace.metadata ?? {};
  const feedback = metadata.feedback;
  return [metadata.thumbs_down, metadata.user_feedback, metadata.feedback_rating, metadata.rating, metadata.customer_complaint, feedback]
    .some(feedbackValue) || (feedback && typeof feedback === "object"
      ? Object.values(feedback as Record<string, unknown>).some(feedbackValue) : false);
};
const failedTool = (trace: Trace) => (trace.spans ?? []).some((span) => {
  if (span.type !== "tool" && span.type !== "function") return false;
  const metadata = span.metadata ?? {};
  const status = String(metadata.status ?? metadata.outcome ?? "").toLowerCase();
  const code = Number(metadata.status_code ?? metadata.http_status);
  return ["error", "failed", "failure", "timeout"].includes(status)
    || (Number.isFinite(code) && code >= 400) || Boolean(metadata.error);
});

function stratifiedSample(items: ReviewQueueItem[], limit: number, excluded: Set<string>, lane: ReviewLane = "representative"): ReviewQueueItem[] {
  const groups = new Map<string, ReviewQueueItem[]>();
  for (const item of items) {
    if (excluded.has(item.trace.id)) continue;
    const key = [signature(item), item.bucket?.risk_level ?? "unknown", item.trace.model].join("|");
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const ordered = [...groups.entries()].sort((a, b) => hash(a[0]) - hash(b[0]));
  ordered.forEach(([, group]) => group.sort((a, b) => hash(a.trace.id) - hash(b.trace.id)));
  const selected: ReviewQueueItem[] = [];
  while (selected.length < limit && ordered.some(([, group]) => group.length)) {
    for (const [, group] of ordered) {
      const item = group.shift();
      if (!item) continue;
      selected.push(lane === "representative" ? {
        ...item, lane,
        reviewReason: "Stratified random coverage of " + signatureName(item) + " (" + (item.bucket?.risk_level ?? "unknown") + " risk, " + item.trace.model + ").",
      } : item);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

const hasHumanReference = (row: GoldenDataset["rows"][number]) =>
  ["human_answer", "expected_response", "reference_answer", "human_passed", "human_score", "label"]
    .some((key) => row[key] !== undefined && row[key] !== null && row[key] !== "");

export function buildReviewQueue(
  traces: Trace[],
  judgeResults: TraceJudgeResult[],
  buckets: DistinctTaskBucket[],
  goldenDatasets: GoldenDataset[] = [],
  maxItems = REVIEW_QUEUE_MAX,
): ReviewQueueResult {
  const bucketByTrace = new Map<string, DistinctTaskBucket>();
  buckets.forEach((bucket) => bucket.traces.forEach((id) => bucketByTrace.set(id, bucket)));
  const judgeByTrace = new Map(judgeResults.map((result) => [result.trace_id, result]));
  const items: ReviewQueueItem[] = traces.map((trace) => ({
    trace, bucket: bucketByTrace.get(trace.id), judge: judgeByTrace.get(trace.id),
    lane: "representative", reviewReason: "",
  }));
  const requested = Math.min(Math.max(0, Math.floor(maxItems)), items.length);
  const third = Math.floor(requested / 3);
  let laneTargets: Record<ReviewLane, number> = {
    representative: third + requested % 3, unusual: third, uncovered: third,
  };
  const itemByTrace = new Map(items.map((item) => [item.trace.id, item]));
  const signatureByName = new Map(buckets.map((bucket) => [bucket.bucket_name, bucket.bucket_id]));
  const coveredSignatures = new Set<string>();
  for (const dataset of goldenDatasets) {
    for (const row of dataset.rows) {
      if (!hasHumanReference(row)) continue;
      const fromTrace = itemByTrace.get(String(row.trace_id ?? row.id ?? ""));
      if (fromTrace) coveredSignatures.add(signature(fromTrace));
      const explicit = String(row.trace_signature ?? row.signature_id ?? row.distinct_task_bucket_id ?? "");
      if (explicit) coveredSignatures.add(signatureByName.get(explicit) ?? explicit);
    }
  }
  const allSignatures = new Set(items.map(signature));
  const uncoveredCandidates = items.filter((item) => !coveredSignatures.has(signature(item)))
    .map((item): ReviewQueueItem => ({
      ...item, lane: "uncovered",
      reviewReason: goldenDatasets.length
        ? "No human-labeled golden eval example covers the " + signatureName(item) + " signature. Review this trace to decide whether to add that signature to the eval set."
        : "No human-labeled golden eval set is loaded. The " + signatureName(item) + " signature needs reference examples before its judge can be calibrated.",
    }));

  const latencyByPeer = new Map<string, number[]>();
  const workflowLengths = new Map<string, number>();
  const pathCounts = new Map<string, number>();
  const signatureCounts = new Map<string, number>();
  for (const item of items) {
    const key = signature(item);
    const latency = item.trace.latency_ms ?? 0;
    const peer = key + "|" + item.trace.model;
    if (latency > 0) {
      const peerValues = latencyByPeer.get(peer);
      if (peerValues) peerValues.push(latency);
      else latencyByPeer.set(peer, [latency]);
    }
    if (item.trace.workflow_id) workflowLengths.set(item.trace.workflow_id, (workflowLengths.get(item.trace.workflow_id) ?? 0) + 1);
    signatureCounts.set(key, (signatureCounts.get(key) ?? 0) + 1);
    const path = toolPath(item.trace);
    if (path) pathCounts.set(key + "|" + path, (pathCounts.get(key + "|" + path) ?? 0) + 1);
  }
  const lengths = [...workflowLengths.values()];
  const sessionMedian = quantile(lengths, .5);
  const sessionQ1 = quantile(lengths, .25);
  const sessionQ3 = quantile(lengths, .75);
  const sessionUpper = sessionQ3 + 1.5 * (sessionQ3 - sessionQ1);
  const unusualCandidates = items.flatMap((item) => {
    if (!coveredSignatures.has(signature(item))) return [];
    const trace = item.trace;
    const reasons: string[] = [];
    let priority = 0;
    const safetySignal = trace.metadata?.safety_signal;
    if (safetySignal === true || (typeof safetySignal === "string" && safetySignal.trim())) {
      const detail = trace.metadata?.safety_reason ?? (typeof safetySignal === "string" ? safetySignal.replaceAll("_", " ") : "requires policy review");
      reasons.push("Safety/policy alert: " + String(detail));
      if (item.judge?.passed) reasons.push("The existing judge passed this response, so this may be a false pass.");
      priority += 10;
    }
    if (traceUserFeedback(trace) === "thumbs_down") {
      reasons.push("This user gave the response a thumbs down (negative feedback)."); priority += 6;
    } else if (negativeFeedback(trace)) {
      reasons.push("Customer complaint or negative feedback was recorded."); priority += 5;
    }
    if (trace.status === "error") { reasons.push("The request ended in error" + (trace.error_type ? " (" + trace.error_type + ")" : "") + "."); priority += 4; }
    if (failedTool(trace)) { reasons.push("A tool call failed or timed out."); priority += 4; }
    const key = signature(item);
    const path = toolPath(trace);
    const pathCount = pathCounts.get(key + "|" + path) ?? 0;
    const peerCount = signatureCounts.get(key) ?? 0;
    if (path && peerCount >= 10 && pathCount <= Math.max(1, Math.floor(peerCount * .1))) {
      reasons.push("Rare tool path for this signature: " + path + "."); priority += 2;
    }
    const peerLatencies = latencyByPeer.get(key + "|" + trace.model) ?? [];
    if (peerLatencies.length >= 5 && (trace.latency_ms ?? 0) > 0) {
      const median = quantile(peerLatencies, .5);
      const q1 = quantile(peerLatencies, .25);
      const q3 = quantile(peerLatencies, .75);
      const upper = Math.max(q3 + 1.5 * (q3 - q1), median * 1.25);
      if ((trace.latency_ms ?? 0) > upper) {
        reasons.push("Latency " + Math.round(trace.latency_ms!).toLocaleString() + " ms exceeds the " + Math.round(upper).toLocaleString()
          + " ms upper range for " + peerLatencies.length + " calls on this signature and model (median " + Math.round(median).toLocaleString() + " ms).");
        priority += 3;
      }
    }
    const length = trace.workflow_id ? workflowLengths.get(trace.workflow_id) ?? 0 : 0;
    if (lengths.length >= 5 && length > Math.max(sessionUpper, sessionMedian * 1.5)) {
      reasons.push("Workflow has " + length + " steps, above the usual upper range of " + Math.round(sessionUpper)
        + " steps (median " + Math.round(sessionMedian) + ").");
      priority += 2;
    }
    if (item.judge && !item.judge.passed) { reasons.push("An existing evaluator flagged this response for review."); priority += 1; }
    return reasons.length ? [{ ...item, lane: "unusual" as const, reviewReason: reasons.join(" "), priority }] : [];
  }).sort((a, b) => b.priority - a.priority || observedAt(b.trace) - observedAt(a.trace) || a.trace.id.localeCompare(b.trace.id));

  let selected: ReviewQueueItem[] = [];
  const balancedQuota = Math.min(third, unusualCandidates.length, uncoveredCandidates.length);
  if (balancedQuota >= 5) {
    const unusual = unusualCandidates.slice(0, balancedQuota);
    const selectedIds = new Set(unusual.map((item) => item.trace.id));
    const representative = stratifiedSample(items, balancedQuota, selectedIds);
    representative.forEach((item) => selectedIds.add(item.trace.id));
    const uncovered = stratifiedSample(uncoveredCandidates, balancedQuota, selectedIds, "uncovered");
    const actualQuota = Math.min(representative.length, unusual.length, uncovered.length);
    if (actualQuota >= 5) {
      selected = [...representative.slice(0, actualQuota), ...unusual.slice(0, actualQuota), ...uncovered.slice(0, actualQuota)];
      laneTargets = { representative: actualQuota, unusual: actualQuota, uncovered: actualQuota };
    }
  }
  if (!selected.length) {
    const selectedIds = new Set<string>();
    const add = (item: ReviewQueueItem) => { selected.push(item); selectedIds.add(item.trace.id); };
    stratifiedSample(items, laneTargets.representative, selectedIds).forEach(add);
    let unusualCount = 0;
    for (const item of unusualCandidates) {
      if (unusualCount >= laneTargets.unusual) break;
      if (!selectedIds.has(item.trace.id)) { add(item); unusualCount += 1; }
    }
    stratifiedSample(uncoveredCandidates, laneTargets.uncovered, selectedIds, "uncovered").forEach(add);
    // Sparse lanes leave capacity with representative coverage, never invented findings.
    if (selected.length < requested) stratifiedSample(items, requested - selected.length, selectedIds).forEach(add);
  }
  const laneCounts: Record<ReviewLane, number> = { representative: 0, unusual: 0, uncovered: 0 };
  selected.forEach((item) => { laneCounts[item.lane] += 1; });
  const byLane: Record<ReviewLane, ReviewQueueItem[]> = { representative: [], unusual: [], uncovered: [] };
  selected.forEach((item) => byLane[item.lane].push(item));
  const interleaved: ReviewQueueItem[] = [];
  for (let index = 0; index < Math.max(...Object.values(laneCounts)); index++) {
    for (const lane of ["representative", "unusual", "uncovered"] as const) {
      if (byLane[lane][index]) interleaved.push(byLane[lane][index]);
    }
  }
  return {
    reviewItems: interleaved, capacity: requested, laneCounts, laneTargets,
    available: { representative: items.length, unusual: unusualCandidates.length, uncovered: uncoveredCandidates.length },
    coverage: { coveredSignatures: [...coveredSignatures].filter((key) => allSignatures.has(key)).length, totalSignatures: allSignatures.size, goldenDatasets: goldenDatasets.length },
  };
}
