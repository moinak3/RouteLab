import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDistinctTaskBuckets } from "../core/distinctTasks";
import {
  compareLLMGrouping,
  createLLMGroupingSnapshot,
  isLLMGroupingRunOutdated,
  type LLMGroupingAssignmentStatus,
  type LLMGroupingRun,
  type LLMGroupingStage,
} from "../core/llmGrouping";
import {
  fetchLatestLLMGroupingRun,
  runLLMGroupingExperiment,
  type LLMGroupingProgress,
} from "../core/llmGroupingPersistence";
import type { Trace } from "../types";

type Props = {
  traces: Trace[];
  serverGatewayKey?: boolean;
  embedded?: boolean;
  runToken?: number;
  onRunningChange?: (running: boolean) => void;
};
type View = "groups" | "compare";

const stageOrder: LLMGroupingStage[] = ["extraction", "discovery", "consolidation", "assignment"];
const stageLabel: Record<LLMGroupingStage, string> = {
  extraction: "Describe tasks",
  discovery: "Discover groups",
  consolidation: "Consolidate definitions",
  assignment: "Assign and audit",
};

const pct = (value: number) => `${Math.round(value * 100)}%`;
const dateTime = (value: string) => new Date(value).toLocaleString();

function Distribution({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  return <section className="llm-distribution">
    <div><h3>{label}</h3><span>{values.length} groups</span></div>
    <div className="llm-bars" aria-label={`${label} group sizes`}>
      {values.map((value, index) => <i key={`${value}-${index}`} style={{ height: `${Math.max(10, value / max * 100)}%` }} title={`${value} traces`} />)}
    </div>
  </section>;
}

export function LLMGroupedTasks({ traces, serverGatewayKey, embedded = false, runToken = 0, onRunningChange }: Props) {
  const [run, setRun] = useState<LLMGroupingRun | null>(null);
  const [view, setView] = useState<View>("groups");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<LLMGroupingProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [existingFilter, setExistingFilter] = useState("all");
  const [llmFilter, setLlmFilter] = useState("all");
  const [ambiguousOnly, setAmbiguousOnly] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const handledRunToken = useRef(0);

  const existingBuckets = useMemo(() => createDistinctTaskBuckets(traces), [traces]);
  const comparison = useMemo(() => run ? compareLLMGrouping(existingBuckets, run) : null, [existingBuckets, run]);
  const currentSnapshot = useMemo(() => createLLMGroupingSnapshot(traces), [traces]);
  const stale = Boolean(run && isLLMGroupingRunOutdated(run, traces));
  const traceById = useMemo(() => new Map(traces.map((trace) => [trace.id, trace])), [traces]);
  const groupById = useMemo(() => new Map((run?.groups ?? []).map((group) => [group.id, group])), [run]);
  const selectedGroup = selectedGroupId ? groupById.get(selectedGroupId) : undefined;
  const selectedTrace = selectedTraceId ? traceById.get(selectedTraceId) : undefined;
  const selectedAssignment = run?.assignments.find((item) => item.traceId === selectedTraceId);
  const selectedExisting = existingBuckets.find((bucket) => bucket.traces.includes(selectedTraceId ?? ""));

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchLatestLLMGroupingRun(controller.signal)
      .then((latest) => {
        setRun(latest);
        setSelectedGroupId(latest?.groups[0]?.id ?? null);
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setStorageNotice(loadError instanceof Error ? loadError.message : "Saved experiments are unavailable.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const startRun = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    onRunningChange?.(true);
    setError(null);
    setProgress({ stage: "extraction", completed: 0, total: traces.length, message: "Preparing the trace snapshot" });
    try {
      const completed = await runLLMGroupingExperiment(traces, setProgress, controller.signal);
      setRun(completed);
      setSelectedGroupId(completed.groups[0]?.id ?? null);
      setView("groups");
    } catch (runError) {
      if (controller.signal.aborted) setError("Run cancelled. No partial result was saved.");
      else setError(runError instanceof Error ? runError.message : "LLM grouping failed.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
      onRunningChange?.(false);
    }
  }, [onRunningChange, traces]);

  useEffect(() => {
    if (!embedded || !runToken || handledRunToken.current === runToken) return;
    handledRunToken.current = runToken;
    void startRun();
  }, [embedded, runToken, startRun]);

  const filteredRows = comparison?.rows.filter((row) => {
    if (existingFilter !== "all" && row.existingBucketId !== existingFilter) return false;
    if (llmFilter !== "all" && row.llmGroupId !== llmFilter) return false;
    if (ambiguousOnly && row.status !== "ambiguous" && row.status !== "unassigned") return false;
    return true;
  }) ?? [];

  return <div className="llm-grouping-page">
    {!embedded && <section className="llm-grouping-intro">
      <div>
        <p className="eyebrow">Independent experiment</p>
        <h2>Task Signatures (LLM Grouped)</h2>
        <p>Discover task groups from request context alone, then compare them with RouteLab's existing task signatures. This experiment does not change Jev, routing policies, or deployed sidecars.</p>
      </div>
      <div className="llm-run-actions">
        <span className={`llm-key-state ${serverGatewayKey ? "ready" : ""}`}>{serverGatewayKey === undefined ? "Checking provider" : serverGatewayKey ? "OpenRouter ready" : "OpenRouter key required"}</span>
        {running
          ? <button type="button" className="danger" onClick={() => abortRef.current?.abort()}>Cancel run</button>
          : <button type="button" className="primary" disabled={!serverGatewayKey || !traces.length} onClick={() => void startRun()}>{run ? "Rerun experiment" : "Run LLM grouping"}</button>}
      </div>
    </section>}

    <section className="llm-method-strip">
      <div><b>Input population</b><span>{traces.length.toLocaleString()} traces · snapshot {currentSnapshot.hash}</span></div>
      <div><b>Allowed evidence</b><span>Prompt, prior conversation, available tools, and whitelisted workflow metadata</span></div>
      <div><b>Excluded evidence</b><span>Responses, outcomes, model/provider, cost, latency, scores, and existing task labels</span></div>
      <div><b>Assignment rule</b><span>One primary group per trace, or explicit ambiguous/unassigned status</span></div>
    </section>

    {running && progress && <section className="llm-progress" aria-live="polite">
      <div className="llm-progress-head"><b>{progress.message}</b><div><span>{progress.completed.toLocaleString()} / {progress.total.toLocaleString()}</span>{embedded&&<button type="button" className="danger" onClick={() => abortRef.current?.abort()}>Cancel generation</button>}</div></div>
      <div className="llm-progress-track"><i style={{ width: `${Math.min(100, progress.total ? progress.completed / progress.total * 100 : 0)}%` }} /></div>
      <ol>{stageOrder.map((stage) => <li className={stage === progress.stage ? "active" : stageOrder.indexOf(stage) < stageOrder.indexOf(progress.stage) ? "done" : ""} key={stage}>{stageLabel[stage]}</li>)}</ol>
    </section>}

    {error && <div className="llm-alert error"><b>Experiment not completed</b><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
    {!serverGatewayKey && serverGatewayKey !== undefined && <div className="llm-alert warning"><b>Provider configuration required</b><span>Add <code>ROUTELAB_OPENROUTER_API_KEY</code> to the server environment. The key is never sent to this browser.</span></div>}
    {storageNotice && !run && <div className="llm-alert neutral"><b>Saved run unavailable</b><span>{storageNotice}</span></div>}

    {loading ? <section className="llm-empty"><b>Loading the latest saved experiment…</b></section> : !run ? <section className="llm-empty">
      <div><span>LLM</span></div>
      <h3>No experiment has been run</h3>
      <p>Start an explicit run to build independent task definitions and assign the current trace snapshot. No provider request is made until you use the run button.</p>
    </section> : <>
      <section className="llm-result-header">
        <div><p className="eyebrow">Latest completed run</p><h2>{run.groups.length} discovered task groups</h2><p>{run.provider} · {run.model} · completed {dateTime(run.completedAt)}</p></div>
        <div className="llm-result-meta"><span>Prompt <b>{run.promptVersion}</b></span><span>Schema <b>{run.schemaVersion}</b></span><span>Snapshot <b>{run.snapshot.hash}</b></span></div>
        {stale && <div className="llm-stale"><b>Outdated result</b><span>The trace population has changed since this run. Rerun before drawing current conclusions.</span></div>}
      </section>

      <section className="llm-metrics">
        <div><span>Groups</span><b>{run.groups.length}</b></div>
        <div><span>Assigned</span><b>{run.coverage.assigned}</b><small>{pct(run.coverage.assigned / Math.max(1, run.coverage.total))} coverage</small></div>
        <div><span>Ambiguous</span><b>{run.coverage.ambiguous}</b></div>
        <div><span>Unassigned</span><b>{run.coverage.unassigned}</b></div>
        <div><span>Processed</span><b>{run.coverage.processed} / {run.coverage.total}</b></div>
      </section>

      <div className="llm-view-switch" role="tablist" aria-label="LLM grouping views">
        <button type="button" role="tab" aria-selected={view === "groups"} className={view === "groups" ? "active" : ""} onClick={() => setView("groups")}>Discovered groups</button>
        <button type="button" role="tab" aria-selected={view === "compare"} className={view === "compare" ? "active" : ""} onClick={() => setView("compare")}>Compare methods</button>
      </div>

      {view === "groups" ? <div className="llm-group-workspace">
        <section className="llm-group-list" aria-label="Discovered task groups">
          {run.groups.map((group) => {
            const assignments = run.assignments.filter((item) => item.groupId === group.id);
            return <button type="button" className={selectedGroupId === group.id ? "active" : ""} onClick={() => setSelectedGroupId(group.id)} key={group.id}>
              <span><b>{group.name}</b><small>{group.description}</small></span>
              <strong>{assignments.length}</strong>
            </button>;
          })}
          {(run.coverage.ambiguous > 0 || run.coverage.unassigned > 0) && <button type="button" onClick={() => { setView("compare"); setAmbiguousOnly(true); }}><span><b>Ambiguous and unassigned</b><small>Inspect traces that did not receive a confident primary group.</small></span><strong>{run.coverage.ambiguous + run.coverage.unassigned}</strong></button>}
        </section>
        {selectedGroup && <section className="llm-group-detail">
          <header><div><p className="eyebrow">Group definition</p><h3>{selectedGroup.name}</h3></div><code>{selectedGroup.id}</code></header>
          <p className="llm-definition">{selectedGroup.description}</p>
          <div className="llm-definition-grid">
            <section><h4>Include when</h4>{selectedGroup.inclusionCriteria.map((item) => <p key={item}>{item}</p>)}</section>
            <section><h4>Exclude when</h4>{selectedGroup.exclusionCriteria.map((item) => <p key={item}>{item}</p>)}</section>
          </div>
          <section className="llm-attribute-section"><h4>Task attributes</h4>{Object.entries(selectedGroup.attributes).map(([label, values]) => <div key={label}><span>{label.replace(/([A-Z])/g, " $1")}</span><p>{values.length ? values.join(" · ") : "Not specified"}</p></div>)}</section>
          <section><h4>Suggested evaluation dimensions</h4><div className="llm-tags">{selectedGroup.suggestedEvaluationDimensions.map((item) => <span key={item}>{item}</span>)}</div></section>
          <section><h4>Routing relevance</h4><p>{selectedGroup.routingRationale}</p></section>
          <section><h4>Nearest groups</h4>{selectedGroup.nearestNeighbors.length ? selectedGroup.nearestNeighbors.map((neighbor) => <button type="button" className="llm-text-link" onClick={() => setSelectedGroupId(neighbor.groupId)} key={neighbor.groupId}><b>{groupById.get(neighbor.groupId)?.name ?? neighbor.groupId}</b><span>{neighbor.distinction}</span></button>) : <p>No confusing neighbor was identified.</p>}</section>
          <section><h4>Representative traces</h4><div className="llm-trace-links">{selectedGroup.representativeTraceIds.map((traceId) => <button type="button" onClick={() => setSelectedTraceId(traceId)} key={traceId}>{traceId}</button>)}</div></section>
          <section><h4>Confusing counterexamples</h4>{selectedGroup.confusingCounterexamples.length ? selectedGroup.confusingCounterexamples.map((item) => <button type="button" className="llm-text-link" onClick={() => setSelectedTraceId(item.traceId)} key={item.traceId}><b>{item.traceId}</b><span>{item.explanation}</span></button>) : <p>No counterexample was retained.</p>}</section>
        </section>}
      </div> : comparison && <div className="llm-comparison">
        <section className="llm-method-comparison">
          <div><p className="eyebrow">Existing RouteLab grouping</p><h3>{existingBuckets.length} signatures</h3><span>{comparison.existingAssigned} traces assigned using the unchanged deterministic taxonomy.</span></div>
          <div><p className="eyebrow">Independent LLM grouping</p><h3>{run.groups.length} groups</h3><span>{comparison.llmAssigned} assigned · {comparison.ambiguous} ambiguous · {comparison.unassigned} unassigned.</span></div>
        </section>
        <div className="llm-distribution-grid"><Distribution label="Existing size distribution" values={comparison.existingGroupSizes} /><Distribution label="LLM size distribution" values={comparison.llmGroupSizes} /></div>
        <section className="llm-difference-grid">
          <div><h3>Potential splits</h3>{comparison.splits.length ? comparison.splits.map((split) => <article key={split.existingBucketId}><b>{split.existingBucketName}</b><span>{split.groups.map((item) => `${item.groupName} (${item.count})`).join(" · ")}</span></article>) : <p>No existing signature was split across multiple assigned LLM groups.</p>}</div>
          <div><h3>Potential merges</h3>{comparison.merges.length ? comparison.merges.map((merge) => <article key={merge.groupId}><b>{merge.groupName}</b><span>{merge.buckets.map((item) => `${item.bucketName} (${item.count})`).join(" · ")}</span></article>) : <p>No LLM group merged multiple existing signatures.</p>}</div>
        </section>
        <section className="llm-cross-tab"><h3>Assignment overlap</h3><div className="llm-table-scroll"><table><thead><tr><th>Existing signature</th><th>LLM group</th><th>Traces</th></tr></thead><tbody>{comparison.cells.map((cell) => <tr key={`${cell.existingBucketId}-${cell.llmGroupId}`}><td>{cell.existingBucketName}</td><td>{cell.llmGroupName}</td><td>{cell.count}</td></tr>)}</tbody></table></div></section>
        <section className="llm-trace-comparison">
          <div className="llm-filter-row"><div><h3>Trace-level comparison</h3><span>{filteredRows.length} visible traces</span></div><label>Existing<select value={existingFilter} onChange={(event) => setExistingFilter(event.target.value)}><option value="all">All signatures</option>{existingBuckets.map((bucket) => <option value={bucket.bucket_id} key={bucket.bucket_id}>{bucket.bucket_name}</option>)}</select></label><label>LLM group<select value={llmFilter} onChange={(event) => setLlmFilter(event.target.value)}><option value="all">All groups</option>{run.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label><label className="llm-check"><input type="checkbox" checked={ambiguousOnly} onChange={(event) => setAmbiguousOnly(event.target.checked)} /> Needs review only</label></div>
          <div className="llm-table-scroll"><table><thead><tr><th>Trace</th><th>Existing</th><th>LLM result</th><th>Status</th><th>Confidence</th></tr></thead><tbody>{filteredRows.map((row) => <tr tabIndex={0} onClick={() => setSelectedTraceId(row.traceId)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedTraceId(row.traceId); }} key={row.traceId}><td><code>{row.traceId}</code></td><td>{row.existingBucketName}</td><td>{row.llmGroupName}</td><td><span className={`llm-status ${row.status}`}>{row.status}</span></td><td>{pct(row.confidence)}</td></tr>)}</tbody></table></div>
        </section>
      </div>}
    </>}

    {selectedTrace && run && <div className="llm-drawer-layer" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSelectedTraceId(null); }}>
      <aside className="llm-trace-drawer" role="dialog" aria-modal="true" aria-labelledby="llm-trace-title">
        <header><div><p className="eyebrow">Trace inspection</p><h2 id="llm-trace-title">{selectedTrace.id}</h2></div><button type="button" aria-label="Close trace details" onClick={() => setSelectedTraceId(null)}>×</button></header>
        <section><h3>Request available before inference</h3><pre>{selectedTrace.prompt_text || selectedTrace.messages.map((message) => `${message.role}: ${message.content}`).join("\n")}</pre></section>
        <section className="llm-trace-methods"><div><small>Existing RouteLab signature</small><b>{selectedExisting?.bucket_name ?? "No existing bucket"}</b></div><div><small>Independent LLM result</small><b>{selectedAssignment?.groupId ? groupById.get(selectedAssignment.groupId)?.name : selectedAssignment?.status ?? "Not assigned"}</b></div></section>
        {selectedAssignment && <section><h3>Assignment evidence</h3><dl><div><dt>Status</dt><dd><span className={`llm-status ${selectedAssignment.status}`}>{selectedAssignment.status}</span></dd></div><div><dt>Confidence</dt><dd>{pct(selectedAssignment.confidence)}</dd></div><div><dt>Rationale</dt><dd>{selectedAssignment.rationale}</dd></div><div><dt>Alternate groups</dt><dd>{selectedAssignment.alternateGroupIds.map((id) => groupById.get(id)?.name ?? id).join(" · ") || "None"}</dd></div></dl></section>}
        <p className="llm-boundary-note">Response content and post-inference outcomes were not available to the grouping model.</p>
      </aside>
    </div>}
  </div>;
}
