export type Risk = "low" | "medium" | "high";
export type WorkflowRole = "planner" | "retriever" | "retriever_summarizer" | "tool_caller" | "final_answer" | "judge" | "other";
export type Message = { role: "system" | "user" | "assistant" | "tool"; content: string };
export type TraceSpan = {
  id: string; parent_id?: string; type: "llm" | "tool" | "retriever" | "function" | "chain" | "agent" | "unknown";
  name?: string; input?: unknown; output?: unknown; metadata?: Record<string, unknown>;
};
export type Trace = {
  id: string; timestamp: string; provider?: string; model: string; messages: Message[];
  prompt_text: string; response_text?: string; input_tokens: number; output_tokens: number;
  total_tokens: number; latency_ms?: number; cost_usd?: number; status: "success" | "error";
  workflow_id?: string; node_id?: string; parent_node_id?: string; workflow_role?: WorkflowRole; span_name?: string;
  source?: "langsmith" | "braintrust" | "helicone" | "litellm" | "csv" | "json" | "unknown";
  spans?: TraceSpan[]; error_type?: string; metadata?: Record<string, unknown>;
};
export type NormalizedTrace = Trace;
export type TaskType =
  | "summarization"
  | "extraction"
  | "classification_tagging"
  | "question_answering"
  | "rag_grounded_answers"
  | "customer_support_responses"
  | "policy_compliance_reasoning"
  | "code_generation"
  | "code_review_debugging"
  | "sql_data_query_generation"
  | "data_analysis_insight_generation"
  | "writing_editing"
  | "sales_marketing_content"
  | "translation_localization"
  | "document_review_legal_analysis"
  | "planning_strategy_recommendations"
  | "tool_use_function_calling"
  | "agentic_workflow_execution"
  | "moderation_safety_review"
  | "multimodal_document_image_understanding";
export type Domain = "general" | "customer_support" | "billing" | "legal" | "compliance" | "finance" | "healthcare" | "sales" | "marketing" | "engineering" | "data" | "hr" | "education" | "operations" | "security" | "product" | "unknown";
export type Complexity = "low" | "medium" | "high";
export type TemporalContext = "single_turn" | "early_multi_turn" | "late_multi_turn";
export type ToolUse = "none" | "success" | "recovered_failure" | "failed";
export type OutputUncertainty = "low" | "medium" | "high";
export type OutputFormat = "natural_language" | "json" | "yaml" | "xml" | "markdown" | "table" | "code" | "sql" | "tool_call" | "classification_label" | "mixed" | "unknown";
export type GroundingRequirement = "none" | "provided_context" | "retrieval_augmented" | "source_citation_required" | "policy_grounded" | "tool_grounded" | "unknown";
export type FieldInference<T> = { value: T; confidence: number; evidence: string[] };
export type DistinctTask = {
  task_type: TaskType; domain: Domain; complexity: Complexity; temporal_context: TemporalContext; tool_use: ToolUse;
  output_uncertainty: OutputUncertainty;
  output_format: OutputFormat; grounding_requirement: GroundingRequirement;
};
export type DistinctTaskField = keyof DistinctTask;
export type InferredDistinctTask = {
  trace_id: string; task: DistinctTask; confidence: Record<DistinctTaskField, number>;
  evidence: Record<DistinctTaskField, string[]>; overall_confidence: number;
  risk_level: Risk; customer_facing: boolean;
  task_status: "inferred" | "low_confidence_needs_review" | "user_confirmed" | "user_corrected";
};
export type DistinctTaskBucket = {
  bucket_id: string; bucket_name: string; task: DistinctTask; traces: string[]; trace_count: number;
  total_cost_usd: number; avg_cost_usd: number; total_tokens: number; avg_input_tokens: number; avg_output_tokens: number;
  avg_latency_ms?: number; avg_confidence: number; low_confidence_count: number;
  risk_level: Risk; customer_facing: boolean;
  evidence: Record<DistinctTaskField, string[]>;
  examples: Array<{ trace_id: string; prompt_preview: string; response_preview: string }>;
};
export type EvalType = "json_schema_validation" | "field_level_exact_match" | "regex_match" | "classification_accuracy" | "confusion_matrix" | "sql_parse" | "sql_execution" | "unit_tests" | "compile_check" | "groundedness_judge" | "citation_accuracy" | "policy_compliance_judge" | "required_facts_check" | "hallucination_check" | "summarization_fidelity_judge" | "omission_check" | "pairwise_judge_against_baseline" | "rubric_judge" | "safety_policy_check" | "tool_call_validity" | "tool_argument_correctness" | "tool_error_recovery" | "context_retention" | "instruction_adherence" | "uncertainty_calibration" | "human_review_sample" | "business_outcome_check";
export type EvalRecommendation = { eval_type: EvalType; priority: "required" | "recommended" | "optional"; reason: string; suggested_config?: Record<string, unknown> };
export type EvalPlan = {
  bucket_id: string; task: DistinctTask; plan_name: string; confidence: number; required_evals: EvalRecommendation[];
  recommended_evals: EvalRecommendation[]; optional_evals: EvalRecommendation[]; human_review_required: boolean;
  minimum_sample_size: number; route_readiness_rule: string; notes: string[];
};
export type WorkflowTraceNode = {
  node_id: string; trace_id: string; parent_node_id?: string; workflow_role: WorkflowRole; span_name?: string;
  children: WorkflowTraceNode[];
};
export type WorkflowTraceTree = {
  workflow_id: string; trace_ids: string[]; roots: WorkflowTraceNode[]; total_cost_usd: number;
  total_latency_ms: number; roles: Partial<Record<WorkflowRole, number>>;
};
export type Model = {
  id: string; provider: string; display_name: string; input_cost_per_1m: number;
  output_cost_per_1m: number; default_latency_ms: number; deployment_type: string;
  pricing_source?: "OpenRouter" | "User configured"; pricing_source_model_id?: string; pricing_updated_at?: string;
  enabled?: boolean;
  quality_tier: "cheap" | "balanced" | "strong" | "specialist";
  family: "OpenAI" | "Claude" | "Gemini" | "Mistral" | "DeepSeek" | "Local";
  family_tier: "top" | "mid" | "cheapest";
};
export type CandidateRun = {
  id: string; trace_id: string; candidate_model: string; response_text: string; input_tokens: number;
  output_tokens: number; latency_ms: number; cost_usd: number; status: "success" | "error";
};
export type EvalResult = {
  id: string; trace_id: string; candidate_run_id: string; evaluator_type: string;
  score: number; passed: boolean; explanation?: string; severity?: "minor" | "major" | "critical";
};
export type RoutingRule = {
  id: string; name: string; match: { distinct_task_bucket_id: string; risk_level: Risk };
  strategy: { type: "direct"; model: string } | { type: "cascade"; primary_model: string; fallback_model: string; evaluator: string; pass_threshold: number } | { type: "keep_current" };
  rationale: string;
  estimated_monthly_savings_usd: number;
  comparison?: {
    cost: { before: number; after: number; delta_pct: number };
    latency_ms: { before: number; after: number; delta_pct: number };
    quality: { before: number; after: number; delta_pct: number };
  };
  rejected_alternative?: {
    model: string; reason: string; potential_monthly_savings_usd: number;
    comparison: NonNullable<RoutingRule["comparison"]>;
  };
};
export type RoutingPolicy = {
  id: string; name: string; created_at: string; rules: RoutingRule[]; estimated_monthly_savings_usd: number;
  estimated_sample_savings_usd: number; monthly_multiplier: number;
  estimated_quality_delta: number; estimated_latency_delta_pct: number; risk_summary: string;
  candidate_model_ids: string[];
};
export type BenchmarkFamily = {
  id: string; name: string; description: string; best_for: string[]; weak_for: string[];
  source_url?: string; freshness_date?: string;
};
export type BenchmarkPrior = {
  benchmark_id: string; alignment_score: number; confidence: number; rationale: string; weight: number;
};
export type ModelBenchmarkScore = {
  model_id: string; model_name: string; benchmark_id: string; score?: number; rank?: number;
  source_url?: string; score_date?: string; score_type?: "official" | "third_party" | "vendor_reported" | "estimated";
  confidence: number;
};
export type CandidateModelRecommendation = {
  model_id: string; model_name: string; candidate_score: number; benchmark_evidence: ModelBenchmarkScore[];
  confidence: number; rationale: string; caveats: string[];
};
export type BenchmarkPriorOutput = {
  distinct_task: DistinctTask;
  benchmark_priors: BenchmarkPrior[];
  candidate_models: CandidateModelRecommendation[];
  recommendation: {
    action: "simulate_candidates_in_signaleval";
    top_k: number;
    benchmark_confidence: "low" | "medium" | "high";
    model_selection_confidence: "low" | "medium" | "high";
  };
};
