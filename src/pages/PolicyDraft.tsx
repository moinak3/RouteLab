import { modelCatalog } from "../core/catalog";
import { reviseDraftRoutingPolicy } from "../core/routingDraft";
import { useRoutingPolicyDraft } from "../core/useRoutingPolicyDraft";
import type { DistinctTaskBucket } from "../types";
import { RoutingPolicyPublisher } from "../components/RoutingPolicyPublisher";
import { formatPercent } from "../lib/format";

export function PolicyDraft({ tasks }: { tasks: DistinctTaskBucket[] }) {
  const { draftPolicy, setDraftPolicy, status, retryMyDraft, useServerDraft } = useRoutingPolicyDraft("gpt-5.5-pro");
  const fallback = modelCatalog.find((model) => model.id === draftPolicy.fallbackModelId);
  const overrides = Object.values(draftPolicy.overrides);
  return <div className="policy-draft-page">
    <section className="panel routing-policy-builder">
      <div className="panelhead"><div><p className="eyebrow">Policy draft</p><h2>Set the fallback, then approve task overrides</h2><p>Overrides are eligible only when the candidate's Wilson 95% lower bound clears the quality bar and both cost and latency guardrails pass.</p></div><div className={`policy-save-state ${status.state}`}><span>Draft v{draftPolicy.version} · {status.state}</span>{status.state === "conflict" && <div><button onClick={retryMyDraft}>Keep my changes</button><button onClick={useServerDraft}>Use cloud draft</button></div>}</div></div>
      <div className="routing-policy-controls">
        <label><small>Fallback model</small><select value={draftPolicy.fallbackModelId} onChange={(event)=>setDraftPolicy((policy)=>reviseDraftRoutingPolicy(policy,{fallbackModelId:event.target.value}))}>{modelCatalog.map((model)=><option value={model.id} key={model.id}>{model.display_name}</option>)}</select><em>Used for unknown, uncertain and unapproved tasks.</em></label>
        <label><small>Quality bar</small><div className="policy-threshold"><input type="number" min="0" max="100" value={Math.round(draftPolicy.minimumPassRate*100)} onChange={(event)=>setDraftPolicy((policy)=>reviseDraftRoutingPolicy(policy,{minimumPassRate:Number(event.target.value)/100}))}/><span>%</span></div><em>Minimum lower-bound pass rate for an override.</em></label>
        <label><small>Latency guardrail</small><div className="policy-threshold"><input type="number" min="0" value={draftPolicy.maximumLatencyIncreasePct} onChange={(event)=>setDraftPolicy((policy)=>reviseDraftRoutingPolicy(policy,{maximumLatencyIncreasePct:Number(event.target.value)}))}/><span>%</span></div><em>Maximum allowed latency increase.</em></label>
      </div>
      <div className="policy-flow"><div><small>Fallback</small><b>{fallback?.display_name ?? draftPolicy.fallbackModelId}</b><span>Default for every request</span></div><i>except</i><div><small>Active overrides</small><b>{overrides.length}</b><span>Approved from measured simulations</span></div></div>
      <div className="policy-overrides"><h3>Current overrides</h3>{overrides.length ? overrides.map((override)=><article key={override.taskId}><div><small>{override.taskName}</small><b>{override.modelName}</b></div><p>{formatPercent(override.passRate*100,override.replayCount)} pass · {override.replayCount.toLocaleString()} replays</p></article>) : <p>No overrides are active. Run a simulation and promote an eligible result.</p>}</div>
      <RoutingPolicyPublisher signatures={tasks.map((task)=>({id:task.bucket_id,label:task.bucket_name,description:`${task.task.task_type} in ${task.task.domain}`,riskLevel:task.risk_level}))} draftRevision={status.revision} draftSaved={status.state==="saved"}/>
    </section>
  </div>;
}
