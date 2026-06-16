import { useMemo, useState } from "react";
import type { Trace } from "../types";
import type { SortDirection, TraceSortKey } from "../types/ui";
import { compareText } from "../lib/format";
import { TraceDrawer } from "../components/TraceDrawer";
import { TraceTable } from "../components/TraceTable";

export function Traces({ traces }: { traces: Trace[] }) {
  const [query,setQuery]=useState("");
  const [promptQuery,setPromptQuery]=useState("");
  const [modelFilter,setModelFilter]=useState("all");
  const [sort,setSort]=useState<{key:TraceSortKey;direction:SortDirection}>({key:"trace",direction:"asc"});
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const selected=traces.find(trace=>trace.id===selectedId)??null;
  const modelOptions=useMemo(()=>[...new Set(traces.map(trace=>trace.model))].sort(compareText),[traces]);
  const shown=useMemo(()=>{
    const globalNeedle=query.trim().toLowerCase();
    const promptNeedle=promptQuery.trim().toLowerCase();
    return traces.filter(trace=>{
      const globalMatch=!globalNeedle||`${trace.id} ${trace.model} ${trace.prompt_text} ${trace.response_text ?? ""} ${trace.status} ${trace.provider ?? ""}`.toLowerCase().includes(globalNeedle);
      const promptMatch=!promptNeedle||trace.prompt_text.toLowerCase().includes(promptNeedle);
      const modelMatch=modelFilter==="all"||trace.model===modelFilter;
      return globalMatch&&promptMatch&&modelMatch;
    });
  },[traces,query,promptQuery,modelFilter]);
  const displayed=useMemo(()=>shown.slice(0,500).sort((left,right)=>{
    const multiplier=sort.direction==="asc"?1:-1;
    let result=0;
    if(sort.key==="trace") result=compareText(left.id,right.id);
    else if(sort.key==="model") result=compareText(left.model,right.model);
    else if(sort.key==="prompt") result=compareText(left.prompt_text,right.prompt_text);
    else if(sort.key==="response") result=compareText(left.response_text ?? "",right.response_text ?? "");
    else if(sort.key==="tokens") result=left.total_tokens-right.total_tokens;
    else if(sort.key==="latency") result=(left.latency_ms ?? 0)-(right.latency_ms ?? 0);
    else if(sort.key==="cost") result=(left.cost_usd ?? 0)-(right.cost_usd ?? 0);
    else result=compareText(left.status,right.status);
    return result===0?compareText(left.id,right.id):result*multiplier;
  }),[shown,sort]);
  const updateSort=(key:TraceSortKey)=>setSort(current=>current.key===key?{key,direction:current.direction==="asc"?"desc":"asc"}:{key,direction:key==="trace"||key==="model"||key==="prompt"||key==="response"||key==="status"?"asc":"desc"});
  const clearFilters=()=>{setQuery("");setPromptQuery("");setModelFilter("all")};
  return <div className="traces-page"><section className="panel"><div className="panelhead trace-panelhead"><div><p className="eyebrow">Normalized traffic</p><h2>{shown.length.toLocaleString()} traces</h2><small className="table-limit">Showing {displayed.length.toLocaleString()} of {shown.length.toLocaleString()} matching traces · sorting applies to this visible page · click any row to inspect it</small></div><div className="trace-filter-bar"><input className="search" placeholder="Search all trace fields" value={query} onChange={event=>setQuery(event.target.value)} aria-label="Search all trace fields" /><input className="search" placeholder="Search prompt only" value={promptQuery} onChange={event=>setPromptQuery(event.target.value)} aria-label="Search prompt text only" /><select value={modelFilter} onChange={event=>setModelFilter(event.target.value)} aria-label="Filter by model"><option value="all">All models</option>{modelOptions.map(model=><option value={model} key={model}>{model}</option>)}</select><button type="button" onClick={clearFilters}>Clear</button></div></div><TraceTable traces={displayed} sort={sort} onSort={updateSort} onSelect={trace=>setSelectedId(trace.id)} /></section><TraceDrawer trace={selected} onClose={()=>setSelectedId(null)} /></div>;
}
