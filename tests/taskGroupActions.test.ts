import { describe, expect, it } from "vitest";
import { confirmTaskGroup, editTaskGroup, taskGroupIdFromSearch } from "../src/core/taskGroupActions";
import type { DistinctTaskBucket } from "../src/types";

const group: DistinctTaskBucket = {
  bucket_id: "task_refund",
  bucket_name: "Refund requests",
  task: { task_type: "customer_support_responses", domain: "billing", complexity: "medium", temporal_context: "single_turn", tool_use: "none", output_uncertainty: "medium", output_format: "natural_language", grounding_requirement: "policy_grounded" },
  traces: ["trace_1"], trace_count: 1, total_cost_usd: 0.01, avg_cost_usd: 0.01, total_tokens: 100,
  avg_input_tokens: 80, avg_output_tokens: 20, avg_confidence: 0.9, low_confidence_count: 0,
  risk_level: "medium", customer_facing: true,
  evidence: { task_type: [], domain: [], complexity: [], temporal_context: [], tool_use: [], output_uncertainty: [], output_format: [], grounding_requirement: [] },
  examples: [],
};

describe("task group actions", () => {
  it("confirms only the selected group", () => {
    const result = confirmTaskGroup([group], group.bucket_id, "2026-10-27T12:00:00.000Z");
    expect(result[0]).toMatchObject({ review_status: "confirmed", reviewed_at: "2026-10-27T12:00:00.000Z" });
  });

  it("edits the selected group and records review state", () => {
    const result = editTaskGroup([group], group.bucket_id, { bucketName: " Billing resolution ", task: { ...group.task, complexity: "high" } }, "2026-10-27T12:00:00.000Z");
    expect(result[0]).toMatchObject({ bucket_name: "Billing resolution", review_status: "edited", reviewed_at: "2026-10-27T12:00:00.000Z", task: { complexity: "high" } });
  });

  it("reads a task-scoped simulation deep link", () => {
    expect(taskGroupIdFromSearch("?taskGroup=task_refund")).toBe("task_refund");
    expect(taskGroupIdFromSearch("")).toBeNull();
  });
});
