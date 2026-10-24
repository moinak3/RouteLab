import type { RoutingPolicy } from "../types";
import { formatCurrency, formatPercent } from "../lib/format";

export function ScriptAutomation({ policy }: { policy: RoutingPolicy }) {
  const recommendations = policy.script_automation_recommendations ?? [];
  return <div><p className="scope-note">Experimental. Validate generated scripts in a sandbox before replacing any model call.</p><section className="panel"><div className="panelhead"><div><p className="eyebrow">Script automation</p><h2>Replace deterministic tool paths with code</h2><p>These clusters have more than 90% identical tool-call signatures with no observed reasoning-driven branch change.</p></div></div><div className="cards recommendations-grid">{recommendations.map((item)=><article className="cluster-card" key={item.id}><h3>{item.cluster_name}</h3><p>{item.rationale}</p><dl><div><dt>Pattern match</dt><dd>{formatPercent(item.pattern_match_pct,item.instance_count)}</dd></div><div><dt>Sessions</dt><dd>{item.instance_count.toLocaleString()}</dd></div><div><dt>Monthly savings</dt><dd>{formatCurrency(item.projected_monthly_savings_usd)}</dd></div></dl><pre>{item.script_stub}</pre><button onClick={()=>void navigator.clipboard?.writeText(item.script_stub)}>Copy TypeScript</button></article>)}</div></section></div>;
}
