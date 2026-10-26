import { useEffect } from "react";
import type { Trace } from "../types";
import { money, stripJudgeMarker } from "../lib/format";
import { traceUserFeedback, traceUserFeedbackLabel } from "../core/traceFeedback";
import { runtimeTraceSourceLabel } from "../core/runtimeTraces";

const visibleMetadata = (metadata: Trace["metadata"]) => Object.fromEntries(
  Object.entries(metadata ?? {}).filter(([key]) => !key.startsWith("_internal")),
);

export function TraceDrawer({ trace, onClose, onWorkflowFilter }: { trace: Trace | null; onClose: () => void; onWorkflowFilter?: (workflowId: string) => void }) {
  useEffect(() => {
    if (!trace) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("keydown", closeOnEscape); document.body.style.overflow = previousOverflow; };
  }, [trace, onClose]);
  const messages=trace?.messages??[];
  const facts = trace ? [["Source", runtimeTraceSourceLabel(trace) ?? trace.source ?? "Uploaded data"], ["Model", trace.model || "unknown"], ["Provider", trace.provider ?? "other"], ["Role", trace.workflow_role ?? "unclassified"], ["Status", trace.status ?? "unknown"], ["Input tokens", Number(trace.input_tokens ?? 0).toLocaleString()], ["Output tokens", Number(trace.output_tokens ?? 0).toLocaleString()], ["Latency", `${trace.latency_ms ?? 0}ms`], ["Cost", money(trace.cost_usd ?? 0)], ["User", String(trace.metadata?.user_id ?? "Not captured")], ["User feedback", traceUserFeedbackLabel(traceUserFeedback(trace))]] : [];
  return <div className={`drawer-layer ${trace?"open":""}`} aria-hidden={!trace} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="trace-drawer" role="dialog" aria-modal="true" aria-label="Trace details"><div className="drawer-head"><div><p className="eyebrow">Trace details</p><h2>{trace?.id??"Select a trace"}</h2><span>{trace?.timestamp??""}</span></div><button aria-label="Close trace details" onClick={onClose}>×</button></div>{trace&&<div className="drawer-body"><section className="drawer-facts">{facts.map(([label,value])=><div key={label}><small>{label}</small><b>{value}</b></div>)}</section>{trace.signature_decision&&<section className="drawer-section signature-decision"><div className="signature-decision-head"><div><p className="eyebrow">Jev signature gate</p><h3>{trace.signature_decision.signature_label}</h3></div><span className={trace.signature_decision.routing_action==="signature_route"?"matched":"fallback"}>{trace.signature_decision.routing_action==="signature_route"?"Signature route":"Fallback model"}</span></div><div className="signature-decision-metrics"><div><small>Confidence</small><b>{(trace.signature_decision.confidence*100).toFixed(1)}%</b></div><div><small>Required</small><b>{(trace.signature_decision.confidence_threshold*100).toFixed(0)}%</b></div><div><small>Gate latency</small><b>{trace.signature_decision.latency_ms}ms</b></div></div><p>{trace.signature_decision.reason}</p>{trace.signature_decision.runner_up&&<small>Runner-up: {trace.signature_decision.runner_up.signature_label} ({(trace.signature_decision.runner_up.confidence*100).toFixed(1)}%)</small>}</section>}<section className="drawer-section"><p className="eyebrow">Workflow context</p><div className="workflow-path">{trace.workflow_id?<button type="button" className="workflow-filter-link" onClick={()=>onWorkflowFilter?.(trace.workflow_id!)}>{trace.workflow_id}</button>:<span>Standalone call</span>}<b>{trace.span_name ?? trace.node_id ?? trace.id}</b><small>{trace.parent_node_id ? `Parent: ${trace.parent_node_id}` : "Root node"}</small></div></section><section className="drawer-section"><p className="eyebrow">Prompt</p><pre>{trace.prompt_text || "No prompt captured"}</pre></section><section className="drawer-section"><p className="eyebrow">Response</p><pre>{stripJudgeMarker(trace.response_text) || "No response captured"}</pre></section><section className="drawer-section"><p className="eyebrow">Messages</p>{messages.length?messages.map((message,index)=><div className="message" key={`${message.role}-${index}`}><b>{message.role}</b><span>{message.content}</span></div>):<pre>No messages captured</pre>}</section><section className="drawer-section"><p className="eyebrow">Metadata</p><pre>{JSON.stringify(visibleMetadata(trace.metadata), null, 2)}</pre></section></div>}</aside></div>;
}
