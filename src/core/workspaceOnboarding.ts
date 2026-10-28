import type { Page } from "../types/ui";

export type WorkspaceOnboardingInput = {
  traceCount: number;
  taskGroupCount: number;
  evaluationEvidenceCount: number;
  hasSimulationDecision: boolean;
  hasPublishedPolicy: boolean;
};

export type WorkspaceOnboardingStep = {
  id: "traces" | "task-groups" | "quality" | "simulations" | "policy";
  number: string;
  title: string;
  detail: string;
  action: string;
  page: Page;
  complete: boolean;
  current: boolean;
};

export type WorkspaceOnboardingState = {
  steps: WorkspaceOnboardingStep[];
  completedCount: number;
  currentStep: WorkspaceOnboardingStep | null;
};

export function workspaceOnboardingState(input: WorkspaceOnboardingInput): WorkspaceOnboardingState {
  const tracesComplete = input.traceCount > 0;
  const taskGroupsComplete = tracesComplete && input.taskGroupCount > 0;
  const qualityComplete = taskGroupsComplete && input.evaluationEvidenceCount > 0;
  const simulationsComplete = qualityComplete && input.hasSimulationDecision;
  const policyComplete = simulationsComplete && input.hasPublishedPolicy;
  const completed = [tracesComplete, taskGroupsComplete, qualityComplete, simulationsComplete, policyComplete];
  const currentIndex = completed.findIndex((value) => !value);

  const definitions: Array<Omit<WorkspaceOnboardingStep, "complete" | "current">> = [
    {
      id: "traces",
      number: "01",
      title: "Add production traces",
      detail: tracesComplete
        ? `${input.traceCount.toLocaleString()} traces imported and normalized. No classification or evaluation ran during import.`
        : "Upload CSV or JSONL. RouteLab stores and normalizes the records without classifying or evaluating them.",
      action: "Upload traces",
      page: "Traces",
    },
    {
      id: "task-groups",
      number: "02",
      title: "Generate task groups",
      detail: taskGroupsComplete
        ? `${input.taskGroupCount.toLocaleString()} task groups define the recurring outcomes in this traffic.`
        : "Run task discovery explicitly to organize requests by the outcome they are trying to achieve.",
      action: "Generate task groups",
      page: "Distinct Tasks",
    },
    {
      id: "quality",
      number: "03",
      title: "Set the quality bar",
      detail: qualityComplete
        ? `${input.evaluationEvidenceCount.toLocaleString()} evaluation records are available for quality decisions.`
        : "Add eval evidence and review where automated judgments disagree with people.",
      action: "Add evaluation evidence",
      page: "Evals",
    },
    {
      id: "simulations",
      number: "04",
      title: "Replay candidate models",
      detail: simulationsComplete
        ? "At least one measured task-model result has been promoted into the draft policy."
        : "Compare quality, latency, and cost on the same requests within each task group.",
      action: "Run routing simulations",
      page: "Simulations",
    },
    {
      id: "policy",
      number: "05",
      title: "Approve an allocation policy",
      detail: policyComplete
        ? "A signed allocation policy is active."
        : "Review the fallback and task overrides, then publish a signed policy version.",
      action: policyComplete ? "View active policy" : "Review and publish policy",
      page: "Simulations",
    },
  ];

  const steps = definitions.map((definition, index) => ({
    ...definition,
    complete: completed[index],
    current: currentIndex === index,
  }));

  return {
    steps,
    completedCount: completed.filter(Boolean).length,
    currentStep: currentIndex === -1 ? null : steps[currentIndex],
  };
}
