import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  askRouteLabFollowUps,
  parseAskChatLabCommand,
  resolveModel,
  resolveTaskGroup,
  validateAskRouteLabPlan,
  workspaceMetricDashboard,
  workspaceCoverageSummary,
  workspaceMetricSummary,
  type AskChatLabCommand,
  type AskRouteLabPlan,
  type AskRouteLabPlannerResponse,
  type AskRouteLabTraceContext,
  type AskSimulationRequest,
  type AskSimulationResult,
  type AskRouteLabOperationalContext,
} from "../core/askChatLab";
import { fallbackAskRouteLabOpenUI, type AskRouteLabOpenUIMessage, type AskRouteLabOpenUIResponse } from "../core/askRouteLabOpenUISpec";
import { classifierExamplesFromAssignments, taskGroupSignatures, type AssignmentValidationWorkflow } from "../core/assignmentValidation";
import { buildClassifierValidationReport } from "../core/classifierValidation";
import { fetchAssignmentValidation, loadLocalAssignmentValidation, saveLocalAssignmentValidation } from "../core/assignmentValidationPersistence";
import { calibrateGoldenDataset } from "../core/goldenDatasets";
import { JEV_RISK_THRESHOLDS } from "../core/jevSignatureGate";
import { buildReviewQueue } from "../core/reviewQueue";
import { currentReviewCycleId, type PersistedReview, type PersistedTaskGroupReview, type ReviewCycle } from "../core/reviewPersistence";
import { fetchOverviewInsights, overviewInsightTitle, persistOverviewInsight } from "../core/overviewInsights";
import type { DistinctTaskBucket, GoldenDataset, Model, Trace, TraceJudgeResult } from "../types";
import type { Page } from "../types/ui";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  facts?: string[];
  generatedUI?: AskRouteLabOpenUIMessage;
  action?: { label: string; onClick: () => void };
  overviewInsight?: { question: string; title: string; description: string };
  suggestions?: string[];
};

type PlannedCommand = {
  command: AskRouteLabPlan | AskChatLabCommand;
  telemetry: AskRouteLabTraceContext;
  planner: "llm" | "fallback";
};

const suggestions = [
  "Catch me up",
  "Which conversations are outside coverage?",
  "Run 10% of traces for task group Financial Savings Analysis through Claude Opus 5.5",
];
const AskRouteLabOpenUI = lazy(() => import("./AskRouteLabOpenUI").then((module) => ({ default: module.AskRouteLabOpenUI })));

const money = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
const score = (value: number) => `${(value * 100).toFixed(1)}%`;
const broadOverviewQuestion = (value: string) => /^(catch me up|give me an overview|overview|what(?:'s| is) going on)/i.test(value.trim());

export function AskChatLab({
  workspaceLabel,
  workspaceId,
  traces,
  traceJudgeResults,
  taskGroups,
  models,
  activeEval,
  classifierActive,
  goldenDatasets,
  weeklyReviewBudget,
  persistedReviews,
  persistedTaskGroupReviews,
  currentReviewCycle,
  onNavigate,
  onOpenReview,
  onRunSimulation,
  onOpenSimulation,
}: {
  workspaceLabel: string;
  workspaceId: string;
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  taskGroups: DistinctTaskBucket[];
  models: Model[];
  activeEval?: { id: string; version: number; name: string };
  classifierActive: boolean;
  goldenDatasets: GoldenDataset[];
  weeklyReviewBudget: number;
  persistedReviews: PersistedReview[];
  persistedTaskGroupReviews: PersistedTaskGroupReview[];
  currentReviewCycle: ReviewCycle | null;
  onNavigate: (page: Page) => void;
  onOpenReview: () => void;
  onRunSimulation: (request: AskSimulationRequest) => Promise<AskSimulationResult>;
  onOpenSimulation: (result: AskSimulationResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Understanding your request");
  const [pinnedInsightIds, setPinnedInsightIds] = useState<Set<string>>(new Set());
  const [pinningInsightIds, setPinningInsightIds] = useState<Set<string>>(new Set());
  const [assignmentValidation, setAssignmentValidation] = useState<AssignmentValidationWorkflow | null>(() => loadLocalAssignmentValidation(workspaceId));
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: "welcome",
    role: "assistant",
    text: `I can inspect ${workspaceLabel}, find coverage gaps, open the right workspace page, and run live model simulations using the active RouteLab eval.`,
  }]);
  const metricSummary = useMemo(() => workspaceMetricSummary(
    traces,
    traceJudgeResults,
    activeEval ? { id: activeEval.id, version: activeEval.version } : undefined,
  ), [traces, traceJudgeResults, activeEval]);
  useEffect(() => {
    const controller = new AbortController();
    setAssignmentValidation(loadLocalAssignmentValidation(workspaceId));
    fetchAssignmentValidation(workspaceId, controller.signal).then((workflow) => {
      if (!workflow) return;
      saveLocalAssignmentValidation(workspaceId, workflow);
      setAssignmentValidation(workflow);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId]);
  useEffect(() => {
    const controller = new AbortController();
    fetchOverviewInsights(workspaceId, controller.signal)
      .then((insights) => setPinnedInsightIds(new Set(insights.map((insight) => insight.id))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId]);

  const operationalContext = useMemo<AskRouteLabOperationalContext>(() => {
    const responseReviews = new Set(persistedReviews.map((review) => review.traceId));
    const taskGroupReviews = new Set(persistedTaskGroupReviews.map((review) => review.traceId));
    const cycle = currentReviewCycle?.id === currentReviewCycleId()
      ? currentReviewCycle.assignments
      : buildReviewQueue(traces, traceJudgeResults, taskGroups, goldenDatasets, weeklyReviewBudget).reviewItems.map((item) => ({
        traceId: item.trace.id,
        requiredTasks: item.requiredTasks,
      }));
    const conversationsToReview = cycle.filter((assignment) => assignment.requiredTasks.some((task) => task === "task_group"
      ? !taskGroupReviews.has(assignment.traceId)
      : !responseReviews.has(assignment.traceId))).length;

    const signatures = taskGroupSignatures(taskGroups);
    const classifierCalibration = (() => {
      if (!assignmentValidation?.sampleTraceIds.length) return {
        needsAttention: true,
        label: "Start human calibration",
        detail: "Create a blind held-out set and compare the classifier with independent human labels.",
        reviewedExamples: 0,
      };
      const reviewed = assignmentValidation.labels.length;
      const target = assignmentValidation.sampleTraceIds.length;
      if (reviewed < target) return {
        needsAttention: true,
        label: "Human review is incomplete",
        detail: `${reviewed.toLocaleString()} of ${target.toLocaleString()} held-out requests are labeled.`,
        reviewedExamples: reviewed,
      };
      if (assignmentValidation.jevAssignments.length < target || assignmentValidation.llmAssignments.length < target) return {
        needsAttention: true,
        label: "Run automated comparisons",
        detail: "Human labels are complete; compare the same requests with the classifier and strong LLM.",
        reviewedExamples: reviewed,
      };
      const thresholds = Object.fromEntries(signatures.map((signature) => [signature.id, JEV_RISK_THRESHOLDS[signature.risk_level]]));
      const examples = classifierExamplesFromAssignments(assignmentValidation, traces, assignmentValidation.jevAssignments, thresholds);
      const report = buildClassifierValidationReport(examples, signatures, {
        datasetLabel: "Workspace held-out assignment set",
        classifierModel: assignmentValidation.jevAssignments[0]?.model ?? "classifier",
        signatureCatalogVersion: assignmentValidation.catalogVersion,
        testSplit: "Blind human-reviewed set",
        thresholdTuningSplit: "Targeted corrections stay separate",
      });
      const ageDays = Math.floor((Date.now() - Date.parse(assignmentValidation.updatedAt)) / 86_400_000);
      const due = report.errors.length > 0 || ageDays >= 8;
      return {
        needsAttention: due,
        label: report.errors.length ? "Classifier follow-up needed" : ageDays >= 8 ? "Weekly check is due" : "Classifier calibrated",
        detail: report.errors.length
          ? `${report.errors.length.toLocaleString()} reviewed assignment${report.errors.length === 1 ? " differs" : "s differ"} from human truth.`
          : ageDays >= 8
            ? `The latest completed round is ${ageDays.toLocaleString()} days old.`
            : `The latest ${reviewed.toLocaleString()}-request round has no classifier errors.`,
        reviewedExamples: reviewed,
      };
    })();

    const activeResults = activeEval ? traceJudgeResults.filter((result) => (
      (result.eval_id === activeEval.id && result.eval_version === activeEval.version)
      || (!result.eval_id && result.eval_version === undefined)
    )) : traceJudgeResults;
    const calibrations = goldenDatasets.map((dataset) => calibrateGoldenDataset(dataset, traces, activeResults));
    const judge = [...calibrations].sort((left, right) => right.matched_rows - left.matched_rows)[0];
    const judgeCalibration = !judge || judge.matched_rows === 0 ? {
      needsAttention: true,
      label: "Add human calibration labels",
      detail: "No comparable human and LLM-judge decisions are available for the active eval.",
      reviewedExamples: 0,
    } : judge.matched_rows < 10 || judge.coverage_pct < 100 || judge.disagreements.length > 0 || judge.avg_score_delta >= .15 ? {
      needsAttention: true,
      label: "Judge follow-up needed",
      detail: judge.disagreements.length
        ? `${judge.disagreements.length.toLocaleString()} human and judge verdict${judge.disagreements.length === 1 ? " differs" : "s differ"}.`
        : judge.coverage_pct < 100
          ? `${judge.coverage_pct.toFixed(1)}% of the selected human set has an active-eval result.`
          : `Only ${judge.matched_rows.toLocaleString()} comparable human labels are available.`,
      reviewedExamples: judge.matched_rows,
    } : {
      needsAttention: false,
      label: "Judge calibrated",
      detail: `${judge.agreement_rate.toFixed(1)}% agreement across ${judge.matched_rows.toLocaleString()} comparable examples.`,
      reviewedExamples: judge.matched_rows,
    };
    return { conversationsToReview, classifierCalibration, judgeCalibration };
  }, [activeEval, assignmentValidation, currentReviewCycle, goldenDatasets, persistedReviews, persistedTaskGroupReviews, taskGroups, traceJudgeResults, traces, weeklyReviewBudget]);
  const metricDashboard = useMemo(() => workspaceMetricDashboard(
    traces,
    taskGroups,
    traceJudgeResults,
    activeEval ? { id: activeEval.id, version: activeEval.version } : undefined,
    classifierActive,
    operationalContext,
  ), [traces, taskGroups, traceJudgeResults, activeEval, classifierActive, operationalContext]);
  const coverageSummary = useMemo(() => workspaceCoverageSummary(
    traces,
    taskGroups,
    traceJudgeResults,
    activeEval ? { id: activeEval.id, version: activeEval.version } : undefined,
  ), [traces, taskGroups, traceJudgeResults, activeEval]);

  const addAssistant = (message: Omit<ChatMessage, "id" | "role">) => {
    setMessages((current) => [...current, { ...message, id: `assistant_${Date.now()}_${current.length}`, role: "assistant" }]);
  };

  const planRequest = async (message: string, interactionId: string): Promise<PlannedCommand> => {
    const taskGroupCatalog = taskGroups.map((group) => ({ id: group.bucket_id, name: group.bucket_name }));
    const modelCatalog = models
      .filter((model) => model.deployment_type !== "decision_model")
      .map((model) => ({ id: model.id, name: `${model.display_name} (${model.provider})` }));
    try {
      const response = await fetch("/api/ask-routelab/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, taskGroups: taskGroupCatalog, models: modelCatalog, interactionId, workspace: workspaceLabel }),
      });
      const payload = await response.json().catch(() => ({})) as Partial<AskRouteLabPlannerResponse> & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The LLM planner is unavailable.");
      const plan = validateAskRouteLabPlan(payload.plan, taskGroupCatalog, modelCatalog);
      if (!plan) throw new Error("The LLM planner returned an unsupported operation.");
      return {
        command: plan,
        telemetry: { interactionId, parent: payload.telemetry?.parent },
        planner: "llm",
      };
    } catch {
      return { command: parseAskChatLabCommand(message), telemetry: { interactionId }, planner: "fallback" };
    }
  };

  const generateMetricsUI = async (question: string, telemetry: AskRouteLabTraceContext): Promise<AskRouteLabOpenUIMessage> => {
    const hasQuality = metricDashboard.summary.averageQuality !== null;
    try {
      const response = await fetch("/api/ask-routelab/openui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          hasQuality,
          weeklyPoints: metricDashboard.weekly.length,
          taskGroupCount: metricDashboard.taskGroups.length,
          interactionId: telemetry.interactionId,
          parent: telemetry.parent,
        }),
      });
      const payload = await response.json().catch(() => ({})) as Partial<AskRouteLabOpenUIResponse> & { error?: string };
      if (!response.ok || payload.renderer !== "openui" || !payload.openui) throw new Error(payload.error ?? "OpenUI generation failed.");
      return { openui: payload.openui, metrics: metricDashboard };
    } catch {
      return { openui: fallbackAskRouteLabOpenUI(question, hasQuality), metrics: metricDashboard };
    }
  };

  const recordInteraction = async ({
    question,
    planned,
    message,
    status = "completed",
  }: {
    question: string;
    planned: PlannedCommand;
    message: Omit<ChatMessage, "id" | "role">;
    status?: "completed" | "failed";
  }) => {
    try {
      const response = await fetch("/api/ask-routelab/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          interactionId: planned.telemetry.interactionId,
          parent: planned.telemetry.parent,
          question,
          workspace: workspaceLabel,
          status,
          planKind: planned.command.kind,
          planner: planned.planner,
          output: {
            text: message.text,
            facts: message.facts ?? [],
            action: message.action?.label,
            openui: message.generatedUI?.openui,
            suggestions: message.suggestions ?? [],
          },
        }),
      });
      if (!response.ok) throw new Error(`Braintrust telemetry HTTP ${response.status}`);
    } catch (error) {
      console.error("Ask RouteLab telemetry could not be delivered", error);
    }
  };

  const finishInteraction = async (
    question: string,
    planned: PlannedCommand,
    message: Omit<ChatMessage, "id" | "role">,
    status: "completed" | "failed" = "completed",
  ) => {
    const overviewInsight = message.generatedUI && !broadOverviewQuestion(question)
      ? { question, title: overviewInsightTitle(question), description: message.text }
      : undefined;
    const completedMessage = { ...message, overviewInsight, suggestions: message.suggestions ?? askRouteLabFollowUps(planned.command.kind) };
    addAssistant(completedMessage);
    await recordInteraction({ question, planned, message: completedMessage, status });
    setRunning(false);
  };

  const addToOverview = async (message: ChatMessage) => {
    if (!message.generatedUI || !message.overviewInsight) return;
    const insightId = `ask_${message.id}`;
    setPinningInsightIds((current) => new Set(current).add(insightId));
    try {
      await persistOverviewInsight(workspaceId, {
        id: insightId,
        ...message.overviewInsight,
        openui: message.generatedUI.openui,
      });
      setPinnedInsightIds((current) => new Set(current).add(insightId));
    } finally {
      setPinningInsightIds((current) => {
        const next = new Set(current);
        next.delete(insightId);
        return next;
      });
    }
  };

  const execute = async (rawInput: string) => {
    const value = rawInput.trim();
    if (!value || running) return;
    setInput("");
    setMessages((current) => [...current, { id: `user_${Date.now()}`, role: "user", text: value }]);
    setBusyLabel("Understanding your request");
    setRunning(true);
    const interactionId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ask_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const planned = await planRequest(value, interactionId);
    const command = planned.command;
    if (command.kind === "metrics" || command.kind === "classifier_metrics" || command.kind === "task_group_quality_comparison") {
      setBusyLabel("Composing an OpenUI dashboard");
      const generatedUI = await generateMetricsUI(value, planned.telemetry);
      if (command.kind === "task_group_quality_comparison") {
        const comparison = metricDashboard.qualityComparison;
        const text = comparison.workspaceAverage === null
          ? "I cannot compare Task Group performance yet because the active response-quality eval has no scored traces."
          : comparison.belowAverage.length === 0
            ? `Using average response quality as the performance measure, none of the ${comparison.scoredTaskGroupCount.toLocaleString()} scored Task Groups is below the ${score(comparison.workspaceAverage)} workspace average.`
            : `Using average response quality as the performance measure, ${comparison.belowAverage.length.toLocaleString()} of ${comparison.scoredTaskGroupCount.toLocaleString()} scored Task Groups ${comparison.belowAverage.length === 1 ? "is" : "are"} below the ${score(comparison.workspaceAverage)} workspace average. ${comparison.belowAverage.slice(0, 3).map((group) => `${group.label} is ${score(group.quality)} (${Math.abs(group.gapFromAverage * 100).toFixed(1)} points below)`).join("; ")}.`;
        await finishInteraction(value, planned, {
          text,
          generatedUI,
          action: { label: "Open Task Groups", onClick: () => { onNavigate("Distinct Tasks"); setOpen(false); } },
        });
        return;
      }
      if (command.kind === "classifier_metrics") {
        const processed = metricDashboard.summary.classifiedRequests;
        const total = metricDashboard.summary.totalTraces;
        await finishInteraction(value, planned, {
          text: `The classifier is ${classifierActive ? "active" : "inactive"}. It has processed ${processed.toLocaleString()} of ${total.toLocaleString()} workspace traces. Imported traces without a recorded classifier decision are not counted as processed.`,
          generatedUI,
          action: classifierActive
            ? { label: "Open classifier calibration", onClick: () => { onNavigate("Classifier Validation"); setOpen(false); } }
            : { label: "Open routing policy", onClick: () => { onNavigate("Simulations"); setOpen(false); } },
        });
        return;
      }
      const direction = metricSummary.recent === metricSummary.prior
        ? "unchanged"
        : metricSummary.recent > metricSummary.prior
          ? `up ${metricSummary.recent - metricSummary.prior}`
          : `down ${metricSummary.prior - metricSummary.recent}`;
      await finishInteraction(value, planned, {
        text: `The classifier is ${classifierActive ? "active" : "inactive"} and has processed ${metricDashboard.summary.classifiedRequests.toLocaleString()} requests. The latest seven-day window has ${metricDashboard.summary.recentTraces.toLocaleString()} requests (${direction} from the preceding window), and ${metricDashboard.attention.conversationsToReview.toLocaleString()} conversations need human review.`,
        generatedUI,
        action: { label: "Open Overview", onClick: () => { onNavigate("Overview"); setOpen(false); } },
      });
      return;
    }
    if (command.kind === "coverage") {
      const reasonText = coverageSummary.topReasons.length
        ? coverageSummary.topReasons.map(([reason, count]) => `${count} ${reason}`).join(", ")
        : "no classifier gaps";
      await finishInteraction(value, planned, {
        text: `${coverageSummary.classifierGaps.length.toLocaleString()} conversations do not have a confident native Task Group match. ${coverageSummary.evalGaps.length.toLocaleString()} have not been scored by the active response-quality eval.`,
        facts: [`Classifier gaps: ${reasonText}`, `Eval coverage: ${(traces.length - coverageSummary.evalGaps.length).toLocaleString()} of ${traces.length.toLocaleString()} traces`],
        action: { label: "Review coverage gaps", onClick: () => { onOpenReview(); setOpen(false); } },
      });
      return;
    }
    if (command.kind === "navigate") {
      const destinations: Record<typeof command.destination, Page> = {
        task_groups: "Distinct Tasks",
        response_quality: "Evals",
        review: "Review Queue",
        classifier: "Classifier Validation",
        simulations: "Simulations",
      };
      const destination = destinations[command.destination];
      await recordInteraction({
        question: value,
        planned,
        message: { text: `Opened ${destination}.`, action: { label: `Open ${destination}`, onClick: () => undefined } },
      });
      onNavigate(destination);
      setRunning(false);
      setOpen(false);
      return;
    }
    if (command.kind === "simulate") {
      const taskGroup = "taskGroupId" in command
        ? taskGroups.find((group) => group.bucket_id === command.taskGroupId)
        : resolveTaskGroup(command.taskGroupQuery, taskGroups);
      const model = "candidateId" in command
        ? models.find((item) => item.id === command.candidateId)
        : resolveModel(command.modelQuery, models);
      if (!taskGroup || !model) {
        await finishInteraction(value, planned, {
          text: !taskGroup
            ? "I couldn't match that request to a Task Group in this workspace."
            : "I couldn't match that request to an enabled generation model.",
          facts: !taskGroup
            ? taskGroups.slice(0, 4).map((group) => group.bucket_name)
            : models.filter((item) => item.deployment_type !== "decision_model").slice(0, 4).map((item) => item.display_name),
        }, "failed");
        return;
      }
      if (!activeEval) {
        await finishInteraction(value, planned, {
          text: "This workspace needs an active response-quality eval before I can run an apples-to-apples simulation.",
          action: { label: "Open Response Quality", onClick: () => { onNavigate("Evals"); setOpen(false); } },
        }, "failed");
        return;
      }
      const request: AskSimulationRequest = {
        taskGroupId: taskGroup.bucket_id,
        taskGroupName: taskGroup.bucket_name,
        candidateId: model.id,
        candidateName: model.display_name,
        sampleMode: command.sampleMode,
        sampleValue: command.sampleValue,
      };
      setBusyLabel("Running live simulation");
      addAssistant({ text: `Running ${command.sampleMode === "percent" ? `${command.sampleValue}%` : command.sampleValue} of ${taskGroup.bucket_name} through ${model.display_name}. Candidate and original responses will use ${activeEval.name} v${activeEval.version}.` });
      try {
        const result = await onRunSimulation(request);
        const costDelta = result.baselineMonthlyCost
          ? (result.candidateMonthlyCost - result.baselineMonthlyCost) / result.baselineMonthlyCost * 100
          : 0;
        const qualityDelta = (result.candidateAverageScore - result.baselineAverageScore) * 100;
        await finishInteraction(value, planned, {
          text: `Completed ${result.successfulRequests} of ${result.traceCount} requests through ${result.provider}. ${result.candidateName} was ${Math.abs(costDelta).toFixed(1)}% ${costDelta <= 0 ? "cheaper" : "more expensive"} with a ${qualityDelta >= 0 ? "+" : ""}${qualityDelta.toFixed(1)} point quality change.`,
          facts: [
            `Cost/month: ${money(result.baselineMonthlyCost)} → ${money(result.candidateMonthlyCost)}`,
            `Average latency: ${result.baselineLatencyMs.toFixed(0)}ms → ${result.candidateLatencyMs.toFixed(0)}ms`,
            `Average quality: ${score(result.baselineAverageScore)} → ${score(result.candidateAverageScore)}`,
          ],
          action: { label: "Inspect simulation", onClick: () => { onOpenSimulation(result); setOpen(false); } },
        });
      } catch (error) {
        await finishInteraction(value, planned, { text: error instanceof Error ? error.message : "The simulation could not be completed." }, "failed");
      }
      return;
    }
    await finishInteraction(value, planned, {
      text: "I can help with RouteLab metrics, coverage gaps, navigation, or a live simulation. For a simulation, include the Task Group, sample size, and candidate model.",
      facts: suggestions,
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void execute(input);
  };

  return <>
    <button className="ask-chatlab-launcher" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>Ask RouteLab</button>
    {open && <div className="ask-chatlab-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="ask-chatlab" role="dialog" aria-modal="true" aria-label="Ask RouteLab workspace agent">
        <header><div><p className="eyebrow">OpenAI-powered workspace agent</p><h2>Ask RouteLab</h2><span>{workspaceLabel} · verified RouteLab operations</span></div><button type="button" aria-label="Close Ask RouteLab" onClick={() => setOpen(false)}>×</button></header>
        <div className="ask-chatlab-messages" aria-live="polite">
          {messages.map((message) => {
            const insightId = `ask_${message.id}`;
            const pinned = pinnedInsightIds.has(insightId);
            const pinning = pinningInsightIds.has(insightId);
            return <article className={`${message.role}${message.generatedUI ? " generated-ui" : ""}`} key={message.id}><small>{message.role === "user" ? "You" : "Ask RouteLab"}</small><p>{message.text}</p>{message.generatedUI ? <Suspense fallback={<div className="ask-chatlab-running"><i />Loading OpenUI dashboard</div>}><AskRouteLabOpenUI response={message.generatedUI.openui} data={message.generatedUI.metrics} /></Suspense> : null}{message.facts?.length ? <ul>{message.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul> : null}{message.action || message.overviewInsight ? <div className="ask-chatlab-actions">{message.overviewInsight ? <button type="button" className="ask-chatlab-pin" disabled={pinning} onClick={() => pinned ? (onNavigate("Overview"), setOpen(false)) : void addToOverview(message)}>{pinning ? "Adding..." : pinned ? "View on Overview" : "Add to Overview"}</button> : null}{message.action ? <button type="button" onClick={message.action.onClick}>{message.action.label}</button> : null}</div> : null}{message.suggestions?.length ? <div className="ask-chatlab-followups"><small>Try next</small><div>{message.suggestions.slice(0, 2).map((suggestion) => <button type="button" key={suggestion} onClick={() => void execute(suggestion)}>{suggestion}</button>)}</div></div> : null}</article>;
          })}
          {running && <div className="ask-chatlab-running"><i />{busyLabel}</div>}
        </div>
        {messages.length === 1 && <div className="ask-chatlab-suggestions">{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => void execute(suggestion)}>{suggestion}</button>)}</div>}
        <form onSubmit={submit}><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about metrics, coverage, or run a simulation…" rows={2} disabled={running} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void execute(input); } }} /><button className="primary" type="submit" disabled={running || !input.trim()}>Run</button></form>
      </section>
    </div>}
  </>;
}
