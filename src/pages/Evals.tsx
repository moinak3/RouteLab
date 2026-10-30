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
  evalRunBatches,
  historicalEvalRunCoversPopulation,
  loadEvalAutomationPolicies,
  loadEvalRunHistory,
  monthlyEvalHistory,
  removeEvalLifecycleState,
  runEvalOnTraces,
  saveEvalRunRecord,
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

export const evaluatorUsesJudgeModel = (evaluatorType: string) => evaluatorType.toLowerCase().includes("judge");

export const openRouterJudgeModelValue = (model: Model) => model.pricing_source_model_id ?? model.id;

export function resolveJudgeModelValue(value: string, models: Model[]) {
  const selected = models.find((model) => model.id === value || model.pricing_source_model_id === value);
  return selected ? openRouterJudgeModelValue(selected) : value;
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
  const failing = activeTraceJudgeResults.filter((result) => !result.passed).length;
  const enabledEvalCount=evalDefinitions.filter((definition)=>definition.status!=="Disabled").length;
  const history = monthlyEvalHistory(activeTraceJudgeResults);
  const historyPoints = history.map((month, index) => ({ ...month, ...chartPoint(index, history.length, month.passRate) }));
  const historyLine = historyPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const [modal,setModal]=useState<"import"|"create"|"edit"|"details"|"versions"|null>(null);
  const [detailEvalId,setDetailEvalId]=useState<string|null>(null);
  const [draft,setDraft]=useState({name:"",evaluator_type:"llm_as_judge",model:defaultJudgeModel,threshold:"0.85",scope:"All task groups",prompt:""});
  const [importText,setImportText]=useState(JSON.stringify(workspaceDefaults[0] ?? demoEvalDefinitions[0],null,2));
  const [importFileName,setImportFileName]=useState<string|null>(null);
  const [formError,setFormError]=useState<string|null>(null);
  const [automationPolicies,setAutomationPolicies]=useState<EvalAutomationPolicy[]>(() => loadEvalAutomationPolicies(workspaceId));
  const [runHistory,setRunHistory]=useState<EvalRunRecord[]>(() => loadEvalRunHistory(workspaceId));
  const [historicalRunState,setHistoricalRunState]=useState<"idle"|"running">("idle");
  const [historicalRunProgress,setHistoricalRunProgress]=useState({processed:0,scored:0,total:0});
  const [lifecycleMessage,setLifecycleMessage]=useState<string|null>(null);
  const [deleteConfirmEvalId,setDeleteConfirmEvalId]=useState<string|null>(null);
  const automationPolicy=activeEvalDefinition ? automationPolicies.find((policy)=>policy.evalId===activeEvalDefinition.id) : undefined;
  const latestHistoricalRun=activeEvalDefinition
    ? runHistory.find((run)=>run.evalId===activeEvalDefinition.id&&run.mode==="historical_test")
    : undefined;
  const latestContinuousRun=activeEvalDefinition
    ? runHistory.find((run)=>run.evalId===activeEvalDefinition.id&&run.mode==="new_traces")
    : undefined;
  const supportsLiveRuns=Boolean(activeEvalDefinition&&evaluatorUsesJudgeModel(activeEvalDefinition.evaluator_type)&&liveJudgeModel);
  useEffect(()=>{
    try {
      window.localStorage.setItem(`${EVAL_DEFINITIONS_STORAGE_PREFIX}${workspaceId}`,JSON.stringify(evalDefinitions));
      window.localStorage.setItem(`${EVAL_VERSIONS_STORAGE_PREFIX}${workspaceId}`,JSON.stringify(evalVersions));
      if (activeVersion) window.localStorage.setItem(`${ACTIVE_EVAL_VERSION_STORAGE_PREFIX}${workspaceId}`,String(activeVersion.version));
      else window.localStorage.removeItem(`${ACTIVE_EVAL_VERSION_STORAGE_PREFIX}${workspaceId}`);
    } catch { /* Version history remains available for the current page session. */ }
  },[workspaceId,evalDefinitions,evalVersions,activeVersion]);
  useEffect(()=>{
    setAutomationPolicies(loadEvalAutomationPolicies(workspaceId));
    setRunHistory(loadEvalRunHistory(workspaceId));
    setHistoricalRunState("idle");
    setHistoricalRunProgress({processed:0,scored:0,total:0});
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
  function openEdit(definition = activeEvalDefinition) {
    if (!definition) return;
    setDraft({
      name:definition.name,
      evaluator_type:definition.evaluator_type,
      model:resolveJudgeModelValue(definition.model,judgeModels),
      threshold:String(definition.threshold),
      scope:definition.scope,
      prompt:definition.prompt,
    });
    setDetailEvalId(definition.id);
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
    const definitionBeingEdited=evalDefinitions.find((definition)=>definition.id===detailEvalId)??activeEvalDefinition;
    if (!definitionBeingEdited) return;
    if(!draft.name.trim()){setFormError("Name is required.");return;}
    const definition: EvalDefinition={
      ...definitionBeingEdited,
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
    setDetailEvalId(null);
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
    if (!activeEvalDefinition||!activeVersion||!traces.length||historicalRunState==="running") return;
    if (!liveJudgeModel) {
      setLifecycleMessage("The current OpenRouter judge catalog is still loading. Try again in a moment.");
      return;
    }
    const definition=ensureRunnableJudgeModel(activeEvalDefinition,liveJudgeModel);
    const batches=evalRunBatches(traces);
    const startedAt=new Date().toISOString();
    const allResults: TraceJudgeResult[]=[];
    const allErrors: Array<{traceId:string;error:string}>=[];
    let processedCount=0;
    setHistoricalRunState("running");
    setHistoricalRunProgress({processed:0,scored:0,total:traces.length});
    setLifecycleMessage(`Running version ${activeVersion.version} on all ${traces.length.toLocaleString()} historical traces…`);
    try {
      for(let index=0;index<batches.length;index+=1){
        const response=await runEvalOnTraces({
          workspaceId,
          definition,
          evalVersion:activeVersion.version,
          mode:"historical_test",
          traces:batches[index],
        });
        allResults.push(...response.results);
        allErrors.push(...response.errors);
        onEvalResults(response.results);
        processedCount+=batches[index].length;
        setHistoricalRunProgress({processed:processedCount,scored:allResults.length,total:traces.length});
        setLifecycleMessage(`Testing all historical traces · ${processedCount.toLocaleString()} of ${traces.length.toLocaleString()} processed · ${allResults.length.toLocaleString()} scored${allErrors.length?` · ${allErrors.length.toLocaleString()} failed`:""}…`);
      }
      const passed=allResults.filter((result)=>result.passed).length;
      const completedAt=new Date().toISOString();
      const run: EvalRunRecord={
        id:`evalrun_full_${Date.now().toString(36)}`,
        evalId:definition.id,
        evalName:definition.name,
        evalVersion:activeVersion.version,
        mode:"historical_test",
        status:"completed",
        attemptedCount:traces.length,
        traceCount:allResults.length,
        passed,
        failed:allResults.length-passed,
        averageScore:allResults.length?allResults.reduce((sum,result)=>sum+result.score,0)/allResults.length:0,
        startedAt,
        completedAt,
      };
      const runs=saveEvalRunRecord(workspaceId,run);
      setRunHistory(runs);
      setHistoricalRunProgress({processed:traces.length,scored:allResults.length,total:traces.length});
      setLifecycleMessage(`${allResults.length.toLocaleString()} of ${traces.length.toLocaleString()} historical traces scored · ${passed.toLocaleString()} passed${allErrors.length?` · ${allErrors.length} could not be scored`:""}`);
    } catch(error) {
      const message=error instanceof Error?error.message:"Historical eval test failed.";
      const completedAt=new Date().toISOString();
      const passed=allResults.filter((result)=>result.passed).length;
      const failedRun: EvalRunRecord={
        id:`evalrun_failed_${Date.now().toString(36)}`,
        evalId:definition.id,
        evalName:definition.name,
        evalVersion:activeVersion.version,
        mode:"historical_test",
        status:"failed",
        attemptedCount:processedCount,
        traceCount:allResults.length,
        passed,
        failed:allResults.length-passed,
        averageScore:allResults.length?allResults.reduce((sum,result)=>sum+result.score,0)/allResults.length:0,
        startedAt,
        completedAt,
        error:message,
      };
      setRunHistory(saveEvalRunRecord(workspaceId,failedRun));
      setHistoricalRunProgress({processed:processedCount,scored:allResults.length,total:traces.length});
      setLifecycleMessage(`Historical test stopped after ${processedCount.toLocaleString()} of ${traces.length.toLocaleString()} traces. ${message}`);
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

  function openDetails(definition: EvalDefinition) {
    setDetailEvalId(definition.id);
    setDeleteConfirmEvalId(null);
    setModal("details");
  }

  function toggleEvalDisabled(definition: EvalDefinition) {
    const disabling=definition.status!=="Disabled";
    const nextDefinition={...definition,status:disabling?"Disabled":"Running"};
    const versions=appendEvalVersion(evalVersions,nextDefinition);
    setEvalDefinitions((items)=>items.map((item)=>item.id===definition.id?nextDefinition:item));
    setEvalVersions(versions);
    setActiveEvalVersion(versions[versions.length-1].version);
    if(disabling){
      configureNewTraceEvaluation({
        workspaceId,
        definition:nextDefinition,
        evalVersion:versions[versions.length-1].version,
        enabled:false,
        currentTraceIds:traces.map((trace)=>trace.id),
      });
      const policies=loadEvalAutomationPolicies(workspaceId);
      setAutomationPolicies(policies);
      onAutomationPoliciesChange(policies);
      setLifecycleMessage(`${definition.name} is disabled. Historical results remain available, and new traces will not be scored.`);
    }else{
      setLifecycleMessage(`${definition.name} is enabled. Test it on historical traces before turning on scoring for new traces.`);
    }
    setDeleteConfirmEvalId(null);
  }

  function deleteEvalDefinition(definition: EvalDefinition) {
    if(deleteConfirmEvalId!==definition.id){
      setDeleteConfirmEvalId(definition.id);
      return;
    }
    const remainingDefinitions=evalDefinitions.filter((item)=>item.id!==definition.id);
    const remainingVersions=evalVersions.filter((item)=>item.definition.id!==definition.id);
    const nextEvalId=activeEvalDefinition?.id===definition.id
      ? remainingDefinitions[0]?.id
      : activeEvalDefinition?.id;
    const nextVersion=nextEvalId
      ? [...remainingVersions].reverse().find((item)=>item.definition.id===nextEvalId)
      : undefined;
    const lifecycle=removeEvalLifecycleState(workspaceId,definition.id);
    setEvalDefinitions(remainingDefinitions);
    setEvalVersions(remainingVersions);
    setActiveEvalVersion(nextVersion?.version??0);
    setAutomationPolicies(lifecycle.policies);
    setRunHistory(lifecycle.runs);
    onAutomationPoliciesChange(lifecycle.policies);
    setDetailEvalId(null);
    setDeleteConfirmEvalId(null);
    setModal(null);
    setLifecycleMessage(`${definition.name} was deleted with its saved versions, automation setting, and run history.`);
  }

  const detailEvalDefinition=evalDefinitions.find((definition)=>definition.id===detailEvalId)??activeEvalDefinition;
  const activeCoverage=traces.length?activeTraceJudgeResults.length/traces.length:0;
  const activeHistoricalNeedsRetry=workspace!=="demo"&&Boolean(
    (latestHistoricalRun&&!historicalEvalRunCoversPopulation(latestHistoricalRun,traces.length))
    ||(!latestHistoricalRun&&activeTraceJudgeResults.length),
  );
  const hasHistoricalEvidence=workspace==="demo"
    ?Boolean(latestHistoricalRun||activeTraceJudgeResults.length)
    :historicalEvalRunCoversPopulation(latestHistoricalRun,traces.length);
  const activeHistoricalLifecycleStatus=historicalRunState==="running"
    ?"Running"
    :activeHistoricalNeedsRetry
      ?"Needs retry"
      :hasHistoricalEvidence?"Complete":"Not run";
  const activeHistoricalLifecycleDetail=historicalRunState==="running"
    ?`${historicalRunProgress.processed.toLocaleString()} of ${historicalRunProgress.total.toLocaleString()} processed · ${historicalRunProgress.scored.toLocaleString()} scored`
    :activeHistoricalNeedsRetry
      ?`${(latestHistoricalRun?.traceCount??activeTraceJudgeResults.length).toLocaleString()} of ${traces.length.toLocaleString()} scored before the run stopped`
      :latestHistoricalRun?`${latestHistoricalRun.traceCount} traces · ${pct(latestHistoricalRun.averageScore*100)} average`:activeTraceJudgeResults.length?`${activeTraceJudgeResults.length.toLocaleString()} traces scored`:`All ${traces.length.toLocaleString()} available traces`;

  return (
    <>
      <section className="evals-hero panel">
        <div>
          <p className="eyebrow">Eval library</p>
          <h2>Manage quality checks</h2>
          <p>See which evals are active, where they apply, and what needs attention next.</p>
        </div>
        <div className="eval-actions">
          <button type="button" className="primary" onClick={openCreateModal}>Create eval</button>
          <button type="button" onClick={openImportModal}>Import eval</button>
        </div>
      </section>

      <section className="eval-run-summary" aria-label="Eval library summary">
        <article className="panel eval-summary-card">
          <small>Active evals</small>
          <b>{enabledEvalCount.toLocaleString()}</b>
          <span>quality checks in this workspace</span>
        </article>
        <article className="panel eval-summary-card">
          <small>Trace coverage</small>
          <b>{pct(activeCoverage * 100)}</b>
          <span>scored by the current eval</span>
        </article>
        <button type="button" className="panel eval-summary-card eval-summary-action" onClick={() => onReviewFilter("unusual")}>
          <small>Needs attention</small>
          <b>{failing.toLocaleString()}</b>
          <span>current results below threshold</span>
        </button>
      </section>

      <section className="panel eval-library">
        <div className="eval-library-head">
          <div><p className="eyebrow">Workspace evals</p><h2>{evalDefinitions.length} eval{evalDefinitions.length===1?"":"s"}</h2></div>
          <p>Open an eval for its definition, versions, and advanced controls.</p>
        </div>
        {lifecycleMessage&&<p className="eval-lifecycle-message" role="status">{lifecycleMessage}</p>}
        {evalDefinitions.length?<div className="eval-library-table" role="table" aria-label="Workspace evals">
          <div className="eval-library-row eval-library-header" role="row">
            <span role="columnheader">Eval</span><span role="columnheader">Scope</span><span role="columnheader">Readiness</span><span role="columnheader">Last run</span><span role="columnheader">Coverage</span><span role="columnheader">Next action</span><span aria-hidden="true" />
          </div>
          {evalDefinitions.map((definition)=>{
            const definitionResults=traceJudgeResults.filter((result)=>result.eval_id===definition.id||(!result.eval_id&&result.evaluator_type.startsWith(definition.id)));
            const definitionRun=runHistory.find((run)=>run.evalId===definition.id);
            const definitionHistoricalRun=runHistory.find((run)=>run.evalId===definition.id&&run.mode==="historical_test");
            const isCurrent=definition.id===activeEvalDefinition?.id;
            const isLive=isCurrent&&Boolean(automationPolicy?.runOnNewTraces);
            const isHistoricalRunning=isCurrent&&historicalRunState==="running";
            const historicalTestComplete=workspace==="demo"
              ?Boolean(definitionHistoricalRun||definitionResults.length)
              :historicalEvalRunCoversPopulation(definitionHistoricalRun,traces.length);
            const needsHistoricalRetry=isCurrent&&!isHistoricalRunning&&Boolean(
              (definitionHistoricalRun&&!historicalTestComplete)||(!definitionHistoricalRun&&definitionResults.length),
            );
            const readiness=definition.status==="Disabled"?"Disabled":isHistoricalRunning?"Running":needsHistoricalRetry?"Needs retry":isLive?"Live":historicalTestComplete?"Tested":definitionResults.length?"Needs retry":definition.status==="Draft"?"Draft":"Needs test";
            const coverage=traces.length?definitionResults.length/traces.length:0;
            const runLabel=isHistoricalRunning
              ?`${historicalRunProgress.processed.toLocaleString()} / ${historicalRunProgress.total.toLocaleString()}`
              :needsHistoricalRetry
                ?`${(definitionHistoricalRun?.traceCount??definitionResults.length).toLocaleString()} / ${traces.length.toLocaleString()} before stop`
                :definitionRun?new Date(definitionRun.completedAt).toLocaleDateString(undefined,{month:"short",day:"numeric"}):definitionResults.length?`${definitionResults.length.toLocaleString()} scored`:"Never";
            return <div className={`eval-library-row ${isCurrent?"current":""}`} role="row" key={definition.id}>
              <span role="cell"><button type="button" className="eval-name-button" onClick={()=>openDetails(definition)}><b>{definition.name}</b><small>{definition.evaluator_type}</small></button></span>
              <span role="cell">{definition.scope}</span>
              <span role="cell"><span className={`eval-readiness eval-readiness-${readiness.toLowerCase().replace(/\s+/g,"-")}`}>{readiness}</span></span>
              <span role="cell">{runLabel}</span>
              <span role="cell">{pct(coverage*100)}</span>
              <span className="eval-next-action" role="cell">
                {definition.status==="Disabled"?<button type="button" onClick={()=>openDetails(definition)}>View details</button>
                  :isHistoricalRunning?<button type="button" className="primary" disabled>{`Testing ${historicalRunProgress.processed.toLocaleString()} / ${historicalRunProgress.total.toLocaleString()}…`}</button>
                  :needsHistoricalRetry?<button type="button" className="primary" disabled={!supportsLiveRuns||!traces.length} onClick={testHistoricalTraces}>Retry historical</button>
                  :isCurrent&&!hasHistoricalEvidence?<button type="button" className="primary" disabled={!supportsLiveRuns||!traces.length} onClick={testHistoricalTraces}>Test historical</button>
                  :isCurrent&&!isLive?<button type="button" className="primary" disabled={!supportsLiveRuns} onClick={()=>toggleNewTraceEvaluation(true)}>Run on new traces</button>
                  :isCurrent?<button type="button" onClick={()=>onReviewFilter("unusual")}>Review results</button>
                  :<button type="button" onClick={()=>openDetails(definition)}>View details</button>}
              </span>
              <button type="button" className="eval-row-menu" aria-label={`More options for ${definition.name}`} onClick={()=>openDetails(definition)}>•••</button>
            </div>;
          })}
        </div>:<article className="eval-empty-state">
          <p className="eyebrow">No evals in My workspace</p>
          <h2>Create an eval from your own evidence</h2>
          <p>Import a definition or create one after your traces and task groups are ready.</p>
          <div><button type="button" className="primary" onClick={openCreateModal}>Create eval</button><button type="button" onClick={openImportModal}>Import JSON</button></div>
        </article>}
      </section>

      {history.length>0&&<section className="panel eval-history">
        <div className="eval-history-head">
          <div>
            <p className="eyebrow">Historical quality</p>
            <h3>Month-over-month eval pass rate</h3>
          </div>
          <span>{history.length} months</span>
        </div>
        <div className="eval-history-chart" aria-label="Monthly eval pass-rate line chart">
          <svg viewBox={`0 0 ${evalChart.width} ${evalChart.height}`} role="img" aria-label="Eval pass rate by month">
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
                    <b>{month.label} · {pct(month.passRate * 100)}</b>
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
      </section>}
      {modal&&<div className="modal-layer" role="presentation" onClick={(event)=>{if(event.target===event.currentTarget)setModal(null)}}>
        {modal==="details"&&detailEvalDefinition?<section className="eval-modal eval-detail-modal" role="dialog" aria-modal="true" aria-labelledby="eval-detail-heading">
          <div className="modal-head"><div><p className="eyebrow">Eval details</p><h2 id="eval-detail-heading">{detailEvalDefinition.name}</h2></div><button type="button" onClick={()=>setModal(null)} aria-label="Close">×</button></div>
          {detailEvalDefinition.generation_basis&&<p className="eval-generation-note">This eval was automatically generated by inferring information from {Number(detailEvalDefinition.generation_basis.trace_count??0).toLocaleString()} imported cases. Edit and calibrate it against human labels before using it on your live traffic.</p>}
          <div className="eval-meta-grid">
            <div><small>Status</small><b>{detailEvalDefinition.status}</b></div>
            <div><small>Evaluator</small><b>{detailEvalDefinition.evaluator_type}</b></div>
            <div><small>Judge model</small><b>{detailEvalDefinition.model}</b></div>
            <div><small>Pass threshold</small><b>{pct(detailEvalDefinition.threshold*100)}</b></div>
          </div>
          <section className="eval-detail-section">
            <div><p className="eyebrow">Task scope</p><h3>{detailEvalDefinition.scope}</h3></div>
          </section>
          {evaluatorUsesJudgeModel(detailEvalDefinition.evaluator_type)&&<section className="eval-prompt eval-detail-prompt" aria-labelledby="eval-prompt-heading">
            <div className="eval-detail-prompt-head"><div><p className="eyebrow">LLM judge prompt</p><h3 id="eval-prompt-heading">Instructions sent to the judge model</h3></div><span>Read only</span></div>
            <pre>{detailEvalDefinition.prompt}</pre>
          </section>}
          <section className="eval-dimensions eval-detail-dimensions" aria-labelledby="eval-dimensions-heading">
            <h3 id="eval-dimensions-heading">Dimensions used</h3>
            {detailEvalDefinition.dimensions.map((dimension)=><span key={dimension}>{dimension}</span>)}
          </section>
          {detailEvalDefinition.id===activeEvalDefinition?.id&&<section className="eval-detail-lifecycle" aria-label="Eval lifecycle status">
            <article><small>Definition</small><b>Created</b><span>Version {activeVersion?.version??1}</span></article>
            <article><small>Historical test</small><b>{activeHistoricalLifecycleStatus}</b><span>{activeHistoricalLifecycleDetail}</span></article>
            <article><small>New traces</small><b>{automationPolicy?.runOnNewTraces?"On":"Off"}</b><span>{automationPolicy?.runOnNewTraces?"Scores newly ingested traces":"Enable after historical testing"}</span></article>
          </section>}
          <details className="eval-definition"><summary>Definition schema</summary><pre>{JSON.stringify(detailEvalDefinition,null,2)}</pre></details>
          <div className="eval-crud">
            <button type="button" className="primary" onClick={()=>openEdit(detailEvalDefinition)}>Edit definition</button>
            <button type="button" onClick={()=>downloadDefinition(detailEvalDefinition)}>Download JSON</button>
            {detailEvalDefinition.id===activeEvalDefinition?.id&&<button type="button" disabled={evalVersions.length<2} onClick={()=>setModal("versions")}>Manage versions</button>}
            <button type="button" disabled title="Not available in this preview">Duplicate</button>
            <button type="button" onClick={()=>toggleEvalDisabled(detailEvalDefinition)}>{detailEvalDefinition.status==="Disabled"?"Enable":"Disable"}</button>
            <button type="button" className={`danger ${deleteConfirmEvalId===detailEvalDefinition.id?"confirming":""}`} onClick={()=>deleteEvalDefinition(detailEvalDefinition)}>{deleteConfirmEvalId===detailEvalDefinition.id?"Confirm delete":"Delete"}</button>
          </div>
          {deleteConfirmEvalId===detailEvalDefinition.id&&<p className="eval-delete-warning" role="alert">Deleting removes this definition, its versions, automation setting, and run history. Historical trace records are not changed.</p>}
        </section>:modal==="versions"?<section className="eval-modal eval-version-modal" role="dialog" aria-modal="true" aria-labelledby="eval-version-heading">
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
