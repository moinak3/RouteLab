import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { modelCatalog } from "../core/catalog";
import { distinctTaskImpactBreakdown, familyCascade, MONTHLY_MULTIPLIER, replay, replayFromRuns, type ReplayResult } from "../core/simulations";
import { liveRoutingStatus, runLiveDirectRouting, type LiveRunSource } from "../core/liveRouting";
import { filterTracesByRange, type DateRange } from "../core/time";
import { traceJudgeResultsByTraceId } from "../core/traceJudge";
import type { CandidateRun, DistinctTaskBucket, EvalResult, GatewayProvider, Trace, Model, TraceJudgeResult } from "../types";
import { money, pct, preview, stripJudgeMarker } from "../lib/format";
import { distinctTaskValue } from "../components/DistinctTaskDisplay";
import { ModelOptions } from "../components/ModelOptions";
import { RoutingPolicyPublisher } from "../components/RoutingPolicyPublisher";
import { assessRouteCandidate, DEFAULT_ROUTE_GUARDRAILS, reviseDraftRoutingPolicy } from "../core/routingDraft";
import { useRoutingPolicyDraft, type RoutingPolicySaveState } from "../core/useRoutingPolicyDraft";
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
    const summary = selectedIds.length ? `${selectedIds.length} selected · ${selectedCount.toLocaleString()} calls` : `All Distinct Tasks · ${totalCalls.toLocaleString()} calls`;
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
    return <div className="scope-picker"><label>Distinct Task scope</label><details ref={detailsRef}><summary><span>{summary}</span><b>{selectedIds.length ? "Filtered" : "All"}</b></summary><div className="scope-menu"><input aria-label="Search Distinct Tasks" placeholder="Search Distinct Tasks" value={query} onChange={event => setQuery(event.target.value)}/><div className="scope-menu-actions"><button type="button" onClick={selectFiltered} disabled={!filtered.length}>Select all Distinct Tasks</button><button type="button" onClick={() => onChange([])}>All tasks</button>{selectedIds.length > 0 && <button type="button" onClick={() => onChange([])}>Clear selected</button>}</div><div className="scope-menu-count">Showing <b>{filtered.length.toLocaleString()}</b> of <b>{buckets.length.toLocaleString()}</b> Distinct Tasks</div><div className="scope-options">{filtered.length ? filtered.map(bucket => { const calls = callCounts.get(bucket.bucket_id) ?? 0; const selected = selectedSet.has(bucket.bucket_id); return <button type="button" className={`scope-option ${selected ? "selected" : ""}`} aria-pressed={selected} key={bucket.bucket_id} onClick={() => toggle(bucket.bucket_id)}><input type="checkbox" tabIndex={-1} checked={selected} readOnly aria-hidden="true"/><span><b>{bucket.bucket_name}</b><small>{distinctTaskValue("task_type", bucket.task.task_type)} · {distinctTaskValue("complexity", bucket.task.complexity)}</small></span><em>{calls.toLocaleString()} calls</em></button>; }) : <p>No matching Distinct Tasks</p>}</div></div></details></div>;
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
    return <div className="live-replay-details">
    <div className="live-replay-head">
      <div><p className="eyebrow">Live candidate requests</p><h3>{traces.length.toLocaleString()} traces sent · {completedCount.toLocaleString()} completed</h3></div>
      <span>{label}</span>
    </div>
    <div className="live-replay-summary">
      <div><small>Quality</small><b>{completedCount ? `${scoreLabel(average(beforeScores))} → ${scoreLabel(average(afterScores))}` : "Waiting for eval"}</b></div>
      <div><small>Cost</small><b>{completedCount ? `${compactMoney(beforeCost)} → ${compactMoney(afterCost)}` : "Waiting for response"}</b></div>
      <div><small>Latency</small><b>{completedCount ? `${beforeLatency.toFixed(0)}ms → ${afterLatency.toFixed(0)}ms` : "Waiting for response"}</b></div>
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
          <td><span className={`status ${row.run.status}`}>{row.run.status}</span><p>{preview(stripJudgeMarker(row.run.response_text), 260)}</p></td>
          <td><b>{scoreLabel(row.beforeScore)} → {scoreLabel(row.evaluation?.score)}</b><small>{row.evaluation?.explanation ?? "No eval rationale returned."}</small></td>
          <td>{compactMoney(row.trace.cost_usd ?? 0)} → {compactMoney(row.run.cost_usd)}</td>
          <td>{(row.trace.latency_ms ?? 0).toFixed(0)}ms → {row.run.latency_ms.toFixed(0)}ms</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
export function Simulations({ traces, traceJudgeResults = [], distinctTaskBuckets, candidate, setCandidate, catalogVersion, activeModels, familyApiKeys, gatewayApiKeys, serverGatewayKeys }: {
    traces: Trace[];
    traceJudgeResults?: TraceJudgeResult[];
    distinctTaskBuckets: DistinctTaskBucket[];
    candidate: string;
    setCandidate: (v: string) => void;
    catalogVersion: number;
    activeModels: Model[];
    familyApiKeys: Partial<Record<Model["family"], string>>;
    gatewayApiKeys: Partial<Record<GatewayProvider, string>>;
    serverGatewayKeys?: Partial<Record<GatewayProvider, boolean>>;
}) {
    const [distinctTaskBucketIds, setDistinctTaskBucketIds] = useState<string[]>([]);
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
    const hasActiveModels = activeModels.length > 0;
    const defaultFallbackModelId = useMemo(() => {
        const counts = new Map<string, number>();
        traces.forEach(trace => counts.set(trace.model, (counts.get(trace.model) ?? 0) + 1));
        return activeModels.find(model => model.id === [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0])?.id
            ?? activeModels.find(model => model.quality_tier === "strong")?.id
            ?? activeModels[0]?.id
            ?? "";
    }, [activeModels, traces]);
    const { draftPolicy, setDraftPolicy, status: draftStatus, useServerDraft, retryMyDraft } = useRoutingPolicyDraft(defaultFallbackModelId);
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
    const direct = useMemo(() => hasActiveModels ? replay(selectedTraces, candidate) : undefined, [selectedTraces, candidate, catalogVersion, hasActiveModels]);
    const liveKeyStatus = useMemo(() => liveRoutingStatus(candidate, { familyApiKeys, gatewayApiKeys, serverGatewayKeys }), [candidate, familyApiKeys, gatewayApiKeys, serverGatewayKeys]);
    const judgeByTraceId = useMemo(() => traceJudgeResultsByTraceId(traceJudgeResults), [traceJudgeResults]);
    const stopLiveReplay = () => { liveAbortRef.current?.abort(); liveAbortRef.current = null; setPendingLiveReplay(null); setLiveStatus({ state: "idle", message: "Simulation stopped. Showing the last available deterministic replay results." }); };
    useEffect(() => () => liveAbortRef.current?.abort(), []);
    useEffect(() => {
        if (!activeModels.some(model => model.id === draftPolicy.fallbackModelId) && defaultFallbackModelId) {
            setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, { fallbackModelId: defaultFallbackModelId }));
        }
    }, [activeModels, defaultFallbackModelId, draftPolicy.fallbackModelId]);
    useEffect(() => { liveAbortRef.current?.abort(); liveAbortRef.current = null; setLiveDirect(null); setPendingLiveReplay(null); setLiveStatus({ state: "idle", message: "" }); }, [candidate, availableTraces, requestLimit.count, dateRange]);
    const runDirect = async () => {
        const nextSeed = Date.now() + Math.floor(Math.random() * 1000000);
        const runTraces = sampleTraces(availableTraces, requestLimit.count, nextSeed);
        setSampleSeed(nextSeed);
        setStrategy("direct");
        if (!liveKeyStatus) {
            const model = modelCatalog.find(item => item.id === candidate);
            const message = model?.pricing_source === "OpenRouter"
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
            if (controller.signal.aborted)
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
    const runCascade = () => {
        liveAbortRef.current?.abort();
        liveAbortRef.current = null;
        const nextSeed = Date.now() + Math.floor(Math.random() * 1000000);
        setSampleSeed(nextSeed);
        setLiveDirect(null);
        setPendingLiveReplay(null);
        setLiveStatus({ state: "idle", message: "" });
        setStrategy("family_cascade");
    };
    const scenarioTraces = strategy === "direct" && liveDirect ? liveDirect.traces : selectedTraces;
    const simulation = useMemo(() => hasActiveModels ? (strategy === "direct" ? (liveDirect?.result ?? direct!) : familyCascade(selectedTraces, candidate)) : undefined, [strategy, direct, liveDirect, selectedTraces, candidate, catalogVersion, hasActiveModels]);
    const distinctTaskImpact = useMemo(() => simulation ? distinctTaskImpactBreakdown(scenarioTraces, selectedDistinctTasks, simulation, traceJudgeResults) : [], [simulation, scenarioTraces, selectedDistinctTasks, traceJudgeResults]);
    if (!hasActiveModels)
        return <section className="panel"><p className="eyebrow">Simulations</p><h2>No enabled models</h2><p>Enable at least one model in Model Catalog before running simulations.</p></section>;
    if (!simulation)
        return null;
    const monthlySavings = simulation.summary.estimated_savings_usd * MONTHLY_MULTIPLIER;
    const candidateName = modelCatalog.find(model => model.id === candidate)?.display_name ?? candidate;
    const candidateFamily = modelCatalog.find(model => model.id === candidate)?.family ?? candidateName;
    const providerName = strategy === "direct" ? liveDirect?.label ?? simulation.runs[0]?.provider : undefined;
    const candidateRouteName = providerName ? `${candidateName} via ${providerName}` : candidateName;
    const fallbackModel = activeModels.find(model => model.id === draftPolicy.fallbackModelId);
    const routeAssessments = new Map(distinctTaskImpact.map(row => [row.distinct_task_bucket_id, assessRouteCandidate({ passRate: row.quality.after_pass_rate, costDeltaPct: row.cost.delta_pct, latencyDeltaPct: row.latency.delta_pct, replayCount: row.trace_count }, { minimumPassRate: draftPolicy.minimumPassRate, maximumLatencyIncreasePct: draftPolicy.maximumLatencyIncreasePct, minimumReplayCount: DEFAULT_ROUTE_GUARDRAILS.minimumReplayCount })]));
    const setTaskOverride = (row: (typeof distinctTaskImpact)[number]) => setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, { overrides: { ...policy.overrides, [row.distinct_task_bucket_id]: { taskId: row.distinct_task_bucket_id, taskName: row.name, modelId: candidate, modelName: candidateName, provider: providerName, passRate: row.quality.after_pass_rate, costDeltaPct: row.cost.delta_pct, latencyDeltaPct: row.latency.delta_pct, replayCount: row.trace_count, updatedAt: new Date().toISOString() } } }));
    const removeTaskOverride = (taskId: string) => setDraftPolicy(policy => { const overrides = { ...policy.overrides }; delete overrides[taskId]; return reviseDraftRoutingPolicy(policy, { overrides }); });
    const scopeName = distinctTaskBucketIds.length === 0 ? "All traffic" : distinctTaskBucketIds.length === 1 ? selectedDistinctTasks[0]?.bucket_name ?? "Selected Distinct Task" : `${distinctTaskBucketIds.length} selected Distinct Tasks`;
    const baselineJudges = scenarioTraces.map(trace => judgeByTraceId.get(trace.id)).filter((judge): judge is TraceJudgeResult => Boolean(judge));
    const baselinePassRate = baselineJudges.length ? baselineJudges.filter(judge => judge.passed).length / baselineJudges.length : undefined;
    const metricRows = [
        { label: "Projected monthly cost", before: money(simulation.summary.baseline_cost_usd * MONTHLY_MULTIPLIER), after: money(simulation.summary.simulated_cost_usd * MONTHLY_MULTIPLIER), change: changeLabel(-simulation.summary.estimated_savings_pct), good: simulation.summary.estimated_savings_usd >= 0 },
        { label: "Average latency", before: `${simulation.summary.baseline_avg_latency_ms.toFixed(0)}ms`, after: `${simulation.summary.simulated_avg_latency_ms.toFixed(0)}ms`, change: changeLabel(simulation.summary.latency_delta_pct), good: simulation.summary.latency_delta_pct <= 0 },
        { label: "Eval pass rate (quality)", before: baselinePassRate === undefined ? "Not scored" : pct(baselinePassRate * 100), after: pct(simulation.summary.pass_rate * 100), change: baselinePassRate === undefined ? "n/a" : pointChangeLabel((simulation.summary.pass_rate - baselinePassRate) * 100), good: baselinePassRate === undefined || simulation.summary.pass_rate >= baselinePassRate },
    ];
    return <>
<section className="sim-builder scenario-builder">
<div className="scenario-controls">
<div className="compact-select">
<label>Candidate model</label>
<select value={candidate} onChange={e => setCandidate(e.target.value)}>
<ModelOptions models={activeModels}/>
</select>
</div>
<DistinctTaskScopePicker buckets={distinctTaskBuckets} selectedIds={distinctTaskBucketIds} onChange={setDistinctTaskBucketIds} callCounts={callCounts} totalCalls={dateTraces.length}/>
<div className="range-control">
<label>Simulation date range</label>
<div className="range-tabs" role="group" aria-label="Simulation date range">{([["7d", "Last 7 days"], ["30d", "Last 30 days"], ["6m", "Last 6 months"]] as Array<[
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
<p className="scenario-note">{liveDirect && strategy === "direct" ? `Live replay via ${liveDirect.label}` : `Deterministic demo replay${providerName ? ` via ${providerName}` : ""}`} · random sample of {scenarioTraces.length.toLocaleString()} from {availableTraces.length.toLocaleString()} matching LLM calls · monthly projection = selected sample × {MONTHLY_MULTIPLIER}</p>
<p className="scope-note">Simulations replay individual requests. Multi-step workflow (trajectory-level) simulation is on the roadmap.</p>{liveKeyStatus && <p className="live-key-note">{liveKeyStatus.message}</p>}{liveStatus.message && <p className={`live-status ${liveStatus.state}`}>{liveStatus.message}</p>}</div>
<div className={`projection ${monthlySavings < 0 ? "projection-cost" : ""}`}>
<small>{strategy === "direct" ? "Raw direct scenario savings (before guardrails)" : "Raw cascade scenario savings (before guardrails)"}</small>
<strong>{money(Math.abs(monthlySavings))}</strong>
<span>{monthlySavings >= 0 ? "saved per month" : "additional monthly cost"} with {strategy === "direct" ? candidateRouteName : `the ${candidateFamily} family`}</span>
</div>
<div className="sim-actions">
<button className={strategy === "direct" ? "primary" : ""} disabled={liveStatus.state === "running"} onClick={runDirect}>{liveStatus.state === "running" ? "Running live replay..." : "Simulate direct routing"}</button>{liveStatus.state === "running" && <button type="button" className="stop-simulation" onClick={stopLiveReplay}>Stop simulation</button>}<span className="cascade-action">
<button className={strategy === "family_cascade" ? "primary" : ""} disabled={liveStatus.state === "running"} onClick={runCascade}>Simulate cascading</button>
<span className="tooltip" tabIndex={0} aria-label="About cascading simulation" title="For each query, simulate the lowest-cost enabled model in the selected family first. If its result is insufficient, check the next enabled tier.">?<span role="tooltip">For each query, simulate the lowest-cost enabled model in the selected family first. If its result is insufficient, check the next enabled tier.</span>
</span>
</span>
</div>
</section>
<section className="scenario-results panel">
<div className="panelhead">
<div>
<p className="eyebrow">Overall impact</p>
<h2>{scopeName} → {strategy === "family_cascade" ? `${candidateFamily} enabled family cascade` : candidateRouteName}</h2>
<p className="impact-explainer">Before uses observed production traces. After uses the candidate replay. Quality is the calibrated evaluator pass rate.</p>
</div>
<span>{scenarioTraces.length.toLocaleString()} calls</span>
</div>
<div className="scenario-metrics">
<div className="scenario-metric-head">
<b>Metric</b>
<span>Before · current</span>
<span>After · candidate</span>
<span>Impact</span>
</div>{metricRows.map(row => <div className="scenario-metric-row" key={row.label}>
<b>{row.label}</b>
<span>{row.before}</span>
<strong>{row.after}</strong>
<em className={row.good ? "good" : "warn"}>{row.change}</em>
</div>)}</div>
<div className="scenario-foot">
<span>Candidate average eval score: {pct(simulation.summary.average_quality_score * 100)}</span>
<span>Candidate pass rate: {pct(simulation.summary.pass_rate * 100)}</span>{strategy === "family_cascade" && <span>Escalation: {pct((simulation.summary.escalation_rate ?? 0) * 100)}</span>}</div>{strategy === "family_cascade" && <p className="scope-note">Escalated requests are re-run and re-scored on the fallback model; costs and latency include both passes.</p>}{strategy === "direct" && (liveDirect || pendingLiveReplay) && <LiveReplayDetails liveDirect={liveDirect} pendingLiveReplay={pendingLiveReplay} judgeByTraceId={judgeByTraceId}/>}</section>
<section className="panel routing-policy-builder">
<div className="panelhead"><div><p className="eyebrow">Routing policy builder</p><h2>Set the fallback, then approve task-specific overrides</h2><p className="impact-explainer">This draft auto-saves. Unknown, low-confidence, and unapproved requests always use the general fallback.</p></div><div className={`policy-save-state ${draftStatus.state}`}><span>Draft v{draftPolicy.version} · {policySaveLabel(draftStatus.state)}</span>{draftStatus.imported ? <small>Browser draft imported</small> : null}{draftStatus.state === "conflict" ? <div><button type="button" onClick={retryMyDraft}>Keep my changes</button><button type="button" onClick={useServerDraft}>Use cloud draft</button></div> : null}</div></div>
<div className="routing-policy-controls">
<label><small>General fallback model</small><select value={draftPolicy.fallbackModelId} onChange={event => setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, { fallbackModelId: event.target.value }))}><ModelOptions models={activeModels}/></select><em>Used for every request unless an approved task override matches.</em></label>
<label><small>Minimum eval pass rate</small><div className="policy-threshold"><input type="number" min="0" max="100" step="1" value={Math.round(draftPolicy.minimumPassRate * 100)} onChange={event => setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, { minimumPassRate: Math.min(1, Math.max(0, Number(event.target.value) / 100)) }))}/><span>%</span></div><em>A candidate must meet this task-level quality bar.</em></label>
<label><small>Maximum latency increase</small><div className="policy-threshold"><input type="number" min="0" max="500" step="5" value={draftPolicy.maximumLatencyIncreasePct} onChange={event => setDraftPolicy(policy => reviseDraftRoutingPolicy(policy, { maximumLatencyIncreasePct: Math.max(0, Number(event.target.value)) }))}/><span>%</span></div><em>Slower candidates beyond this limit stay on fallback.</em></label>
</div>
<div className="policy-flow"><div><small>Default route for all requests</small><b>{fallbackModel?.display_name ?? "Select a fallback"}</b><span>Includes unknown and low-confidence signatures</span></div><i>except</i><div><small>Approved task-signature overrides</small><b>{Object.keys(draftPolicy.overrides).length ? `${Object.keys(draftPolicy.overrides).length} active override${Object.keys(draftPolicy.overrides).length === 1 ? "" : "s"}` : "No overrides yet"}</b><span>Promoted from measured simulation results</span></div></div>
{Object.values(draftPolicy.overrides).length > 0 && <div className="policy-overrides"><h3>Current task overrides</h3>{Object.values(draftPolicy.overrides).map(override => <article key={override.taskId}><div><small>{override.taskName}</small><b>{override.modelName}{override.provider ? ` via ${override.provider}` : ""}</b></div><p>{pct(override.passRate * 100)} pass · {changeLabel(override.costDeltaPct)} cost · {changeLabel(override.latencyDeltaPct)} latency · {override.replayCount} traces</p><button type="button" onClick={() => removeTaskOverride(override.taskId)}>Remove override</button></article>)}</div>}
<RoutingPolicyPublisher
  signatures={distinctTaskBuckets.map((bucket) => ({
    id: bucket.bucket_id,
    label: bucket.bucket_name,
    description: `${bucket.task.task_type} in ${bucket.task.domain}; ${bucket.task.complexity} complexity; ${bucket.task.grounding_requirement}; ${bucket.task.output_format} output`,
    riskLevel: bucket.risk_level,
  }))}
  draftRevision={draftStatus.revision}
  draftSaved={draftStatus.state === "saved"}
/>
</section>
<section className="panel task-impact-panel">
<div className="panelhead">
<div>
<p className="eyebrow">Impact by Distinct Task</p>
<h2>Before and after by task signature</h2>
<p className="impact-explainer">Cost is the projected monthly run rate. Latency is the average per request. Quality is the eval pass rate; its impact is shown in percentage points.</p>
</div>
<span>{scopeName} → {strategy === "family_cascade" ? `${candidateFamily} enabled cascade` : candidateRouteName}</span>
</div>
<div className="task-impact-wrap">
<table className="task-impact-table">
<thead>
<tr>
<th rowSpan={2}>Distinct Task</th>
<th colSpan={3}>Cost / month</th>
<th colSpan={3}>Average latency</th>
<th colSpan={3}>Quality / accuracy</th>
<th rowSpan={2}>Policy action</th>
</tr>
<tr>
<th>Before</th>
<th>After</th>
<th>Impact</th>
<th>Before</th>
<th>After</th>
<th>Impact</th>
<th>Before</th>
<th>After</th>
<th>Impact</th>
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
</td>
<td>{money(row.cost.before_monthly_usd)}</td>
<td>
<strong>{money(row.cost.after_monthly_usd)}</strong>
</td>
<td>
<em className={row.cost.delta_pct <= 0 ? "good" : "warn"}>{changeLabel(row.cost.delta_pct)}</em>
</td>
<td>{row.latency.before_ms.toFixed(0)}ms</td>
<td>
<strong>{row.latency.after_ms.toFixed(0)}ms</strong>
</td>
<td>
<em className={row.latency.delta_pct <= 0 ? "good" : "warn"}>{changeLabel(row.latency.delta_pct)}</em>
</td>
<td>{row.quality.before_pass_rate === undefined ? "Not scored" : pct(row.quality.before_pass_rate * 100)}</td>
<td>
<strong>{pct(row.quality.after_pass_rate * 100)}</strong>
</td>
<td>
<em className={(row.quality.delta_points ?? 0) >= 0 ? "good" : "warn"}>{pointChangeLabel(row.quality.delta_points)}</em>
</td>
<td className="route-action">{strategy !== "direct" ? <><span className="route-ineligible">Direct replay required</span><small>Cascades need a separate policy rule.</small></> : assessment.eligible ? <button type="button" className={candidateIsActive ? "active" : ""} disabled={candidateIsActive} onClick={() => setTaskOverride(row)}>{candidateIsActive ? "Override active" : activeOverride ? `Replace ${activeOverride.modelName}` : `Use ${candidateName}`}</button> : <><span className="route-ineligible" title={failedChecks.map(check => check.detail).join("; ")}>Does not clear guardrails</span><small>{failedChecks[0]?.detail}</small></>}</td>
</tr>;
})}</tbody>
</table>
</div>
</section>
</>;
}
