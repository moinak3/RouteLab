import { calculateCost, getModel, modelCatalog } from "./catalog";
import { replay } from "./simulations";
import type { DistinctTaskBucket, GoldenDataset, GoldenDatasetRow, Trace, TraceJudgeResult } from "../types";

export type FineTuningRecommendationAction =
  | "do_not_fine_tune"
  | "improve_prompting_or_context"
  | "use_routing"
  | "pilot_fine_tuning"
  | "strongly_recommend_fine_tuning";
export type FineTuningConfidence = "low" | "medium" | "high";
export type FineTuningReadinessLevel = "insufficient" | "prototype" | "pilot_ready" | "strong";
export type FineTuningLabelQuality = "low" | "medium" | "high";

export type FineTuningEconomicSummary = {
  current_monthly_cost: number;
  projected_monthly_cost: number;
  monthly_savings: number;
  annual_savings: number;
  break_even_months: number;
  input_token_reduction_pct: number;
  total_cost_reduction_pct: number;
  latency_reduction_estimate_pct: number;
};
export type FineTuningQualitySummary = {
  current_eval_score: number;
  main_failure_modes: string[];
  systematic_failure_rate: number;
  fine_tuning_likely_to_help: boolean;
};
export type FineTuningDataReadiness = {
  training_examples_available: number;
  corrected_examples_available: number;
  examples_per_signature: Record<string, number>;
  label_quality: FineTuningLabelQuality;
  readiness_level: FineTuningReadinessLevel;
};
export type FineTuningPromptAnalysis = {
  avg_input_tokens: number;
  avg_output_tokens: number;
  avg_static_prompt_tokens: number;
  avg_few_shot_tokens: number;
  avg_retrieved_context_tokens: number;
  compressible_token_pct: number;
  prompt_similarity_score: number;
};
export type FineTuningRoutingComparison = {
  routing_was_evaluated: boolean;
  best_alternative_model: string;
  routing_cost_reduction_pct: number;
  routing_quality_delta: number;
  routing_recommendation: string;
};
export type FineTuningScoreFactor = {
  name: string;
  weight: number;
  points: number;
  evidence: string;
};
export type FineTuningRecommendationJson = {
  recommendation: FineTuningRecommendationAction;
  score: number;
  confidence: FineTuningConfidence;
  primary_reason: string;
  economic_summary: FineTuningEconomicSummary;
  quality_summary: FineTuningQualitySummary;
  data_readiness: FineTuningDataReadiness;
  prompt_analysis: FineTuningPromptAnalysis;
  routing_comparison: FineTuningRoutingComparison;
  risks: string[];
  next_steps: string[];
};
export type FineTuningRecommendationReport = FineTuningRecommendationJson & {
  scope: "global" | "trace_signature";
  scope_id: string;
  scope_name: string;
  trace_count: number;
  score_factors: FineTuningScoreFactor[];
  human_summary: string;
};
export type FineTuningRecommendationBundle = {
  global: FineTuningRecommendationReport;
  by_signature: FineTuningRecommendationReport[];
};

type FailureAnalysis = {
  main_failure_modes: string[];
  systematic_failure_rate: number;
  fine_tuning_likely_to_help: boolean;
  missing_knowledge_rate: number;
  dynamic_context_rate: number;
  repeated_teachable_rate: number;
};
type StabilityAnalysis = { score: number; stable: boolean; dynamicKnowledge: boolean; reasons: string[] };
type BuildOptions = {
  distinctTaskBuckets?: DistinctTaskBucket[];
  traceJudgeResults?: TraceJudgeResult[];
  goldenDatasets?: GoldenDataset[];
  monthlyRequestVolume?: number;
  monthlyMultiplier?: number;
  fineTunedModelId?: string;
  trainingCostUsd?: number;
  setupCostUsd?: number;
  monthlyMaintenanceCostUsd?: number;
  monthlyHostingCostUsd?: number;
};

const TOKEN_CHARS = 4;
const round = (value: number, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const pct = (numerator: number, denominator: number) => denominator ? numerator / denominator * 100 : 0;
const approxTokens = (text: string) => Math.ceil(text.length / TOKEN_CHARS);
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const metadataText = (trace: Trace) => JSON.stringify(trace.metadata ?? {}).toLowerCase();
const traceText = (trace: Trace) => `${trace.prompt_text} ${trace.response_text ?? ""} ${metadataText(trace)}`.toLowerCase();
const rowString = (row: GoldenDatasetRow, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
};
const rowBoolean = (row: GoldenDatasetRow, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value > 0;
    if (typeof value === "string") {
      const lower = value.toLowerCase().trim();
      if (["true", "yes", "pass", "passed", "1"].includes(lower)) return true;
      if (["false", "no", "fail", "failed", "0"].includes(lower)) return false;
    }
  }
  return undefined;
};

export function analyzePromptOverhead(traces: Trace[]): FineTuningPromptAnalysis {
  if (!traces.length) return {
    avg_input_tokens: 0,
    avg_output_tokens: 0,
    avg_static_prompt_tokens: 0,
    avg_few_shot_tokens: 0,
    avg_retrieved_context_tokens: 0,
    compressible_token_pct: 0,
    prompt_similarity_score: 0,
  };
  const prompts = traces.map((trace) => trace.prompt_text || trace.messages.map((message) => message.content).join("\n"));
  const systemTokens = traces.map((trace) => approxTokens(trace.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n")));
  const commonPrefix = longestCommonPrefix(prompts);
  const commonPrefixTokens = commonPrefix.length >= 80 ? approxTokens(commonPrefix) : 0;
  const fewShotTokens = traces.map((trace) => estimateFewShotTokens(trace));
  const retrievedContextTokens = traces.map((trace) => estimateRetrievedContextTokens(trace));
  const staticPromptTokens = traces.map((trace, index) => {
    const metadataStatic = Number(trace.metadata?.static_prompt_tokens ?? trace.metadata?.system_prompt_tokens ?? 0);
    return Math.max(systemTokens[index], commonPrefixTokens, Number.isFinite(metadataStatic) ? metadataStatic : 0);
  });
  const avgInput = avg(traces.map((trace) => trace.input_tokens));
  const avgStatic = avg(staticPromptTokens);
  const avgFewShot = avg(fewShotTokens);
  const avgRetrieved = avg(retrievedContextTokens);
  const promptSimilarity = estimatePromptSimilarity(prompts);
  const repeatedInstructionTokens = Math.max(avgStatic, promptSimilarity >= .72 ? commonPrefixTokens : 0);
  const compressibleTokens = Math.max(0, repeatedInstructionTokens + avgFewShot * .85 - avgRetrieved * .15);
  return {
    avg_input_tokens: round(avgInput, 1),
    avg_output_tokens: round(avg(traces.map((trace) => trace.output_tokens)), 1),
    avg_static_prompt_tokens: round(avgStatic, 1),
    avg_few_shot_tokens: round(avgFewShot, 1),
    avg_retrieved_context_tokens: round(avgRetrieved, 1),
    compressible_token_pct: round(pct(compressibleTokens, avgInput), 1),
    prompt_similarity_score: round(promptSimilarity * 100, 1),
  };
}

export function analyzeQualityFailures(traces: Trace[], judgeResults: TraceJudgeResult[] = []): FineTuningQualitySummary & FailureAnalysis {
  const judgeByTraceId = new Map(judgeResults.map((result) => [result.trace_id, result]));
  const failed = traces.filter((trace) => judgeByTraceId.get(trace.id)?.passed === false || trace.status === "error");
  const failureModes = failed.map((trace) => classifyFailureMode(trace, judgeByTraceId.get(trace.id))).filter(Boolean);
  const counts = countBy(failureModes);
  const sortedModes = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const mainFailureModes = sortedModes.slice(0, 4).map(([mode]) => mode);
  const topCount = sortedModes[0]?.[1] ?? 0;
  const systematicFailureRate = pct(topCount, Math.max(failed.length, 1));
  const missingKnowledge = failed.filter((trace) => isMissingKnowledge(trace, judgeByTraceId.get(trace.id))).length;
  const dynamicContext = failed.filter(isDynamicContextTrace).length;
  const repeatedTeachable = failed.filter((trace) => isTeachableFailure(trace, judgeByTraceId.get(trace.id))).length;
  const averageScore = judgeResults.length ? avg(judgeResults.filter((result) => traces.some((trace) => trace.id === result.trace_id)).map((result) => result.score)) : 0;
  const likelyToHelp = failed.length > 0 && systematicFailureRate >= 40 && repeatedTeachable / failed.length >= .45 && missingKnowledge / failed.length < .35 && dynamicContext / failed.length < .45;
  return {
    current_eval_score: round(averageScore * 100, 1),
    main_failure_modes: mainFailureModes,
    systematic_failure_rate: round(systematicFailureRate, 1),
    fine_tuning_likely_to_help: likelyToHelp,
    missing_knowledge_rate: round(pct(missingKnowledge, Math.max(failed.length, 1)), 1),
    dynamic_context_rate: round(pct(dynamicContext, Math.max(failed.length, 1)), 1),
    repeated_teachable_rate: round(pct(repeatedTeachable, Math.max(failed.length, 1)), 1),
  };
}

export function analyzeDataReadiness(traces: Trace[], buckets: DistinctTaskBucket[] = [], judgeResults: TraceJudgeResult[] = [], goldenDatasets: GoldenDataset[] = []): FineTuningDataReadiness {
  const judgeByTraceId = new Map(judgeResults.map((result) => [result.trace_id, result]));
  const successful = traces.filter((trace) => judgeByTraceId.get(trace.id)?.passed !== false && trace.response_text).length;
  const goldenRows = goldenDatasets.flatMap((dataset) => dataset.rows);
  const traceIds = new Set(traces.map((trace) => trace.id));
  const humanRows = goldenRows.filter((row) => {
    const traceId = rowString(row, ["trace_id", "id"]);
    return !traceId || traceIds.has(traceId);
  });
  const corrected = humanRows.filter((row) => rowString(row, ["corrected_output", "human_answer", "reference_answer", "gold_answer"])).length;
  const humanLabeled = humanRows.filter((row) => rowBoolean(row, ["human_passed", "passed", "label"]) !== undefined || rowString(row, ["human_score", "score"])).length;
  const examplesPerSignature = Object.fromEntries(
    buckets
      .map((bucket): [string, number] => [bucket.bucket_id, bucket.traces.filter((id) => traceIds.has(id)).length])
      .filter(([, count]) => count > 0),
  );
  const duplicateRate = estimateDuplicateRate(traces.map((trace) => trace.prompt_text));
  const labelQuality: FineTuningLabelQuality = humanLabeled >= 1000 && corrected >= 500 && duplicateRate < .35
    ? "high"
    : humanLabeled >= 100 || corrected >= 100 || successful >= 1000
      ? "medium"
      : "low";
  const trainingExamples = Math.max(successful, corrected);
  return {
    training_examples_available: trainingExamples,
    corrected_examples_available: corrected,
    examples_per_signature: examplesPerSignature,
    label_quality: labelQuality,
    readiness_level: readinessLevel(trainingExamples),
  };
}

export function analyzeTaskStability(traces: Trace[], buckets: DistinctTaskBucket[] = []): StabilityAnalysis {
  const selectedIds = new Set(traces.map((trace) => trace.id));
  const selectedBuckets = buckets.filter((bucket) => bucket.traces.some((id) => selectedIds.has(id)));
  const texts = traces.map(traceText);
  const stableSignals = texts.filter((text) => /schema|format|json|classif|taxonomy|extract|tone|style|policy that changes rarely|rubric/.test(text)).length;
  const dynamicSignals = texts.filter((text) => /pricing|inventory|legal text|product docs|support policy|external facts|news|personalized|retrieved|current policy|latest/.test(text)).length;
  const stableTasks = selectedBuckets.filter((bucket) => ["extraction", "classification_tagging", "writing_editing", "translation_localization"].includes(bucket.task.task_type) || ["json", "classification_label"].includes(bucket.task.output_format)).length;
  const dynamicTasks = selectedBuckets.filter((bucket) => ["rag_grounded_answers", "question_answering", "document_review_legal_analysis"].includes(bucket.task.task_type) || ["retrieval_augmented", "source_citation_required", "policy_grounded"].includes(bucket.task.grounding_requirement)).length;
  const score = clamp((stableSignals + stableTasks * 3 + 1) / (stableSignals + dynamicSignals + stableTasks * 3 + dynamicTasks * 3 + 2));
  return {
    score: round(score * 100, 1),
    stable: score >= .55,
    dynamicKnowledge: dynamicSignals + dynamicTasks * 2 > stableSignals + stableTasks,
    reasons: [
      `${stableSignals + stableTasks} stable formatting/classification/style signals`,
      `${dynamicSignals + dynamicTasks} dynamic knowledge/RAG/legal-context signals`,
    ],
  };
}

export function analyzeEconomics(traces: Trace[], promptAnalysis: FineTuningPromptAnalysis, options: BuildOptions = {}): FineTuningEconomicSummary & { pricingKnown: boolean; volumeKnown: boolean; currentMonthlyVolume: number } {
  const monthlyVolume = options.monthlyRequestVolume ?? (Number.isFinite(options.monthlyMultiplier) ? traces.length * (options.monthlyMultiplier ?? 30) : traces.length * 30);
  const volumeKnown = monthlyVolume > 0 && traces.length > 0;
  const currentSampleCost = traces.reduce((sum, trace) => sum + currentTraceCost(trace), 0);
  const pricingKnown = traces.some((trace) => (trace.cost_usd ?? 0) > 0 || Boolean(getModel(trace.model)));
  const currentMonthlyCost = traces.length && volumeKnown ? currentSampleCost / traces.length * monthlyVolume : 0;
  const ftModel = getModel(options.fineTunedModelId ?? "mistral-small-3.2") ?? getModel("deepseek-v4-pro");
  const tokenReductionPct = clamp(promptAnalysis.compressible_token_pct / 100 * .78, 0, .78);
  const reducedInputTokens = Math.max(40, promptAnalysis.avg_input_tokens * (1 - tokenReductionPct));
  const projectedPerRequest = ftModel ? calculateCost(reducedInputTokens, promptAnalysis.avg_output_tokens, ftModel) : 0;
  const trainingCost = options.trainingCostUsd ?? 1200;
  const setupCost = options.setupCostUsd ?? 800;
  const maintenance = options.monthlyMaintenanceCostUsd ?? 250;
  const hosting = options.monthlyHostingCostUsd ?? 300;
  const amortizedTraining = (trainingCost + setupCost) / 12;
  const projectedMonthlyCost = pricingKnown && volumeKnown ? projectedPerRequest * monthlyVolume + amortizedTraining + maintenance + hosting : 0;
  const monthlySavings = currentMonthlyCost - projectedMonthlyCost;
  return {
    current_monthly_cost: round(currentMonthlyCost, 2),
    projected_monthly_cost: round(projectedMonthlyCost, 2),
    monthly_savings: round(monthlySavings, 2),
    annual_savings: round(monthlySavings * 12, 2),
    break_even_months: monthlySavings > 0 ? round((trainingCost + setupCost) / monthlySavings, 1) : 0,
    input_token_reduction_pct: round(tokenReductionPct * 100, 1),
    total_cost_reduction_pct: round(pct(monthlySavings, currentMonthlyCost), 1),
    latency_reduction_estimate_pct: round(Math.min(45, tokenReductionPct * 65), 1),
    pricingKnown,
    volumeKnown,
    currentMonthlyVolume: monthlyVolume,
  };
}

export function compareRouting(traces: Trace[], judgeResults: TraceJudgeResult[] = [], promptAnalysis?: FineTuningPromptAnalysis): FineTuningRoutingComparison {
  if (!traces.length) return {
    routing_was_evaluated: false,
    best_alternative_model: "",
    routing_cost_reduction_pct: 0,
    routing_quality_delta: 0,
    routing_recommendation: "No traces available for routing comparison.",
  };
  const currentQuality = judgeResults.length ? avg(judgeResults.filter((result) => traces.some((trace) => trace.id === result.trace_id)).map((result) => result.score)) : 1;
  const candidates = modelCatalog.filter((model) => model.id !== traces[0]?.model && model.id !== "local-qwen-14b");
  const results = candidates.map((model) => ({ model, result: replay(traces, model.id) }));
  const viable = results
    .filter(({ result }) => result.summary.pass_rate >= Math.max(.82, currentQuality - .05))
    .sort((a, b) => b.result.summary.estimated_savings_pct - a.result.summary.estimated_savings_pct);
  const best = viable[0] ?? results.sort((a, b) => b.result.summary.pass_rate - a.result.summary.pass_rate)[0];
  if (!best) return {
    routing_was_evaluated: false,
    best_alternative_model: "",
    routing_cost_reduction_pct: 0,
    routing_quality_delta: 0,
    routing_recommendation: "No enabled alternative models were available.",
  };
  const qualityDelta = best.result.summary.average_quality_score - currentQuality;
  const savings = best.result.summary.estimated_savings_pct;
  const goodRouting = savings >= Math.max(20, (promptAnalysis?.compressible_token_pct ?? 0) * .35) && qualityDelta >= -.05;
  return {
    routing_was_evaluated: true,
    best_alternative_model: best.model.display_name,
    routing_cost_reduction_pct: round(savings, 1),
    routing_quality_delta: round(qualityDelta * 100, 1),
    routing_recommendation: goodRouting
      ? `${best.model.display_name} appears to reduce cost enough with acceptable quality; evaluate routing before fine-tuning.`
      : `Routing does not clearly beat fine-tuning for this workload; best candidate was ${best.model.display_name}.`,
  };
}

export function buildFineTuningRecommendationBundle(options: BuildOptions & { traces: Trace[] }): FineTuningRecommendationBundle {
  const buckets = options.distinctTaskBuckets ?? [];
  const global = buildFineTuningRecommendation({
    ...options,
    scope: "global",
    scopeId: "all",
    scopeName: "All production traces",
  });
  const traceById = new Map(options.traces.map((trace) => [trace.id, trace]));
  const bySignature = buckets.map((bucket) => buildFineTuningRecommendation({
    ...options,
    traces: bucket.traces.map((id) => traceById.get(id)).filter((trace): trace is Trace => Boolean(trace)),
    distinctTaskBuckets: [bucket],
    scope: "trace_signature",
    scopeId: bucket.bucket_id,
    scopeName: bucket.bucket_name,
  }));
  return { global, by_signature: bySignature };
}

export function buildFineTuningRecommendation(options: BuildOptions & { traces: Trace[]; scope?: "global" | "trace_signature"; scopeId?: string; scopeName?: string }): FineTuningRecommendationReport {
  const traces = options.traces;
  const scopedJudgeResults = (options.traceJudgeResults ?? []).filter((result) => traces.some((trace) => trace.id === result.trace_id));
  const promptAnalysis = analyzePromptOverhead(traces);
  const quality = analyzeQualityFailures(traces, scopedJudgeResults);
  const dataReadiness = analyzeDataReadiness(traces, options.distinctTaskBuckets, scopedJudgeResults, options.goldenDatasets);
  const stability = analyzeTaskStability(traces, options.distinctTaskBuckets);
  const economics = analyzeEconomics(traces, promptAnalysis, options);
  const routing = compareRouting(traces, scopedJudgeResults, promptAnalysis);
  const { score, factors } = scoreFineTuningRecommendation(promptAnalysis, quality, dataReadiness, stability, economics, routing);
  const risks = buildRisks(promptAnalysis, quality, dataReadiness, stability, economics, routing);
  const recommendation = chooseRecommendation(score, promptAnalysis, quality, dataReadiness, stability, economics, routing);
  const primaryReason = primaryReasonFor(recommendation, promptAnalysis, quality, dataReadiness, economics, routing, stability);
  const nextSteps = nextStepsFor(recommendation, dataReadiness, routing, stability);
  const json: FineTuningRecommendationJson = {
    recommendation,
    score,
    confidence: confidenceFor(traces, scopedJudgeResults, dataReadiness, economics),
    primary_reason: primaryReason,
    economic_summary: stripEconomics(economics),
    quality_summary: {
      current_eval_score: quality.current_eval_score,
      main_failure_modes: quality.main_failure_modes,
      systematic_failure_rate: quality.systematic_failure_rate,
      fine_tuning_likely_to_help: quality.fine_tuning_likely_to_help,
    },
    data_readiness: dataReadiness,
    prompt_analysis: promptAnalysis,
    routing_comparison: routing,
    risks,
    next_steps: nextSteps,
  };
  return {
    ...json,
    scope: options.scope ?? "global",
    scope_id: options.scopeId ?? "all",
    scope_name: options.scopeName ?? "All production traces",
    trace_count: traces.length,
    score_factors: factors,
    human_summary: generateHumanSummary(json),
  };
}

function scoreFineTuningRecommendation(
  prompt: FineTuningPromptAnalysis,
  quality: FineTuningQualitySummary & FailureAnalysis,
  data: FineTuningDataReadiness,
  stability: StabilityAnalysis,
  economics: FineTuningEconomicSummary & { pricingKnown: boolean; volumeKnown: boolean; currentMonthlyVolume: number },
  routing: FineTuningRoutingComparison,
) {
  const factors: FineTuningScoreFactor[] = [];
  const add = (name: string, weight: number, ratio: number, evidence: string) => {
    const points = round(weight * clamp(ratio), 1);
    factors.push({ name, weight, points, evidence });
  };
  add("Prompt compression opportunity", 20, prompt.compressible_token_pct >= 55 ? 1 : prompt.compressible_token_pct / 55, `${prompt.compressible_token_pct}% of input tokens look compressible.`);
  add("High request volume", 15, economics.currentMonthlyVolume >= 50_000 ? 1 : economics.currentMonthlyVolume / 50_000, `${Math.round(economics.currentMonthlyVolume).toLocaleString()} estimated requests per month.`);
  add("Systematic repeated failures", 15, quality.fine_tuning_likely_to_help ? quality.systematic_failure_rate / 70 : quality.systematic_failure_rate / 140, `${quality.systematic_failure_rate}% of failures share the top mode.`);
  add("Stable task or behavior", 15, stability.score / 100, stability.reasons.join("; "));
  add("Training data readiness", 15, readinessScore(data.readiness_level), `${data.training_examples_available.toLocaleString()} usable examples; label quality ${data.label_quality}.`);
  add("Fine-tuned model cost advantage", 10, economics.pricingKnown && economics.volumeKnown ? Math.max(0, economics.total_cost_reduction_pct) / 60 : 0, economics.pricingKnown ? `${economics.total_cost_reduction_pct}% estimated cost reduction.` : "Pricing data missing.");
  add("Routing alternatives insufficient", 5, routing.routing_cost_reduction_pct >= economics.total_cost_reduction_pct && routing.routing_quality_delta >= -5 ? .1 : 1, routing.routing_recommendation);
  add("Latency improvement opportunity", 5, economics.latency_reduction_estimate_pct / 35, `${economics.latency_reduction_estimate_pct}% estimated latency reduction from shorter prompts.`);
  return { score: Math.round(factors.reduce((sum, factor) => sum + factor.points, 0)), factors };
}

function chooseRecommendation(
  score: number,
  prompt: FineTuningPromptAnalysis,
  quality: FineTuningQualitySummary & FailureAnalysis,
  data: FineTuningDataReadiness,
  stability: StabilityAnalysis,
  economics: FineTuningEconomicSummary & { pricingKnown: boolean; volumeKnown: boolean },
  routing: FineTuningRoutingComparison,
): FineTuningRecommendationAction {
  if (data.training_examples_available < 100) return "do_not_fine_tune";
  if (!economics.pricingKnown || !economics.volumeKnown) return score >= 51 ? "pilot_fine_tuning" : "improve_prompting_or_context";
  if (stability.dynamicKnowledge && prompt.avg_retrieved_context_tokens > prompt.avg_static_prompt_tokens + prompt.avg_few_shot_tokens) return "improve_prompting_or_context";
  if (routing.routing_was_evaluated && routing.routing_cost_reduction_pct >= Math.max(20, economics.total_cost_reduction_pct - 5) && routing.routing_quality_delta >= -5) return "use_routing";
  if (!quality.fine_tuning_likely_to_help && score < 71) return prompt.compressible_token_pct >= 40 ? "improve_prompting_or_context" : "use_routing";
  if (score <= 30) return "do_not_fine_tune";
  if (score <= 50) return "improve_prompting_or_context";
  if (score <= 70) return "pilot_fine_tuning";
  if (score <= 85) return "pilot_fine_tuning";
  return "strongly_recommend_fine_tuning";
}

function generateHumanSummary(report: FineTuningRecommendationJson) {
  const label = report.recommendation.replaceAll("_", " ");
  const economics = report.economic_summary.monthly_savings > 0
    ? `Projected monthly savings are ${money(report.economic_summary.monthly_savings)} with an estimated ${report.economic_summary.break_even_months || "unknown"} month break-even.`
    : "Projected fine-tuned economics do not yet beat the current path.";
  return `${capitalize(label)}. Score ${report.score}/100. ${report.primary_reason} ${economics} Quality evidence: current eval score ${report.quality_summary.current_eval_score}%, main failure modes ${report.quality_summary.main_failure_modes.join(", ") || "not enough failure data"}. Recommended next experiment: ${report.next_steps[0] ?? "collect more labeled examples"}`;
}

function primaryReasonFor(
  recommendation: FineTuningRecommendationAction,
  prompt: FineTuningPromptAnalysis,
  quality: FineTuningQualitySummary & FailureAnalysis,
  data: FineTuningDataReadiness,
  economics: FineTuningEconomicSummary,
  routing: FineTuningRoutingComparison,
  stability: StabilityAnalysis,
) {
  if (data.training_examples_available < 100) return "There are fewer than 100 usable examples, so fine-tuning would not have enough evidence.";
  if (stability.dynamicKnowledge) return "The workload depends heavily on dynamic or retrieved knowledge, so context/RAG should stay in the request path.";
  if (recommendation === "use_routing") return routing.routing_recommendation;
  if (recommendation === "strongly_recommend_fine_tuning" || recommendation === "pilot_fine_tuning") return `${prompt.compressible_token_pct}% of input tokens look compressible, failures are ${quality.systematic_failure_rate}% systematic, and monthly savings are estimated at ${money(economics.monthly_savings)}.`;
  if (!quality.fine_tuning_likely_to_help) return "Eval failures are not concentrated enough in repeated teachable patterns.";
  return "Improve prompts, context boundaries, or routing before committing to training.";
}

function buildRisks(
  prompt: FineTuningPromptAnalysis,
  quality: FineTuningQualitySummary & FailureAnalysis,
  data: FineTuningDataReadiness,
  stability: StabilityAnalysis,
  economics: FineTuningEconomicSummary & { pricingKnown: boolean; volumeKnown: boolean },
  routing: FineTuningRoutingComparison,
) {
  const risks: string[] = [];
  if (!economics.pricingKnown) risks.push("Pricing data is missing for some current traces, so exact savings are unknown.");
  if (!economics.volumeKnown) risks.push("Monthly request volume is missing, so break-even should be treated as unknown.");
  if (prompt.avg_retrieved_context_tokens > prompt.avg_static_prompt_tokens + prompt.avg_few_shot_tokens) risks.push("Most prompt tokens are retrieved or dynamic context; fine-tuning will not remove those tokens.");
  if (quality.missing_knowledge_rate > 35) risks.push("Many failures appear knowledge-related; RAG or context quality is safer than moving facts into weights.");
  if (data.label_quality === "low") risks.push("Label quality is low; corrected examples or human review are needed before training.");
  if (stability.dynamicKnowledge) risks.push("The behavior being taught may change frequently, increasing retraining and drift risk.");
  if (routing.routing_cost_reduction_pct > economics.total_cost_reduction_pct && routing.routing_quality_delta >= -5) risks.push("Routing may achieve similar or better savings without training operations.");
  return risks;
}

function nextStepsFor(recommendation: FineTuningRecommendationAction, data: FineTuningDataReadiness, routing: FineTuningRoutingComparison, stability: StabilityAnalysis) {
  if (recommendation === "do_not_fine_tune") return ["Collect at least 100 high-quality or corrected examples for the target trace signature.", "Improve the eval and golden dataset coverage before training."];
  if (recommendation === "improve_prompting_or_context") return stability.dynamicKnowledge
    ? ["Tighten retrieved context selection and source freshness.", "Re-run evals after RAG/context changes before considering fine-tuning."]
    : ["Reduce duplicated instructions and few-shot examples in the prompt.", "Run an A/B eval comparing shorter prompts against current prompts."];
  if (recommendation === "use_routing") return [routing.routing_recommendation, "Run a controlled routing simulation on the highest-volume trace signatures."];
  if (data.readiness_level === "prototype") return ["Run a prototype fine-tune on one stable trace signature.", "Hold out a golden eval set and compare against routing before deployment."];
  return ["Start a fine-tuning pilot on the highest-volume stable trace signature.", "Evaluate the fine-tuned model against golden human labels and routing alternatives before rollout."];
}

function confidenceFor(traces: Trace[], judgeResults: TraceJudgeResult[], data: FineTuningDataReadiness, economics: { pricingKnown: boolean; volumeKnown: boolean }): FineTuningConfidence {
  const evalCoverage = pct(judgeResults.length, traces.length);
  if (traces.length >= 1000 && evalCoverage >= 80 && data.label_quality !== "low" && economics.pricingKnown && economics.volumeKnown) return "high";
  if (traces.length >= 100 && evalCoverage >= 40 && economics.pricingKnown) return "medium";
  return "low";
}

function stripEconomics(economics: FineTuningEconomicSummary): FineTuningEconomicSummary {
  return {
    current_monthly_cost: economics.current_monthly_cost,
    projected_monthly_cost: economics.projected_monthly_cost,
    monthly_savings: economics.monthly_savings,
    annual_savings: economics.annual_savings,
    break_even_months: economics.break_even_months,
    input_token_reduction_pct: economics.input_token_reduction_pct,
    total_cost_reduction_pct: economics.total_cost_reduction_pct,
    latency_reduction_estimate_pct: economics.latency_reduction_estimate_pct,
  };
}

function estimateFewShotTokens(trace: Trace) {
  const metadataTokens = Number(trace.metadata?.few_shot_tokens ?? 0);
  if (Number.isFinite(metadataTokens) && metadataTokens > 0) return metadataTokens;
  const text = trace.prompt_text;
  const matches = text.match(/(few[- ]shot|example\s+\d+|examples?:)([\s\S]{0,1200})/i);
  if (!matches) return 0;
  return Math.min(trace.input_tokens * .6, approxTokens(matches[0]));
}

function estimateRetrievedContextTokens(trace: Trace) {
  const metadataTokens = Number(trace.metadata?.retrieved_context_tokens ?? 0);
  if (Number.isFinite(metadataTokens) && metadataTokens > 0) return metadataTokens;
  const retrieved = String(trace.metadata?.retrieved_context ?? "");
  const retrieverSpanTokens = (trace.spans ?? []).filter((span) => span.type === "retriever").length * 500;
  const promptMatch = trace.prompt_text.match(/(retrieved context|context:|source excerpts?|policy excerpt)([\s\S]{0,2400})/i);
  return Math.min(trace.input_tokens * .85, approxTokens(retrieved) + retrieverSpanTokens + (promptMatch ? approxTokens(promptMatch[0]) : 0));
}

function longestCommonPrefix(values: string[]) {
  if (!values.length) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < value.length && prefix[index] === value[index]) index++;
    prefix = prefix.slice(0, index);
    if (!prefix) break;
  }
  return prefix;
}

function estimatePromptSimilarity(prompts: string[]) {
  if (prompts.length < 2) return prompts.length ? 1 : 0;
  const sampled = prompts.slice(0, 40).map((prompt) => new Set(normalize(prompt).split(/\s+/).filter((word) => word.length > 2)));
  const scores: number[] = [];
  for (let i = 0; i < sampled.length; i++) {
    for (let j = i + 1; j < Math.min(sampled.length, i + 6); j++) {
      const intersection = [...sampled[i]].filter((word) => sampled[j].has(word)).length;
      const union = new Set([...sampled[i], ...sampled[j]]).size;
      scores.push(union ? intersection / union : 0);
    }
  }
  return avg(scores);
}

function classifyFailureMode(trace: Trace, judge?: TraceJudgeResult) {
  const text = `${trace.error_type ?? ""} ${judge?.rationale ?? ""}`.toLowerCase();
  if (/missing field|required field|field/.test(text)) return "missing_field";
  if (/hallucinat|misleading|unsupported|invent/.test(text)) return "hallucination";
  if (/json|schema|format|parse|valid/.test(text)) return "formatting_failure";
  if (/classif|intent|sentiment|label|taxonomy/.test(text)) return "classification_error";
  if (/extract|invoice|amount|entity/.test(text)) return "extraction_error";
  if (/reason|logic|math|incomplete|required detail/.test(text)) return "reasoning_error";
  if (/policy|unsafe|compliance|violation/.test(text)) return "policy_violation";
  if (/tone|style|voice|rude|friendly/.test(text)) return "tone_style_mismatch";
  if (/tool|api|timeout|function/.test(text)) return "tool_use_error";
  return "other_failure";
}

function isMissingKnowledge(trace: Trace, judge?: TraceJudgeResult) {
  return /missing knowledge|unknown|not found|not provided|outdated|unsupported|hallucinat|cannot verify|source/.test(`${traceText(trace)} ${judge?.rationale ?? ""}`);
}

function isDynamicContextTrace(trace: Trace) {
  return /retrieved|pricing|inventory|legal text|product docs|support policy|external facts|news|personalized|current|latest/.test(traceText(trace));
}

function isTeachableFailure(trace: Trace, judge?: TraceJudgeResult) {
  return /format|schema|json|classif|label|extract|tone|style|missing field|required detail|policy wording/.test(`${traceText(trace)} ${judge?.rationale ?? ""}`);
}

function readinessLevel(examples: number): FineTuningReadinessLevel {
  if (examples < 100) return "insufficient";
  if (examples < 1000) return "prototype";
  if (examples < 5000) return "pilot_ready";
  return "strong";
}

function readinessScore(level: FineTuningReadinessLevel) {
  return level === "strong" ? 1 : level === "pilot_ready" ? .78 : level === "prototype" ? .42 : 0;
}

function estimateDuplicateRate(prompts: string[]) {
  if (!prompts.length) return 0;
  const normalized = prompts.map((prompt) => normalize(prompt).slice(0, 180));
  return 1 - new Set(normalized).size / normalized.length;
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function currentTraceCost(trace: Trace) {
  if (trace.cost_usd !== undefined && trace.cost_usd > 0) return trace.cost_usd;
  const model = getModel(trace.model);
  return model ? calculateCost(trace.input_tokens, trace.output_tokens, model) : 0;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function money(value: number) {
  return `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
