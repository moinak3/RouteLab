import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import type { Model, Trace, TraceJudgeResult } from "../types";
import { pct } from "../lib/format";
import type { ReviewQueueFilter } from "../types/ui";
import { ModelOptions } from "../components/ModelOptions";
import {
  defaultEvalDefinitions,
  demoEvalDefinitions,
  ensureRunnableJudgeModel,
  evalDefinitionFileName,
  formatEvalDefinitionJson,
  parseEvalDefinitionJson,
  serializeEvalDefinition,
  type EvalDefinition,
} from "../core/evalDefinitions";
import {
  configureNewTraceEvaluation,
  HISTORICAL_TEST_SAMPLE_SIZE,
  loadEvalAutomationPolicies,
  loadEvalRunHistory,
  runEvalOnTraces,
  saveEvalRunRecord,
  selectHistoricalTestSample,
  type EvalAutomationPolicy,
  type EvalRunRecord,
} from "../core/evalLifecycle";

type EvalVersion = {
  version: number;
  createdAt: string;
  definition: EvalDefinition;
};

export function appendEvalVersion(versions: EvalVersion[], definition: EvalDefinition, createdAt = new Date().toISOString()): EvalVersion[] {
  const nextVersion = Math.max(0, ...versions.map((item) => item.version)) + 1;
  return [...versions, { version: nextVersion, createdAt, definition }];
}

const EVAL_DEFINITIONS_STORAGE_PREFIX = "routelab-eval-definitions-v2:";
const EVAL_VERSIONS_STORAGE_PREFIX = "routelab-eval-versions-v2:";
const ACTIVE_EVAL_VERSION_STORAGE_PREFIX = "routelab-active-eval-version-v2:";

function loadEvalDefinitions(workspaceId: string, defaults: EvalDefinition[], fallbackJudgeModel: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${EVAL_DEFINITIONS_STORAGE_PREFIX}${workspaceId}`) ?? "null") as EvalDefinition[] | null;
    if (Array.isArray(parsed)
      && parsed.every((item) => typeof item?.id === "string" && typeof item?.name === "string")
      && (parsed.length > 0 || defaults.length === 0)) {
      return parsed.map((definition) => ensureRunnableJudgeModel(definition, fallbackJudgeModel));
    }
  } catch { /* Use workspace-specific defaults when local definitions are unavailable. */ }
  return defaults;
}

function loadEvalVersions(workspaceId: string, defaults: EvalDefinition[], fallbackJudgeModel: string) {
  try {
    const parsed=JSON.parse(window.localStorage.getItem(`${EVAL_VERSIONS_STORAGE_PREFIX}${workspaceId}`)??"null") as EvalVersion[]|null;
    if(Array.isArray(parsed)&&parsed.length&&parsed.every(item=>Number.isInteger(item?.version)&&typeof item?.createdAt==="string"&&typeof item?.definition?.id==="string")) {
      return parsed.map((item) => ({ ...item, definition: ensureRunnableJudgeModel(item.definition, fallbackJudgeModel) }));
    }
  } catch { /* Start from workspace-specific definitions when local history is unavailable. */ }
  return defaults.length ? [{ version: 1, createdAt: "2026-10-01T17:00:00.000Z", definition: defaults[0] }] : [];
}

function loadActiveEvalVersion(workspaceId: string) {
  try {
    const parsed=Number(window.localStorage.getItem(`${ACTIVE_EVAL_VERSION_STORAGE_PREFIX}${workspaceId}`));
    if(Number.isInteger(parsed)&&parsed>0)return parsed;
  } catch { /* Start from the bundled definition when local history is unavailable. */ }
  return 1;
}

const monthLabel = (date: Date) => date.toLocaleString("en-US", { month: "short" });

export const evaluatorUsesJudgeModel = (evaluatorType: string) => evaluatorType.toLowerCase().includes("judge");

export const openRouterJudgeModelValue = (model: Model) => model.pricing_source_model_id ?? model.id;

export function resolveJudgeModelValue(value: string, models: Model[]) {
  const selected = models.find((model) => model.id === value || model.pricing_source_model_id === value);
  return selected ? openRouterJudgeModelValue(selected) : value;
}

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
  workspaceId,
  workspace,
  traces,
  traceJudgeResults,
  models,
  onReviewFilter,
  onEvalResults,
  onAutomationPoliciesChange,
}: {
  workspaceId: string;
  workspace: "personal" | "demo";
  traces: Trace[];
  traceJudgeResults: TraceJudgeResult[];
  models: Model[];
  onReviewFilter: (filter: ReviewQueueFilter) => void;
  onEvalResults: (results: TraceJudgeResult[]) => void;
  onAutomationPoliciesChange: (policies: EvalAutomationPolicy[]) => void;
}) {
  const judgeModels = models.filter((model) => model.pricing_source === "OpenRouter" && model.family !== "Router");
  const defaultJudgeModel = judgeModels[0] ? openRouterJudgeModelValue(judgeModels[0]) : "gpt-5.5-pro";
  const liveJudgeModel = judgeModels.some((model) => model.id.startsWith("openrouter:")) ? defaultJudgeModel : "";
  const workspaceDefaults = defaultEvalDefinitions(workspace, traces)
    .map((definition) => ensureRunnableJudgeModel(definition, liveJudgeModel));
  const [evalDefinitions,setEvalDefinitions]=useState<EvalDefinition[]>(() => loadEvalDefinitions(workspaceId, workspaceDefaults, liveJudgeModel));
  const [evalVersions,setEvalVersions]=useState<EvalVersion[]>(() => loadEvalVersions(workspaceId, workspaceDefaults, liveJudgeModel));
  const [activeEvalVersion,setActiveEvalVersion]=useState(() => loadActiveEvalVersion(workspaceId));
  const activeVersion=evalVersions.find(item=>item.version===activeEvalVersion)??evalVersions[evalVersions.length-1];
  const activeEvalDefinition=activeVersion?.definition;
  const activeTraceJudgeResults=activeEvalDefinition
    ? traceJudgeResults.filter((result)=>result.eval_id===activeEvalDefinition.id||(!result.eval_id&&result.evaluator_type.startsWith(activeEvalDefinition.id)))
    : [];
  const passing = activeTraceJudgeResults.filter((result) => result.passed).length;
  const failing = activeTraceJudgeResults.length - passing;
  const averageScore = activeTraceJudgeResults.length ? activeTraceJudgeResults.reduce((sum, result) => sum + result.score, 0) / activeTraceJudgeResults.length : 0;
  const history = monthlyEvalHistory(activeTraceJudgeResults);
  const historyPoints = history.map((month, index) => ({ ...month, ...chartPoint(index, history.length, month.averageScore) }));
  const historyLine = historyPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const [modal,setModal]=useState<"import"|"create"|"edit"|"versions"|null>(null);
  const [draft,setDraft]=useState({name:"",evaluator_type:"llm_as_judge",model:defaultJudgeModel,threshold:"0.85",scope:"All task groups",prompt:""});
  const [importText,setImportText]=useState(JSON.stringify(workspaceDefaults[0] ?? demoEvalDefinitions[0],null,2));
  const [importFileName,setImportFileName]=useState<string|null>(null);
  const [formError,setFormError]=useState<string|null>(null);
  const [automationPolicies,setAutomationPolicies]=useState<EvalAutomationPolicy[]>(() => loadEvalAutomationPolicies(workspaceId));
  const [runHistory,setRunHistory]=useState<EvalRunRecord[]>(() => loadEvalRunHistory(workspaceId));
  const [historicalRunState,setHistoricalRunState]=useState<"idle"|"running">("idle");
  const [lifecycleMessage,setLifecycleMessage]=useState<string|null>(null);
  const automationPolicy=activeEvalDefinition ? automationPolicies.find((policy)=>policy.evalId===activeEvalDefinition.id) : undefined;
  const latestHistoricalRun=activeEvalDefinition
    ? runHistory.find((run)=>run.evalId===activeEvalDefinition.id&&run.mode==="historical_test")
    : undefined;
  const latestContinuousRun=activeEvalDefinition
    ? runHistory.find((run)=>run.evalId===activeEvalDefinition.id&&run.mode==="new_traces")
    : undefined;
  const historicalSample=selectHistoricalTestSample(traces,HISTORICAL_TEST_SAMPLE_SIZE);
  const supportsLiveRuns=Boolean(activeEvalDefinition&&evaluatorUsesJudgeModel(activeEvalDefinition.evaluator_type)&&liveJudgeModel);
  useEffect(()=>{
    try {
      window.localStorage.setItem(`${EVAL_DEFINITIONS_STORAGE_PREFIX}${workspaceId}`,JSON.stringify(evalDefinitions));
      window.localStorage.setItem(`${EVAL_VERSIONS_STORAGE_PREFIX}${workspaceId}`,JSON.stringify(evalVersions));
      if (activeVersion) window.localStorage.setItem(`${ACTIVE_EVAL_VERSION_STORAGE_PREFIX}${workspaceId}`,String(activeVersion.version));
    } catch { /* Version history remains available for the current page session. */ }
  },[workspaceId,evalDefinitions,evalVersions,activeVersion]);
  useEffect(()=>{
    setAutomationPolicies(loadEvalAutomationPolicies(workspaceId));
    setRunHistory(loadEvalRunHistory(workspaceId));
    setLifecycleMessage(null);
  },[workspaceId]);
  useEffect(()=>{
    if (!liveJudgeModel) return;
    setEvalDefinitions((items) => items.map((definition) => ensureRunnableJudgeModel(definition, liveJudgeModel)));
    setEvalVersions((items) => items.map((item) => ({
      ...item,
      definition: ensureRunnableJudgeModel(item.definition, liveJudgeModel),
    })));
  },[liveJudgeModel]);
  function addDefinition(definition: EvalDefinition) {
    const versions = appendEvalVersion(evalVersions, definition);
    setEvalDefinitions(items=>[definition,...items.filter(item=>item.id!==definition.id)]);
    setEvalVersions(versions);
    setActiveEvalVersion(versions[versions.length-1].version);
  }
  function importEval(event: FormEvent) {
    event.preventDefault();
    try {
      const parsed=parseEvalDefinitionJson(importText);
      addDefinition({
        ...demoEvalDefinitions[0],
        ...parsed,
        dimensions:Array.isArray(parsed.dimensions)?parsed.dimensions:[],
        scope:parsed.scope??"Imported task scope",
        status:parsed.status??"Draft",
      });
      setModal(null); setFormError(null);
    } catch(error) { setFormError(error instanceof Error?error.message:"Invalid eval JSON."); }
  }
  function openImportModal() {
    setFormError(null);
    setImportFileName(null);
    setModal("import");
  }
  function openCreateModal() {
    setDraft({name:"",evaluator_type:"llm_as_judge",model:defaultJudgeModel,threshold:"0.85",scope:"All task groups",prompt:""});
    setFormError(null);
    setModal("create");
  }
  async function loadImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0];
    event.target.value="";
    if(!file)return;
    if(!file.name.toLowerCase().endsWith(".json")){
      setFormError("Choose a .json eval definition file.");
      return;
    }
    if(file.size>2_000_000){
      setFormError("Eval definition files must be smaller than 2 MB.");
      return;
    }
    try {
      const formatted=formatEvalDefinitionJson(await file.text());
      setImportText(formatted);
      setImportFileName(file.name);
      setFormError(null);
    } catch(error) {
      setImportFileName(file.name);
      setFormError(error instanceof Error?error.message:"Invalid eval JSON file.");
    }
  }
  function formatImportText() {
    try {
      setImportText(formatEvalDefinitionJson(importText));
      setFormError(null);
    } catch(error) {
      setFormError(error instanceof Error?error.message:"Invalid eval JSON.");
    }
  }
  function createEval(event: FormEvent) {
    event.preventDefault();
    if(!draft.name.trim()){setFormError("Name is required.");return;}
    addDefinition({
      id:draft.name.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"")||`eval_${Date.now()}`,
      name:draft.name.trim(),
      status:"Draft",
      evaluator_type:draft.evaluator_type,
      model:draft.model,
      threshold:Number(draft.threshold)||.85,
      prompt:draft.prompt||"Evaluate candidate response against the selected task rubric.",
      dimensions:["Task scope", "Pass threshold", "Evaluator prompt"],
      scope:draft.scope||"All task groups",
    });
    setModal(null); setFormError(null);
  }
  function openEdit() {
    if (!activeEvalDefinition) return;
    setDraft({
      name:activeEvalDefinition.name,
      evaluator_type:activeEvalDefinition.evaluator_type,
      model:resolveJudgeModelValue(activeEvalDefinition.model,judgeModels),
      threshold:String(activeEvalDefinition.threshold),
      scope:activeEvalDefinition.scope,
      prompt:activeEvalDefinition.prompt,
    });
    setFormError(null);
    setModal("edit");
  }
  function updateEvaluatorType(evaluatorType: string) {
    setDraft((current) => ({
      ...current,
      evaluator_type:evaluatorType,
      model:evaluatorUsesJudgeModel(evaluatorType)
        ? resolveJudgeModelValue(current.model === "none" ? defaultJudgeModel : current.model,judgeModels)
        : "none",
    }));
  }
  function saveVersion(event: FormEvent) {
    event.preventDefault();
    if (!activeEvalDefinition) return;
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
  function downloadDefinition(definition: EvalDefinition) {
    const blob = new Blob([serializeEvalDefinition(definition)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = evalDefinitionFileName(definition);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
  async function testHistoricalTraces() {
    if (!activeEvalDefinition||!activeVersion||!historicalSample.length||historicalRunState==="running") return;
    if (!liveJudgeModel) {
      setLifecycleMessage("The current OpenRouter judge catalog is still loading. Try again in a moment.");
      return;
    }
    const definition=ensureRunnableJudgeModel(activeEvalDefinition,liveJudgeModel);
    setHistoricalRunState("running");
    setLifecycleMessage(`Running version ${activeVersion.version} on ${historicalSample.length.toLocaleString()} historical traces…`);
    try {
      const response=await runEvalOnTraces({
        workspaceId,
        definition,
        evalVersion:activeVersion.version,
        mode:"historical_test",
        traces:historicalSample,
      });
      onEvalResults(response.results);
      const runs=saveEvalRunRecord(workspaceId,response.run);
      setRunHistory(runs);
      setLifecycleMessage(`${response.run.traceCount.toLocaleString()} traces scored · ${response.run.passed.toLocaleString()} passed${response.errors.length?` · ${response.errors.length} could not be scored`:""}`);
    } catch(error) {
      setLifecycleMessage(error instanceof Error?error.message:"Historical eval test failed.");
    } finally {
      setHistoricalRunState("idle");
    }
  }
  function toggleNewTraceEvaluation(enabled: boolean) {
    if (!activeEvalDefinition||!activeVersion) return;
    const policy=configureNewTraceEvaluation({
      workspaceId,
      definition:activeEvalDefinition,
      evalVersion:activeVersion.version,
      enabled,
      currentTraceIds:traces.map((trace)=>trace.id),
    });
    const policies=loadEvalAutomationPolicies(workspaceId);
    setAutomationPolicies(policies);
    onAutomationPoliciesChange(policies);
    setLifecycleMessage(enabled
      ? `Version ${policy.evalVersion} will score every trace ingested after this point.`
      : "Automatic evaluation of new traces is off.");
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
          <button type="button" className="primary" onClick={openImportModal}>Import eval</button>
          <button type="button" onClick={openCreateModal}>Create eval</button>
          <span className={`eval-version-button-wrap ${evalVersions.length<2?"disabled":""}`} tabIndex={evalVersions.length<2?0:undefined}>
            <button type="button" disabled={evalVersions.length<2} onClick={()=>setModal("versions")}>Manage versions</button>
            {evalVersions.length<2&&<span role="tooltip">Create another version to manage history.</span>}
          </span>
        </div>
      </section>

      <section className="eval-run-summary" aria-label="Latest eval run summary">
        <article className="panel eval-summary-card">
          <small>Latest run</small>
          <b>{activeTraceJudgeResults.length.toLocaleString()}</b>
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
          <b>{traces.length ? pct(activeTraceJudgeResults.length / traces.length * 100) : "0.0%"}</b>
          <span>of ingested traces</span>
        </article>
      </section>

      {activeEvalDefinition && activeVersion ? <article className="panel eval-card">
        <div className="eval-card-head">
          <div>
            <p className="eyebrow">{activeEvalDefinition.status === "Draft" ? "Generated draft" : "Currently running"}</p>
            <h2>{activeEvalDefinition.name}</h2>
          </div>
          <div className="eval-current-state"><span>Version {activeVersion.version}</span><span className="eval-status">{activeEvalDefinition.status}</span></div>
        </div>
        {activeEvalDefinition.generation_basis && <p className="eval-generation-note">
          Generated from {Number(activeEvalDefinition.generation_basis.trace_count ?? 0).toLocaleString()} imported traces. Review and calibrate it against human labels before using it as a routing gate.
        </p>}
        <section className="eval-lifecycle" aria-labelledby="eval-lifecycle-heading">
          <div className="eval-lifecycle-head">
            <div><p className="eyebrow">Eval lifecycle</p><h3 id="eval-lifecycle-heading">Create, test, then evaluate new traffic</h3></div>
            <span>{automationPolicy?.runOnNewTraces?"Continuous evaluation on":"Historical test first"}</span>
          </div>
          <ol>
            <li className="complete">
              <span>1</span>
              <div><b>Definition created</b><p>Version {activeVersion.version} is ready to test. No traces were scored when it was created.</p></div>
              <strong>Complete</strong>
            </li>
            <li className={latestHistoricalRun?"complete":""}>
              <span>2</span>
              <div>
                <b>Test on historical traces</b>
                <p>Run the judge on a representative sample of up to {HISTORICAL_TEST_SAMPLE_SIZE} existing traces before a full backfill.</p>
                {latestHistoricalRun&&<small>Last tested {new Date(latestHistoricalRun.completedAt).toLocaleString()} · {latestHistoricalRun.traceCount} scored · {pct(latestHistoricalRun.averageScore*100)} average</small>}
              </div>
              <button type="button" className="primary" disabled={!supportsLiveRuns||!historicalSample.length||historicalRunState==="running"} onClick={testHistoricalTraces} title={!liveJudgeModel?"Loading the current OpenRouter judge catalog.":!supportsLiveRuns?"Live historical tests currently require an LLM judge eval.":!historicalSample.length?"Import traces before testing this eval.":undefined}>{historicalRunState==="running"?"Running test…":latestHistoricalRun?"Test again":"Test historical traces"}</button>
            </li>
            <li className={automationPolicy?.runOnNewTraces?"complete":""}>
              <span>3</span>
              <div>
                <b>Run on all new traces</b>
                <p>After activation, each newly ingested trace is scored with this exact eval version. Existing traces remain unchanged.</p>
                {automationPolicy?.runOnNewTraces&&<small>Enabled {automationPolicy.enabledAt?new Date(automationPolicy.enabledAt).toLocaleString():"now"} · version {automationPolicy.evalVersion}{latestContinuousRun?` · latest run ${latestContinuousRun.traceCount} traces`:""}</small>}
              </div>
              <label className="eval-automation-toggle"><input type="checkbox" checked={Boolean(automationPolicy?.runOnNewTraces)} disabled={!supportsLiveRuns} onChange={(event)=>toggleNewTraceEvaluation(event.target.checked)} /><span aria-hidden="true" /><b>{automationPolicy?.runOnNewTraces?"On":"Off"}</b></label>
            </li>
          </ol>
          {lifecycleMessage&&<p className="eval-lifecycle-message" role="status">{lifecycleMessage}</p>}
        </section>
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
          <button type="button" className="primary" onClick={()=>downloadDefinition(activeEvalDefinition)}>Download JSON</button>
          <button type="button" onClick={openEdit}>Edit definition</button>
          <button type="button" disabled title="Not available in this preview">Duplicate</button>
          <button type="button" disabled title="Not available in this preview">Disable</button>
          <button type="button" className="danger" disabled title="Not available in this preview">Delete</button>
        </div>
      </article> : <article className="panel eval-empty-state">
        <p className="eyebrow">No evals in My workspace</p>
        <h2>Create an eval from your own evidence</h2>
        <p>RouteLab demo evals are intentionally kept out of personal workspaces. Import a definition or create one after your traces and task groups are ready.</p>
        <div><button type="button" className="primary" onClick={openCreateModal}>Create eval</button><button type="button" onClick={openImportModal}>Import JSON</button></div>
      </article>}

      <section className="panel eval-library">
        <div className="panelhead"><div><p className="eyebrow">Eval library</p><h2>{evalDefinitions.length} active evals</h2></div></div>
        <div className="eval-library-grid">{evalDefinitions.map((definition)=><article key={definition.id}><span className="eval-status">{definition.status}</span><h3>{definition.name}</h3><p>{definition.scope}</p><small>{definition.evaluator_type} · {definition.model} · threshold {pct(definition.threshold*100)}</small><button type="button" onClick={()=>downloadDefinition(definition)}>Download JSON</button></article>)}</div>
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
      {modal&&<div className="modal-layer" role="presentation" onClick={(event)=>{if(event.target===event.currentTarget)setModal(null)}}>
        {modal==="versions"?<section className="eval-modal eval-version-modal" role="dialog" aria-modal="true" aria-labelledby="eval-version-heading">
          <div className="modal-head"><div><p className="eyebrow">Eval history</p><h2 id="eval-version-heading">Manage versions</h2></div><button type="button" onClick={()=>setModal(null)} aria-label="Close">×</button></div>
          <p>Activate an earlier immutable definition. Historical trace scores are not recalculated.</p>
          <div className="eval-version-list">{[...evalVersions].sort((a,b)=>b.version-a.version).map(version=><article key={version.version}><div><span>Version {version.version}</span>{version.version===activeVersion.version&&<b>Current</b>}<small>{new Date(version.createdAt).toLocaleString(undefined,{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})}</small></div><p><strong>{version.definition.name}</strong><span>{version.definition.model} · threshold {pct(version.definition.threshold*100)}</span></p><button type="button" disabled={version.version===activeVersion.version} onClick={()=>activateVersion(version)}>{version.version===activeVersion.version?"Active":"Activate version"}</button></article>)}</div>
        </section>:<form className={`eval-modal ${modal==="import"?"eval-import-modal":""}`} onSubmit={modal==="import"?importEval:modal==="edit"?saveVersion:createEval} role="dialog" aria-modal="true" aria-labelledby="eval-modal-heading">
          <div className="modal-head"><div><p className="eyebrow">{modal==="import"?"Import eval":modal==="edit"?"Version eval":"Create eval"}</p><h2 id="eval-modal-heading">{modal==="import"?"Import an eval definition":modal==="edit"?"Create a new version":"Create evaluator"}</h2></div><button type="button" onClick={()=>setModal(null)} aria-label="Close">×</button></div>
          {modal==="import"?<div className="eval-import-workspace">
            <p>Upload a JSON definition or paste one below. You can review and edit the exact definition before RouteLab imports it.</p>
            <label className="eval-import-file">
              <input type="file" accept=".json,application/json" onChange={loadImportFile} aria-label="Choose eval JSON file" />
              <span aria-hidden="true">JSON</span>
              <span><b>Choose a JSON definition</b><small>One eval object · maximum 2 MB</small></span>
              <strong>{importFileName??"Browse file"}</strong>
            </label>
            <div className="eval-import-divider"><span>or paste JSON</span></div>
            <section className="eval-json-editor" aria-label="JSON editor">
              <header><div><b>Eval definition JSON</b><small>Required fields: id and name</small></div><button type="button" onClick={formatImportText}>Format JSON</button></header>
              <textarea aria-label="Eval definition JSON" value={importText} onChange={event=>setImportText(event.target.value)} rows={20} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
              <footer>Supports evaluator type, model, threshold, prompt, dimensions, scope, scoring rules, and output schema.</footer>
            </section>
          </div>:<div className="eval-form-grid">
            <label>Name<input value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})} /></label>
            <label>Evaluator type<select value={draft.evaluator_type} onChange={event=>updateEvaluatorType(event.target.value)}><option>llm_as_judge</option><option>hybrid_deterministic_and_llm_judge</option><option>deterministic_rule_check</option><option>schema_check</option></select></label>
            <label>Judge model
              {evaluatorUsesJudgeModel(draft.evaluator_type)?<>
                <select aria-label="Judge model" value={draft.model} onChange={event=>setDraft({...draft,model:event.target.value})}>
                  {!judgeModels.some((model)=>openRouterJudgeModelValue(model)===draft.model)&&draft.model&&<optgroup label="Current selection"><option value={draft.model}>{draft.model} · saved selection</option></optgroup>}
                  <ModelOptions models={judgeModels} valueForModel={openRouterJudgeModelValue} />
                </select>
                <small className="eval-field-note">Live OpenRouter catalog · the provider route is saved with this eval version.</small>
              </>:<>
                <input value="No judge model required" readOnly aria-label="Judge model not required" />
                <small className="eval-field-note">This evaluator runs deterministically and does not call a judge model.</small>
              </>}
            </label>
            <label className="eval-threshold-field">Threshold<input value={draft.threshold} onChange={event=>setDraft({...draft,threshold:event.target.value})} /></label>
            <label className="eval-scope-field">Task scope<input value={draft.scope} onChange={event=>setDraft({...draft,scope:event.target.value})} /></label>
            <label className="wide">Prompt<textarea value={draft.prompt} onChange={event=>setDraft({...draft,prompt:event.target.value})} rows={6} /></label>
          </div>}
          {formError&&<p className="form-error" role="alert">{formError}</p>}
          <div className="eval-modal-actions"><button type="button" onClick={()=>setModal(null)}>Cancel</button><button type="submit" className="primary">{modal==="import"?"Import eval":modal==="edit"?"Save version":"Create eval"}</button></div>
        </form>}
      </div>}
    </>
  );
}
