import { useMemo, useState } from "react";
import { buildReviewQueue } from "../core/reviewQueue";
import { replay } from "../core/simulations";
import type { DistinctTaskBucket, Trace } from "../types";
import type { ReviewDecision } from "../types/ui";
import { money, pct, preview } from "../lib/format";
import { distinctTaskFieldColumns, distinctTaskValue } from "../components/DistinctTaskDisplay";

export function ReviewQueue({traces,distinctTaskBuckets,candidate}:{traces:Trace[];distinctTaskBuckets:DistinctTaskBucket[];candidate:string}){
  const [index,setIndex]=useState(0);
  const [decisions,setDecisions]=useState<Record<string,ReviewDecision>>({});
  const {reviewItems,lowScoreCount,distinctTaskCount}=useMemo(()=>{
    const replayResult=replay(traces,candidate);
    return buildReviewQueue(traces,replayResult.runs,replayResult.evals,distinctTaskBuckets);
  },[traces,distinctTaskBuckets,candidate]);
  const current=reviewItems[Math.min(index,Math.max(reviewItems.length-1,0))];
  const reviewed=Object.keys(decisions).filter(id=>reviewItems.some(item=>item.evalResult.id===id)).length;
  const applyDecision=(decision:ReviewDecision)=>{
    if(!current)return;
    setDecisions({...decisions,[current.evalResult.id]:decision});
    setIndex(Math.min(index+1,Math.max(reviewItems.length-1,0)));
  };
  const choiceLabels: Array<[ReviewDecision,string,string]> = [
    ["approve","Approve","Eval is wrong"],
    ["reject","Reject","Real failure"],
    ["escalate","Flag for review","Needs expert"],
    ["skip","Skip","Not enough context"],
  ];
  if(!current)return <section className="panel review-empty"><p className="eyebrow">Human review</p><h2>No low-score evals need spot check</h2><p>All simulated evals for {candidate} are currently passing the low-score review threshold.</p></section>;
  const decision=decisions[current.evalResult.id];
  return <section className="review-shell"><div className="review-top"><div><p className="eyebrow">Human review</p><h2>Smart trace check</h2><small>Sampling {reviewItems.length.toLocaleString()} traces from {lowScoreCount.toLocaleString()} low-score evals across {distinctTaskCount.toLocaleString()} Distinct Tasks</small></div><span>{reviewed}/{reviewItems.length.toLocaleString()} reviewed</span></div><article className="review-card"><div className="review-score"><div><small>Judge score</small><b>{pct(current.evalResult.score*100)}</b></div><span className={`risk ${current.bucket?.risk_level??"medium"}`}>{current.bucket?.risk_level??"unknown"} risk</span></div><section className="review-facts"><div><small>Actual trace</small><b>{current.trace.id}</b><span>{current.trace.model} · {current.trace.status} · {current.trace.total_tokens.toLocaleString()} tokens · {current.trace.latency_ms??0}ms</span></div><div><small>Candidate run</small><b>{current.run.candidate_model}</b><span>{money(current.run.cost_usd)} · {current.run.latency_ms}ms · {current.run.status}</span></div></section><section><small>Prompt</small><p>{preview(current.trace.prompt_text,900)}</p></section><section><small>Answer provided by agent</small><p>{preview(current.run.response_text,900)}</p></section><section><small>Classification / Distinct Task</small><p>{current.bucket?`${current.bucket.bucket_name} (${current.bucket.bucket_id})`:"No distinct task bucket assigned"}</p>{current.bucket&&<div className="review-tags">{distinctTaskFieldColumns.map(({field})=><span key={field}>{distinctTaskValue(field,current.bucket!.task[field])}</span>)}</div>}</section><section><small>LLM-as-judge result</small><p><b>{current.evalResult.evaluator_type.replaceAll("_"," ")}</b> scored this {pct(current.evalResult.score*100)}. {current.evalResult.explanation??`${current.evalResult.severity??"Low"} eval outcome on ${candidate}.`}</p></section><details><summary>Reference answer</summary><p>{preview(current.trace.response_text||"No response captured on the source trace",900)}</p></details>{decision&&<div className="review-decision">Marked: <b>{decision==="escalate"?"flag for review":decision}</b></div>}<div className="review-actions" aria-label="Review choices">{choiceLabels.map(([value,label,hint])=><button type="button" className={`review-choice ${value}`} onClick={()=>applyDecision(value)} key={value}><b>{label}</b><span>{hint}</span></button>)}</div></article><div className="review-nav"><button type="button" onClick={()=>setIndex(Math.max(0,index-1))} disabled={index===0}>Previous</button><span>{Math.min(index+1,reviewItems.length).toLocaleString()} of {reviewItems.length.toLocaleString()}</span><button type="button" onClick={()=>setIndex(Math.min(reviewItems.length-1,index+1))} disabled={index>=reviewItems.length-1}>Next</button></div></section>;
}
