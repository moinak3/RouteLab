import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { benchmarkFamilies, buildBenchmarkPriorRecommendation } from "../core/benchmarkPriors";
import { createDistinctTaskBuckets, mostCommonModelForTaskGroup } from "../core/distinctTasks";
import { generateEvalPlans } from "../core/evalPlans";
import type { CustomerEvaluationEvidence, DistinctTask, DistinctTaskBucket, DistinctTaskField, EvalPlan, Trace, TraceJudgeResult } from "../types";
import type { DistinctTaskSortKey, SortDirection } from "../types/ui";
import { compareText, money, pct } from "../lib/format";
import { DistinctTaskHelp, distinctTaskFieldColumns, distinctTaskValue } from "../components/DistinctTaskDisplay";
import { SortHeader } from "../components/SortHeader";
import { confirmTaskGroup, editTaskGroup } from "../core/taskGroupActions";

const taskFieldOptions: Record<DistinctTaskField, readonly string[]> = {
  task_type: ["summarization", "extraction", "classification_tagging", "question_answering", "rag_grounded_answers", "customer_support_responses", "policy_compliance_reasoning", "code_generation", "code_review_debugging", "sql_data_query_generation", "data_analysis_insight_generation", "writing_editing", "sales_marketing_content", "translation_localization", "document_review_legal_analysis", "planning_strategy_recommendations", "tool_use_function_calling", "agentic_workflow_execution", "moderation_safety_review", "multimodal_document_image_understanding"],
  domain: ["general", "customer_support", "billing", "legal", "compliance", "finance", "healthcare", "sales", "marketing", "engineering", "data", "hr", "education", "operations", "security", "product", "unknown"],
  complexity: ["low", "medium", "high"],
  temporal_context: ["single_turn", "early_multi_turn", "late_multi_turn"],
  tool_use: ["none", "success", "recovered_failure", "failed"],
  output_uncertainty: ["low", "medium", "high"],
  output_format: ["natural_language", "json", "yaml", "xml", "markdown", "table", "code", "sql", "tool_call", "classification_label", "mixed", "unknown"],
  grounding_requirement: ["none", "provided_context", "retrieval_augmented", "source_citation_required", "policy_grounded", "tool_grounded", "unknown"],
};
const taskGroupFieldColumns=distinctTaskFieldColumns.filter(({field})=>field!=="grounding_requirement");

function customerEvaluationEvidence(bucket: DistinctTaskBucket, traces: Trace[], results: TraceJudgeResult[]): CustomerEvaluationEvidence[] {
  const traceById = new Map(traces.filter((trace) => bucket.traces.includes(trace.id)).map((trace) => [trace.id, trace]));
  const grouped = new Map<string, TraceJudgeResult[]>();
  results.forEach((result) => {
    const modelId = traceById.get(result.trace_id)?.model;
    if (modelId) grouped.set(modelId, [...(grouped.get(modelId) ?? []), result]);
  });
  return [...grouped.entries()].map(([model_id, items]) => ({
    model_id,
    sample_size: items.length,
    pass_rate: items.filter((item) => item.passed).length / items.length,
    average_score: items.reduce((sum, item) => sum + item.score, 0) / items.length,
    evaluated_at: items.map((item) => item.created_at).sort().at(-1) ?? new Date(0).toISOString(),
  }));
}

export function DistinctTasks({traces,traceJudgeResults=[],embedded=false,buckets:providedBuckets,onBucketsChange,onRunSimulation}:{traces:Trace[];traceJudgeResults?:TraceJudgeResult[];embedded?:boolean;buckets?:DistinctTaskBucket[];onBucketsChange?:(groups:DistinctTaskBucket[])=>void;onRunSimulation?:(bucketId:string)=>void}){
  const generatedBuckets=useMemo(()=>createDistinctTaskBuckets(traces),[traces]);
  const buckets=providedBuckets??generatedBuckets;
  const plans=useMemo(()=>generateEvalPlans(buckets),[buckets]);
  const mostCommonModels=useMemo(()=>new Map(buckets.map(bucket=>[bucket.bucket_id,mostCommonModelForTaskGroup(bucket,traces)??"N/A"])),[buckets,traces]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [sort,setSort]=useState<{key:DistinctTaskSortKey;direction:SortDirection}>({key:"trace_count",direction:"desc"});
  const sortedBuckets=useMemo(()=>[...buckets].sort((left,right)=>{
    const multiplier=sort.direction==="asc"?1:-1;
    let result=0;
    if(sort.key==="bucket_name") result=compareText(left.bucket_name,right.bucket_name);
    else if(sort.key==="most_common_model") result=compareText(mostCommonModels.get(left.bucket_id)??"N/A",mostCommonModels.get(right.bucket_id)??"N/A");
    else if(sort.key==="trace_count") result=left.trace_count-right.trace_count;
    else if(sort.key==="total_cost_usd") result=left.total_cost_usd-right.total_cost_usd;
    else if(sort.key==="avg_confidence") result=left.avg_confidence-right.avg_confidence;
    else if(sort.key==="eval_plan") result=compareText(plans.get(left.bucket_id)?.human_review_required?"human review required":"ready",plans.get(right.bucket_id)?.human_review_required?"human review required":"ready");
    else result=compareText(distinctTaskValue(sort.key,left.task[sort.key]),distinctTaskValue(sort.key,right.task[sort.key]));
    return result===0?compareText(left.bucket_id,right.bucket_id):result*multiplier;
  }),[buckets,mostCommonModels,plans,sort]);
  const updateSort=(key:DistinctTaskSortKey)=>setSort(current=>current.key===key?{key,direction:current.direction==="asc"?"desc":"asc"}:{key,direction:key==="bucket_name"||taskGroupFieldColumns.some(column=>column.field===key)?"asc":"desc"});
  const selected=buckets.find(bucket=>bucket.bucket_id===selectedId)??null; const plan=selected?plans.get(selected.bucket_id):undefined;
  const gated=traces.filter(trace=>trace.signature_decision); const matched=gated.filter(trace=>trace.signature_decision?.routing_action==="signature_route").length; const unknown=gated.filter(trace=>trace.signature_decision?.status==="unknown").length;
  const confirmSelected=(bucketId:string)=>onBucketsChange?.(confirmTaskGroup(buckets,bucketId));
  const editSelected=(bucketId:string,bucketName:string,task:DistinctTask)=>onBucketsChange?.(editTaskGroup(buckets,bucketId,{bucketName,task}));
  return <>{!embedded&&<section className="task-intro panel distinct-task-explainer"><div><p className="eyebrow">Core intelligence layer</p><h2>Traces → Task Groups</h2><p>Every newly ingested trace is synchronously classified by Jev through OpenRouter against the known signature catalog plus an explicit unknown option. A high-confidence match can use a signature-specific route; uncertainty, timeout, or provider failure uses the broadly capable fallback model.</p><p>Thresholds are risk-adjusted: 80% for low-risk work, 86% for medium risk, and 92% for high-risk work. These thresholds should be calibrated against your Golden Dataset before production routing.</p></div><div><strong>{buckets.length}</strong><span>task groups</span></div></section>}{gated.length>0&&<section className="panel jev-gate-summary"><div><small>Jev classified</small><b>{gated.length}</b></div><div><small>Signature routes</small><b>{matched}</b></div><div><small>Fallback routes</small><b>{gated.length-matched}</b></div><div><small>Unknown signatures</small><b>{unknown}</b></div></section>}<section className="panel task-table-panel"><div className="panelhead"><div><p className="eyebrow">Workload groups</p><h2>Task Groups</h2></div><span>{traces.length.toLocaleString()} traces classified</span></div><div className="tablewrap"><table className="task-table"><thead><tr><SortHeader label="Group name" sortKey="bucket_name" activeKey={sort.key} direction={sort.direction} onSort={updateSort} />{taskGroupFieldColumns.map(({field,label})=><SortHeader key={field} label={label} sortKey={field} activeKey={sort.key} direction={sort.direction} onSort={updateSort}><DistinctTaskHelp field={field} label={label} /></SortHeader>)}<SortHeader label="Most common model" sortKey="most_common_model" activeKey={sort.key} direction={sort.direction} onSort={updateSort} /><SortHeader label="Traces" sortKey="trace_count" activeKey={sort.key} direction={sort.direction} onSort={updateSort} /><SortHeader label="Total cost" sortKey="total_cost_usd" activeKey={sort.key} direction={sort.direction} onSort={updateSort} /><SortHeader label="Confidence" sortKey="avg_confidence" activeKey={sort.key} direction={sort.direction} onSort={updateSort} /><SortHeader label="Eval plan" sortKey="eval_plan" activeKey={sort.key} direction={sort.direction} onSort={updateSort} /></tr></thead><tbody>{sortedBuckets.map(bucket=><tr className="task-row" key={bucket.bucket_id} tabIndex={0} onClick={()=>setSelectedId(bucket.bucket_id)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();setSelectedId(bucket.bucket_id)}}}><td><b>{bucket.bucket_name}</b><small>{bucket.bucket_id}</small></td>{taskGroupFieldColumns.map(({field})=><td key={field}>{distinctTaskValue(field,bucket.task[field])}</td>)}<td><code>{mostCommonModels.get(bucket.bucket_id)??"N/A"}</code></td><td>{bucket.trace_count.toLocaleString()}</td><td>{money(bucket.total_cost_usd)}</td><td>{pct(bucket.avg_confidence*100)}</td><td><span className="eval-ready">Ready</span></td></tr>)}</tbody></table></div></section>{selected&&plan&&<DistinctTaskDetail bucket={selected} plan={plan} customerEvaluations={customerEvaluationEvidence(selected,traces,traceJudgeResults)} onClose={()=>setSelectedId(null)} onConfirm={onBucketsChange?confirmSelected:undefined} onEdit={onBucketsChange?editSelected:undefined} onRunSimulation={onRunSimulation} />}</>;
}

function DistinctTaskDetail({bucket,plan,customerEvaluations,onClose,onConfirm,onEdit,onRunSimulation}:{bucket:DistinctTaskBucket;plan:EvalPlan;customerEvaluations:CustomerEvaluationEvidence[];onClose:()=>void;onConfirm?:(bucketId:string)=>void;onEdit?:(bucketId:string,bucketName:string,task:DistinctTask)=>void;onRunSimulation?:(bucketId:string)=>void}){
  const groups=[["Required",plan.required_evals],["Recommended",plan.recommended_evals],["Optional",plan.optional_evals]] as const;
  const benchmarkOutput=useMemo(()=>buildBenchmarkPriorRecommendation(bucket.task,{topK:3,customerEvaluations}),[bucket.task,customerEvaluations]);
  const family=(id:string)=>benchmarkFamilies.find(item=>item.id===id);
  const [editMode,setEditMode]=useState<"rename"|"attributes"|null>(null);
  const [draftName,setDraftName]=useState(bucket.bucket_name);
  const [draftTask,setDraftTask]=useState<DistinctTask>(bucket.task);
  const [actionMessage,setActionMessage]=useState<string|null>(null);
  useEffect(()=>{setEditMode(null);setDraftName(bucket.bucket_name);setDraftTask(bucket.task);setActionMessage(null)},[bucket.bucket_id]);
  const saveEdit=()=>{
    if(!onEdit||!editMode)return;
    const nextName=editMode==="rename"?draftName.trim():bucket.bucket_name;
    if(!nextName)return;
    onEdit(bucket.bucket_id,nextName,editMode==="attributes"?draftTask:bucket.task);
    setEditMode(null);
    setActionMessage(editMode==="rename"?"Task group renamed. Confirm this updated group when ready.":"Task group attributes saved. Confirm this updated group when ready.");
  };
  const confirm=()=>{
    if(!onConfirm)return;
    onConfirm(bucket.bucket_id);
    setActionMessage("Group confirmed and saved to this workspace.");
  };
  const drawer=<div className="task-detail-layer" onClick={event=>{if(event.target===event.currentTarget)onClose()}}>
    <aside className="task-detail" role="dialog" aria-modal="true" aria-label="Task Group detail">
      <div className="task-detail-head"><div><p className="eyebrow">Task Group</p><h2>{bucket.bucket_name}</h2><span>{bucket.bucket_id} · {bucket.trace_count.toLocaleString()} traces · {bucket.name_source === "llm" ? "AI-proposed name, editable" : bucket.name_source === "user" ? "User-edited name" : "RouteLab fallback name"}</span></div><button aria-label="Close task detail" onClick={onClose}>×</button></div>
      <div className="task-detail-body">
        <section><div className="task-actions"><button type="button" className="primary" disabled={!onRunSimulation} onClick={()=>onRunSimulation?.(bucket.bucket_id)}>Run simulation</button><button type="button" disabled={!onConfirm||bucket.review_status==="confirmed"} onClick={confirm}>{bucket.review_status==="confirmed"?"Confirmed":"Confirm group"}</button><button type="button" disabled={!onEdit} onClick={()=>{setEditMode("rename");setDraftName(bucket.bucket_name);setActionMessage(null)}}>Rename task group</button><button type="button" disabled={!onEdit} onClick={()=>{setEditMode("attributes");setDraftTask(bucket.task);setActionMessage(null)}}>Edit group</button><button type="button" disabled title="Not available yet">Split group</button><button type="button" disabled title="Not available yet">Create eval set</button></div>{actionMessage&&<p className="task-action-message" role="status">{actionMessage}</p>}{editMode&&<form className="task-edit-form" onSubmit={event=>{event.preventDefault();saveEdit()}}>{editMode==="rename"?<label className="task-edit-name">Task group name<input value={draftName} onChange={event=>setDraftName(event.target.value)} required autoFocus /></label>:<div>{taskGroupFieldColumns.map(({field,label})=><label key={field}>{label}<select value={draftTask[field]} onChange={event=>setDraftTask(current=>({...current,[field]:event.target.value} as DistinctTask))}>{taskFieldOptions[field].map(option=><option value={option} key={option}>{option.replaceAll("_"," ")}</option>)}</select></label>)}</div>}<footer><button type="button" onClick={()=>{setEditMode(null);setDraftName(bucket.bucket_name);setDraftTask(bucket.task)}}>Cancel</button><button type="submit" className="primary" disabled={editMode==="rename"&&!draftName.trim()}>{editMode==="rename"?"Save name":"Save attributes"}</button></footer></form>}<h3>Task Group summary</h3><div className="task-summary">{taskGroupFieldColumns.map(({field,label})=><div key={field}><small><DistinctTaskHelp field={field} label={label} /></small><b>{distinctTaskValue(field,bucket.task[field])}</b></div>)}</div></section>
        <section><h3>Examples</h3>{bucket.examples.map(example=><article className="task-example" key={example.trace_id}><b>{example.trace_id}</b><p>{example.prompt_preview}</p><small>{example.response_preview}</small></article>)}</section>
        <section className="benchmark-priors">
          <div className="benchmark-head"><div><p className="eyebrow">Model shortlist</p><h3>Recommended models to evaluate</h3></div><div className="eval-plan-meta"><span>Benchmark confidence: <b>{benchmarkOutput.recommendation.benchmark_confidence}</b></span><span>Shortlist confidence: <b>{benchmarkOutput.recommendation.model_selection_confidence}</b></span></div></div>
          <p className="recommendation-boundary">This shortlist recommends what to test, not what to deploy. Customer evaluations outweigh public benchmarks once at least three reviewed examples exist.</p>
          <div className="candidate-list">{benchmarkOutput.candidate_models.map((candidate,index)=><article className="candidate-card" key={candidate.model_id}>
            <div className="candidate-title"><span>{index+1}</span><b>{candidate.model_name}</b><strong>{pct(candidate.candidate_score*100)} evidence fit</strong></div>
            <p><b>Why it matches:</b> {candidate.why_match}</p>
            <div className="candidate-source-grid">
              <section><small>Public benchmarks</small>{candidate.benchmark_evidence.length?candidate.benchmark_evidence.slice(0,3).map(evidence=>{const benchmark=family(evidence.benchmark_id);return <div key={`${candidate.model_id}-${evidence.benchmark_id}`}><b>{benchmark?.name??evidence.benchmark_id}</b><span>{evidence.score_type??"unverified"}{evidence.rank?` directional rank ${evidence.rank}`:evidence.score!==undefined?` score ${evidence.score}`:""}</span><em>{benchmark?.benchmark_version??"Version not recorded"} · {evidence.configuration??benchmark?.configuration??"Configuration not recorded"}</em><a href={evidence.source_url??benchmark?.source_url} target="_blank" rel="noreferrer">Source · {evidence.score_date??benchmark?.freshness_date??"date unavailable"}</a></div>}):<p>No directly relevant public model result is recorded.</p>}</section>
              <section><small>Customer evaluations</small>{candidate.customer_evaluation?<div><b>{pct(candidate.customer_evaluation.pass_rate*100)} pass rate</b><span>{candidate.customer_evaluation.sample_size} independently reviewed examples · {pct(candidate.customer_evaluation.average_score*100)} average score</span><em>Measured {new Date(candidate.customer_evaluation.evaluated_at).toLocaleDateString()}</em></div>:<p>No customer evaluation evidence for this model and task yet.</p>}</section>
              <section><small>Cross-customer adoption</small>{candidate.adoption_evidence?<div><b>{candidate.adoption_evidence.independent_organizations} independent organizations</b><span>{candidate.adoption_evidence.explicit_approvals} explicit approvals · {candidate.adoption_evidence.default_selections} defaults</span><em>Adoption evidence only; not proof of quality.</em></div>:<p>No verified adoption evidence is connected. Defaults are not counted as deliberate approvals.</p>}</section>
            </div>
            <p className="candidate-limit"><b>Limitations:</b> {candidate.caveats.join(" ")}</p>
          </article>)}</div>
        </section>
        <section><h3>Cost, token, and latency summary</h3><div className="task-metrics"><div><small>Total cost</small><b>{money(bucket.total_cost_usd)}</b></div><div><small>Total tokens</small><b>{bucket.total_tokens.toLocaleString()}</b></div><div><small>Avg input</small><b>{bucket.avg_input_tokens.toFixed(0)}</b></div><div><small>Avg output</small><b>{bucket.avg_output_tokens.toFixed(0)}</b></div><div><small>Avg latency</small><b>{bucket.avg_latency_ms?.toFixed(0)}ms</b></div><div><small>Low confidence</small><b>{bucket.low_confidence_count}</b></div></div></section>
        <section className="eval-plan"><h3>{plan.plan_name}</h3><div className="eval-plan-meta"><span>Human review: <b>{plan.human_review_required?"Required":"Not required"}</b></span><span>Minimum sample: <b>{plan.minimum_sample_size}</b></span><span>Plan confidence: <b>{pct(plan.confidence*100)}</b></span></div>{groups.map(([label,evals])=><div className="eval-group" key={label}><h4>{label} evals</h4>{evals.map(item=><div key={item.eval_type}><b>{item.eval_type.replaceAll("_"," ")}</b><span>{item.reason}</span></div>)}</div>)}<div className="readiness-rule"><small>Route readiness rule</small><code>{plan.route_readiness_rule}</code></div>{plan.notes.map(note=><p key={note}>{note}</p>)}</section>
      </div>
    </aside>
  </div>;
  return createPortal(drawer,document.body);
}
