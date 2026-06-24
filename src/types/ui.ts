import type { DistinctTaskField } from "../types";

export type Page = "Home" | "Overview" | "Traces" | "Distinct Tasks" | "Evals" | "Golden Dataset" | "Review Queue" | "Simulations" | "Recommendations" | "Fine-Tuning" | "Model Catalog";

export type ReviewDecision = "approve" | "reject" | "escalate" | "skip";

export type ReviewQueueFilter = "all" | "passing" | "needs_review";

export type SortDirection = "asc" | "desc";

export type DistinctTaskSortKey = "bucket_name" | DistinctTaskField | "trace_count" | "total_cost_usd" | "avg_confidence" | "eval_plan";

export type TraceSortKey = "trace" | "model" | "prompt" | "response" | "judge" | "tokens" | "latency" | "cost" | "status";
