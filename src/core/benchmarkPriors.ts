import seed from "../data/benchmark_priors.seed.json";
import { getModel } from "./catalog";
import type { BenchmarkFamily, BenchmarkPrior, BenchmarkPriorOutput, CandidateModelRecommendation, CrossCustomerAdoptionEvidence, CustomerEvaluationEvidence, ModelBenchmarkScore, DistinctTask } from "../types";

type MappingRule = BenchmarkPrior & {
  task_type_any?: string[];
  domain_any?: string[];
  output_format_any?: string[];
  grounding_any?: string[];
  metadata_keywords_any?: string[];
  tool_use?: boolean;
};
type BenchmarkSeed = {
  benchmark_families: BenchmarkFamily[];
  mapping_rules: MappingRule[];
  model_scores: ModelBenchmarkScore[];
  fallback_models: string[];
};
const data = seed as unknown as BenchmarkSeed;
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const normalizeScore = (score?: number) => score === undefined ? undefined : score > 1 ? clamp(score / 100) : clamp(score);
const normalizeRank = (rank?: number) => rank === undefined ? undefined : clamp(1 / rank);
const confidenceLabel = (value: number): "low" | "medium" | "high" => value >= 4 ? "high" : value >= 2.75 ? "medium" : "low";
const distinctTaskText = (task: DistinctTask) => Object.values(task).join(" ").toLowerCase();
const matches = (rule: MappingRule, task: DistinctTask) => {
  if (rule.task_type_any && !rule.task_type_any.includes(task.task_type)) return false;
  if (rule.domain_any && !rule.domain_any.includes(task.domain)) return false;
  if (rule.output_format_any && !rule.output_format_any.includes(task.output_format)) return false;
  if (rule.grounding_any && !rule.grounding_any.includes(task.grounding_requirement)) return false;
  if (rule.tool_use !== undefined && rule.tool_use !== (task.tool_use !== "none")) return false;
  if (rule.metadata_keywords_any && !rule.metadata_keywords_any.some((word) => distinctTaskText(task).includes(word))) return false;
  return true;
};
const mergePriors = (priors: BenchmarkPrior[]) => {
  const byBenchmark = new Map<string, BenchmarkPrior>();
  priors.forEach((prior) => {
    const existing = byBenchmark.get(prior.benchmark_id);
    if (!existing || prior.alignment_score * prior.weight > existing.alignment_score * existing.weight) byBenchmark.set(prior.benchmark_id, prior);
  });
  return [...byBenchmark.values()].sort((a, b) => b.alignment_score * b.weight - a.alignment_score * a.weight);
};

export const benchmarkFamilies = data.benchmark_families;
export const modelBenchmarkScores = data.model_scores;
export function mapDistinctTaskToBenchmarkPriors(task: DistinctTask): BenchmarkPrior[] {
  const mapped = mergePriors(data.mapping_rules.filter((rule) => matches(rule, task)).map(({ benchmark_id, alignment_score, confidence, rationale, weight }) => ({ benchmark_id, alignment_score, confidence, rationale, weight })));
  if (mapped.some((prior) => prior.alignment_score >= .55)) return mapped;
  return [{
    benchmark_id: "custom_signaleval",
    alignment_score: .55,
    confidence: 2,
    rationale: "No public benchmark family maps strongly to this Distinct Task; custom SignalEval traces should dominate selection.",
    weight: 1,
  }];
}

function scoreEvidence(prior: BenchmarkPrior, evidence: ModelBenchmarkScore) {
  const normalized = normalizeScore(evidence.score) ?? normalizeRank(evidence.rank) ?? .35;
  const benchmarkConfidence = prior.confidence / 5;
  const freshness = evidence.score_date && evidence.score_date >= "2025-01-01" ? 1 : .65;
  return clamp(.45 * prior.alignment_score + .30 * normalized + .15 * benchmarkConfidence + .10 * freshness);
}
export type CandidateRecommendationOptions = {
  topK?: number;
  customerEvaluations?: CustomerEvaluationEvidence[];
  adoptionEvidence?: CrossCustomerAdoptionEvidence[];
};

export function recommendCandidateModels(task: DistinctTask, options: CandidateRecommendationOptions = {}): CandidateModelRecommendation[] {
  const topK = options.topK ?? 3;
  const priors = mapDistinctTaskToBenchmarkPriors(task);
  const customDominant = priors[0]?.benchmark_id === "custom_signaleval";
  const customerByModel = new Map((options.customerEvaluations ?? []).map((item) => [item.model_id, item]));
  const hasAnyCustomerEvidence = [...customerByModel.values()].some((item) => item.sample_size >= 3);
  const adoptionByModel = new Map((options.adoptionEvidence ?? []).map((item) => [item.model_id, item]));
  const evidenceByModel = new Map<string, ModelBenchmarkScore[]>();
  priors.forEach((prior) => data.model_scores.filter((score) => score.benchmark_id === prior.benchmark_id).forEach((score) => evidenceByModel.set(score.model_id, [...(evidenceByModel.get(score.model_id) ?? []), score])));
  customerByModel.forEach((_evidence, modelId) => {
    if (!evidenceByModel.has(modelId)) evidenceByModel.set(modelId, []);
  });
  if (!evidenceByModel.size || priors.every((prior) => prior.benchmark_id === "custom_signaleval")) {
    const modelIds = [...customerByModel.values()]
      .sort((left, right) => right.sample_size - left.sample_size || right.average_score - left.average_score)
      .map((item) => item.model_id);
    data.fallback_models.forEach((modelId) => { if (!modelIds.includes(modelId)) modelIds.push(modelId); });
    return modelIds.slice(0, topK).map((modelId, index) => {
      const model = getModel(modelId);
      const customer = customerByModel.get(modelId);
      return {
        model_id: modelId,
        model_name: model?.display_name ?? modelId,
        candidate_score: Number((customer ? .75 * customer.average_score + .25 * .48 : .48 - index * .03).toFixed(3)),
        benchmark_evidence: data.model_scores.filter((score) => score.model_id === modelId && score.benchmark_id === "custom_signaleval"),
        customer_evaluation: customer,
        adoption_evidence: adoptionByModel.get(modelId),
        confidence: customer && customer.sample_size >= 3 ? 3 : 1,
        rationale: customer && customer.sample_size >= 3
          ? "Customer evaluation evidence drives this shortlist position because public benchmark alignment is weak."
          : "Generally strong frontier model candidate; public benchmark priors are weak for this Distinct Task.",
        why_match: "Broad capability makes this a useful comparison point when no public benchmark closely matches the task.",
        caveats: ["Custom SignalEval traces should dominate model selection before production routing.", "Do not interpret this as the best model for the workload."],
      };
    });
  }
  return [...evidenceByModel.entries()].map(([modelId, evidence]) => {
    const weightedScores = evidence.flatMap((item) => {
      const prior = priors.find((entry) => entry.benchmark_id === item.benchmark_id);
      return prior ? [scoreEvidence(prior, item) * prior.weight] : [];
    });
    const weights = evidence.flatMap((item) => {
      const prior = priors.find((entry) => entry.benchmark_id === item.benchmark_id);
      return prior ? [prior.weight] : [];
    });
    const publicScore = weights.reduce((sum, weight) => sum + weight, 0) ? weightedScores.reduce((sum, value) => sum + value, 0) / weights.reduce((sum, weight) => sum + weight, 0) : .35;
    const customer = customerByModel.get(modelId);
    const adoption = adoptionByModel.get(modelId);
    const hasCustomerEvidence = Boolean(customer && customer.sample_size >= 3);
    const adoptionScore = adoption ? clamp((adoption.explicit_approvals + adoption.default_selections * .2) / 12) : .5;
    const candidateScore = hasCustomerEvidence
      ? .80 * customer!.average_score + .15 * publicScore + .05 * adoptionScore
      : hasAnyCustomerEvidence
        ? .60 * publicScore + (adoption ? .10 * adoptionScore : 0)
        : adoption ? .85 * publicScore + .15 * adoptionScore : publicScore;
    const modelConfidence = average(evidence.map((item) => item.confidence));
    const strongestPrior = priors.find((prior) => evidence.some((item) => item.benchmark_id === prior.benchmark_id));
    return {
      model_id: modelId,
      model_name: evidence[0]?.model_name ?? getModel(modelId)?.display_name ?? modelId,
      candidate_score: Number(candidateScore.toFixed(3)),
      benchmark_evidence: evidence,
      customer_evaluation: customer,
      adoption_evidence: adoption,
      confidence: hasCustomerEvidence ? Math.max(3, Math.min(5, Math.round(modelConfidence + 1))) : customDominant ? 1 : Math.max(1, Math.min(4, Math.round(modelConfidence))),
      rationale: hasCustomerEvidence
        ? "Customer evaluation evidence carries most of this shortlist score; benchmark and adoption evidence are supporting signals."
        : "Public benchmark relevance drives this shortlist position because sufficient customer evaluation evidence is not yet available.",
      why_match: strongestPrior?.rationale ?? "Useful comparison candidate for this task profile.",
      caveats: [
        customDominant ? "Custom SignalEval traces should dominate model selection before production routing." : "Based on public benchmark priors, this is a candidate model to simulate, not a best-model claim.",
        "Validate on customer-specific SignalEval traces before production routing.",
        "Do not interpret this as the best model for the workload.",
      ],
    };
  }).sort((a, b) => b.candidate_score - a.candidate_score).slice(0, topK);
}

export function buildBenchmarkPriorRecommendation(task: DistinctTask, options: CandidateRecommendationOptions = {}): BenchmarkPriorOutput {
  const topK = options.topK ?? 3;
  const benchmark_priors = mapDistinctTaskToBenchmarkPriors(task);
  const candidate_models = recommendCandidateModels(task, { ...options, topK });
  const publicPriors = benchmark_priors.filter((prior) => prior.benchmark_id !== "custom_signaleval");
  const benchmarkConfidence = benchmark_priors[0]?.benchmark_id === "custom_signaleval"
    ? "low"
    : confidenceLabel(average(publicPriors.map((prior) => prior.confidence)));
  return {
    distinct_task: task,
    benchmark_priors,
    candidate_models,
    recommendation: {
      action: "simulate_candidates_in_signaleval",
      top_k: topK,
      benchmark_confidence: benchmarkConfidence,
      model_selection_confidence: confidenceLabel(average(candidate_models.map((model) => model.confidence))),
    },
  };
}
