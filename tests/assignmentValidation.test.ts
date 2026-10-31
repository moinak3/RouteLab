import { describe, expect, it } from "vitest";
import {
  buildAssignmentValidationSample,
  classifierExamplesFromAssignments,
  createWeeklyAssignmentValidationRound,
  emptyAssignmentValidationWorkflow,
  normalizeAssignmentValidationWorkflow,
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

  it("migrates the original flat workflow into an initial calibration round", () => {
    const migrated = normalizeAssignmentValidationWorkflow({
      version: 1,
      sampleSize: 1,
      sampleTraceIds: ["trace-1"],
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      labels: [],
      jevAssignments: [],
      llmAssignments: [],
    });
    expect(migrated?.version).toBe(2);
    expect(migrated?.roundKind).toBe("initial");
    expect(migrated?.laneByTraceId["trace-1"]).toBe("initial_blind");
    expect(migrated?.history).toEqual([]);
  });

  it("creates a non-overlapping weekly round with blind and targeted lanes", () => {
    const traces = createSeedTraces().slice(0, 60).map((trace, index) => ({
      ...trace,
      signature_decision: {
        provider: "jev" as const,
        model: "typesafe/jev-1.14",
        signature_id: index % 7 === 0 ? "unknown" : `task-${index % 4}`,
        signature_label: index % 7 === 0 ? "Unknown" : `Task ${index % 4}`,
        confidence: index % 7 === 0 ? .35 : .91,
        probabilities: {},
        status: index % 7 === 0 ? "unknown" as const : "matched" as const,
        routing_action: index % 7 === 0 ? "fallback_model" as const : "signature_route" as const,
        confidence_threshold: .86,
        latency_ms: 20,
        reason: "fixture",
      },
    }));
    const groups = createDistinctTaskBuckets(traces);
    const initial = emptyAssignmentValidationWorkflow(traces, groups, 20, "2026-10-01T00:00:00.000Z");
    const weekly = createWeeklyAssignmentValidationRound(initial, traces, groups, 20, "2026-10-08T00:00:00.000Z");
    expect(weekly.roundKind).toBe("weekly");
    expect(weekly.history).toHaveLength(1);
    expect(weekly.sampleTraceIds).toHaveLength(20);
    expect(weekly.sampleTraceIds.some((id) => initial.sampleTraceIds.includes(id))).toBe(false);
    expect(Object.values(weekly.laneByTraceId).filter((lane) => lane === "weekly_blind")).toHaveLength(12);
    expect(Object.values(weekly.laneByTraceId).filter((lane) => lane === "weekly_targeted")).toHaveLength(8);
    expect(weekly.jevAssignments.length).toBe(20);
  });

  it("gives classifiers representative request examples without response text", () => {
    const traces = createSeedTraces().slice(0, 24);
    const groups = createDistinctTaskBuckets(traces);
    const signatures = taskGroupSignatures(groups);
    expect(signatures[0].description).toContain("Representative request 1:");
    expect(signatures[0].description).not.toContain(groups[0].examples[0].response_preview);
  });
});
