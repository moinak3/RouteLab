import { useCallback, useState } from "react";
import { createDistinctTaskBuckets } from "../core/distinctTasks";
import { nameTaskGroups } from "../core/taskGroupNaming";
import type { TaskGroupingMethod } from "../core/workspaces";
import type { DistinctTaskBucket, Trace, TraceJudgeResult } from "../types";
import { DistinctTasks } from "./DistinctTasks";
import { LLMGroupedTasks } from "./LLMGroupedTasks";

export function TaskSignatures({ traces, traceJudgeResults, workspaceId, serverGatewayKey, taskGroups, taskGroupingMethod, onTaskGroupsChange, onRunSimulation }: {
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  workspaceId: string;
  serverGatewayKey?: boolean;
  taskGroups: DistinctTaskBucket[];
  taskGroupingMethod?: TaskGroupingMethod;
  onTaskGroupsChange?: (groups: DistinctTaskBucket[], method: TaskGroupingMethod) => void;
  onRunSimulation?: (bucketId: string) => void;
}) {
  const [method, setMethod] = useState<TaskGroupingMethod>(() => taskGroupingMethod ?? (taskGroups.some((group) => group.bucket_id.startsWith("llm_")) ? "llm" : taskGroups.length ? "rules" : "llm"));
  const [rulesRunToken, setRulesRunToken] = useState(0);
  const [llmRunToken, setLlmRunToken] = useState(0);
  const [llmRunning, setLlmRunning] = useState(false);
  const [rulesRunning, setRulesRunning] = useState(false);
  const [rulesNotice, setRulesNotice] = useState<string | null>(null);
  const canGenerate = traces.length > 0 && !llmRunning && !rulesRunning && (method === "rules" || serverGatewayKey === true);
  const saveRuleGroups = useCallback((groups: DistinctTaskBucket[]) => onTaskGroupsChange?.(groups, "rules"), [onTaskGroupsChange]);
  const saveLLMGroups = useCallback((groups: DistinctTaskBucket[]) => onTaskGroupsChange?.(groups, "llm"), [onTaskGroupsChange]);

  async function generate() {
    if (method === "rules") {
      setRulesRunning(true);
      setRulesNotice(null);
      const groups = createDistinctTaskBuckets(traces);
      saveRuleGroups(groups);
      try {
        if (serverGatewayKey !== true) throw new Error("OpenRouter naming is unavailable, so RouteLab used readable fallback names.");
        const namedGroups = await nameTaskGroups(groups);
        saveRuleGroups(namedGroups);
        setRulesNotice("Membership was created by RouteLab rules. OpenRouter supplied concise, editable names for every group.");
      } catch (error) {
        setRulesNotice(error instanceof Error ? error.message : "RouteLab used readable fallback names because model naming was unavailable.");
      } finally {
        setRulesRunToken((value) => value + 1);
        setRulesRunning(false);
      }
    }
    else setLlmRunToken((value) => value + 1);
  }

  return <div className="task-signatures-page">
    <section className="task-signature-config">
      <div className="task-signature-config-head">
        <div><p className="eyebrow">Task Groups</p><h2>Choose how RouteLab creates task groups</h2><p>A task group brings together requests that are trying to achieve the same outcome, even when their wording, context, or execution differs. Every trace is processed by the selected method. Switching methods does not change deployed routing policies.</p></div>
        <div className="task-signature-generate">
          <span>{traces.length.toLocaleString()} traces ready</span>
          <button type="button" className="primary" disabled={!canGenerate} onClick={generate}>{rulesRunning ? "Naming groups…" : llmRunning ? "Generating…" : "Generate Task Groups"}</button>
        </div>
      </div>
      <div className="task-signature-methods" role="radiogroup" aria-label="Task grouping method">
        <button type="button" role="radio" aria-checked={method === "rules"} className={method === "rules" ? "active" : ""} onClick={() => setMethod("rules")}>
          <span>1</span><div><b>RouteLab rules</b><small>Deterministic factors set membership. An LLM then proposes a concise, editable name for each group.</small></div>
        </button>
        <button type="button" role="radio" aria-checked={method === "llm"} className={method === "llm" ? "active" : ""} onClick={() => setMethod("llm")}>
          <span>2</span><div><b>LLM grouped</b><small>OpenRouter discovers task boundaries from pre-inference request context, then assigns every trace.</small></div>
        </button>
      </div>
      <div className="task-signature-method-status">
        <b>{method === "rules" ? "RouteLab rules selected" : "LLM grouping selected"}</b>
        <span>{method === "rules" ? "Task type, domain, complexity, conversation position, tool use, uncertainty, and output format define membership." : serverGatewayKey === undefined ? "Checking the OpenRouter connection…" : serverGatewayKey ? "OpenRouter is ready. Generation may take several minutes." : "OpenRouter must be configured before groups can be generated."}</span>
      </div>
      {method === "rules" && rulesNotice && <p className="task-action-message" role="status">{rulesNotice}</p>}
    </section>

    {method === "rules" ? rulesRunToken > 0 || taskGroups.length > 0
      ? <DistinctTasks key={rulesRunToken} traces={traces} traceJudgeResults={traceJudgeResults} buckets={taskGroups.length ? taskGroups : undefined} onBucketsChange={saveRuleGroups} onRunSimulation={onRunSimulation} embedded />
      : <section className="task-signature-empty"><b>No RouteLab rule groups generated yet</b><span>Choose Generate Task Groups to classify the current trace snapshot.</span></section>
      : <LLMGroupedTasks traces={traces} workspaceId={workspaceId} serverGatewayKey={serverGatewayKey} savedTaskGroups={taskGroups} embedded runToken={llmRunToken} onRunningChange={setLlmRunning} onTaskGroupsChange={saveLLMGroups} onRunSimulation={onRunSimulation} />}
  </div>;
}
