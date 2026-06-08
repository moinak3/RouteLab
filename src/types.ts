export type Risk = "low" | "medium" | "high";
export type WorkflowRole = "planner" | "retriever" | "retriever_summarizer" | "tool_caller" | "final_answer" | "judge" | "other";
export type Message = { role: "system" | "user" | "assistant" | "tool"; content: string };
export type Trace = {
  id: string; timestamp: string; provider?: string; model: string; messages: Message[];
  prompt_text: string; response_text?: string; input_tokens: number; output_tokens: number;
  total_tokens: number; latency_ms?: number; cost_usd?: number; status: "success" | "error";
  workflow_id?: string; node_id?: string; parent_node_id?: string; workflow_role?: WorkflowRole; span_name?: string;
  error_type?: string; metadata?: Record<string, unknown>;
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
  quality_tier: "cheap" | "balanced" | "strong" | "specialist";
  family: "OpenAI" | "Claude" | "Gemini" | "Mistral" | "DeepSeek" | "Local";
  family_tier: "top" | "mid" | "cheapest";
};
export type Cluster = {
  id: string; name: string; description: string; trace_ids: string[]; representative_trace_ids: string[];
  volume: number; actual_cost_usd: number; average_latency_ms: number; average_input_tokens: number;
  average_output_tokens: number; dominant_model: string; inferred_task_type: string; risk_level: Risk;
  clustering_reason: string; risk_reason: string; risk_signals: string[];
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
  id: string; name: string; match: { cluster_id: string; risk_level: Risk };
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
