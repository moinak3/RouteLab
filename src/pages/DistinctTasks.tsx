import { useMemo, useState } from "react";
import { createDistinctTaskBuckets } from "../core/distinctTasks";
import { generateEvalPlans } from "../core/evalPlans";
import type { DistinctTaskBucket, EvalPlan, Trace } from "../types";
import { compareText, formatInteger, formatLatency, money, pct } from "../lib/format";
import { DistinctTaskHelp, distinctTaskFieldColumns, distinctTaskValue } from "../components/DistinctTaskDisplay";
import { labelFor } from "../lib/labels";

export function DistinctTasks({ traces }: { traces: Trace[] }) {
  const buckets = useMemo(() => createDistinctTaskBuckets(traces), [traces]);
  const plans = useMemo(() => generateEvalPlans(buckets), [buckets]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sortedBuckets = useMemo(() => [...buckets].sort((left, right) => right.trace_count - left.trace_count || compareText(left.bucket_name, right.bucket_name)), [buckets]);
  const selected = buckets.find((bucket) => bucket.bucket_id === selectedId) ?? null;
  const plan = selected ? plans.get(selected.bucket_id) : undefined;
  const classified = traces.filter((trace) => trace.signature_decision);
  const matched = classified.filter((trace) => trace.signature_decision?.routing_action === "signature_route").length;
  const unknown = classified.filter((trace) => trace.signature_decision?.status === "unknown").length;

  return <>
    <section className="task-intro panel distinct-task-explainer">
      <div><p className="eyebrow">Task classification</p><h2>Traces become tasks</h2><p>RouteLab classifies every new trace against your known tasks, plus an explicit Unknown. Confident matches can use a task override. Anything uncertain, slow or failed uses the fallback model.</p><p>The confidence threshold is stricter for higher-risk work and should be calibrated against your golden dataset before production routing.</p></div>
      <div><strong>{formatInteger(buckets.length)}</strong><span>tasks</span></div>
    </section>
    {classified.length > 0 && <section className="panel jev-gate-summary" aria-label="Classification summary">
      <div><small>Classified</small><b>{formatInteger(classified.length)}</b></div>
      <div><small>Task overrides</small><b>{formatInteger(matched)}</b></div>
      <div><small>Fallback</small><b>{formatInteger(classified.length - matched)}</b></div>
      <div><small>Unknown</small><b>{formatInteger(unknown)}</b></div>
    </section>}
    <section className="panel task-table-panel">
      <div className="panelhead"><div><p className="eyebrow">Task inventory</p><h2>Known tasks</h2></div><span>{formatInteger(traces.length)} traces classified</span></div>
      <div className="tablewrap"><table className="task-table compact-task-table">
        <thead><tr><th>Task</th><th>Risk</th><th>Traces</th><th>Sample cost</th><th>Confidence</th><th>Eval readiness</th></tr></thead>
        <tbody>{sortedBuckets.map((bucket) => <tr className="task-row" key={bucket.bucket_id} tabIndex={0} onClick={() => setSelectedId(bucket.bucket_id)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedId(bucket.bucket_id); }}>
          <td><b>{bucket.bucket_name}</b><small className="mono-id">{bucket.bucket_id}</small></td>
          <td><span className={`risk ${bucket.risk_level}`}>{labelFor(bucket.risk_level)}</span></td>
          <td>{formatInteger(bucket.trace_count)}</td>
          <td>{money(bucket.total_cost_usd)}</td>
          <td>{pct(bucket.avg_confidence * 100, bucket.trace_count)}</td>
          <td><span className="eval-ready">Ready</span></td>
        </tr>)}</tbody>
      </table></div>
    </section>
    {selected && plan && <TaskDetail bucket={selected} plan={plan} onClose={() => setSelectedId(null)} />}
  </>;
}

function TaskDetail({ bucket, plan, onClose }: { bucket: DistinctTaskBucket; plan: EvalPlan; onClose: () => void }) {
  const groups = [["Required", plan.required_evals], ["Recommended", plan.recommended_evals], ["Optional", plan.optional_evals]] as const;
  return <div className="task-detail-layer" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="task-detail" role="dialog" aria-modal="true" aria-label="Task detail">
      <div className="task-detail-head"><div><p className="eyebrow">Task</p><h2>{bucket.bucket_name}</h2><span className="mono-id">{bucket.bucket_id} · {formatInteger(bucket.trace_count)} traces</span></div><button aria-label="Close task detail" onClick={onClose}>×</button></div>
      <div className="task-detail-body">
        <section><div className="task-actions"><button>Confirm task</button><button>Edit task</button><button>Split task</button><button>Create eval set</button><button className="primary">Run simulation</button></div><h3>Classifier attributes</h3><div className="task-summary">{distinctTaskFieldColumns.map(({ field, label }) => <div key={field}><small><DistinctTaskHelp field={field} label={label} /></small><b>{distinctTaskValue(field, bucket.task[field])}</b></div>)}</div></section>
        <section><h3>Evidence</h3><div className="evidence-list">{Object.entries(bucket.evidence).map(([field, evidence]) => <div key={field}><b>{labelFor(field)}</b><span>{evidence.join(" · ")}</span></div>)}</div></section>
        <section><h3>Examples</h3>{bucket.examples.map((example) => <article className="task-example" key={example.trace_id}><b className="mono-id">{example.trace_id}</b><p>{example.prompt_preview}</p><small>{example.response_preview}</small></article>)}</section>
        <section><h3>Sample metrics</h3><div className="task-metrics"><div><small>Total cost</small><b>{money(bucket.total_cost_usd)}</b></div><div><small>Total tokens</small><b>{formatInteger(bucket.total_tokens)}</b></div><div><small>Average input</small><b>{formatInteger(bucket.avg_input_tokens)}</b></div><div><small>Average output</small><b>{formatInteger(bucket.avg_output_tokens)}</b></div><div><small>Average latency</small><b>{formatLatency(bucket.avg_latency_ms ?? 0)}</b></div><div><small>Low confidence</small><b>{formatInteger(bucket.low_confidence_count)}</b></div></div></section>
        <section className="eval-plan"><h3>{plan.plan_name}</h3><div className="eval-plan-meta"><span>Human review: <b>{plan.human_review_required ? "Required" : "Not required"}</b></span><span>Minimum sample: <b>{formatInteger(plan.minimum_sample_size)}</b></span><span>Plan confidence: <b>{pct(plan.confidence * 100)}</b></span></div>{groups.map(([label, evals]) => <div className="eval-group" key={label}><h4>{label} evals</h4>{evals.map((item) => <div key={item.eval_type}><b>{labelFor(item.eval_type)}</b><span>{item.reason}</span></div>)}</div>)}</section>
      </div>
    </aside>
  </div>;
}
