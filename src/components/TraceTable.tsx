import type { Trace, TraceJudgeResult } from "../types";
import type { SortDirection, TraceSortKey } from "../types/ui";
import { formatCurrency, formatInteger, formatLatency, preview, stripJudgeMarker } from "../lib/format";
import { SortHeader } from "./SortHeader";
import { getModel } from "../core/catalog";

const endEllipsis = (value: string, length = 26) => value.length <= length ? value : `${value.slice(0, length)}...`;
const judgeLabel = (score: number) => score >= 1 ? "Pass" : score >= .5 ? "Partial" : "Fail";

export function TraceTable({ traces, judgeByTraceId, onSelect, sort, onSort }: { traces: Trace[]; judgeByTraceId?: Map<string, TraceJudgeResult>; onSelect?: (trace: Trace) => void; sort?: { key: TraceSortKey; direction: SortDirection }; onSort?: (key: TraceSortKey) => void }) {
  const header = (label: string, key: TraceSortKey) => sort && onSort ? <SortHeader label={label} sortKey={key} activeKey={sort.key} direction={sort.direction} onSort={onSort} /> : <th>{label}</th>;
  return <div className="tablewrap"><table><thead><tr>{header("Trace", "trace")}{header("Model", "model")}{header("Prompt", "prompt")}{header("Response snapshot", "response")}{header("Judge", "judge")}{header("API", "status")}{header("Tokens", "tokens")}{header("Latency", "latency")}{header("Cost", "cost")}</tr></thead><tbody>{traces.map((trace) => {
    const judge = judgeByTraceId?.get(trace.id);
    const response = stripJudgeMarker(trace.response_text);
    return <tr className={onSelect ? "trace-row" : ""} key={trace.id} tabIndex={onSelect ? 0 : undefined} onClick={() => onSelect?.(trace)} onKeyDown={(event) => { if (onSelect && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(trace); } }}>
      <td><span className="trace-id-action"><code title={trace.id}>{endEllipsis(trace.id)}</code><button className="trace-copy" title="Copy full trace ID" aria-label={`Copy ${trace.id}`} onClick={(event) => { event.stopPropagation(); void navigator.clipboard?.writeText(trace.id); }}>Copy</button></span></td>
      <td>{getModel(trace.model)?.display_name ?? trace.model}</td>
      <td className="prompt">{preview(trace.prompt_text, 120)}</td>
      <td className="response-snapshot">{preview(response || "No response captured", 120)}</td>
      <td className="judge-snapshot" title={judge?.rationale}>{judge ? <><span className={`judge-score ${judge.score >= 1 ? "pass" : judge.score >= .5 ? "partial" : "fail"}`}>{judgeLabel(judge.score)}</span>{judge.severity && <span className={`severity ${judge.severity}`}>{judge.severity}</span>}</> : <span className="judge-score unknown">Not scored</span>}</td>
      <td><span className={`status ${trace.status}`}>{trace.status}</span></td>
      <td>{formatInteger(trace.total_tokens)}</td>
      <td>{formatLatency(trace.latency_ms ?? 0)}</td>
      <td>{formatCurrency(trace.cost_usd ?? 0)}</td>
    </tr>;
  })}</tbody></table></div>;
}
