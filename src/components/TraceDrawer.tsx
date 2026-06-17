import { useEffect } from "react";
import type { Trace } from "../types";
import { money, stripJudgeMarker } from "../lib/format";

export function TraceDrawer({ trace, onClose }: { trace: Trace | null; onClose: () => void }) {
  useEffect(() => {
    if (!trace) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("keydown", closeOnEscape); document.body.style.overflow = previousOverflow; };
  }, [trace, onClose]);
  const messages=trace?.messages??[];
  const facts = trace ? [["Model", trace.model || "unknown"], ["Provider", trace.provider ?? "other"], ["Role", trace.workflow_role ?? "unclassified"], ["Status", trace.status ?? "unknown"], ["Input tokens", Number(trace.input_tokens ?? 0).toLocaleString()], ["Output tokens", Number(trace.output_tokens ?? 0).toLocaleString()], ["Latency", `${trace.latency_ms ?? 0}ms`], ["Cost", money(trace.cost_usd ?? 0)]] : [];
  return <div className={`drawer-layer ${trace?"open":""}`} aria-hidden={!trace} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="trace-drawer" role="dialog" aria-modal="true" aria-label="Trace details"><div className="drawer-head"><div><p className="eyebrow">Trace details</p><h2>{trace?.id??"Select a trace"}</h2><span>{trace?.timestamp??""}</span></div><button aria-label="Close trace details" onClick={onClose}>×</button></div>{trace&&<div className="drawer-body"><section className="drawer-facts">{facts.map(([label,value])=><div key={label}><small>{label}</small><b>{value}</b></div>)}</section><section className="drawer-section"><p className="eyebrow">Workflow context</p><div className="workflow-path"><span>{trace.workflow_id ?? "Standalone call"}</span><b>{trace.span_name ?? trace.node_id ?? trace.id}</b><small>{trace.parent_node_id ? `Parent: ${trace.parent_node_id}` : "Root node"}</small></div></section><section className="drawer-section"><p className="eyebrow">Prompt</p><pre>{trace.prompt_text || "No prompt captured"}</pre></section><section className="drawer-section"><p className="eyebrow">Response</p><pre>{stripJudgeMarker(trace.response_text) || "No response captured"}</pre></section><section className="drawer-section"><p className="eyebrow">Messages</p>{messages.length?messages.map((message,index)=><div className="message" key={`${message.role}-${index}`}><b>{message.role}</b><span>{message.content}</span></div>):<pre>No messages captured</pre>}</section><section className="drawer-section"><p className="eyebrow">Metadata</p><pre>{JSON.stringify(trace.metadata ?? {}, null, 2)}</pre></section></div>}</aside></div>;
}
