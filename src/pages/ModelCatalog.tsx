import { useState } from "react";
import { benchmarkFamilies, modelBenchmarkScores } from "../core/benchmarkPriors";
import { isModelEnabled, modelCatalog, modelFamilies } from "../core/catalog";
import type { GatewayProvider, Model, ModelBenchmarkScore } from "../types";
import { FamilyLogo } from "../components/FamilyLogo";

const benchmarkFamilyById = new Map(benchmarkFamilies.map((family) => [family.id, family]));
const benchmarkScoresByModel = modelBenchmarkScores.reduce((scores, score) => {
  const existing = scores.get(score.model_id) ?? [];
  existing.push(score);
  scores.set(score.model_id, existing);
  return scores;
}, new Map<string, ModelBenchmarkScore[]>());
const benchmarkDisplayOrder = ["swe_bench_verified", "tau_bench", "terminal_bench", "bfcl", "webarena_webvoyager", "osworld", "expert_reasoning", "math_reasoning", "long_context", "custom_signaleval"];
const modelBenchmarks = (modelId: string) => [...(benchmarkScoresByModel.get(modelId) ?? [])]
  .sort((a, b) => {
    const orderDelta = benchmarkDisplayOrder.indexOf(a.benchmark_id) - benchmarkDisplayOrder.indexOf(b.benchmark_id);
    return orderDelta || (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
  })
  .slice(0, 6);
const scoreLabel = (score: ModelBenchmarkScore) => score.rank ? `#${score.rank}` : score.score !== undefined ? `${score.score > 1 ? score.score.toFixed(1) : (score.score * 100).toFixed(1)}%` : "Signal";
const scoreMeta = (score: ModelBenchmarkScore) => [
  score.score_type?.replace("_", " "),
  score.score_date,
  `confidence ${score.confidence}/5`,
].filter(Boolean).join(" · ");

export function ModelCatalog({catalogVersion,familyApiKeys,gatewayApiKeys,onFamilyApiKey,onGatewayApiKey,onModelEnabled,onFamilyEnabled,onPricing}:{catalogVersion:number;familyApiKeys:Partial<Record<Model["family"],string>>;gatewayApiKeys:Partial<Record<GatewayProvider,string>>;onFamilyApiKey:(family:Model["family"],key:string)=>void;onGatewayApiKey:(gateway:GatewayProvider,key:string)=>void;onModelEnabled:(id:string,enabled:boolean)=>void;onFamilyEnabled:(family:Model["family"],enabled:boolean)=>void;onPricing:(id:string,input:number,output:number)=>void}) {
  void catalogVersion;
  const [apiKeyTarget,setApiKeyTarget]=useState<{type:"family";id:Model["family"]}|{type:"gateway";id:GatewayProvider}|null>(null);
  const [apiKeyDraft,setApiKeyDraft]=useState("");
  const openFamilyApiKeyModal=(family:Model["family"])=>{setApiKeyTarget({type:"family",id:family});setApiKeyDraft(familyApiKeys[family]??"")};
  const openGatewayApiKeyModal=(gateway:GatewayProvider)=>{setApiKeyTarget({type:"gateway",id:gateway});setApiKeyDraft(gatewayApiKeys[gateway]??"")};
  const closeApiKeyModal=()=>{setApiKeyTarget(null);setApiKeyDraft("")};
  const saveApiKey=()=>{if(!apiKeyTarget)return;if(apiKeyTarget.type==="family")onFamilyApiKey(apiKeyTarget.id,apiKeyDraft);else onGatewayApiKey(apiKeyTarget.id,apiKeyDraft);closeApiKeyModal()};
  const modalName=apiKeyTarget?.id;
  const modalEyebrow=apiKeyTarget?.type==="gateway"?"Gateway key":"Live simulation key";
  const modalCopy=apiKeyTarget?.type==="gateway"?"Stored locally in this session and used when simulations or exports route through this gateway.":"Stored locally in this session and used only when live simulations are enabled for this family.";
  const openRouterConfigured=Boolean(gatewayApiKeys.OpenRouter);
  return <div className="model-catalog-page"><section className="gateway-keys panel"><div><p className="eyebrow">Gateway keys</p><h2>OpenRouter</h2><span>Use one gateway key for models routed through OpenRouter.</span></div><button type="button" className={`api-key-button ${openRouterConfigured?"configured":""}`} aria-label="OpenRouter API key settings" title={openRouterConfigured?"API key configured":"Add OpenRouter API key"} onClick={()=>openGatewayApiKeyModal("OpenRouter")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 10a4 4 0 1 1-1.2-2.8L22 7v4h-3v3h-3v3h-4l-2.1-2.1A4 4 0 0 1 14 10Zm-8 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" /></svg><span>{openRouterConfigured?"Configured":"API key"}</span></button></section>{modelFamilies.map(family=>{
    const familyModels=modelCatalog.filter(model=>model.family===family);
    const enabledCount=familyModels.filter(isModelEnabled).length;
    const familyEnabled=enabledCount===familyModels.length;
    const apiKeyConfigured=Boolean(familyApiKeys[family]);
    return <section className="catalog-family" key={family}><div className="panelhead"><div className="family-head"><span className={`family-logo ${family.toLowerCase()}`}><FamilyLogo family={family} /></span><div><p className="eyebrow">Model family</p><h2>{family}</h2></div><button type="button" className={`api-key-button ${apiKeyConfigured?"configured":""}`} aria-label={`${family} API key settings`} title={family==="Local"?"Local models do not need an API key":apiKeyConfigured?"API key configured":"Add API key"} disabled={family==="Local"} onClick={()=>openFamilyApiKeyModal(family)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 10a4 4 0 1 1-1.2-2.8L22 7v4h-3v3h-3v3h-4l-2.1-2.1A4 4 0 0 1 14 10Zm-8 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" /></svg><span>{apiKeyConfigured?"Configured":"API key"}</span></button></div><label className="toggle-control"><input type="checkbox" checked={familyEnabled} onChange={event=>onFamilyEnabled(family,event.target.checked)} /><span className="switch-track" aria-hidden="true"><i /></span><span>{enabledCount}/{familyModels.length} enabled</span></label></div><div className="cards">{familyModels.map(model=>{
      const enabled=isModelEnabled(model);
      const benchmarks=modelBenchmarks(model.id);
      return <article className={`cluster-card model ${enabled?"":"disabled"}`} key={model.id}><div><span className="provider">{model.family_tier}</span><label className="toggle-control small"><input type="checkbox" checked={enabled} onChange={event=>onModelEnabled(model.id,event.target.checked)} /><span className="switch-track" aria-hidden="true"><i /></span><span>{enabled?"On":"Off"}</span></label></div><h2>{model.display_name}</h2><code>{model.id}</code><small className="pricing-source">{model.pricing_source}{model.pricing_source_model_id?` pricing: ${model.pricing_source_model_id}`:""}{model.pricing_updated_at?` · refreshed ${model.pricing_updated_at}`:""}</small><div className="pricing-editor compact"><label>Input / 1M tokens<input aria-label={`${model.display_name} input cost per 1M tokens`} type="number" min="0" step=".001" value={model.input_cost_per_1m} onChange={event=>onPricing(model.id,Number(event.target.value),model.output_cost_per_1m)} /></label><label>Output / 1M tokens<input aria-label={`${model.display_name} output cost per 1M tokens`} type="number" min="0" step=".001" value={model.output_cost_per_1m} onChange={event=>onPricing(model.id,model.input_cost_per_1m,Number(event.target.value))} /></label></div><dl><div><dt>Status</dt><dd>{enabled?"Considered":"Excluded"}</dd></div><div><dt>Default latency</dt><dd>{model.default_latency_ms}ms</dd></div><div><dt>Quality</dt><dd>{model.quality_tier}</dd></div></dl><details className="model-benchmarks"><summary><span>Benchmark performance</span><strong>{benchmarks.length?`${benchmarks.length} signals`:"No signals"}</strong></summary>{benchmarks.length?<div className="benchmark-score-list">{benchmarks.map(score=>{const family=benchmarkFamilyById.get(score.benchmark_id);return <div className="benchmark-score" key={`${score.model_id}-${score.benchmark_id}`}><div><b>{family?.name??score.benchmark_id.replaceAll("_"," ")}</b><span>{family?.description??"Public benchmark evidence"}</span></div><strong>{scoreLabel(score)}</strong><small>{scoreMeta(score)}{score.source_url&&<> · <a href={score.source_url} target="_blank" rel="noreferrer">source</a></>}</small></div>})}</div>:<p>No benchmark evidence is available for this model yet.</p>}</details></article>;
    })}</div></section>;
  })}{apiKeyTarget&&modalName&&<div className="key-modal-layer" role="presentation" onClick={event=>{if(event.target===event.currentTarget)closeApiKeyModal()}}><section className="key-modal" role="dialog" aria-modal="true" aria-label={`${modalName} API key`}><div><p className="eyebrow">{modalEyebrow}</p><h2>{modalName} API key</h2><p>{modalCopy}</p></div><label>API key<input autoFocus type="password" autoComplete="off" value={apiKeyDraft} placeholder={`Paste ${modalName} API key`} onChange={event=>setApiKeyDraft(event.target.value)} /></label><div className="key-modal-actions"><button type="button" onClick={closeApiKeyModal}>Cancel</button><button type="button" className="primary" onClick={saveApiKey}>Save key</button></div></section></div>}</div>;
}
