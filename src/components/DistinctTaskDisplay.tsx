import { useState, type FocusEvent, type MouseEvent } from "react";
import type { DistinctTaskField } from "../types";

const distinctTaskHelp: Record<string,string> = {
  task_type:"What kind of work the model performs, such as extraction, summarization, support answering, code review, or planning_strategy_recommendations.",
  domain:"The business or knowledge area involved, such as billing, legal, engineering, marketing, or healthcare.",
  complexity:"Estimated semantic and reasoning difficulty: low, medium, or high. Input/output size contributes, but dense domains, multi-step reasoning, tools, grounding, constraints, repetition, and optional embedding or LLM difficulty scores can outweigh it.",
  temporal_context:"Whether this is a single-turn request, an early multi-turn exchange, or a later turn where accumulated context and instruction drift become important.",
  tool_use:"Whether tools were used and whether they succeeded, recovered from failure, or failed.",
  output_uncertainty:"How much uncertainty the model expresses in its output. Low uncertainty means a confident answer; high uncertainty means substantial hedging or inability to confirm.",
  output_format:"The expected response structure, such as natural language, JSON, SQL, code, a table, or a classification_tagging label.",
  grounding_requirement:"What evidence the answer must rely on, such as provided context, retrieved sources, policy, or tool results.",
};

export const distinctTaskFieldColumns: Array<{ field: DistinctTaskField; label: string }> = [
  { field: "task_type", label: "Task type" },
  { field: "domain", label: "Domain" },
  { field: "complexity", label: "Complexity" },
  { field: "temporal_context", label: "Session" },
  { field: "tool_use", label: "Tools" },
  { field: "output_uncertainty", label: "Uncertainty" },
  { field: "output_format", label: "Output" },
  { field: "grounding_requirement", label: "Grounding" },
];

export const distinctTaskValue = (field: DistinctTaskField, value: unknown) => {
  const normalized = String(value).replaceAll(" ", "_");
  const suffixes: Record<DistinctTaskField, string> = {
    task_type: "task",
    domain: "domain",
    complexity: "complexity",
    temporal_context: "session",
    tool_use: "tool_use",
    output_uncertainty: "uncertainty",
    output_format: "output",
    grounding_requirement: "grounding",
  };
  return `${normalized}_${suffixes[field]}`;
};

export function DistinctTaskHelp({field,label}:{field:keyof typeof distinctTaskHelp;label:string}){
  const [tooltip,setTooltip]=useState<{left:number;top:number}|null>(null);
  const showTooltip=(event:MouseEvent<HTMLElement>|FocusEvent<HTMLElement>)=>{
    const rect=event.currentTarget.getBoundingClientRect();
    const width=300;
    setTooltip({
      left:Math.min(Math.max(12,rect.left),window.innerWidth-width-12),
      top:rect.bottom+10,
    });
  };
  return <span className="task-help" tabIndex={0} onMouseEnter={showTooltip} onMouseLeave={()=>setTooltip(null)} onFocus={showTooltip} onBlur={()=>setTooltip(null)} onClick={showTooltip}>{label}<i>?</i>{tooltip&&<em className="task-help-tooltip" role="tooltip" style={{left:tooltip.left,top:tooltip.top}}>{distinctTaskHelp[field]}</em>}</span>;
}
