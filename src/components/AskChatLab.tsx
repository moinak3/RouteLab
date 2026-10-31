import { useMemo, useState, type FormEvent } from "react";
import {
  parseAskChatLabCommand,
  resolveModel,
  resolveTaskGroup,
  workspaceCoverageSummary,
  workspaceMetricSummary,
  type AskSimulationRequest,
  type AskSimulationResult,
} from "../core/askChatLab";
import type { DistinctTaskBucket, Model, Trace, TraceJudgeResult } from "../types";
import type { Page } from "../types/ui";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  facts?: string[];
  action?: { label: string; onClick: () => void };
};

const suggestions = [
  "What's new with my metrics?",
  "Which conversations are outside coverage?",
  "Run 10% of traces for task group Financial Savings Analysis through Claude Opus 5.5",
];

const money = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
const score = (value: number) => `${(value * 100).toFixed(1)}%`;

export function AskChatLab({
  workspaceLabel,
  traces,
  traceJudgeResults,
  taskGroups,
  models,
  activeEval,
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
  onNavigate: (page: Page) => void;
  onOpenReview: () => void;
  onRunSimulation: (request: AskSimulationRequest) => Promise<AskSimulationResult>;
  onOpenSimulation: (result: AskSimulationResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: "welcome",
    role: "assistant",
    text: `I can inspect ${workspaceLabel}, find coverage gaps, and run live model simulations using the active RouteLab eval.`,
  }]);
  const metricSummary = useMemo(() => workspaceMetricSummary(
    traces,
    traceJudgeResults,
    activeEval ? { id: activeEval.id, version: activeEval.version } : undefined,
  ), [traces, traceJudgeResults, activeEval]);
  const coverageSummary = useMemo(() => workspaceCoverageSummary(
    traces,
    taskGroups,
    traceJudgeResults,
    activeEval ? { id: activeEval.id, version: activeEval.version } : undefined,
  ), [traces, taskGroups, traceJudgeResults, activeEval]);

  const addAssistant = (message: Omit<ChatMessage, "id" | "role">) => {
    setMessages((current) => [...current, { ...message, id: `assistant_${Date.now()}_${current.length}`, role: "assistant" }]);
  };

  const execute = async (rawInput: string) => {
    const value = rawInput.trim();
    if (!value || running) return;
    setInput("");
    setMessages((current) => [...current, { id: `user_${Date.now()}`, role: "user", text: value }]);
    const command = parseAskChatLabCommand(value);
    if (command.kind === "metrics") {
      const direction = metricSummary.recent === metricSummary.prior
        ? "unchanged"
        : metricSummary.recent > metricSummary.prior
          ? `up ${metricSummary.recent - metricSummary.prior}`
          : `down ${metricSummary.prior - metricSummary.recent}`;
      addAssistant({
        text: `This workspace has ${metricSummary.total.toLocaleString()} traces. The latest seven-day window contains ${metricSummary.recent.toLocaleString()} traces, ${direction} from the preceding window.`,
        facts: [
          `${money(metricSummary.cost)} observed trace cost`,
          `${metricSummary.averageLatencyMs.toFixed(0)}ms average latency`,
          metricSummary.scored ? `${score(metricSummary.averageScore)} average quality across ${metricSummary.scored.toLocaleString()} scored traces` : "No quality scores yet",
        ],
        action: { label: "Open Overview", onClick: () => { onNavigate("Overview"); setOpen(false); } },
      });
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
      setOpen(false);
      return;
    }
    if (command.kind === "simulate") {
      const taskGroup = resolveTaskGroup(command.taskGroupQuery, taskGroups);
      const model = resolveModel(command.modelQuery, models);
      if (!taskGroup || !model) {
        addAssistant({
          text: !taskGroup
            ? `I couldn't match “${command.taskGroupQuery}” to a Task Group in this workspace.`
            : `I couldn't match “${command.modelQuery}” to an enabled generation model.`,
          facts: !taskGroup
            ? taskGroups.slice(0, 4).map((group) => group.bucket_name)
            : models.filter((item) => item.deployment_type !== "decision_model").slice(0, 4).map((item) => item.display_name),
        });
        return;
      }
      if (!activeEval) {
        addAssistant({
          text: "This workspace needs an active response-quality eval before I can run an apples-to-apples simulation.",
          action: { label: "Open Response Quality", onClick: () => { onNavigate("Evals"); setOpen(false); } },
        });
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
      setRunning(true);
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
      text: "Try asking for a metric update, coverage gaps, or a live simulation. For simulations, name the Task Group, sample size, and model.",
      facts: suggestions,
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void execute(input);
  };

  return <>
    <button className="ask-chatlab-launcher" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>AskChatLab</button>
    {open && <div className="ask-chatlab-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="ask-chatlab" role="dialog" aria-modal="true" aria-label="AskChatLab workspace agent">
        <header><div><p className="eyebrow">Workspace agent</p><h2>AskChatLab</h2><span>{workspaceLabel} · actions run immediately</span></div><button type="button" aria-label="Close AskChatLab" onClick={() => setOpen(false)}>×</button></header>
        <div className="ask-chatlab-messages" aria-live="polite">
          {messages.map((message) => <article className={message.role} key={message.id}><small>{message.role === "user" ? "You" : "AskChatLab"}</small><p>{message.text}</p>{message.facts?.length ? <ul>{message.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul> : null}{message.action ? <button type="button" onClick={message.action.onClick}>{message.action.label}</button> : null}</article>)}
          {running && <div className="ask-chatlab-running"><i />Live operation in progress</div>}
        </div>
        {messages.length === 1 && <div className="ask-chatlab-suggestions">{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => void execute(suggestion)}>{suggestion}</button>)}</div>}
        <form onSubmit={submit}><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about metrics, coverage, or run a simulation…" rows={2} disabled={running} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void execute(input); } }} /><button className="primary" type="submit" disabled={running || !input.trim()}>Run</button></form>
      </section>
    </div>}
  </>;
}
