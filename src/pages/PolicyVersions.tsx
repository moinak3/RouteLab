import { RoutingPolicyPublisher } from "../components/RoutingPolicyPublisher";
import { useRoutingPolicyDraft } from "../core/useRoutingPolicyDraft";
import type { DistinctTaskBucket } from "../types";

export function PolicyVersions({ tasks }: { tasks: DistinctTaskBucket[] }) {
  const { status } = useRoutingPolicyDraft("gpt-5.5-pro", { readOnly: true });
  return <section className="panel"><div className="panelhead"><div><p className="eyebrow">Policy versions</p><h2>Published and saved versions</h2><p>Published versions are immutable. Activate a signed version or roll back to a prior one without changing the draft.</p></div></div><RoutingPolicyPublisher signatures={tasks.map((task)=>({id:task.bucket_id,label:task.bucket_name,description:`${task.task.task_type} in ${task.task.domain}`,riskLevel:task.risk_level}))} draftRevision={status.revision} draftSaved={status.state==="saved"}/></section>;
}
