import { useState } from "react";
import type { Trace, TraceJudgeResult } from "../types";
import { DistinctTasks } from "./DistinctTasks";
import { LLMGroupedTasks } from "./LLMGroupedTasks";

type GroupingMethod = "rules" | "llm";

export function TaskSignatures({ traces, traceJudgeResults, serverGatewayKey }: {
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  serverGatewayKey?: boolean;
}) {
  const [method, setMethod] = useState<GroupingMethod>("rules");
  const [rulesRunToken, setRulesRunToken] = useState(0);
  const [llmRunToken, setLlmRunToken] = useState(0);
  const [llmRunning, setLlmRunning] = useState(false);
  const canGenerate = traces.length > 0 && !llmRunning && (method === "rules" || serverGatewayKey === true);

  function generate() {
    if (method === "rules") setRulesRunToken((value) => value + 1);
    else setLlmRunToken((value) => value + 1);
  }

  return <div className="task-signatures-page">
    <section className="task-signature-config">
      <div className="task-signature-config-head">
        <div><p className="eyebrow">Task Groups</p><h2>Choose how RouteLab creates task groups</h2><p>A task group brings together requests that are trying to achieve the same outcome, even when their wording, context, or execution differs. Every trace is processed by the selected method. Switching methods does not change deployed routing policies.</p></div>
        <div className="task-signature-generate">
          <span>{traces.length.toLocaleString()} traces ready</span>
          <button type="button" className="primary" disabled={!canGenerate} onClick={generate}>{llmRunning ? "Generating…" : "Generate Task Groups"}</button>
        </div>
      </div>
      <div className="task-signature-methods" role="radiogroup" aria-label="Task grouping method">
        <button type="button" role="radio" aria-checked={method === "rules"} className={method === "rules" ? "active" : ""} onClick={() => setMethod("rules")}>
          <span>1</span><div><b>RouteLab rules</b><small>Explicit RouteLab-authored rules classify each trace into the standard task taxonomy.</small></div>
        </button>
        <button type="button" role="radio" aria-checked={method === "llm"} className={method === "llm" ? "active" : ""} onClick={() => setMethod("llm")}>
          <span>2</span><div><b>LLM grouped</b><small>OpenRouter discovers task boundaries from pre-inference request context, then assigns every trace.</small></div>
        </button>
      </div>
      <div className="task-signature-method-status">
        <b>{method === "rules" ? "RouteLab rules selected" : "LLM grouping selected"}</b>
        <span>{method === "rules" ? "Deterministic and immediate. Re-running the same trace snapshot produces the same groups." : serverGatewayKey === undefined ? "Checking the OpenRouter connection…" : serverGatewayKey ? "OpenRouter is ready. Generation may take several minutes." : "OpenRouter must be configured before groups can be generated."}</span>
      </div>
    </section>

    {method === "rules" ? rulesRunToken > 0
      ? <DistinctTasks key={rulesRunToken} traces={traces} traceJudgeResults={traceJudgeResults} embedded />
      : <section className="task-signature-empty"><b>No RouteLab rule groups generated yet</b><span>Choose Generate Task Groups to classify the current trace snapshot.</span></section>
      : <LLMGroupedTasks traces={traces} serverGatewayKey={serverGatewayKey} embedded runToken={llmRunToken} onRunningChange={setLlmRunning} />}
  </div>;
}
