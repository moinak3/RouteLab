import type { DistinctTaskField } from "../types";

export type Page = "Home" | "Overview" | "Traces" | "Distinct Tasks" | "Evals" | "Golden Dataset" | "Review Queue" | "Classifier Validation" | "Simulations" | "Benchmarking" | "Recommendations" | "Fine-Tuning" | "Model Catalog";

export type ReviewDecision = "correct" | "incorrect" | "escalate" | "skip";

export type ReviewQueueFilter = "representative" | "unusual" | "uncovered";

export type SortDirection = "asc" | "desc";

export type DistinctTaskSortKey = "bucket_name" | DistinctTaskField | "most_common_model" | "trace_count" | "total_cost_usd" | "average_cost_usd" | "average_quality_score" | "p95_latency_ms" | "avg_confidence" | "eval_plan";

export type TraceSortKey = "timestamp" | "trace" | "model" | "prompt" | "response" | "judge" | "tokens" | "latency" | "cost" | "status";
