import { useEffect, useState, type FormEvent } from "react";
import type { Trace, TraceJudgeResult } from "../types";
import { pct } from "../lib/format";
import type { ReviewQueueFilter } from "../types/ui";

const seededActiveEvalDefinition = {
  id: "trace_quality_llm_judge",
  name: "Trace quality LLM judge",
  status: "Running",
  evaluator_type: "llm_as_judge",
  model: "gpt-5.5-pro",
  threshold: .85,
  prompt: `You are the Trace Quality LLM Judge for customer support agent traces.

Evaluate the agent response against the user prompt, available context, policies, tool results, and expected task requirements.

Return a score of 1.0, 0.5, or 0.0 and a concise rationale.

Score 1.0 only when the response fully resolves the support request, includes all required facts or fields, follows grounding and policy requirements, uses the requested format, and introduces no material safety, privacy, legal, billing, or account-access risk.

Score 0.5 when the response is directionally useful but incomplete, vague, missing an important requested detail, weakly grounded, or needs human follow-up before use, while avoiding critical policy or safety errors.

Score 0.0 when the response fails the task, answers the wrong request, omits core required information, contradicts context or policy, produces unusable structured output, or creates high-risk customer harm.

Inputs:
- User prompt
- Agent response
- Trace metadata
- Retrieved context, policy text, or tool results when present

Output JSON:
{"score":1|0.5|0,"passed":boolean,"rationale":"short reason","severity":"minor|major|critical|null"}`,
  dimensions: [
    "Prompt intent and requested task",
    "Agent response completeness",
    "Required factual details",
    "Policy or safety risk",
    "Severity of missing or incorrect answer",
    "Pass/fail score threshold",
  ],
};

type EvalDefinition = typeof seededActiveEvalDefinition & { scope: string };
type EvalVersion = {
  version: number;
  createdAt: string;
  definition: EvalDefinition;
};

export function appendEvalVersion(versions: EvalVersion[], definition: EvalDefinition, createdAt = new Date().toISOString()): EvalVersion[] {
  const nextVersion = Math.max(0, ...versions.map((item) => item.version)) + 1;
  return [...versions, { version: nextVersion, createdAt, definition }];
}

const seededEvalDefinitions: EvalDefinition[] = [
  { ...seededActiveEvalDefinition, scope: "All task groups" },
  {
    id: "policy_compliance_check",
    name: "Policy compliance check",
    status: "Running",
    evaluator_type: "deterministic_rule_check",
    model: "none",
    threshold: 1,
    prompt: "Rule-based evaluator rejects refund promises before verification, password disclosure requests, public data sharing, and unsupported SLA credit commitments.",
    dimensions: ["Refund approval language", "Account access policy", "Data handling policy", "SLA eligibility constraints"],
    scope: "Policy compliance review, refund and billing dispute resolution, account security verification",
  },
  {
    id: "factual_grounding_judge",
    name: "Factual grounding judge",
    status: "Running",
    evaluator_type: "llm_as_judge",
    model: "gpt-5.5-pro",
    threshold: .9,
    prompt: "Score whether the answer is supported by retrieved context and cites the correct source for RAG-grounded support answers.",
    dimensions: ["Retrieved context support", "Citation correctness", "Unsupported claim detection"],
    scope: "RAG-grounded policy answers",
  },
  {
    id: "tool_call_validity",
    name: "Tool call validity",
    status: "Running",
    evaluator_type: "schema_check",
    model: "none",
    threshold: 1,
    prompt: "Validate tool output schema, required arguments, tool success state, and whether the final answer reflects the returned tool data.",
    dimensions: ["Tool arguments", "Tool status", "Schema validity", "Final answer consistency"],
    scope: "Order status lookup, account security verification",
  },
];

const EVAL_VERSIONS_STORAGE_KEY="routelab-eval-versions-v1";
const ACTIVE_EVAL_VERSION_STORAGE_KEY="routelab-active-eval-version-v1";
const seededEvalVersions: EvalVersion[]=[{version:1,createdAt:"2026-10-01T17:00:00.000Z",definition:seededEvalDefinitions[0]}];

function loadEvalVersions() {
  try {
    const parsed=JSON.parse(window.localStorage.getItem(EVAL_VERSIONS_STORAGE_KEY)??"null") as EvalVersion[]|null;
    if(Array.isArray(parsed)&&parsed.length&&parsed.every(item=>Number.isInteger(item?.version)&&typeof item?.createdAt==="string"&&typeof item?.definition?.id==="string")) return parsed;
  } catch { /* Start from the bundled definition when local history is unavailable. */ }
  return seededEvalVersions;
}

function loadActiveEvalVersion() {
  try {
    const parsed=Number(window.localStorage.getItem(ACTIVE_EVAL_VERSION_STORAGE_KEY));
    if(Number.isInteger(parsed)&&parsed>0)return parsed;
  } catch { /* Start from the bundled definition when local history is unavailable. */ }
  return 1;
}

const monthLabel = (date: Date) => date.toLocaleString("en-US", { month: "short" });

function monthlyEvalHistory(results: TraceJudgeResult[]) {
  const buckets = new Map<string, { label: string; count: number; scoreSum: number; passing: number }>();

  for (const result of results) {
    const date = new Date(result.created_at);
    if (Number.isNaN(date.getTime())) continue;

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key) ?? { label: monthLabel(date), count: 0, scoreSum: 0, passing: 0 };
    bucket.count += 1;
    bucket.scoreSum += result.score;
    bucket.passing += result.passed ? 1 : 0;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      count: bucket.count,
      passing: bucket.passing,
      failing: bucket.count - bucket.passing,
      averageScore: bucket.count ? bucket.scoreSum / bucket.count : 0,
      passRate: bucket.count ? bucket.passing / bucket.count : 0,
    }));
}

const evalChart = { width: 640, height: 240, left: 38, right: 26, top: 24, bottom: 42 };
const chartPoint = (index: number, total: number, score: number) => {
  const plotWidth = evalChart.width - evalChart.left - evalChart.right;
  const plotHeight = evalChart.height - evalChart.top - evalChart.bottom;
  const x = total <= 1 ? evalChart.left + plotWidth / 2 : evalChart.left + index * (plotWidth / (total - 1));
  const y = evalChart.top + (1 - Math.max(0, Math.min(1, score))) * plotHeight;
  return { x, y };
};

export function Evals({
  traces,
  traceJudgeResults,
  onReviewFilter,
}: {
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  onReviewFilter: (filter: ReviewQueueFilter) => void;
}) {
  const passing = traceJudgeResults.filter((result) => result.passed).length;
  const failing = traceJudgeResults.length - passing;
  const averageScore = traceJudgeResults.length ? traceJudgeResults.reduce((sum, result) => sum + result.score, 0) / traceJudgeResults.length : 0;
  const history = monthlyEvalHistory(traceJudgeResults);
  const historyPoints = history.map((month, index) => ({ ...month, ...chartPoint(index, history.length, month.averageScore) }));
  const historyLine = historyPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const [evalDefinitions,setEvalDefinitions]=useState<EvalDefinition[]>(seededEvalDefinitions);
  const [evalVersions,setEvalVersions]=useState<EvalVersion[]>(loadEvalVersions);
  const [activeEvalVersion,setActiveEvalVersion]=useState(loadActiveEvalVersion);
  const activeVersion=evalVersions.find(item=>item.version===activeEvalVersion)??evalVersions[evalVersions.length-1];
  const activeEvalDefinition=activeVersion.definition;
  const [modal,setModal]=useState<"import"|"create"|"edit"|"versions"|null>(null);
  const [draft,setDraft]=useState({name:"",evaluator_type:"llm_as_judge",model:"gpt-5.5-pro",threshold:"0.85",scope:"All task groups",prompt:""});
  const [importText,setImportText]=useState(JSON.stringify(seededEvalDefinitions[0],null,2));
  const [formError,setFormError]=useState<string|null>(null);
  useEffect(()=>{
    try {
      window.localStorage.setItem(EVAL_VERSIONS_STORAGE_KEY,JSON.stringify(evalVersions));
      window.localStorage.setItem(ACTIVE_EVAL_VERSION_STORAGE_KEY,String(activeVersion.version));
    } catch { /* Version history remains available for the current page session. */ }
  },[evalVersions,activeVersion.version]);
  function importEval(event: FormEvent) {
    event.preventDefault();
    try {
      const parsed=JSON.parse(importText) as Partial<EvalDefinition>;
      if(!parsed.id||!parsed.name) throw new Error("Eval JSON must include id and name.");
      setEvalDefinitions(items=>[{...seededEvalDefinitions[0],...parsed,dimensions:Array.isArray(parsed.dimensions)?parsed.dimensions:[],scope:parsed.scope??"Imported task scope",status:parsed.status??"Running"},...items]);
      setModal(null); setFormError(null);
    } catch(error) { setFormError(error instanceof Error?error.message:"Invalid eval JSON."); }
  }
  function createEval(event: FormEvent) {
    event.preventDefault();
    if(!draft.name.trim()){setFormError("Name is required.");return;}
    setEvalDefinitions(items=>[{
      id:draft.name.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"")||`eval_${Date.now()}`,
      name:draft.name.trim(),
      status:"Running",
      evaluator_type:draft.evaluator_type,
      model:draft.model,
      threshold:Number(draft.threshold)||.85,
      prompt:draft.prompt||"Evaluate candidate response against the selected task rubric.",
      dimensions:["Task scope", "Pass threshold", "Evaluator prompt"],
      scope:draft.scope||"All task groups",
    },...items]);
    setModal(null); setFormError(null);
  }
  function openEdit() {
    setDraft({
      name:activeEvalDefinition.name,
      evaluator_type:activeEvalDefinition.evaluator_type,
      model:activeEvalDefinition.model,
      threshold:String(activeEvalDefinition.threshold),
      scope:activeEvalDefinition.scope,
      prompt:activeEvalDefinition.prompt,
    });
    setFormError(null);
    setModal("edit");
  }
  function saveVersion(event: FormEvent) {
    event.preventDefault();
    if(!draft.name.trim()){setFormError("Name is required.");return;}
    const definition: EvalDefinition={
      ...activeEvalDefinition,
      name:draft.name.trim(),
      evaluator_type:draft.evaluator_type,
      model:draft.model,
      threshold:Number(draft.threshold)||.85,
      scope:draft.scope||"All task groups",
      prompt:draft.prompt||"Evaluate candidate response against the selected task rubric.",
    };
    const versions=appendEvalVersion(evalVersions,definition);
    setEvalVersions(versions);
    setActiveEvalVersion(versions[versions.length-1].version);
    setEvalDefinitions(items=>items.map(item=>item.id===definition.id?definition:item));
    setModal(null);
    setFormError(null);
  }
  function activateVersion(version: EvalVersion) {
    setActiveEvalVersion(version.version);
    setEvalDefinitions(items=>items.map(item=>item.id===version.definition.id?version.definition:item));
    setModal(null);
  }

  return (
    <>
      <section className="evals-hero panel">
        <div>
          <p className="eyebrow">Evaluation workspace</p>
          <h2>Import, define, and manage evals</h2>
          <p>
            Evals are reusable checks that score traces, simulations, or candidate model responses before RouteLab
            recommends routing changes. This page is the control plane for importing eval definitions, reviewing active
            evals, and eventually creating, editing, versioning, and deleting evals.
          </p>
        </div>
        <div className="eval-actions">
          <button type="button" className="primary" onClick={()=>setModal("import")}>Import eval</button>
          <button type="button" onClick={()=>setModal("create")}>Create eval</button>
          <span className={`eval-version-button-wrap ${evalVersions.length===1?"disabled":""}`} tabIndex={evalVersions.length===1?0:undefined}>
            <button type="button" disabled={evalVersions.length===1} onClick={()=>setModal("versions")}>Manage versions</button>
            {evalVersions.length===1&&<span role="tooltip">The current version is the only version.</span>}
          </span>
        </div>
      </section>

      <section className="eval-run-summary" aria-label="Latest eval run summary">
        <article className="panel eval-summary-card">
          <small>Latest run</small>
          <b>{traceJudgeResults.length.toLocaleString()}</b>
          <span>trace scores</span>
        </article>
        <article className="panel eval-summary-card">
          <small>Average score</small>
          <b>{pct(averageScore * 100)}</b>
          <span>across scored traces</span>
        </article>
        <button type="button" className="panel eval-summary-card eval-summary-action" onClick={() => onReviewFilter("representative")}>
          <small>Passing</small>
          <b>{passing.toLocaleString()}</b>
          <span>met threshold · review a representative sample</span>
        </button>
        <button type="button" className="panel eval-summary-card eval-summary-action" onClick={() => onReviewFilter("unusual")}>
          <small>Needs review</small>
          <b>{failing.toLocaleString()}</b>
          <span>below threshold · review unusual cases</span>
        </button>
        <article className="panel eval-summary-card">
          <small>Trace coverage</small>
          <b>{traces.length ? pct(traceJudgeResults.length / traces.length * 100) : "0.0%"}</b>
          <span>of ingested traces</span>
        </article>
      </section>

      <article className="panel eval-card">
        <div className="eval-card-head">
          <div>
            <p className="eyebrow">Currently running</p>
            <h2>{activeEvalDefinition.name}</h2>
          </div>
          <div className="eval-current-state"><span>Version {activeVersion.version}</span><span className="eval-status">{activeEvalDefinition.status}</span></div>
        </div>
        <section className="eval-prompt">
          <h3>Judge prompt</h3>
          <pre>{activeEvalDefinition.prompt}</pre>
        </section>

        <div className="eval-meta-grid">
          <div><small>Eval ID</small><b>{activeEvalDefinition.id}</b></div>
          <div><small>Evaluator</small><b>{activeEvalDefinition.evaluator_type}</b></div>
          <div><small>Judge model</small><b>{activeEvalDefinition.model}</b></div>
          <div><small>Pass threshold</small><b>{pct(activeEvalDefinition.threshold * 100)}</b></div>
        </div>

        <section className="eval-dimensions">
          <h3>Dimensions used</h3>
          {activeEvalDefinition.dimensions.map((dimension) => <span key={dimension}>{dimension}</span>)}
        </section>

        <details className="eval-definition">
          <summary>Definition schema</summary>
          <pre>{JSON.stringify(activeEvalDefinition, null, 2)}</pre>
        </details>

        <div className="eval-crud">
          <button type="button" onClick={openEdit}>Edit definition</button>
          <button type="button" disabled title="Not available in this preview">Duplicate</button>
          <button type="button" disabled title="Not available in this preview">Disable</button>
          <button type="button" className="danger" disabled title="Not available in this preview">Delete</button>
        </div>
      </article>

      <section className="panel eval-library">
        <div className="panelhead"><div><p className="eyebrow">Eval library</p><h2>{evalDefinitions.length} active evals</h2></div></div>
        <div className="eval-library-grid">{evalDefinitions.map((definition)=><article key={definition.id}><span className="eval-status">{definition.status}</span><h3>{definition.name}</h3><p>{definition.scope}</p><small>{definition.evaluator_type} · {definition.model} · threshold {pct(definition.threshold*100)}</small></article>)}</div>
      </section>

      <section className="panel eval-history">
        <div className="eval-history-head">
          <div>
            <p className="eyebrow">Historical quality</p>
            <h3>Month-over-month eval scores</h3>
          </div>
          <span>{history.length} months</span>
        </div>
        <div className="eval-history-chart" aria-label="Monthly eval score line chart">
          <svg viewBox={`0 0 ${evalChart.width} ${evalChart.height}`} role="img" aria-label="Average eval score by month">
            {[0,.25,.5,.75,1].map((value)=><text className="eval-axis-label" key={value} x="4" y={evalChart.top+(1-value)*(evalChart.height-evalChart.top-evalChart.bottom)+4}>{pct(value*100)}</text>)}
            <g className="eval-history-grid">
              {[.25, .5, .75].map((value) => {
                const y = evalChart.top + (1 - value) * (evalChart.height - evalChart.top - evalChart.bottom);
                return <line key={value} x1={evalChart.left} x2={evalChart.width - evalChart.right} y1={y} y2={y} />;
              })}
            </g>
            <polyline points={historyLine} />
            {historyPoints.map((month) => (
              <g className="eval-history-point" key={month.key} transform={`translate(${month.x} ${month.y})`} tabIndex={0}>
                <circle r="7" />
                <foreignObject x="-58" y="-76" width="132" height="68" className="eval-history-tooltip-wrap">
                  <div className="eval-history-tooltip">
                    <b>{month.label} · {pct(month.averageScore * 100)}</b>
                    <span>{month.count.toLocaleString()} traces</span>
                    <span>{month.passing.toLocaleString()} passed</span>
                    <span>{month.failing.toLocaleString()} failed</span>
                  </div>
                </foreignObject>
              </g>
            ))}
            {historyPoints.map((month) => (
              <text className="eval-history-label" key={`${month.key}-label`} x={month.x} y={evalChart.height - 10}>{month.label}</text>
            ))}
          </svg>
        </div>
      </section>
      {modal&&<div className="modal-layer" role="presentation" onClick={(event)=>{if(event.target===event.currentTarget)setModal(null)}}>{modal==="versions"?<section className="eval-modal eval-version-modal" role="dialog" aria-modal="true" aria-labelledby="eval-version-heading"><div className="modal-head"><div><p className="eyebrow">Eval history</p><h2 id="eval-version-heading">Manage versions</h2></div><button type="button" onClick={()=>setModal(null)} aria-label="Close">×</button></div><p>Activate an earlier immutable definition. Historical trace scores are not recalculated.</p><div className="eval-version-list">{[...evalVersions].sort((a,b)=>b.version-a.version).map(version=><article key={version.version}><div><span>Version {version.version}</span>{version.version===activeVersion.version&&<b>Current</b>}<small>{new Date(version.createdAt).toLocaleString(undefined,{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})}</small></div><p><strong>{version.definition.name}</strong><span>{version.definition.model} · threshold {pct(version.definition.threshold*100)}</span></p><button type="button" disabled={version.version===activeVersion.version} onClick={()=>activateVersion(version)}>{version.version===activeVersion.version?"Active":"Activate version"}</button></article>)}</div></section>:<form className="eval-modal" onSubmit={modal==="import"?importEval:modal==="edit"?saveVersion:createEval} role="dialog" aria-modal="true"><div className="modal-head"><div><p className="eyebrow">{modal==="import"?"Import eval":modal==="edit"?"Version eval":"Create eval"}</p><h2>{modal==="import"?"Import JSON eval definition":modal==="edit"?"Create a new version":"Create evaluator"}</h2></div><button type="button" onClick={()=>setModal(null)} aria-label="Close">×</button></div>{modal==="import"?<><p>Paste an eval definition JSON object with id, name, evaluator_type, model, threshold, prompt, dimensions, and scope.</p><textarea value={importText} onChange={event=>setImportText(event.target.value)} rows={12} /></>:<div className="eval-form-grid"><label>Name<input value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})} /></label><label>Evaluator type<select value={draft.evaluator_type} onChange={event=>setDraft({...draft,evaluator_type:event.target.value})}><option>llm_as_judge</option><option>deterministic_rule_check</option><option>schema_check</option></select></label><label>Judge model<input value={draft.model} onChange={event=>setDraft({...draft,model:event.target.value})} /></label><label>Threshold<input value={draft.threshold} onChange={event=>setDraft({...draft,threshold:event.target.value})} /></label><label>Task scope<input value={draft.scope} onChange={event=>setDraft({...draft,scope:event.target.value})} /></label><label className="wide">Prompt<textarea value={draft.prompt} onChange={event=>setDraft({...draft,prompt:event.target.value})} rows={6} /></label></div>}{formError&&<p className="form-error">{formError}</p>}<button type="submit" className="primary">{modal==="import"?"Import eval":modal==="edit"?"Save version":"Create eval"}</button></form>}</div>}
    </>
  );
}
