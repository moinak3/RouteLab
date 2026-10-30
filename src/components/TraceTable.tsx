import type { Trace, TraceJudgeResult } from "../types";
import type { SortDirection, TraceSortKey } from "../types/ui";
import { money, pct, preview, stripJudgeMarker } from "../lib/format";
import { SortHeader } from "./SortHeader";
import { runtimeTraceSourceLabel } from "../core/runtimeTraces";

const middleEllipsis = (value: string, head = 18, tail = 8) => value.length <= head + tail + 1 ? value : `${value.slice(0, head)}...${value.slice(-tail)}`;
const traceDateFormatter = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "2-digit" });
const traceTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });

function traceDateTime(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return { date: "Unknown date", time: value };
  return { date: traceDateFormatter.format(timestamp), time: traceTimeFormatter.format(timestamp) };
}

export function TraceTable({ traces, judgeByTraceId, onSelect, sort, onSort, showTimestamp = false }: { traces: Trace[]; judgeByTraceId?: Map<string, TraceJudgeResult>; onSelect?: (trace: Trace) => void; sort?: { key: TraceSortKey; direction: SortDirection }; onSort?: (key: TraceSortKey) => void; showTimestamp?: boolean }) {
  const header = (label: string, key: TraceSortKey) => sort && onSort ? <SortHeader label={label} sortKey={key} activeKey={sort.key} direction={sort.direction} onSort={onSort} /> : <th>{label}</th>;
  return <div className="tablewrap"><table><thead><tr>{showTimestamp&&header("Date / time","timestamp")}{header("Trace","trace")}{header("Model","model")}{header("Prompt","prompt")}{header("Response snapshot","response")}{header("LLM judge","judge")}{header("Tokens","tokens")}{header("Latency","latency")}{header("Cost","cost")}{header("Status","status")}</tr></thead><tbody>{traces.map((trace) => { const judge=judgeByTraceId?.get(trace.id); const response=stripJudgeMarker(trace.response_text); const sourceLabel=runtimeTraceSourceLabel(trace); const timestamp=traceDateTime(trace.timestamp); return <tr className={onSelect ? "trace-row" : ""} key={trace.id} tabIndex={onSelect ? 0 : undefined} onClick={() => onSelect?.(trace)} onKeyDown={(event) => { if (onSelect && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(trace); } }}>{showTimestamp&&<td className="trace-date-time"><time dateTime={trace.timestamp} title={trace.timestamp}><b>{timestamp.date}</b><small>{timestamp.time}</small></time></td>}<td>{onSelect?<span className="trace-id-action"><code title={trace.id}>{middleEllipsis(trace.id)}</code>{sourceLabel&&<small className="runtime-trace-source">{sourceLabel}</small>}<button className="trace-details-button" aria-haspopup="dialog" aria-label={`View details for ${trace.id}`} onClick={(event)=>{event.stopPropagation();onSelect(trace)}}>View details</button></span>:<code title={trace.id}>{middleEllipsis(trace.id)}</code>}</td><td>{trace.model}</td><td className="prompt">{preview(trace.prompt_text, 120)}</td><td className="response-snapshot">{preview(response || "No response captured", 120)}</td><td className="judge-snapshot" title={judge?.rationale}><span className="judge-snapshot-content">{judge?<><span className={`judge-score ${judge.passed?"pass":"fail"}`}>{pct(judge.score*100)}</span><span className={`severity ${judge.severity??"none"}`}>{judge.severity??"pass"}</span></>:<span className="judge-score unknown">N/A</span>}</span></td><td>{trace.total_tokens}</td><td>{trace.latency_ms}ms</td><td>{money(trace.cost_usd ?? 0)}</td><td><span className={`status ${trace.status}`}>{trace.status}</span></td></tr>; })}</tbody></table></div>;
}
