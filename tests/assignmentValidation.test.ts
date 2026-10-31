import { describe, expect, it } from "vitest";
import {
  buildAssignmentValidationSample,
  classifierExamplesFromAssignments,
  emptyAssignmentValidationWorkflow,
  taskGroupSignatures,
} from "../src/core/assignmentValidation";
import { createDistinctTaskBuckets } from "../src/core/distinctTasks";
import { createSeedTraces } from "../src/core/seed";

describe("assignment validation", () => {
  it("creates a stable balanced held-out set without exposing responses as classifier inputs", () => {
    const traces = createSeedTraces().slice(0, 60);
    const groups = createDistinctTaskBuckets(traces);
    const first = buildAssignmentValidationSample(traces, groups, 20);
    const second = buildAssignmentValidationSample(traces, groups, 20);
    expect(first.map((trace) => trace.id)).toEqual(second.map((trace) => trace.id));
    expect(new Set(first.map((trace) => trace.id)).size).toBe(20);
  });

  it("uses human labels as truth for Jev and comparator reports", () => {
    const traces = createSeedTraces().slice(0, 12);
    const groups = createDistinctTaskBuckets(traces);
    const signatures = taskGroupSignatures(groups);
    const workflow = emptyAssignmentValidationWorkflow(traces, groups, 2, "2026-10-30T00:00:00.000Z");
    workflow.labels = workflow.sampleTraceIds.map((traceId, index) => ({
      traceId,
      outcome: index ? "unknown" : "task_group",
      signatureId: index ? null : signatures[0].id,
      rationale: null,
      reviewedAt: "2026-10-30T00:01:00.000Z",
    }));
    workflow.jevAssignments = workflow.sampleTraceIds.map((traceId, index) => ({
      traceId,
      signatureId: index ? "unknown" : signatures[0].id,
      confidence: .95,
      model: "typesafe/jev-1.14",
    }));
    const examples = classifierExamplesFromAssignments(workflow, traces, workflow.jevAssignments);
    expect(examples).toHaveLength(2);
    expect(examples[0].reviewedSignatureId).toBe(signatures[0].id);
    expect(examples[1].reviewedSignatureId).toBe("unknown");
    expect(examples.every((example) => example.usesOnlyPreInferenceInformation)).toBe(true);
  });
});
