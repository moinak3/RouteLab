import { exportLiteLlm, exportOpenRouterConfig, exportPolicyJson, exportTypeScript, recommendPolicy } from "../core/recommendations";
import type { Model } from "../types";
import { download, formatLatency, money, pct } from "../lib/format";

type RecommendationPolicy = ReturnType<typeof recommendPolicy>;

function Comparison({ comparison }: { comparison: NonNullable<RecommendationPolicy["rules"][number]["comparison"]> }) {
  const rows = [
    { label: "Cost", before: money(comparison.cost.before), after: money(comparison.cost.after), delta: comparison.cost.delta_pct },
    { label: "Latency", before: formatLatency(comparison.latency_ms.before), after: formatLatency(comparison.latency_ms.after), delta: comparison.latency_ms.delta_pct },
    { label: "Quality", before: pct(comparison.quality.before * 100), after: pct(comparison.quality.after * 100), delta: comparison.quality.delta_pct },
  ];
  return <div className="comparison">
    <div className="comparison-head"><span>Projected impact</span><small>Before</small><small>After</small><small>Change</small></div>
    {rows.map((row) => <div className="comparison-row" key={row.label}>
      <b>{row.label}</b><span>{row.before}</span><strong>{row.after}</strong>
      <em className={row.delta <= 0 && row.label !== "Quality" || row.delta >= 0 && row.label === "Quality" ? "good" : "warn"}>{row.delta > 0 ? "+" : ""}{pct(row.delta)}</em>
    </div>)}
  </div>;
}

function routeLabel(modelId: string, provider?: string, models: Model[] = []) {
  const model = models.find((item) => item.id === modelId);
  return `${model?.display_name ?? modelId}${provider ? ` via ${provider}` : ""}`;
}

function copyAndDownload(name: string, content: string) {
  void navigator.clipboard?.writeText(content).catch(() => undefined);
  download(name, content);
}

export function Recommendations({ policy, activeModels, traceCount }: { policy: RecommendationPolicy; activeModels: Model[]; traceCount: number }) {
  if (!activeModels.length) {
    return <section className="panel"><p className="eyebrow">Task routing</p><h2>No enabled models</h2><p>Enable at least one model in Model Catalog before generating recommendations.</p></section>;
  }
  return <div className="recommendations-page">
    <section className="recommendation-controls panel">
      <div>
        <p className="eyebrow">DeepSeek discovery routing <span className="sponsored-badge">Sponsored evaluation</span></p>
        <h2>Recommendation for you</h2>
        <span className="recommendation-intro">We&apos;ve run your {traceCount.toLocaleString()} traces through DeepSeek models at no cost to you. Here are RouteLab&apos;s recommendations for where DeepSeek can reduce cost while preserving quality and latency guardrails.</span>
        <small className="neutrality-note">Sponsored candidates are scored by the same calibrated evals and guardrails as every other model. Recommendations are ranked on evidence, not sponsorship.</small>
      </div>
    </section>
    <section className="hero recommendation">
      <div>
        <p className="eyebrow">Recommended guardrail-approved policy savings</p>
        <strong>{money(policy.estimated_monthly_savings_usd)}<small>/mo</small></strong>
        <p>Projected from a {traceCount.toLocaleString()}-trace sample representing about 40 million monthly calls. {policy.risk_summary}</p>
      </div>
      <div className="export">
        <button onClick={() => copyAndDownload("routelab-policy.json", exportPolicyJson(policy))}>Export JSON</button>
        <button onClick={() => copyAndDownload("openrouter-config.json", exportOpenRouterConfig(policy))}>OpenRouter config</button>
        <button onClick={() => copyAndDownload("litellm.yaml", exportLiteLlm(policy))}>LiteLLM config</button>
        <button onClick={() => copyAndDownload("router.ts", exportTypeScript(policy))}>TypeScript stub</button>
      </div>
    </section>
    <div className="policy-note">
      <b>Monthly savings by task</b>
      <span>{policy.candidate_model_ids.length} candidate model{policy.candidate_model_ids.length === 1 ? "" : "s"} evaluated across at least five inference providers each. Each card shows the winning model-provider pair, estimated cost, and latency.</span>
    </div>
    <div className="cards recommendations-grid">
      {policy.rules.map((rule) => <article className="cluster-card rule" key={rule.id}>
        <div><span className={`risk ${rule.match.risk_level}`}>{rule.match.risk_level} risk</span><span className="strategy">{rule.strategy.type.replace("_", " ")}</span></div>
        <div className="rule-title">
          <h2>{rule.name}</h2>
          <div className={rule.estimated_monthly_savings_usd > 0 ? "monthly-saving" : "monthly-saving zero"}><small>Recommended monthly savings</small><b>{money(rule.estimated_monthly_savings_usd)}</b></div>
        </div>
        <p>{rule.rationale}</p>
        {rule.provider_quote && <div className="provider-choice">
          <span>Recommended route</span>
          <b>{routeLabel(rule.provider_quote.model_id, rule.provider_quote.provider_name, activeModels)}</b>
          <small>{money(rule.comparison?.cost.after ?? 0)} sample cost · {formatLatency(rule.comparison?.latency_ms.after ?? 0)} estimated latency · {rule.provider_quotes_evaluated?.length ?? 0} provider quotes checked</small>
        </div>}
        {rule.comparison && <Comparison comparison={rule.comparison} />}
        {rule.strategy.type === "keep_current" && <div className="provider-choice">
          <span>Evidence summary</span>
          <b>Keep current model</b>
          <small>{rule.provider_quotes_evaluated?.length ?? 0} provider quotes evaluated. Guardrail blocked route changes because quality, latency, risk, or tool-recovery evidence was insufficient.</small>
        </div>}
        {rule.rejected_alternative && <div className="rejected-alternative">
          <div><span>Rejected alternative</span><b>{routeLabel(rule.rejected_alternative.model, rule.rejected_alternative.provider, activeModels)}</b><strong className="rejected-saving">Potential savings {money(rule.rejected_alternative.potential_monthly_savings_usd)}/mo</strong></div>
          <p>{rule.rejected_alternative.reason}</p>
          <Comparison comparison={rule.rejected_alternative.comparison} />
        </div>}
        {rule.strategy.type === "cascade" && <div className="route"><b>{routeLabel(rule.strategy.primary_model, rule.strategy.primary_provider, activeModels)}</b><span>evaluate {"->"} fallback</span><b>{routeLabel(rule.strategy.fallback_model, rule.strategy.fallback_provider, activeModels)}</b></div>}
        {rule.strategy.type === "direct" && <div className="route"><span>Route directly to</span><b>{routeLabel(rule.strategy.model, rule.strategy.provider, activeModels)}</b></div>}
      </article>)}
    </div>
  </div>;
}
