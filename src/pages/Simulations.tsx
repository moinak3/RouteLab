import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { getModel } from "../core/catalog";
import { distinctTaskImpactBreakdown, familyCascade, MONTHLY_MULTIPLIER, replay, replayFromRuns, type ReplayResult } from "../core/simulations";
import { liveRoutingStatus, runLiveDirectRouting, type LiveRunSource } from "../core/liveRouting";
import { filterTracesByRange, type DateRange } from "../core/time";
import { traceJudgeResultsByTraceId } from "../core/traceJudge";
import type { CandidateRun, DistinctTaskBucket, EvalResult, GatewayProvider, Trace, Model, TraceJudgeResult } from "../types";
import { money, pct, preview, stripJudgeMarker } from "../lib/format";
import { distinctTaskValue } from "../components/DistinctTaskDisplay";
import { ModelOptions, ModelPicker } from "../components/ModelOptions";
import { RoutingPolicyPublisher } from "../components/RoutingPolicyPublisher";
import { assessRouteCandidate, DEFAULT_ROUTE_GUARDRAILS, reviseDraftRoutingPolicy } from "../core/routingDraft";
import { useRoutingPolicyDraft, type RoutingPolicySaveState } from "../core/useRoutingPolicyDraft";
import { taskGroupIdFromSearch } from "../core/taskGroupActions";
import { simulationScopeKey } from "../core/simulationScope";
import { mostCommonModelForTaskGroup } from "../core/distinctTasks";
import { ScenarioMetricRows, type ScenarioMetric } from "../components/SimulationMetricRows";
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
function TaskImpactValues({ before, after, impact, tone, pending = false }: {
    before: string;
    after: string;
    impact: string;
    tone: "good" | "warn";
    pending?: boolean;
}) {
    return <div className="task-impact-values">
        <span><small>Before</small>{before}</span>
        <span><small>After</small><strong aria-busy={pending}>{pending ? null : after}</strong></span>
        <span><small>Impact</small><em className={pending ? undefined : tone} aria-busy={pending}>{pending ? null : impact}</em></span>
    </div>;
}
const policySaveLabel = (state: RoutingPolicySaveState) => ({
    loading: "Loading saved draft",
    saving: "Saving to cloud",
    saved: "Saved to cloud",
    offline: "Saved in this browser",
    conflict: "Newer cloud draft found",
})[state];
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
    return <div className="live-replay-details">
    <div className="live-replay-head">
      <div><p className="eyebrow">Live candidate requests</p><h3>{traces.length.toLocaleString()} traces sent · {completedCount.toLocaleString()} completed</h3></div>
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
        <thead><tr><th>Trace sent</th><th>Original response</th><th>OpenRouter response</th><th>Eval</th><th>Cost</th><th>Latency</th></tr></thead>
        <tbody>{pendingRows.map(trace => <tr key={`pending_${trace.id}`}>
          <td><b>{trace.id}</b><small>{preview(trace.prompt_text, 180)}</small></td>
          <td>{preview(stripJudgeMarker(trace.response_text ?? ""), 220)}</td>
          <td><span className="status pending">pending</span><p>Sent to {label}; waiting for candidate response.</p></td>
          <td><b>{scoreLabel(judgeByTraceId.get(trace.id)?.score)} → pending</b><small>Eval runs after the candidate response returns.</small></td>
          <td>{compactMoney(trace.cost_usd ?? 0)} → pending</td>
          <td>{(trace.latency_ms ?? 0).toFixed(0)}ms → pending</td>
        </tr>)}{rows.map(row => <tr key={row.run.id}>
          <td><b>{row.trace.id}</b><small>{preview(row.trace.prompt_text, 180)}</small></td>
          <td>{preview(stripJudgeMarker(row.trace.response_text ?? ""), 220)}</td>
          <td><span className={`status ${row.run.status}`}>{row.run.status}</span>{row.run.selected_model&&<small>Selected {row.run.selected_model}</small>}<p>{preview(stripJudgeMarker(row.run.response_text), 260)}</p></td>
          <td><b>{scoreLabel(row.beforeScore)} → {scoreLabel(row.evaluation?.score)}</b><small>{row.evaluation?.explanation ?? "No eval rationale returned."}</small></td>
          <td>{compactMoney(row.trace.cost_usd ?? 0)} → {compactMoney(row.run.cost_usd)}</td>
          <td>{(row.trace.latency_ms ?? 0).toFixed(0)}ms → {row.run.latency_ms.toFixed(0)}ms</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
export function Simulations({ traces, traceJudgeResults = [], distinctTaskBuckets, candidate, setCandidate, catalogVersion, activeModels, candidateModels, familyApiKeys, gatewayApiKeys, serverGatewayKeys, workspaceId }: {
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
    const direct = useMemo(() => hasActiveModels ? replay(selectedTraces, candidate) : undefined, [selectedTraces, candidate, catalogVersion, hasActiveModels]);
    const liveKeyStatus = useMemo(() => liveRoutingStatus(candidate, { familyApiKeys, gatewayApiKeys, serverGatewayKeys }), [candidate, familyApiKeys, gatewayApiKeys, serverGatewayKeys]);
    const judgeByTraceId = useMemo(() => traceJudgeResultsByTraceId(traceJudgeResults), [traceJudgeResults]);
    const stopLiveReplay = () => { liveAbortRef.current?.abort(); liveAbortRef.current = null; setPendingLiveReplay(null); setLiveStatus({ state: "idle", message: "Simulation stopped. Showing the last available deterministic replay results." }); };
    useEffect(() => () => liveAbortRef.current?.abort(), []);
    useEffect(() => {
        const changes: Partial<typeof draftPolicy> = {};
        if (!activeModels.some(model => model.id === draftPolicy.defaultModelId) && defaultFallbackModelId) changes.defaultModelId = defaultFallbackModelId;
        if (!activeModels.some(model => model.id === draftPolicy.emergencyFallbackModelId) && defaultFallbackModelId) changes.emergencyFallbackModelId = defaultFallbackModelId;
        if (Object.keys(changes).length) setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, changes));
    }, [activeModels, defaultFallbackModelId, draftPolicy.defaultModelId, draftPolicy.emergencyFallbackModelId]);
    useEffect(() => { liveAbortRef.current?.abort(); liveAbortRef.current = null; setLiveDirect(null); setPendingLiveReplay(null); setLiveStatus({ state: "idle", message: "" }); }, [activeScopeKey]);
    const runDirect = async () => {
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
                ? `No OpenRouter API key found for ${model.display_name}. Add one in Model Catalog or restart the dev server with OPENROUTER_API_KEY. Using deterministic demo replay.`
                : "No API key configured for this candidate; using deterministic demo replay.";
            setLiveDirect(null);
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
            const result = replayFromRuns(runTraces, live.runs);
            const failures = live.runs.filter(run => run.status === "error").length;
            setLiveDirect({ result, source: live.source, label: live.label, traces: runTraces });
            setPendingLiveReplay(null);
            setLiveStatus({ state: failures ? "error" : "idle", message: failures ? `${failures.toLocaleString()} of ${live.runs.length.toLocaleString()} live requests failed; failed rows are marked in the result sample.` : `Live replay completed through ${live.label}.` });
        }
        catch (error) {
            if (controller.signal.aborted) {
                setLiveStatus({ state: "idle", message: "Simulation stopped. Showing the last available deterministic replay results." });
                return;
            }
            setLiveDirect(null);
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
    const simulation = useMemo(() => hasActiveModels ? (strategy === "direct" ? (liveDirect?.result ?? direct!) : familyCascade(selectedTraces, candidate)) : undefined, [strategy, direct, liveDirect, selectedTraces, candidate, catalogVersion, hasActiveModels]);
    const distinctTaskImpact = useMemo(() => simulation ? distinctTaskImpactBreakdown(scenarioTraces, selectedDistinctTasks, simulation, traceJudgeResults) : [], [simulation, scenarioTraces, selectedDistinctTasks, traceJudgeResults]);
    const currentModelByTaskGroup = useMemo(() => new Map(distinctTaskBuckets.map(bucket => {
        const modelId = mostCommonModelForTaskGroup(bucket, traces);
        return [bucket.bucket_id, modelId ? getModel(modelId)?.display_name ?? modelId : "Not recorded"];
    })), [distinctTaskBuckets, traces]);
    if (!hasActiveModels)
        return <section className="panel"><p className="eyebrow">Simulations</p><h2>No enabled models</h2><p>Enable at least one model in Model Catalog before running simulations.</p></section>;
    if (!simulation)
        return null;
    const candidateName = getModel(candidate)?.display_name ?? candidate;
    const candidateFamily = getModel(candidate)?.family ?? candidateName;
    const providerName = strategy === "direct" ? liveDirect?.label ?? pendingLiveReplay?.label ?? simulation.runs[0]?.provider : undefined;
    const providerId = strategy === "direct" ? simulation.runs[0]?.provider_id : undefined;
    const candidateRouteName = providerName ? `${candidateName} via ${providerName}` : candidateName;
    const isAutoRouter = candidate === "openrouter-auto";
    const autoNeedsLiveReplay = isAutoRouter && !liveDirect;
    const defaultModel = activeModels.find(model => model.id === draftPolicy.defaultModelId);
    const emergencyFallbackModel = activeModels.find(model => model.id === draftPolicy.emergencyFallbackModelId);
    const routeAssessments = new Map(distinctTaskImpact.map(row => [row.distinct_task_bucket_id, assessRouteCandidate({ passRate: row.quality.after_pass_rate, costDeltaPct: row.cost.delta_pct, latencyDeltaPct: row.latency.delta_pct, replayCount: row.trace_count }, { minimumPassRate: draftPolicy.minimumPassRate, maximumLatencyIncreasePct: draftPolicy.maximumLatencyIncreasePct, minimumReplayCount: DEFAULT_ROUTE_GUARDRAILS.minimumReplayCount })]));
    const setTaskOverride = (row: (typeof distinctTaskImpact)[number]) => setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, { overrides: { ...policy.overrides, [row.distinct_task_bucket_id]: { taskId: row.distinct_task_bucket_id, taskName: row.name, modelId: candidate, modelName: candidateName, openRouterModelId: getModel(candidate)?.pricing_source_model_id, provider: providerName, providerId, passRate: row.quality.after_pass_rate, costDeltaPct: row.cost.delta_pct, latencyDeltaPct: row.latency.delta_pct, replayCount: row.trace_count, updatedAt: new Date().toISOString() } } }));
    const removeTaskOverride = (taskId: string) => setDraftPolicy(policy => { const overrides = { ...policy.overrides }; delete overrides[taskId]; return reviseDraftRoutingPolicy(policy, { overrides }); });
    const scopeName = distinctTaskBucketIds.length === 0 ? "All traffic" : distinctTaskBucketIds.length === 1 ? selectedDistinctTasks[0]?.bucket_name ?? "Selected Task Group" : `${distinctTaskBucketIds.length} selected Task Groups`;
    const baselineJudges = scenarioTraces.map(trace => judgeByTraceId.get(trace.id)).filter((judge): judge is TraceJudgeResult => Boolean(judge));
    const baselinePassRate = baselineJudges.length ? baselineJudges.filter(judge => judge.passed).length / baselineJudges.length : undefined;
    const baselineAverageScore = baselineJudges.length ? average(baselineJudges.map(judge => judge.score)) : undefined;
    const metricRows: ScenarioMetric[] = [
        { label: "Projected monthly cost", before: money(simulation.summary.baseline_cost_usd * MONTHLY_MULTIPLIER), after: money(simulation.summary.simulated_cost_usd * MONTHLY_MULTIPLIER), change: changeLabel(-simulation.summary.estimated_savings_pct), good: simulation.summary.estimated_savings_usd >= 0 },
        { label: "Average latency", before: `${simulation.summary.baseline_avg_latency_ms.toFixed(0)}ms`, after: `${simulation.summary.simulated_avg_latency_ms.toFixed(0)}ms`, change: changeLabel(simulation.summary.latency_delta_pct), good: simulation.summary.latency_delta_pct <= 0 },
        { label: "Average eval score", before: baselineAverageScore === undefined ? "Not scored" : pct(baselineAverageScore * 100), after: pct(simulation.summary.average_quality_score * 100), change: baselineAverageScore === undefined ? "n/a" : pointChangeLabel((simulation.summary.average_quality_score - baselineAverageScore) * 100), good: baselineAverageScore === undefined || simulation.summary.average_quality_score >= baselineAverageScore },
        { label: "Eval pass rate", before: baselinePassRate === undefined ? "Not scored" : pct(baselinePassRate * 100), after: pct(simulation.summary.pass_rate * 100), change: baselinePassRate === undefined ? "n/a" : pointChangeLabel((simulation.summary.pass_rate - baselinePassRate) * 100), good: baselinePassRate === undefined || simulation.summary.pass_rate >= baselinePassRate },
    ];
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
<p className="scenario-note">{liveDirect && strategy === "direct" ? `Live replay via ${liveDirect.label}` : isAutoRouter ? "Live replay required to observe OpenRouter's selected models" : `Deterministic demo replay${providerName ? ` via ${providerName}` : ""}`} · random sample of {scenarioTraces.length.toLocaleString()} from {availableTraces.length.toLocaleString()} matching LLM calls{autoNeedsLiveReplay?"":` · monthly projection = selected sample × ${MONTHLY_MULTIPLIER}`}</p>
</div>
<div className="sim-actions">
<button className={strategy === "direct" ? "primary" : ""} disabled={liveStatus.state === "running"} onClick={runDirect}>{liveStatus.state === "running" ? "Running live replay..." : "Simulate direct routing"}</button>{liveStatus.state === "running" && <button type="button" className="stop-simulation" onClick={stopLiveReplay}>Stop simulation</button>}
</div>
{liveStatus.message && <p className={`simulation-run-status ${liveStatus.state}`} role="status" aria-live="polite">{liveStatus.message}</p>}
</section>
<section className="scenario-results panel">
<div className="panelhead">
<div>
<p className="eyebrow">Overall impact</p>
<h2>{scopeName} → {strategy === "family_cascade" ? `${candidateFamily} enabled family cascade` : candidateRouteName}</h2>
<p className="impact-explainer">{autoNeedsLiveReplay?"Auto Router results appear only after a live replay, including the model selected for every request.":"Before uses observed production traces. After uses the completed candidate replay. Average eval score and pass rate are reported separately."}</p>
</div>
<span>{scenarioTraces.length.toLocaleString()} calls</span>
</div>
<div className="scenario-metrics">
<div className="scenario-metric-head">
<b>Metric</b>
<span>Before · current</span>
<span>After · candidate</span>
<span>Impact</span>
</div><ScenarioMetricRows rows={metricRows} pending={liveReplayPending} requiresLiveReplay={autoNeedsLiveReplay}/></div>
<div className="scenario-foot">
{liveReplayPending?<span>Waiting for completed candidate responses and eval scores.</span>:autoNeedsLiveReplay?<span>Actual quality, cost, latency, and selected models will be measured live.</span>:<><span>Candidate average eval score: {pct(simulation.summary.average_quality_score * 100)}</span><span>Candidate pass rate: {pct(simulation.summary.pass_rate * 100)}</span></>}{strategy === "family_cascade" && <span>Escalation: {pct((simulation.summary.escalation_rate ?? 0) * 100)}</span>}</div>{strategy === "family_cascade" && <p className="scope-note">Escalated requests are re-run and re-scored on the fallback model; costs and latency include both passes.</p>}{strategy === "direct" && (liveDirect || pendingLiveReplay) && <LiveReplayDetails liveDirect={liveDirect} pendingLiveReplay={pendingLiveReplay} judgeByTraceId={judgeByTraceId}/>}</section>
<section className="panel routing-policy-builder">
<div className="panelhead"><div><p className="eyebrow">Routing policy builder</p><h2>Approve task overrides and configure the unmatched path</h2><p className="impact-explainer">Confident match to an approved task override → use its model. Otherwise → use the configured default strategy. Runtime failures use the separate emergency fallback.</p></div><div className={`policy-save-state ${draftStatus.state}`}><span>Draft v{draftPolicy.version} · {policySaveLabel(draftStatus.state)}</span>{draftStatus.imported ? <small>Browser draft imported</small> : null}{draftStatus.state === "conflict" ? <div><button type="button" onClick={retryMyDraft}>Keep my changes</button><button type="button" onClick={useServerDraft}>Use cloud draft</button></div> : null}</div></div>
<div className="routing-policy-controls">
<label><small>Default strategy</small><select value={draftPolicy.defaultStrategyType} onChange={event => setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, { defaultStrategyType: event.target.value as "fixed_model"|"openrouter_auto" }))}><option value="fixed_model">Specific model</option><option value="openrouter_auto">OpenRouter Auto Router</option></select><em>Used for unmatched, low-confidence, and unapproved tasks.</em></label>
{draftPolicy.defaultStrategyType==="fixed_model"?<label><small>Default model</small><select value={draftPolicy.defaultModelId} onChange={event => { const model = getModel(event.target.value); setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, { defaultModelId: event.target.value, defaultOpenRouterModelId: model?.pricing_source_model_id })); }}><ModelOptions models={activeModels}/></select><em>Predictable fixed-model behavior for the everyday default path.</em></label>:<label><small>Auto Router policy</small><input value="openrouter/auto" readOnly/><em>OpenRouter chooses per request; simulations must measure its actual selections.</em></label>}
<label><small>Emergency fallback model</small><select value={draftPolicy.emergencyFallbackModelId} onChange={event => { const model = getModel(event.target.value); setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, { emergencyFallbackModelId: event.target.value, emergencyFallbackOpenRouterModelId: model?.pricing_source_model_id })); }}><ModelOptions models={activeModels}/></select><em>Fixed approved model for classifier failure, invalid routes, or constrained high-risk work.</em></label>
<label><small>Minimum eval pass rate</small><div className="policy-threshold"><input type="number" min="0" max="100" step="1" value={Math.round(draftPolicy.minimumPassRate * 100)} onChange={event => setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, { minimumPassRate: Math.min(1, Math.max(0, Number(event.target.value) / 100)) }))}/><span>%</span></div><em>A candidate must meet this task-level quality bar.</em></label>
<label><small>Maximum latency increase</small><div className="policy-threshold"><input type="number" min="0" max="500" step="5" value={draftPolicy.maximumLatencyIncreasePct} onChange={event => setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, { maximumLatencyIncreasePct: Math.max(0, Number(event.target.value)) }))}/><span>%</span></div><em>Slower candidates beyond this limit stay on the default strategy.</em></label>
</div>
<div className="policy-flow"><div><small>Confident approved match</small><b>{Object.keys(draftPolicy.overrides).length ? `${Object.keys(draftPolicy.overrides).length} task override${Object.keys(draftPolicy.overrides).length === 1 ? "" : "s"}` : "No overrides yet"}</b><span>Measured and explicitly approved per signature</span></div><i>else</i><div><small>Everyday default</small><b>{draftPolicy.defaultStrategyType==="openrouter_auto"?"OpenRouter Auto Router":defaultModel?.display_name??"Select a model"}</b><span>Unknown, low-confidence, and uncovered tasks</span></div><i>failure</i><div><small>Emergency fallback</small><b>{emergencyFallbackModel?.display_name??"Select a model"}</b><span>Classifier failure and constrained high-risk work</span></div></div>
{Object.values(draftPolicy.overrides).length > 0 && <div className="policy-overrides"><h3>Current task overrides</h3>{Object.values(draftPolicy.overrides).map(override => <article key={override.taskId}><div><small>{override.taskName}</small><b>{override.modelName}{override.provider ? ` via ${override.provider}` : ""}</b></div><p>{pct(override.passRate * 100)} pass · {changeLabel(override.costDeltaPct)} cost · {changeLabel(override.latencyDeltaPct)} latency · {override.replayCount} traces</p><button type="button" onClick={() => removeTaskOverride(override.taskId)}>Remove override</button></article>)}</div>}
<RoutingPolicyPublisher
  workspaceId={workspaceId}
  signatures={distinctTaskBuckets.map((bucket) => ({
    id: bucket.bucket_id,
    label: bucket.bucket_name,
    description: `${bucket.task.task_type} in ${bucket.task.domain}; ${bucket.task.complexity} complexity; ${bucket.task.grounding_requirement}; ${bucket.task.output_format} output`,
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
<p className="eyebrow">Impact by Task Group</p>
<h2>Before and after by Task Group</h2>
<p className="impact-explainer">Cost is the projected monthly run rate. Latency is the average per request. Quality is the eval pass rate; its impact is shown in percentage points.</p>
</div>
<span>{scopeName} → {strategy === "family_cascade" ? `${candidateFamily} enabled cascade` : candidateRouteName}</span>
</div>
<div className="task-impact-wrap">
<table className="task-impact-table">
<thead>
<tr>
<th>Task Group</th>
<th>Cost / month</th>
<th>Average latency</th>
<th>Quality / accuracy</th>
<th>Policy action</th>
</tr>
</thead>
<tbody>{distinctTaskImpact.map(row => {
const assessment = routeAssessments.get(row.distinct_task_bucket_id)!;
const activeOverride = draftPolicy.overrides[row.distinct_task_bucket_id];
const candidateIsActive = activeOverride?.modelId === candidate && activeOverride?.provider === providerName;
const failedChecks = assessment.checks.filter(check => !check.passed);
return <tr key={row.distinct_task_bucket_id}>
<td>
<b>{row.name}</b>
<small>{row.trace_count.toLocaleString()} replayed trace{row.trace_count === 1 ? "" : "s"}</small>
<small className="current-task-model">Current model: {currentModelByTaskGroup.get(row.distinct_task_bucket_id) ?? "Not recorded"}</small>
</td>
<td><TaskImpactValues before={money(row.cost.before_monthly_usd)} after={money(row.cost.after_monthly_usd)} impact={changeLabel(row.cost.delta_pct)} tone={row.cost.delta_pct <= 0 ? "good" : "warn"} pending={liveReplayPending}/></td>
<td><TaskImpactValues before={`${row.latency.before_ms.toFixed(0)}ms`} after={`${row.latency.after_ms.toFixed(0)}ms`} impact={changeLabel(row.latency.delta_pct)} tone={row.latency.delta_pct <= 0 ? "good" : "warn"} pending={liveReplayPending}/></td>
<td><TaskImpactValues before={row.quality.before_pass_rate === undefined ? "Not scored" : pct(row.quality.before_pass_rate * 100)} after={pct(row.quality.after_pass_rate * 100)} impact={pointChangeLabel(row.quality.delta_points)} tone={(row.quality.delta_points ?? 0) >= 0 ? "good" : "warn"} pending={liveReplayPending}/></td>
<td className="route-action">{liveReplayPending ? <><span className="route-ineligible">Simulation in progress</span><small>Policy eligibility appears after the live replay completes.</small></> : isAutoRouter ? <><span className="route-ineligible">Default strategy only</span><small>Auto Router results are measured live but are not promoted as a fixed task override.</small></> : strategy !== "direct" ? <><span className="route-ineligible">Direct replay required</span><small>Cascades need a separate policy rule.</small></> : assessment.eligible ? <button type="button" className={candidateIsActive ? "active" : ""} disabled={candidateIsActive} onClick={() => setTaskOverride(row)}>{candidateIsActive ? "Override active" : activeOverride ? `Replace ${activeOverride.modelName}` : `Use ${candidateName}`}</button> : <><span className="route-ineligible" title={failedChecks.map(check => check.detail).join("; ")}>Does not clear guardrails</span><small>{failedChecks[0]?.detail}</small></>}</td>
</tr>;
})}</tbody>
</table>
</div>
</section>
</>;
}
