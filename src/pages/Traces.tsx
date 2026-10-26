import { useMemo, useRef, useState } from "react";
import type { Trace, TraceJudgeResult } from "../types";
import type { SortDirection, TraceSortKey } from "../types/ui";
import { compareText, stripJudgeMarker } from "../lib/format";
import { traceJudgeResultsByTraceId } from "../core/traceJudge";
import { TraceDrawer } from "../components/TraceDrawer";
import { TraceTable } from "../components/TraceTable";
import { runtimeTraceSourceLabel } from "../core/runtimeTraces";

type ImportResult = { imported: number; errors: string[] };

export function Traces({ traces, traceJudgeResults, onImport }: {
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  onImport: (file: File) => Promise<ImportResult>;
}) {
  const [query,setQuery]=useState("");
  const [modelFilter,setModelFilter]=useState("all");
  const [judgeScoreFilter,setJudgeScoreFilter]=useState("all");
  const [workflowFilter,setWorkflowFilter]=useState("all");
  const [sort,setSort]=useState<{key:TraceSortKey;direction:SortDirection}>({key:"timestamp",direction:"desc"});
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [importing,setImporting]=useState(false);
  const [importResult,setImportResult]=useState<{message:string;errors:string[]}|null>(null);
  const fileInputRef=useRef<HTMLInputElement|null>(null);
  const selected=traces.find(trace=>trace.id===selectedId)??null;
  const modelOptions=useMemo(()=>[...new Set(traces.map(trace=>trace.model))].sort(compareText),[traces]);
  const judgeByTraceId=useMemo(()=>traceJudgeResultsByTraceId(traceJudgeResults),[traceJudgeResults]);
  const shown=useMemo(()=>{
    const globalNeedle=query.trim().toLowerCase();
    return traces.filter(trace=>{
      const judge=judgeByTraceId.get(trace.id);
      const globalMatch=!globalNeedle||`${trace.id} ${trace.model} ${trace.prompt_text} ${stripJudgeMarker(trace.response_text) ?? ""} ${judge?.rationale ?? ""} ${judge?.score ?? ""} ${trace.status} ${trace.provider ?? ""} ${trace.source ?? ""} ${runtimeTraceSourceLabel(trace) ?? ""}`.toLowerCase().includes(globalNeedle);
      const modelMatch=modelFilter==="all"||trace.model===modelFilter;
      const judgeMatch=judgeScoreFilter==="all"||judge?.score===Number(judgeScoreFilter);
      const workflowMatch=workflowFilter==="all"||trace.workflow_id===workflowFilter;
      return globalMatch&&modelMatch&&judgeMatch&&workflowMatch;
    });
  },[traces,query,modelFilter,judgeScoreFilter,workflowFilter,judgeByTraceId]);
  const displayed=useMemo(()=>[...shown].sort((left,right)=>{
    const multiplier=sort.direction==="asc"?1:-1;
    let result=0;
    if(sort.key==="timestamp") {
      const leftTimestamp=Date.parse(left.timestamp);
      const rightTimestamp=Date.parse(right.timestamp);
      result=(Number.isFinite(leftTimestamp)?leftTimestamp:0)-(Number.isFinite(rightTimestamp)?rightTimestamp:0);
    }
    else if(sort.key==="trace") result=compareText(left.id,right.id);
    else if(sort.key==="model") result=compareText(left.model,right.model);
    else if(sort.key==="prompt") result=compareText(left.prompt_text,right.prompt_text);
    else if(sort.key==="response") result=compareText(stripJudgeMarker(left.response_text),stripJudgeMarker(right.response_text));
    else if(sort.key==="judge") result=(judgeByTraceId.get(left.id)?.score??-1)-(judgeByTraceId.get(right.id)?.score??-1);
    else if(sort.key==="tokens") result=left.total_tokens-right.total_tokens;
    else if(sort.key==="latency") result=(left.latency_ms ?? 0)-(right.latency_ms ?? 0);
    else if(sort.key==="cost") result=(left.cost_usd ?? 0)-(right.cost_usd ?? 0);
    else result=compareText(left.status,right.status);
    return result===0?compareText(left.id,right.id):result*multiplier;
  }).slice(0,500),[shown,sort,judgeByTraceId]);
  const updateSort=(key:TraceSortKey)=>setSort(current=>current.key===key?{key,direction:current.direction==="asc"?"desc":"asc"}:{key,direction:key==="timestamp"||key==="judge"||key==="tokens"||key==="latency"||key==="cost"?"desc":"asc"});
  const clearFilters=()=>{setQuery("");setModelFilter("all");setJudgeScoreFilter("all");setWorkflowFilter("all")};
  const importFile=async(file?:File)=>{
    if(!file)return;
    setImporting(true);setImportResult(null);
    try{
      const result=await onImport(file);
      if(result.imported){clearFilters();setSelectedId(null)}
      setImportResult({message:result.imported?`${result.imported.toLocaleString()} traces imported from ${file.name}`:`No traces imported from ${file.name}`,errors:result.errors});
    }catch(error){setImportResult({message:`Could not import ${file.name}`,errors:[error instanceof Error?error.message:"The file could not be read."]})}
    finally{setImporting(false);if(fileInputRef.current)fileInputRef.current.value=""}
  };
  return <div className="traces-page"><section className="trace-source-bar" aria-label="Trace data sources"><div><p className="eyebrow">Trace data</p><b>Choose a source</b></div><div className="trace-source-actions"><input ref={fileInputRef} type="file" accept=".csv,.json,.jsonl" onChange={event=>void importFile(event.target.files?.[0])} aria-label="Select trace file" /><button type="button" className="primary" disabled={importing} onClick={()=>fileInputRef.current?.click()}>{importing?"Importing…":"Import traces"}</button><button type="button" disabled>Connect to observability tool <span>(Coming Soon)</span></button></div>{importResult&&<div className={`trace-import-result ${importResult.errors.length?"warning":""}`} role="status"><b>{importResult.message}</b>{importResult.errors.map(error=><span key={error}>{error}</span>)}</div>}</section><section className="panel"><div className="panelhead trace-panelhead"><div><p className="eyebrow">Normalized traffic</p><h2>{shown.length.toLocaleString()} traces</h2></div><div className="trace-filter-bar"><input className="search" placeholder="Search all trace fields" value={query} onChange={event=>setQuery(event.target.value)} aria-label="Search all trace fields" /><select value={modelFilter} onChange={event=>setModelFilter(event.target.value)} aria-label="Filter by model"><option value="all">All models</option>{modelOptions.map(model=><option value={model} key={model}>{model}</option>)}</select><select value={judgeScoreFilter} onChange={event=>setJudgeScoreFilter(event.target.value)} aria-label="Filter by LLM judge score"><option value="all">All judge scores</option><option value="1">100% judge score</option><option value="0.5">50% judge score</option><option value="0">0% judge score</option></select><button type="button" onClick={clearFilters}>Clear</button></div></div><TraceTable traces={displayed} judgeByTraceId={judgeByTraceId} sort={sort} onSort={updateSort} onSelect={trace=>setSelectedId(trace.id)} showTimestamp /></section><TraceDrawer trace={selected} onClose={()=>setSelectedId(null)} onWorkflowFilter={(workflowId)=>{setWorkflowFilter(workflowId);setSelectedId(null)}} /></div>;
}
