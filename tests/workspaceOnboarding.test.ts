import { describe, expect, it } from "vitest";
import { shouldShowWorkspaceOnboarding, workspaceOnboardingState } from "../src/core/workspaceOnboarding";

const base = {
  traceCount: 0,
  taskGroupCount: 0,
  evaluationEvidenceCount: 0,
  hasSimulationDecision: false,
  hasPublishedPolicy: false,
};

describe("workspace onboarding", () => {
  it("hides the wizard after the first policy becomes active", () => {
    expect(shouldShowWorkspaceOnboarding(true, "ready", false)).toBe(true);
    expect(shouldShowWorkspaceOnboarding(true, "loading", false)).toBe(false);
    expect(shouldShowWorkspaceOnboarding(true, "ready", true)).toBe(false);
    expect(shouldShowWorkspaceOnboarding(false, "ready", false)).toBe(false);
  });

  it("marks trace import complete and advances to task-group generation", () => {
    const state = workspaceOnboardingState({ ...base, traceCount: 300 });
    expect(state.completedCount).toBe(1);
    expect(state.steps[0]).toMatchObject({ title: "Add production traces", complete: true, current: false });
    expect(state.currentStep).toMatchObject({ title: "Generate task groups", action: "Generate task groups", page: "Distinct Tasks" });
  });

  it("advances one gated evidence step at a time", () => {
    const groups = workspaceOnboardingState({ ...base, traceCount: 300, taskGroupCount: 18 });
    expect(groups.completedCount).toBe(2);
    expect(groups.currentStep?.id).toBe("quality");

    const quality = workspaceOnboardingState({ ...base, traceCount: 300, taskGroupCount: 18, evaluationEvidenceCount: 42 });
    expect(quality.completedCount).toBe(3);
    expect(quality.currentStep?.id).toBe("simulations");

    const simulation = workspaceOnboardingState({ ...base, traceCount: 300, taskGroupCount: 18, evaluationEvidenceCount: 42, hasSimulationDecision: true });
    expect(simulation.completedCount).toBe(4);
    expect(simulation.currentStep?.id).toBe("policy");
  });

  it("does not skip prerequisites when later state exists", () => {
    const state = workspaceOnboardingState({ ...base, traceCount: 300, hasSimulationDecision: true, hasPublishedPolicy: true });
    expect(state.completedCount).toBe(1);
    expect(state.currentStep?.id).toBe("task-groups");
  });

  it("finishes only after a measured decision and a published policy", () => {
    const state = workspaceOnboardingState({
      traceCount: 300,
      taskGroupCount: 18,
      evaluationEvidenceCount: 42,
      hasSimulationDecision: true,
      hasPublishedPolicy: true,
    });
    expect(state.completedCount).toBe(5);
    expect(state.currentStep).toBeNull();
  });
});
