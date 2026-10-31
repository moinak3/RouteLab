import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { getModel } from "../core/catalog";
import { distinctTaskImpactBreakdown, familyCascade, MONTHLY_MULTIPLIER, type ReplayResult } from "../core/simulations";
import { liveRoutingStatus, runLiveDirectRouting, type LiveRunSource } from "../core/liveRouting";
import { evaluateLiveReplay } from "../core/simulationEvaluation";
import type { ActiveEvalConfig } from "../core/evalRegistry";
import { filterTracesByRange, type DateRange } from "../core/time";
import { traceJudgeResultsByTraceId } from "../core/traceJudge";
import type { CandidateRun, DistinctTaskBucket, EvalResult, GatewayProvider, Trace, Model, TraceJudgeResult } from "../types";
import { money, pct, preview, stripJudgeMarker } from "../lib/format";
import { distinctTaskValue } from "../components/DistinctTaskDisplay";
import { ModelOptions, ModelPicker } from "../components/ModelOptions";
import { RoutingPolicyPublisher } from "../components/RoutingPolicyPublisher";
import { reviseDraftRoutingPolicy } from "../core/routingDraft";
import { useRoutingPolicyDraft, type RoutingPolicySaveState } from "../core/useRoutingPolicyDraft";
import { taskGroupIdFromSearch } from "../core/taskGroupActions";
import { simulationScopeKey } from "../core/simulationScope";
import { mostCommonModelForTaskGroup } from "../core/distinctTasks";
import { ScenarioMetricRows, type ScenarioMetric } from "../components/SimulationMetricRows";
import { latestSimulationRun, saveSimulationRun, simulationRunComparisonKey } from "../core/simulationHistory";
function DistinctTaskScopePicker({ buckets, selectedIds, onChange, callCounts, totalCalls }: {
    buckets: DistinctTaskBucket[];
    selectedIds: string[];
    onChange: Dispatch<SetStateAction<string[]>>;
    callCounts: Map<string, number>;
    totalCalls: number;
}) {
    const [query, setQuery] = useState("");
    const detailsRef = useRef<HTMLDetailsElement | null>(null);
    const selectedSet = new Set(selectedIds);
    const filtered = buckets.filter(bucket => `${bucket.bucket_name} ${bucket.bucket_id} ${Object.values(bucket.task).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
    const filteredIds = filtered.map(bucket => bucket.bucket_id);
    const selectedCount = selectedIds.reduce((sum, id) => sum + (callCounts.get(id) ?? 0), 0);
    const summary = selectedIds.length ? `${selectedIds.length} selected · ${selectedCount.toLocaleString()} calls` : `All Task Groups · ${totalCalls.toLocaleString()} calls`;
    const toggle = (id: string) => onChange(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
    const selectFiltered = () => onChange(ids => [...new Set([...ids, ...filteredIds])]);
    useEffect(() => {
        const closeOnOutsideClick = (event: PointerEvent) => {
            if (detailsRef.current && event.target && !detailsRef.current.contains(event.target as Node)) {
                detailsRef.current.removeAttribute("open");
            }
        };
        document.addEventListener("pointerdown", closeOnOutsideClick);
        return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
    }, []);
    return <div className="scope-picker"><label>Task Group scope</label><details ref={detailsRef}><summary><span>{summary}</span><b>{selectedIds.length ? "Filtered" : "All"}</b></summary><div className="scope-menu"><input aria-label="Search Task Groups" placeholder="Search Task Groups" value={query} onChange={event => setQuery(event.target.value)}/><div className="scope-menu-actions"><button type="button" onClick={selectFiltered} disabled={!filtered.length}>Select all Task Groups</button><button type="button" onClick={() => onChange([])}>All tasks</button>{selectedIds.length > 0 && <button type="button" onClick={() => onChange([])}>Clear selected</button>}</div><div className="scope-menu-count">Showing <b>{filtered.length.toLocaleString()}</b> of <b>{buckets.length.toLocaleString()}</b> Task Groups</div><div className="scope-options">{filtered.length ? filtered.map(bucket => { const calls = callCounts.get(bucket.bucket_id) ?? 0; const selected = selectedSet.has(bucket.bucket_id); return <button type="button" className={`scope-option ${selected ? "selected" : ""}`} aria-pressed={selected} key={bucket.bucket_id} onClick={() => toggle(bucket.bucket_id)}><input type="checkbox" tabIndex={-1} checked={selected} readOnly aria-hidden="true"/><span><b>{bucket.bucket_name}</b><small>{distinctTaskValue("task_type", bucket.task.task_type)} · {distinctTaskValue("complexity", bucket.task.complexity)}</small></span><em>{calls.toLocaleString()} calls</em></button>; }) : <p>No matching Task Groups</p>}</div></div></details></div>;
}
const seededRandom = (seed: number) => {
    let state = seed % 2147483647;
    if (state <= 0)
        state += 2147483646;
    return () => (state = state * 16807 % 2147483647) / 2147483647;
};
const sampleTraces = (traces: Trace[], count: number, seed: number) => {
    if (count >= traces.length)
        return traces;
    const shuffled = [...traces];
    const random = seededRandom(seed);
    for (let index = shuffled.length - 1; index > 0; index--) {
        const swap = Math.floor(random() * (index + 1));
        [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return shuffled.slice(0, count);
};
type LiveDirectState = {
    result: ReplayResult;
    source: LiveRunSource;
    label: string;
    traces: Trace[];
    baselineResults: TraceJudgeResult[];
    completedAt: string;
};
type LiveReplayRow = {
    trace: Trace;
    run: CandidateRun;
    evaluation?: EvalResult;
    beforeScore?: number;
};
type PendingLiveReplay = {
    traces: Trace[];
    label: string;
};
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const compactMoney = (value: number) => value < .01 ? `$${value.toFixed(5)}` : money(value);
const scoreLabel = (value?: number) => Number.isFinite(value) ? pct((value ?? 0) * 100) : "Not scored";
const changeLabel = (value: number) => `${value > 0 ? "+" : ""}${pct(value)}`;
const pointChangeLabel = (value?: number) => value === undefined ? "n/a" : `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`;
function TaskImpactCells({ before, after, impact, tone, pending = false }: {
    before: string;
    after: string;
    impact: string;
    tone: "good" | "warn";
    pending?: boolean;
}) {
    return <>
        <td className="task-impact-value before">{before}</td>
        <td className="task-impact-value after"><strong aria-busy={pending}>{pending ? null : after}</strong></td>
        <td className="task-impact-value impact"><em className={pending ? undefined : tone} aria-busy={pending}>{pending ? null : impact}</em></td>
    </>;
}
const policySaveLabel = (state: RoutingPolicySaveState) => ({
    loading: "Loading saved draft",
    saving: "Saving to cloud",
    saved: "Saved to cloud",
    offline: "Saved in this browser",
    conflict: "Newer cloud draft found",
})[state];
function RunMetricPair({ current, candidate, label }: { current: string; candidate: string; label: string }) {
    return <div className="live-replay-comparison" aria-label={`Current ${label}: ${current}. Candidate ${label}: ${candidate}.`}>
      <span><small>Current</small><b>{current}</b></span>
      <span><small>Candidate</small><b>{candidate}</b></span>
    </div>;
}
function LiveReplayDetails({ liveDirect, pendingLiveReplay, judgeByTraceId }: {
    liveDirect: LiveDirectState | null;
    pendingLiveReplay: PendingLiveReplay | null;
    judgeByTraceId: Map<string, TraceJudgeResult>;
}) {
    const traces = liveDirect?.traces ?? pendingLiveReplay?.traces ?? [];
    const evalsByRunId = new Map(liveDirect?.result.evals.map(item => [item.candidate_run_id, item]) ?? []);
    const runsByTraceId = new Map(liveDirect?.result.runs.map(run => [run.trace_id, run]) ?? []);
    const rows: LiveReplayRow[] = traces.flatMap(trace => {
        const run = runsByTraceId.get(trace.id);
        if (!run)
            return [];
        return [{ trace, run, evaluation: evalsByRunId.get(run.id), beforeScore: judgeByTraceId.get(trace.id)?.score }];
    });
    const pendingRows = traces.filter(trace => !runsByTraceId.has(trace.id));
    const completedCount = rows.length;
    const beforeScores = rows.map(row => row.beforeScore).filter((value): value is number => typeof value === "number");
    const afterScores = rows.map(row => row.evaluation?.score).filter((value): value is number => typeof value === "number");
    const beforeCost = rows.reduce((sum, row) => sum + (row.trace.cost_usd ?? 0), 0);
    const afterCost = rows.reduce((sum, row) => sum + row.run.cost_usd, 0);
    const beforeLatency = average(rows.map(row => row.trace.latency_ms ?? 0));
    const afterLatency = average(rows.map(row => row.run.latency_ms));
    const label = liveDirect?.label ?? pendingLiveReplay?.label ?? "candidate model";
    const selectedModels = [...new Set(rows.map((row) => row.run.selected_model).filter(Boolean))] as string[];
    const evaluation = liveDirect?.result.evaluation;
    return <div className="live-replay-details">
    <div className="live-replay-head">
      <div><p className="eyebrow">Live candidate requests</p><h3>{traces.length.toLocaleString()} traces sent · {completedCount.toLocaleString()} completed</h3>
        <p className="live-replay-eval-proof">{evaluation
          ? <><b>Actual judge run:</b> {evaluation.eval_name} v{evaluation.eval_version} · {evaluation.judge_model}</>
          : "The active eval will grade each candidate response after it returns."}</p>
      </div>
      <span>{label}</span>
    </div>
    <div className="live-replay-summary">
      <div><small>Quality</small><b>{completedCount ? `${scoreLabel(average(beforeScores))} → ${scoreLabel(average(afterScores))}` : "Waiting for eval"}</b></div>
      <div><small>Cost</small><b>{completedCount ? `${compactMoney(beforeCost)} → ${compactMoney(afterCost)}` : "Waiting for response"}</b></div>
      <div><small>Latency</small><b>{completedCount ? `${beforeLatency.toFixed(0)}ms → ${afterLatency.toFixed(0)}ms` : "Waiting for response"}</b></div>
      <div><small>Models selected</small><b>{selectedModels.length ? selectedModels.join(", ") : "Waiting for response"}</b></div>
    </div>
    <div className="live-replay-table-wrap">
      <table className="live-replay-table">
        <colgroup>
          <col className="live-replay-trace-column" />
          <col className="live-replay-original-column" />
          <col className="live-replay-candidate-column" />
          <col className="live-replay-eval-column" />
          <col className="live-replay-cost-column" />
          <col className="live-replay-latency-column" />
        </colgroup>
        <thead><tr><th>Trace sent</th><th>Original response</th><th>OpenRouter response</th><th>Eval</th><th>Cost</th><th>Latency</th></tr></thead>
        <tbody>{pendingRows.map(trace => <tr key={`pending_${trace.id}`}>
          <td><b>{trace.id}</b><small>{preview(trace.prompt_text, 180)}</small></td>
          <td>{preview(stripJudgeMarker(trace.response_text ?? ""), 220)}</td>
          <td><span className="status pending">pending</span><p>Sent to {label}; waiting for candidate response.</p></td>
          <td><b>{scoreLabel(judgeByTraceId.get(trace.id)?.score)} → pending</b><small>Eval runs after the candidate response returns.</small></td>
          <td><RunMetricPair label="cost" current={compactMoney(trace.cost_usd ?? 0)} candidate="Pending" /></td>
          <td><RunMetricPair label="latency" current={`${(trace.latency_ms ?? 0).toFixed(0)}ms`} candidate="Pending" /></td>
        </tr>)}{rows.map(row => <tr key={row.run.id}>
          <td><b>{row.trace.id}</b><small>{preview(row.trace.prompt_text, 180)}</small></td>
          <td>{preview(stripJudgeMarker(row.trace.response_text ?? ""), 220)}</td>
          <td><span className={`status ${row.run.status}`}>{row.run.status}</span>{row.run.selected_model&&<small>Selected {row.run.selected_model}</small>}<p>{preview(stripJudgeMarker(row.run.response_text), 260)}</p></td>
          <td><b>{scoreLabel(row.beforeScore)} → {scoreLabel(row.evaluation?.score)}</b><small>{row.evaluation?.explanation ?? "No eval rationale returned."}</small></td>
          <td><RunMetricPair label="cost" current={compactMoney(row.trace.cost_usd ?? 0)} candidate={compactMoney(row.run.cost_usd)} /></td>
          <td><RunMetricPair label="latency" current={`${(row.trace.latency_ms ?? 0).toFixed(0)}ms`} candidate={`${row.run.latency_ms.toFixed(0)}ms`} /></td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
export function Simulations({ traces, traceJudgeResults = [], distinctTaskBuckets, candidate, setCandidate, catalogVersion, activeModels, candidateModels, familyApiKeys, gatewayApiKeys, serverGatewayKeys, workspaceId, activeEval }: {
    traces: Trace[];
    traceJudgeResults?: TraceJudgeResult[];
    distinctTaskBuckets: DistinctTaskBucket[];
    candidate: string;
    setCandidate: (v: string) => void;
    catalogVersion: number;
    activeModels: Model[];
    candidateModels: Model[];
    familyApiKeys: Partial<Record<Model["family"], string>>;
    gatewayApiKeys: Partial<Record<GatewayProvider, string>>;
    serverGatewayKeys?: Partial<Record<GatewayProvider, boolean>>;
    workspaceId: string;
    activeEval?: ActiveEvalConfig;
}) {
    const [distinctTaskBucketIds, setDistinctTaskBucketIds] = useState<string[]>(() => {
        const taskGroupId = taskGroupIdFromSearch(window.location.search);
        return taskGroupId ? [taskGroupId] : [];
    });
    const [strategy, setStrategy] = useState<"direct" | "family_cascade">("direct");
    const [dateRange, setDateRange] = useState<DateRange>("6m");
    const [requestLimitMode, setRequestLimitMode] = useState<"count" | "percent">("percent");
    const [requestLimitValue, setRequestLimitValue] = useState("100");
    const [sampleSeed, setSampleSeed] = useState(() => Date.now());
    const [liveDirect, setLiveDirect] = useState<LiveDirectState | null>(null);
    const [pendingLiveReplay, setPendingLiveReplay] = useState<PendingLiveReplay | null>(null);
    const [liveStatus, setLiveStatus] = useState<{
        state: "idle" | "running" | "error";
        message: string;
    }>({ state: "idle", message: "" });
    const liveAbortRef = useRef<AbortController | null>(null);
    const activeScopeKeyRef = useRef("");
    const hasActiveModels = candidateModels.length > 0;
    const defaultFallbackModelId = useMemo(() => {
        const counts = new Map<string, number>();
        traces.forEach(trace => counts.set(trace.model, (counts.get(trace.model) ?? 0) + 1));
        return activeModels.find(model => model.id === [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0])?.id
            ?? activeModels.find(model => model.quality_tier === "strong")?.id
            ?? activeModels[0]?.id
            ?? "";
    }, [activeModels, traces]);
    const { draftPolicy, setDraftPolicy, status: draftStatus, useServerDraft, retryMyDraft } = useRoutingPolicyDraft(defaultFallbackModelId, { workspaceId });
    const dateTraces = useMemo(() => filterTracesByRange(traces, dateRange), [traces, dateRange]);
    const dateTraceIds = useMemo(() => new Set(dateTraces.map(trace => trace.id)), [dateTraces]);
    const callCounts = useMemo(() => new Map(distinctTaskBuckets.map(bucket => [bucket.bucket_id, bucket.traces.filter(id => dateTraceIds.has(id)).length])), [distinctTaskBuckets, dateTraceIds]);
    useEffect(() => setDistinctTaskBucketIds(ids => ids.filter(id => distinctTaskBuckets.some(bucket => bucket.bucket_id === id))), [distinctTaskBuckets]);
    const selectedDistinctTasks = useMemo(() => distinctTaskBucketIds.length ? distinctTaskBucketIds.map(id => distinctTaskBuckets.find(bucket => bucket.bucket_id === id)).filter((bucket): bucket is DistinctTaskBucket => Boolean(bucket)) : distinctTaskBuckets, [distinctTaskBucketIds, distinctTaskBuckets]);
    const selectedTraceIds = useMemo(() => distinctTaskBucketIds.length ? new Set(selectedDistinctTasks.flatMap(bucket => bucket.traces)) : undefined, [distinctTaskBucketIds.length, selectedDistinctTasks]);
    const availableTraces = useMemo(() => selectedTraceIds ? dateTraces.filter(trace => selectedTraceIds.has(trace.id)) : dateTraces, [dateTraces, selectedTraceIds]);
    const requestLimit = useMemo(() => {
        const available = availableTraces.length;
        const raw = requestLimitValue.trim();
        if (!available)
            return { count: 0, message: "No requests match the current scope." };
        if (!raw)
            return { count: available, message: "No request limit entered; simulating all matching requests." };
        const parsed = Number(raw);
        if (!Number.isFinite(parsed))
            return { count: available, message: "Enter a valid number; simulating all matching requests." };
        if (parsed <= 0)
            return { count: available, message: "Enter a value above 0; simulating all matching requests." };
        if (requestLimitMode === "percent") {
            if (parsed > 100)
                return { count: available, message: "Percent capped at 100% of matching requests." };
            return { count: Math.max(1, Math.ceil(available * parsed / 100)), message: undefined };
        }
        const requested = Math.floor(parsed);
        if (requested > available)
            return { count: available, message: `Request count capped at ${available.toLocaleString()} matching requests.` };
        return { count: requested, message: parsed % 1 ? "Rounded down to a whole request count." : undefined };
    }, [availableTraces.length, requestLimitMode, requestLimitValue]);
    const selectedTraces = useMemo(() => sampleTraces(availableTraces, requestLimit.count, sampleSeed), [availableTraces, requestLimit.count, sampleSeed]);
    const activeScopeKey = simulationScopeKey({
        candidateId: candidate,
        dateRange,
        requestCount: requestLimit.count,
        taskGroupIds: distinctTaskBucketIds,
        traceIds: availableTraces.map(trace => trace.id),
    });
    activeScopeKeyRef.current = activeScopeKey;
    const comparisonKey = simulationRunComparisonKey({
        scopeKey: activeScopeKey,
        evalId: activeEval?.definition.id,
        evalVersion: activeEval?.version,
    });
    const liveKeyStatus = useMemo(() => liveRoutingStatus(candidate, { familyApiKeys, gatewayApiKeys, serverGatewayKeys }), [candidate, familyApiKeys, gatewayApiKeys, serverGatewayKeys]);
    const isDecisionCandidate = getModel(candidate)?.deployment_type === "decision_model";
    const activeBaselineResults = useMemo(() => activeEval
        ? traceJudgeResults.filter(result => (
            result.eval_id === activeEval.definition.id && result.eval_version === activeEval.version
        ) || (
            !result.eval_id && result.evaluator_type.startsWith(activeEval.definition.id)
        ))
        : [], [traceJudgeResults, activeEval]);
    const judgeByTraceId = useMemo(() => traceJudgeResultsByTraceId(liveDirect?.baselineResults ?? activeBaselineResults), [liveDirect, activeBaselineResults]);
    const hydrateSavedRun = () => {
        const saved = latestSimulationRun(workspaceId, comparisonKey);
        if (!saved) return null;
        const tracesById = new Map(traces.map((trace) => [trace.id, trace]));
        const runTraces = saved.traceIds.map((id) => tracesById.get(id)).filter((trace): trace is Trace => Boolean(trace));
        if (runTraces.length !== saved.traceIds.length) return null;
        return {
            result: saved.result,
            source: saved.source,
            label: saved.label,
            traces: runTraces,
            baselineResults: saved.baselineResults,
            completedAt: saved.completedAt,
        } satisfies LiveDirectState;
    };
    const restorePreviousRun = () => {
        const restored = hydrateSavedRun();
        setLiveDirect(restored);
        return restored;
    };
    const stopLiveReplay = () => {
        liveAbortRef.current?.abort();
        liveAbortRef.current = null;
        setPendingLiveReplay(null);
        const restored = restorePreviousRun();
        setLiveStatus({ state: "idle", message: restored ? "Simulation stopped. Showing the latest completed run for this comparison." : "Simulation stopped. No new comparison was saved." });
    };
    useEffect(() => () => liveAbortRef.current?.abort(), []);
    useEffect(() => {
        const changes: Partial<typeof draftPolicy> = {};
        if (!activeModels.some(model => model.id === draftPolicy.defaultModelId) && defaultFallbackModelId) changes.defaultModelId = defaultFallbackModelId;
        if (Object.keys(changes).length) setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, changes));
    }, [activeModels, defaultFallbackModelId, draftPolicy.defaultModelId]);
    useEffect(() => {
        liveAbortRef.current?.abort();
        liveAbortRef.current = null;
        setPendingLiveReplay(null);
        const restored = hydrateSavedRun();
        setLiveDirect(restored);
        setLiveStatus({
            state: "idle",
            message: restored ? `Showing the latest completed run from ${new Date(restored.completedAt).toLocaleString()}.` : "",
        });
    }, [comparisonKey, workspaceId, traces]);
    const runDirect = async () => {
        if (isDecisionCandidate) {
            setLiveStatus({ state: "error", message: "Jev is available through OpenRouter's Decisions API for classification and routing, but it cannot generate candidate responses for this replay." });
            return;
        }
        if (!activeEval) {
            setLiveStatus({ state: "error", message: "Create and test an eval before running a quality comparison. RouteLab will not substitute a heuristic score." });
            return;
        }
        const runScopeKey = activeScopeKey;
        const nextSeed = Date.now() + Math.floor(Math.random() * 1000000);
        const runTraces = sampleTraces(availableTraces, requestLimit.count, nextSeed);
        setSampleSeed(nextSeed);
        setStrategy("direct");
        if (!liveKeyStatus) {
            const model = getModel(candidate);
            const message = candidate === "openrouter-auto"
                ? "OpenRouter Auto Router must be evaluated with a live OpenRouter key so RouteLab can measure its actual model selections, cost, latency, and quality."
                : model?.pricing_source === "OpenRouter"
                ? `No OpenRouter API key found for ${model.display_name}. Add one in Settings or restart the dev server with OPENROUTER_API_KEY. No candidate result was generated.`
                : "No API key is configured for this candidate. No candidate result was generated.";
            setPendingLiveReplay(null);
            setLiveStatus({ state: "idle", message });
            return;
        }
        if (!runTraces.length) {
            setLiveStatus({ state: "error", message: "No requests match the current simulation scope." });
            return;
        }
        liveAbortRef.current?.abort();
        const controller = new AbortController();
        liveAbortRef.current = controller;
        setLiveDirect(null);
        setPendingLiveReplay({ traces: runTraces, label: liveKeyStatus.label });
        setLiveStatus({ state: "running", message: `Sending ${runTraces.length.toLocaleString()} request${runTraces.length === 1 ? "" : "s"} through ${liveKeyStatus.label}...` });
        try {
            const live = await runLiveDirectRouting(runTraces, candidate, { familyApiKeys, gatewayApiKeys, serverGatewayKeys }, controller.signal);
            if (controller.signal.aborted || activeScopeKeyRef.current !== runScopeKey)
                return;
            setLiveStatus({ state: "running", message: `Candidate responses received. Scoring original and candidate responses with ${activeEval.definition.name} v${activeEval.version}…` });
            const evaluated = await evaluateLiveReplay({
                workspaceId,
                activeEval,
                traces: runTraces,
                runs: live.runs,
                existingBaselineResults: traceJudgeResults,
                signal: controller.signal,
            });
            if (controller.signal.aborted || activeScopeKeyRef.current !== runScopeKey)
                return;
            const failures = live.runs.filter(run => run.status === "error").length;
            const completedAt = new Date().toISOString();
            const completedRun: LiveDirectState = { result: evaluated.result, source: live.source, label: live.label, traces: runTraces, baselineResults: evaluated.baselineResults, completedAt };
            setLiveDirect(completedRun);
            saveSimulationRun(workspaceId, {
                id: `simulation_${Date.now()}`,
                comparisonKey,
                candidateId: candidate,
                completedAt,
                source: live.source,
                label: live.label,
                traceIds: runTraces.map((trace) => trace.id),
                baselineResults: evaluated.baselineResults,
                result: evaluated.result,
            });
            setPendingLiveReplay(null);
            setLiveStatus({ state: failures ? "error" : "idle", message: failures ? `${failures.toLocaleString()} of ${live.runs.length.toLocaleString()} live requests failed; failed requests count as unsuccessful outcomes.` : `Live replay and paired eval completed through ${live.label}.` });
        }
        catch (error) {
            if (controller.signal.aborted) {
                const restored = restorePreviousRun();
                setLiveStatus({ state: "idle", message: restored ? "Simulation stopped. Showing the latest completed run for this comparison." : "Simulation stopped. No new comparison was saved." });
                return;
            }
            restorePreviousRun();
            setPendingLiveReplay(null);
            setLiveStatus({ state: "error", message: error instanceof Error ? error.message : "Live direct routing failed." });
        }
        finally {
            if (liveAbortRef.current === controller)
                liveAbortRef.current = null;
        }
    };
    const liveReplayPending = strategy === "direct" && liveStatus.state === "running";
    const scenarioTraces = strategy === "direct" ? liveDirect?.traces ?? pendingLiveReplay?.traces ?? selectedTraces : selectedTraces;
    const simulation = useMemo(() => hasActiveModels ? (strategy === "direct" ? liveDirect?.result : familyCascade(selectedTraces, candidate)) : undefined, [strategy, liveDirect, selectedTraces, candidate, catalogVersion, hasActiveModels]);
    const baselineResults = liveDirect?.baselineResults ?? activeBaselineResults;
    const distinctTaskImpact = useMemo(() => simulation ? distinctTaskImpactBreakdown(scenarioTraces, selectedDistinctTasks, simulation, baselineResults) : [], [simulation, scenarioTraces, selectedDistinctTasks, baselineResults]);
    const currentModelByTaskGroup = useMemo(() => new Map(distinctTaskBuckets.map(bucket => {
        const modelId = mostCommonModelForTaskGroup(bucket, traces);
        return [bucket.bucket_id, modelId ? getModel(modelId)?.display_name ?? modelId : "Not recorded"];
    })), [distinctTaskBuckets, traces]);
    if (!hasActiveModels)
        return <section className="panel"><p className="eyebrow">Simulations</p><h2>No enabled models</h2><p>Enable at least one model in Model Catalog before running simulations.</p></section>;
    const candidateName = getModel(candidate)?.display_name ?? candidate;
    const candidateFamily = getModel(candidate)?.family ?? candidateName;
    const providerName = strategy === "direct" ? liveDirect?.label ?? pendingLiveReplay?.label : undefined;
    const providerId = strategy === "direct" ? liveDirect?.result.runs[0]?.provider_id : undefined;
    const candidateRouteName = providerName ? `${candidateName} via ${providerName}` : candidateName;
    const isAutoRouter = candidate === "openrouter-auto";
    const defaultStrategyValue = draftPolicy.defaultStrategyType === "openrouter_auto" ? "openrouter-auto" : draftPolicy.defaultModelId;
    const setDefaultStrategy = (value: string) => {
        if (value === "openrouter-auto") {
            setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, { defaultStrategyType: "openrouter_auto" }));
            return;
        }
        const model = getModel(value);
        setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, {
            defaultStrategyType: "fixed_model",
            defaultModelId: value,
            defaultOpenRouterModelId: model?.pricing_source_model_id,
        }));
    };
    const setTaskOverride = (row: (typeof distinctTaskImpact)[number]) => setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, { overrides: { ...policy.overrides, [row.distinct_task_bucket_id]: { taskId: row.distinct_task_bucket_id, taskName: row.name, modelId: candidate, modelName: candidateName, openRouterModelId: getModel(candidate)?.pricing_source_model_id, provider: providerName, providerId, passRate: row.quality.after_pass_rate, costDeltaPct: row.cost.delta_pct, latencyDeltaPct: row.latency.delta_pct, replayCount: row.trace_count, updatedAt: new Date().toISOString() } } }));
    const removeTaskOverride = (taskId: string) => setDraftPolicy(policy => { const overrides = { ...policy.overrides }; delete overrides[taskId]; return reviseDraftRoutingPolicy(policy, { overrides }); });
    const scopeName = distinctTaskBucketIds.length === 0 ? "All traffic" : distinctTaskBucketIds.length === 1 ? selectedDistinctTasks[0]?.bucket_name ?? "Selected Task Group" : `${distinctTaskBucketIds.length} selected Task Groups`;
    const baselineJudges = scenarioTraces.map(trace => judgeByTraceId.get(trace.id)).filter((judge): judge is TraceJudgeResult => Boolean(judge));
    const baselineAverageScore = baselineJudges.length ? average(baselineJudges.map((judge) => judge.score)) : undefined;
    const hasMeasuredQuality = Boolean(liveDirect?.result.evaluation);
    const metricRows: ScenarioMetric[] = simulation ? [
        { label: "Projected monthly cost", before: money(simulation.summary.baseline_cost_usd * MONTHLY_MULTIPLIER), after: money(simulation.summary.simulated_cost_usd * MONTHLY_MULTIPLIER), change: changeLabel(-simulation.summary.estimated_savings_pct), good: simulation.summary.estimated_savings_usd >= 0 },
        { label: "Average latency", before: `${simulation.summary.baseline_avg_latency_ms.toFixed(0)}ms`, after: `${simulation.summary.simulated_avg_latency_ms.toFixed(0)}ms`, change: changeLabel(simulation.summary.latency_delta_pct), good: simulation.summary.latency_delta_pct <= 0 },
        { label: "Average eval score", before: baselineAverageScore === undefined ? "Not scored" : pct(baselineAverageScore * 100), after: hasMeasuredQuality ? pct(simulation.summary.average_quality_score * 100) : "Not evaluated", change: hasMeasuredQuality && baselineAverageScore !== undefined ? pointChangeLabel((simulation.summary.average_quality_score - baselineAverageScore) * 100) : "n/a", good: baselineAverageScore === undefined || simulation.summary.average_quality_score >= baselineAverageScore },
    ] : [];
    const currentCost = scenarioTraces.reduce((sum, trace) => sum + (trace.cost_usd ?? 0), 0) * MONTHLY_MULTIPLIER;
    const currentLatency = average(scenarioTraces.map((trace) => trace.latency_ms ?? 0));
    const currentTaskMetrics = selectedDistinctTasks.flatMap((bucket) => {
        const traceIds = new Set(bucket.traces);
        const groupTraces = scenarioTraces.filter((trace) => traceIds.has(trace.id));
        if (!groupTraces.length) return [];
        const groupJudges = groupTraces.map((trace) => judgeByTraceId.get(trace.id)).filter((judge): judge is TraceJudgeResult => Boolean(judge));
        return [{
            id: bucket.bucket_id,
            name: bucket.bucket_name,
            traceCount: groupTraces.length,
            monthlyCost: groupTraces.reduce((sum, trace) => sum + (trace.cost_usd ?? 0), 0) * MONTHLY_MULTIPLIER,
            latency: average(groupTraces.map((trace) => trace.latency_ms ?? 0)),
            averageScore: groupJudges.length ? average(groupJudges.map((judge) => judge.score)) : undefined,
            scored: groupJudges.length,
        }];
    });
    return <>
<section className="sim-builder scenario-builder">
<div className="scenario-controls">
<div className="compact-select">
<label>Candidate model</label>
<ModelPicker models={candidateModels} value={candidate} onChange={setCandidate}/>
</div>
<DistinctTaskScopePicker buckets={distinctTaskBuckets} selectedIds={distinctTaskBucketIds} onChange={setDistinctTaskBucketIds} callCounts={callCounts} totalCalls={dateTraces.length}/>
<div className="range-control">
<label>Simulation date range</label>
<div className="range-tabs" role="group" aria-label="Simulation date range">{([["7d", "L7D"], ["30d", "L30D"], ["6m", "L6M"]] as Array<[
        DateRange,
        string
    ]>).map(([value, label]) => <button type="button" aria-pressed={dateRange === value} className={dateRange === value ? "active" : ""} onClick={() => setDateRange(value)} key={value}>{label}</button>)}</div>
</div>
<div className={`request-limit ${requestLimit.message ? "has-warning" : ""}`}>
<label>Requests to simulate</label>
<div>
<select aria-label="Request limit type" value={requestLimitMode} onChange={event => setRequestLimitMode(event.target.value as "count" | "percent")}>
<option value="percent">% of requests</option>
<option value="count">Exact count</option>
</select>
<input aria-label="Requests to simulate" inputMode="decimal" value={requestLimitValue} onChange={event => setRequestLimitValue(event.target.value)} placeholder={requestLimitMode === "percent" ? "100" : "500"}/>
</div>{requestLimit.message && <small>{requestLimit.message}</small>}</div>
<p className="scenario-note">{liveDirect && strategy === "direct" ? `Latest measured replay via ${liveDirect.label}` : "Current production baseline · no candidate replay results yet"} · {scenarioTraces.length.toLocaleString()} of {availableTraces.length.toLocaleString()} matching LLM calls · monthly projection = selected sample × {MONTHLY_MULTIPLIER}</p>
{isDecisionCandidate && <p className="simulation-model-compatibility">Jev is a structured decision model. Use it for task classification and routing decisions; it does not return agent responses for before/after replay.</p>}
{!activeEval && <p className="simulation-model-compatibility">No active eval version is available. Create and test an eval before comparing model quality.</p>}
</div>
<div className="sim-actions">
<button className={strategy === "direct" ? "primary" : ""} disabled={liveStatus.state === "running" || !activeEval} onClick={runDirect}>{liveStatus.state === "running" ? "Running live replay..." : "Simulate direct routing"}</button>{liveStatus.state === "running" && <button type="button" className="stop-simulation" onClick={stopLiveReplay}>Stop simulation</button>}
</div>
{liveStatus.message && <p className={`simulation-run-status ${liveStatus.state}`} role="status" aria-live="polite">{liveStatus.message}</p>}
</section>
<section className="scenario-results panel">
<div className="panelhead">
<div>
<p className="eyebrow">{simulation ? "Overall impact" : "Current traffic"}</p>
<h2>{simulation ? `${scopeName} → ${strategy === "family_cascade" ? `${candidateFamily} enabled family cascade` : candidateRouteName}` : `${scopeName} baseline`}</h2>
<p className="impact-explainer">{simulation ? "Before uses observed production traces. After uses the latest completed candidate replay for this exact scope." : "These are observed metrics from the currently selected traces. Run a candidate simulation to create a measured before-and-after comparison."}</p>
{activeEval && <p className="impact-explainer"><b>Shared eval:</b> {activeEval.definition.name} v{activeEval.version} · {activeEval.definition.model}. Original and candidate responses use this same frozen rubric.</p>}
</div>
<span>{scenarioTraces.length.toLocaleString()} calls</span>
</div>
{simulation ? <div className="scenario-metrics">
<div className="scenario-metric-head">
<b>Metric</b>
<span>Before · current</span>
<span>After · candidate</span>
<span>Impact</span>
</div><ScenarioMetricRows rows={metricRows} pending={liveReplayPending} requiresLiveReplay={false}/></div> : <div className="current-baseline-grid">
<div><small>Projected monthly cost</small><b>{money(currentCost)}</b></div>
<div><small>Average latency</small><b>{currentLatency.toFixed(0)}ms</b></div>
<div><small>Average eval score</small><b>{baselineAverageScore === undefined ? "Not scored" : pct(baselineAverageScore * 100)}</b><span>{baselineJudges.length.toLocaleString()} of {scenarioTraces.length.toLocaleString()} traces scored</span></div>
</div>}
<div className="scenario-foot">
{liveReplayPending?<span>Waiting for completed candidate responses and paired eval scores.</span>:simulation && hasMeasuredQuality?<><span>Completed {new Date(liveDirect!.completedAt).toLocaleString()}</span><span>Candidate average eval score: {pct(simulation.summary.average_quality_score * 100)}</span></>:<span>No candidate results are shown until a measured replay completes.</span>}{strategy === "family_cascade" && simulation && <span>Escalation: {pct((simulation.summary.escalation_rate ?? 0) * 100)}</span>}</div>{strategy === "family_cascade" && simulation && <p className="scope-note">Escalated requests are re-run and re-scored on the fallback model; costs and latency include both passes.</p>}{strategy === "direct" && (liveDirect || pendingLiveReplay) && <LiveReplayDetails liveDirect={liveDirect} pendingLiveReplay={pendingLiveReplay} judgeByTraceId={judgeByTraceId}/>}</section>
<section className="panel routing-policy-builder">
<div className="panelhead"><div><p className="eyebrow">Routing policy builder</p><h2>Choose task overrides and configure the unmatched path</h2><p className="impact-explainer">Review the measured quality, cost, and latency for each Task Group, then decide whether to use the candidate model. Unselected tasks continue using the configured default strategy.</p></div><div className={`policy-save-state ${draftStatus.state}`}><span>Draft v{draftPolicy.version} · {policySaveLabel(draftStatus.state)}</span>{draftStatus.imported ? <small>Browser draft imported</small> : null}{draftStatus.state === "conflict" ? <div><button type="button" onClick={retryMyDraft}>Keep my changes</button><button type="button" onClick={useServerDraft}>Use cloud draft</button></div> : null}</div></div>
<div className="policy-flow"><div><small>Matched task override</small><b>{Object.keys(draftPolicy.overrides).length ? `${Object.keys(draftPolicy.overrides).length} task override${Object.keys(draftPolicy.overrides).length === 1 ? "" : "s"}` : "No overrides yet"}</b><span>Use the model explicitly chosen for that Task Group</span></div><i>else</i><label className="policy-default-route"><small>Default strategy</small><select aria-label="Default strategy" value={defaultStrategyValue} onChange={event => setDefaultStrategy(event.target.value)}><option value="openrouter-auto">OpenRouter Auto Router</option><ModelOptions models={activeModels}/></select><span>Used for every request without a matched task override</span></label></div>
{Object.values(draftPolicy.overrides).length > 0 && <div className="policy-overrides"><h3>Current task overrides</h3>{Object.values(draftPolicy.overrides).map(override => <article key={override.taskId}><div><small>{override.taskName}</small><b>{override.modelName}{override.provider ? ` via ${override.provider}` : ""}</b></div><p>{pct(override.passRate * 100)} pass · {changeLabel(override.costDeltaPct)} cost · {changeLabel(override.latencyDeltaPct)} latency · {override.replayCount} traces</p><button type="button" onClick={() => removeTaskOverride(override.taskId)}>Remove override</button></article>)}</div>}
<RoutingPolicyPublisher
  workspaceId={workspaceId}
  signatures={distinctTaskBuckets.map((bucket) => ({
    id: bucket.bucket_id,
    label: bucket.bucket_name,
    description: `${bucket.task.task_type} in ${bucket.task.domain}; ${bucket.task.complexity} complexity; ${bucket.task.output_format} output`,
    riskLevel: bucket.risk_level,
    task: bucket.task,
    examples: bucket.examples.map((example) => example.prompt_preview).filter(Boolean).slice(0, 3),
  }))}
  draftRevision={draftStatus.revision}
  draftSaved={draftStatus.state === "saved"}
/>
</section>
<section className="panel task-impact-panel">
<div className="panelhead">
<div>
<p className="eyebrow">{simulation ? "Impact by Task Group" : "Current metrics by Task Group"}</p>
<h2>{simulation ? "Before and after by Task Group" : "Observed task-group baseline"}</h2>
<p className="impact-explainer">{simulation ? "Cost is the projected monthly run rate. Latency is the average per request. Quality is the average score returned by the shared eval rubric; its impact is shown in percentage points." : "No candidate comparison exists for this selection yet. These values come only from the currently selected production traces."}</p>
</div>
<span>{simulation ? `${scopeName} → ${strategy === "family_cascade" ? `${candidateFamily} enabled cascade` : candidateRouteName}` : scopeName}</span>
</div>
<div className="task-impact-wrap">
{simulation ? <table className="task-impact-table">
<colgroup>
<col className="task-impact-task-col" />
<col span={6} className="task-impact-metric-col" />
<col className="task-impact-quality-before-col" />
<col className="task-impact-quality-after-col" />
<col className="task-impact-quality-impact-col" />
<col className="task-impact-action-col" />
</colgroup>
<thead>
<tr>
<th rowSpan={2}>Task Group</th>
<th colSpan={3} scope="colgroup">Cost / month</th>
<th colSpan={3} scope="colgroup">Average latency</th>
<th colSpan={3} scope="colgroup">Average eval score</th>
<th rowSpan={2}>Model choice</th>
</tr>
<tr className="task-impact-subhead">
<th>Before</th><th>After</th><th>Impact</th>
<th>Before</th><th>After</th><th>Impact</th>
<th>Before</th><th>After</th><th>Impact</th>
</tr>
</thead>
<tbody>{distinctTaskImpact.map(row => {
const activeOverride = draftPolicy.overrides[row.distinct_task_bucket_id];
const candidateIsActive = activeOverride?.modelId === candidate && activeOverride?.provider === providerName;
return <tr key={row.distinct_task_bucket_id}>
<td>
<b>{row.name}</b>
<small>{row.trace_count.toLocaleString()} replayed trace{row.trace_count === 1 ? "" : "s"}</small>
<small className="current-task-model">Current model: {currentModelByTaskGroup.get(row.distinct_task_bucket_id) ?? "Not recorded"}</small>
</td>
<TaskImpactCells before={money(row.cost.before_monthly_usd)} after={money(row.cost.after_monthly_usd)} impact={changeLabel(row.cost.delta_pct)} tone={row.cost.delta_pct <= 0 ? "good" : "warn"} pending={liveReplayPending}/>
<TaskImpactCells before={`${row.latency.before_ms.toFixed(0)}ms`} after={`${row.latency.after_ms.toFixed(0)}ms`} impact={changeLabel(row.latency.delta_pct)} tone={row.latency.delta_pct <= 0 ? "good" : "warn"} pending={liveReplayPending}/>
<TaskImpactCells before={row.quality.before_average_score === undefined ? "Not scored" : pct(row.quality.before_average_score * 100)} after={hasMeasuredQuality ? pct(row.quality.after_average_score * 100) : "Not evaluated"} impact={hasMeasuredQuality ? pointChangeLabel(row.quality.delta_points) : "n/a"} tone={(row.quality.delta_points ?? 0) >= 0 ? "good" : "warn"} pending={liveReplayPending}/>
<td className="route-action">{liveReplayPending ? <><span className="route-ineligible">Simulation in progress</span><small>The model choice becomes available after the replay completes.</small></> : !hasMeasuredQuality ? <><span className="route-ineligible">Live eval required</span><small>Run the candidate and shared rubric before choosing an override.</small></> : isAutoRouter ? <><span className="route-ineligible">Default strategy only</span><small>Auto Router results are measured live but are not promoted as a fixed task override.</small></> : strategy !== "direct" ? <><span className="route-ineligible">Direct replay required</span><small>Cascades need a separate policy rule.</small></> : <><button type="button" className={candidateIsActive ? "active" : ""} disabled={candidateIsActive} onClick={() => setTaskOverride(row)}>{candidateIsActive ? "Override active" : activeOverride ? `Replace ${activeOverride.modelName}` : `Use ${candidateName}`}</button>{!candidateIsActive && <small>You decide after reviewing the measured tradeoffs.</small>}</>}</td>
</tr>;
})}</tbody>
</table> : <table className="task-impact-table current-task-metrics-table">
<thead><tr><th>Task Group</th><th>Current cost / month</th><th>Current latency</th><th>Current average eval score</th><th>Current model</th></tr></thead>
<tbody>{currentTaskMetrics.map((row) => <tr key={row.id}>
<td><b>{row.name}</b><small>{row.traceCount.toLocaleString()} selected trace{row.traceCount === 1 ? "" : "s"}</small></td>
<td className="task-impact-value">{money(row.monthlyCost)}</td>
<td className="task-impact-value">{row.latency.toFixed(0)}ms</td>
<td className="task-impact-value">{row.averageScore === undefined ? "Not scored" : pct(row.averageScore * 100)}<small>{row.scored.toLocaleString()} scored</small></td>
<td><span className="current-task-model">{currentModelByTaskGroup.get(row.id) ?? "Not recorded"}</span></td>
</tr>)}</tbody>
</table>}
</div>
</section>
</>;
}
