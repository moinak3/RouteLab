import type { DistinctTaskField } from "../types";

export type Page = "Overview" | "Traces" | "Distinct Tasks" | "Review Queue" | "Simulations" | "Recommendations" | "Model Catalog";

export type ReviewDecision = "approve" | "reject" | "escalate" | "skip";

export type SortDirection = "asc" | "desc";

export type DistinctTaskSortKey = "bucket_name" | DistinctTaskField | "trace_count" | "total_cost_usd" | "avg_confidence" | "eval_plan";

export type TraceSortKey = "trace" | "model" | "prompt" | "response" | "tokens" | "latency" | "cost" | "status";
