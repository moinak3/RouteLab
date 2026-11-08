import { lazy, Suspense, useMemo, useState, type FormEvent } from "react";
import {
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
  type AskSimulationRequest,
  type AskSimulationResult,
} from "../core/askChatLab";
import { fallbackAskRouteLabOpenUI, type AskRouteLabOpenUIMessage, type AskRouteLabOpenUIResponse } from "../core/askRouteLabOpenUISpec";
import type { DistinctTaskBucket, Model, Trace, TraceJudgeResult } from "../types";
import type { Page } from "../types/ui";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  facts?: string[];
  generatedUI?: AskRouteLabOpenUIMessage;
  action?: { label: string; onClick: () => void };
};

const suggestions = [
  "What's new with my metrics?",
  "Which conversations are outside coverage?",
  "Run 10% of traces for task group Financial Savings Analysis through Claude Opus 5.5",
];
const AskRouteLabOpenUI = lazy(() => import("./AskRouteLabOpenUI").then((module) => ({ default: module.AskRouteLabOpenUI })));

const money = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
const score = (value: number) => `${(value * 100).toFixed(1)}%`;

export function AskChatLab({
  workspaceLabel,
  traces,
  traceJudgeResults,
  taskGroups,
  models,
  activeEval,
  classifierActive,
  onNavigate,
  onOpenReview,
  onRunSimulation,
  onOpenSimulation,
}: {
  workspaceLabel: string;
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  taskGroups: DistinctTaskBucket[];
  models: Model[];
  activeEval?: { id: string; version: number; name: string };
  classifierActive: boolean;
  onNavigate: (page: Page) => void;
  onOpenReview: () => void;
  onRunSimulation: (request: AskSimulationRequest) => Promise<AskSimulationResult>;
  onOpenSimulation: (result: AskSimulationResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Understanding your request");
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
  const metricDashboard = useMemo(() => workspaceMetricDashboard(
    traces,
    taskGroups,
    traceJudgeResults,
    activeEval ? { id: activeEval.id, version: activeEval.version } : undefined,
    classifierActive,
  ), [traces, taskGroups, traceJudgeResults, activeEval, classifierActive]);
  const coverageSummary = useMemo(() => workspaceCoverageSummary(
    traces,
    taskGroups,
    traceJudgeResults,
    activeEval ? { id: activeEval.id, version: activeEval.version } : undefined,
  ), [traces, taskGroups, traceJudgeResults, activeEval]);

  const addAssistant = (message: Omit<ChatMessage, "id" | "role">) => {
    setMessages((current) => [...current, { ...message, id: `assistant_${Date.now()}_${current.length}`, role: "assistant" }]);
  };

  const planRequest = async (message: string): Promise<AskRouteLabPlan | AskChatLabCommand> => {
    const taskGroupCatalog = taskGroups.map((group) => ({ id: group.bucket_id, name: group.bucket_name }));
    const modelCatalog = models
      .filter((model) => model.deployment_type !== "decision_model")
      .map((model) => ({ id: model.id, name: `${model.display_name} (${model.provider})` }));
    try {
      const response = await fetch("/api/ask-routelab/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, taskGroups: taskGroupCatalog, models: modelCatalog }),
      });
      const payload = await response.json().catch(() => ({})) as Partial<AskRouteLabPlannerResponse> & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The LLM planner is unavailable.");
      const plan = validateAskRouteLabPlan(payload.plan, taskGroupCatalog, modelCatalog);
      if (!plan) throw new Error("The LLM planner returned an unsupported operation.");
      return plan;
    } catch {
      return parseAskChatLabCommand(message);
    }
  };

  const generateMetricsUI = async (question: string): Promise<AskRouteLabOpenUIMessage> => {
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
        }),
      });
      const payload = await response.json().catch(() => ({})) as Partial<AskRouteLabOpenUIResponse> & { error?: string };
      if (!response.ok || payload.renderer !== "openui" || !payload.openui) throw new Error(payload.error ?? "OpenUI generation failed.");
      return { openui: payload.openui, metrics: metricDashboard };
    } catch {
      return { openui: fallbackAskRouteLabOpenUI(question, hasQuality), metrics: metricDashboard };
    }
  };

  const execute = async (rawInput: string) => {
    const value = rawInput.trim();
    if (!value || running) return;
    setInput("");
    setMessages((current) => [...current, { id: `user_${Date.now()}`, role: "user", text: value }]);
    setBusyLabel("Understanding your request");
    setRunning(true);
    const command = await planRequest(value);
    if (command.kind === "metrics" || command.kind === "classifier_metrics") {
      setBusyLabel("Composing an OpenUI dashboard");
      const generatedUI = await generateMetricsUI(value);
      if (command.kind === "classifier_metrics") {
        const processed = metricDashboard.summary.classifiedRequests;
        const total = metricDashboard.summary.totalTraces;
        addAssistant({
          text: `The classifier is ${classifierActive ? "active" : "inactive"}. It has processed ${processed.toLocaleString()} of ${total.toLocaleString()} workspace traces. Imported traces without a recorded classifier decision are not counted as processed.`,
          generatedUI,
          action: classifierActive
            ? { label: "Open classifier calibration", onClick: () => { onNavigate("Classifier Validation"); setOpen(false); } }
            : { label: "Open routing policy", onClick: () => { onNavigate("Simulations"); setOpen(false); } },
        });
        setRunning(false);
        return;
      }
      const direction = metricSummary.recent === metricSummary.prior
        ? "unchanged"
        : metricSummary.recent > metricSummary.prior
          ? `up ${metricSummary.recent - metricSummary.prior}`
          : `down ${metricSummary.prior - metricSummary.recent}`;
      addAssistant({
        text: `Here is a grounded view of the metrics you asked about. The latest seven-day trace count is ${direction} from the preceding window.`,
        generatedUI,
        action: { label: "Open Overview", onClick: () => { onNavigate("Overview"); setOpen(false); } },
      });
      setRunning(false);
      return;
    }
    if (command.kind === "coverage") {
      const reasonText = coverageSummary.topReasons.length
        ? coverageSummary.topReasons.map(([reason, count]) => `${count} ${reason}`).join(", ")
        : "no classifier gaps";
      addAssistant({
        text: `${coverageSummary.classifierGaps.length.toLocaleString()} conversations do not have a confident native Task Group match. ${coverageSummary.evalGaps.length.toLocaleString()} have not been scored by the active response-quality eval.`,
        facts: [`Classifier gaps: ${reasonText}`, `Eval coverage: ${(traces.length - coverageSummary.evalGaps.length).toLocaleString()} of ${traces.length.toLocaleString()} traces`],
        action: { label: "Review coverage gaps", onClick: () => { onOpenReview(); setOpen(false); } },
      });
      setRunning(false);
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
      onNavigate(destinations[command.destination]);
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
        addAssistant({
          text: !taskGroup
            ? "I couldn't match that request to a Task Group in this workspace."
            : "I couldn't match that request to an enabled generation model.",
          facts: !taskGroup
            ? taskGroups.slice(0, 4).map((group) => group.bucket_name)
            : models.filter((item) => item.deployment_type !== "decision_model").slice(0, 4).map((item) => item.display_name),
        });
        setRunning(false);
        return;
      }
      if (!activeEval) {
        addAssistant({
          text: "This workspace needs an active response-quality eval before I can run an apples-to-apples simulation.",
          action: { label: "Open Response Quality", onClick: () => { onNavigate("Evals"); setOpen(false); } },
        });
        setRunning(false);
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
        addAssistant({
          text: `Completed ${result.successfulRequests} of ${result.traceCount} requests through ${result.provider}. ${result.candidateName} was ${Math.abs(costDelta).toFixed(1)}% ${costDelta <= 0 ? "cheaper" : "more expensive"} with a ${qualityDelta >= 0 ? "+" : ""}${qualityDelta.toFixed(1)} point quality change.`,
          facts: [
            `Cost/month: ${money(result.baselineMonthlyCost)} → ${money(result.candidateMonthlyCost)}`,
            `Average latency: ${result.baselineLatencyMs.toFixed(0)}ms → ${result.candidateLatencyMs.toFixed(0)}ms`,
            `Average quality: ${score(result.baselineAverageScore)} → ${score(result.candidateAverageScore)}`,
          ],
          action: { label: "Inspect simulation", onClick: () => { onOpenSimulation(result); setOpen(false); } },
        });
      } catch (error) {
        addAssistant({ text: error instanceof Error ? error.message : "The simulation could not be completed." });
      } finally {
        setRunning(false);
      }
      return;
    }
    addAssistant({
      text: "I can help with RouteLab metrics, coverage gaps, navigation, or a live simulation. For a simulation, include the Task Group, sample size, and candidate model.",
      facts: suggestions,
    });
    setRunning(false);
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
          {messages.map((message) => <article className={`${message.role}${message.generatedUI ? " generated-ui" : ""}`} key={message.id}><small>{message.role === "user" ? "You" : "Ask RouteLab"}</small><p>{message.text}</p>{message.generatedUI ? <Suspense fallback={<div className="ask-chatlab-running"><i />Loading OpenUI dashboard</div>}><AskRouteLabOpenUI response={message.generatedUI.openui} data={message.generatedUI.metrics} /></Suspense> : null}{message.facts?.length ? <ul>{message.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul> : null}{message.action ? <button type="button" onClick={message.action.onClick}>{message.action.label}</button> : null}</article>)}
          {running && <div className="ask-chatlab-running"><i />{busyLabel}</div>}
        </div>
        {messages.length === 1 && <div className="ask-chatlab-suggestions">{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => void execute(suggestion)}>{suggestion}</button>)}</div>}
        <form onSubmit={submit}><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about metrics, coverage, or run a simulation…" rows={2} disabled={running} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void execute(input); } }} /><button className="primary" type="submit" disabled={running || !input.trim()}>Run</button></form>
      </section>
    </div>}
  </>;
}
