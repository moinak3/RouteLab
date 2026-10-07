import { useMemo, useState } from "react";
import {
  aggregateFrontierResults,
  defaultDemoCaseIds,
  frontierEvalCases,
  frontierHarnesses,
  frontierModelAliases,
  frontierRoutingRecommendations,
  frontierTakeaways,
  loadFrontierRuns,
  p50,
  saveFrontierRuns,
  scoreFrontierRun,
  upsertFrontierRun,
  type FrontierDimension,
  type FrontierEvalCase,
  type FrontierHarnessId,
  type FrontierHarnessSelection,
  type FrontierLabRun,
  type FrontierModelConfig,
  type FrontierProviderRun,
  type FrontierScoredRun,
} from "../core/frontierLab";

const MODEL_CONFIG_KEY = "routelab.frontier-model-lab.model-config.v2";
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const money = (value?: number) => Number.isFinite(value) ? `$${value!.toFixed(value! < 0.01 ? 4 : 3)}` : "Unknown";
const latency = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function initialModelConfigs(): FrontierModelConfig[] {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const defaults: Record<string, Partial<FrontierModelConfig>> = {
    "openai-astra": { runtimeModelId: env.VITE_FRONTIER_ASTRA_MODEL_ID, inputCostPer1m: Number(env.VITE_FRONTIER_ASTRA_INPUT_PER_1M) || undefined, outputCostPer1m: Number(env.VITE_FRONTIER_ASTRA_OUTPUT_PER_1M) || undefined },
    "openai-sol": { runtimeModelId: env.VITE_FRONTIER_SOL_MODEL_ID, inputCostPer1m: Number(env.VITE_FRONTIER_SOL_INPUT_PER_1M) || undefined, outputCostPer1m: Number(env.VITE_FRONTIER_SOL_OUTPUT_PER_1M) || undefined },
    "anthropic-opus-5-5": { runtimeModelId: env.VITE_FRONTIER_OPUS_5_5_MODEL_ID, inputCostPer1m: Number(env.VITE_FRONTIER_OPUS_5_5_INPUT_PER_1M) || undefined, outputCostPer1m: Number(env.VITE_FRONTIER_OPUS_5_5_OUTPUT_PER_1M) || undefined },
  };
  let saved: Record<string, Partial<FrontierModelConfig>> = {};
  try { saved = JSON.parse(window.localStorage.getItem(MODEL_CONFIG_KEY) ?? "{}"); } catch { saved = {}; }
  return frontierModelAliases.map((model) => ({
    ...model,
    ...defaults[model.id],
    ...saved[model.id],
    runtimeModelId: saved[model.id]?.runtimeModelId || defaults[model.id]?.runtimeModelId || model.runtimeModelId || "",
    inputCostPer1m: saved[model.id]?.inputCostPer1m ?? defaults[model.id]?.inputCostPer1m ?? model.inputCostPer1m,
    outputCostPer1m: saved[model.id]?.outputCostPer1m ?? defaults[model.id]?.outputCostPer1m ?? model.outputCostPer1m,
  }));
}

async function runOne(model: FrontierModelConfig, caseId: string, harnessId: FrontierHarnessId, repetition: number): Promise<FrontierProviderRun> {
  const started = Date.now();
  try {
    const response = await fetch("/api/frontier-lab/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, caseId, harnessId, repetition, assetBaseUrl: window.location.origin }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Provider request failed.");
    return payload;
  } catch (error) {
    const evalCase = frontierEvalCases.find((item) => item.id === caseId)!;
    return {
      caseId,
      modelAliasId: model.id,
      modelDisplayName: model.displayName,
      runtimeModelId: model.runtimeModelId,
      harnessId,
      repetition,
      provider: "OpenRouter",
      finalAnswer: "",
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - started,
      retries: 0,
      inputNormalization: evalCase.documents.length ? "Identical ordered page images through OpenRouter." : "Identical text context and tool schemas through OpenRouter.",
      systemPrompt: frontierHarnesses[harnessId].systemPrompt,
      contextSent: evalCase.context,
      toolDefinitions: evalCase.tools,
      status: "error",
      error: error instanceof Error ? error.message : "Provider request failed.",
    };
  }
}

function ResultCell({ results, onOpen }: { results: FrontierScoredRun[]; onOpen: () => void }) {
  if (!results.length) return <button type="button" className="frontier-cell empty" disabled>No measurement</button>;
  const passed = results.filter((result) => result.passed).length;
  const quality = mean(results.map((result) => result.quality));
  const dimensions = (Object.keys(results[0].dimensions) as FrontierDimension[]).map((key) => [key, mean(results.map((result) => result.dimensions[key]))] as const);
  const costs = results.map((result) => result.estimatedCostUsd).filter((value): value is number => Number.isFinite(value));
  const successful = results.filter((result) => result.passed).length;
  const costPerSuccess = costs.length === results.length && successful ? costs.reduce((sum, value) => sum + value, 0) / successful : undefined;
  const qualityValues = results.map((result) => result.quality);
  return <button type="button" className={`frontier-cell ${passed === results.length ? "pass" : passed ? "mixed" : "fail"}`} onClick={onOpen}>
    <div className="frontier-cell-head"><b>{passed === results.length ? "PASS" : passed ? "MIXED" : "FAIL"}</b><strong>{passed}/{results.length}</strong></div>
    <div className="frontier-quality"><span>Quality</span><b>{percent(quality)}</b><small>{percent(Math.min(...qualityValues))}–{percent(Math.max(...qualityValues))}</small></div>
    <div className="frontier-dimensions">{dimensions.map(([key, value]) => <span key={key}><small>{key === "task_success" ? "Task" : key === "tool_correctness" ? "Tools" : key === "policy_adherence" ? "Policy" : "Ground"}</small><b>{percent(value)}</b></span>)}</div>
    <div className="frontier-cell-metrics">
      <span><small>P50</small><b>{latency(p50(results.map((result) => result.latencyMs)))}</b></span>
      <span><small>Tokens</small><b>{Math.round(mean(results.map((result) => result.inputTokens + result.outputTokens))).toLocaleString()}</b></span>
      <span><small>Cost</small><b>{costs.length === results.length ? money(mean(costs)) : "Unknown"}</b></span>
      <span><small>Cost/success</small><b>{money(costPerSuccess)}</b></span>
      <span><small>Tool calls</small><b>{mean(results.map((result) => result.toolCalls.length)).toFixed(1)}</b></span>
      <span><small>Retries</small><b>{mean(results.map((result) => result.retries)).toFixed(1)}</b></span>
    </div>
  </button>;
}

function TraceViewer({ results, initialIndex, onClose }: { results: FrontierScoredRun[]; initialIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex);
  const run = results[index];
  const evalCase = frontierEvalCases.find((item) => item.id === run.caseId)!;
  return <div className="frontier-drawer-layer" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="frontier-drawer" role="dialog" aria-modal="true" aria-label={`${evalCase.name} trace`}>
      <div className="frontier-drawer-head">
        <div><p className="eyebrow">Measured trace · run {run.repetition}</p><h2>{evalCase.name}</h2><span>{run.modelDisplayName} · {frontierHarnesses[run.harnessId].name}</span></div>
        <button type="button" onClick={onClose} aria-label="Close trace">×</button>
      </div>
      <div className="frontier-trace-nav"><button type="button" disabled={index === 0} onClick={() => setIndex((value) => value - 1)}>Previous</button><span>{index + 1} of {results.length}</span><button type="button" disabled={index === results.length - 1} onClick={() => setIndex((value) => value + 1)}>Next</button></div>
      <div className="frontier-trace-status">
        <div className={run.passed ? "pass" : "fail"}><small>Result</small><b>{run.passed ? "PASS" : "FAIL"}</b></div>
        <div><small>Quality</small><b>{percent(run.quality)}</b></div>
        <div><small>Latency</small><b>{latency(run.latencyMs)}</b></div>
        <div><small>Tokens</small><b>{(run.inputTokens + run.outputTokens).toLocaleString()}</b></div>
        <div><small>Cost</small><b>{money(run.estimatedCostUsd)}</b></div>
      </div>
      {!run.passed ? <section className="frontier-failure"><b>Exact failure reason</b><p>{run.passReason}</p>{run.hardFailureReasons.map((reason) => <span key={reason}>{reason}</span>)}</section> : null}
      <section><h3>User request</h3><p>{evalCase.userMessage}</p></section>
      <section><h3>Input context</h3>{run.contextSent.map((block) => <div className="frontier-context" key={`${block.title}_${block.date}`}><b>{block.title}</b>{block.date ? <span>{block.date}</span> : null}<p>{block.content}</p></div>)}</section>
      {evalCase.documents.length ? <section><h3>Attached documents / page images</h3>{evalCase.documents.map((document) => <div key={document.href} className="frontier-document-row"><div><b>{document.name}</b><small>{document.pageImages?.length ?? 0} ordered page images · {run.inputNormalization}</small></div><a href={document.href} target="_blank" rel="noreferrer">Open PDF</a></div>)}</section> : null}
      <section><h3>System prompt</h3><pre>{run.systemPrompt}</pre></section>
      <section><h3>Harness configuration</h3><p>{frontierHarnesses[run.harnessId].summary}</p></section>
      <section><h3>Tool definitions</h3>{run.toolDefinitions.length ? run.toolDefinitions.map((item) => <details key={item.name}><summary>{item.name}</summary><p>{item.description}</p><pre>{JSON.stringify(item.parameters, null, 2)}</pre></details>) : <p>No tools supplied.</p>}</section>
      <section><h3>Model response / final answer</h3><p>{run.finalAnswer || "No final answer returned."}</p></section>
      <section><h3>Tool calls, arguments, and responses</h3>{run.toolCalls.length ? run.toolCalls.map((call) => <div className="frontier-tool-call" key={call.id}><b>{call.sequence}. {call.name}</b><small>Arguments</small><pre>{JSON.stringify(call.arguments, null, 2)}</pre><small>Response</small><pre>{JSON.stringify(call.response, null, 2)}</pre></div>) : <p>No tool calls.</p>}</section>
      <section><h3>Deterministic assertions</h3><div className="frontier-assertions">{run.assertions.map((assertion) => <div className={assertion.passed ? "pass" : "fail"} key={assertion.id}><b>{assertion.passed ? "PASS" : "FAIL"}</b><span>{assertion.label}</span><small>{assertion.evidence}</small></div>)}</div></section>
      <section><h3>Measured execution</h3><dl className="frontier-measured"><div><dt>Latency</dt><dd>{run.latencyMs.toLocaleString()}ms</dd></div><div><dt>Input tokens</dt><dd>{run.inputTokens.toLocaleString()}</dd></div><div><dt>Output tokens</dt><dd>{run.outputTokens.toLocaleString()}</dd></div><div><dt>Estimated cost</dt><dd>{money(run.estimatedCostUsd)}</dd></div><div><dt>Provider</dt><dd>{run.provider}</dd></div><div><dt>Runtime ID</dt><dd>{run.runtimeModelId}</dd></div></dl></section>
    </aside>
  </div>;
}

function EvalCaseDetails({ evalCase, onClose, onInspectPdf }: { evalCase: FrontierEvalCase; onClose: () => void; onInspectPdf: () => void }) {
  return <div className="frontier-drawer-layer" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="frontier-drawer frontier-case-drawer" role="dialog" aria-modal="true" aria-label={`${evalCase.name} eval details`}>
      <div className="frontier-drawer-head">
        <div><p className="eyebrow">Eval case</p><h2>{evalCase.name}</h2><span>{evalCase.category} · {evalCase.difficulty}</span></div>
        <button type="button" onClick={onClose} aria-label="Close eval details">×</button>
      </div>
      <section className="frontier-case-purpose">
        <p className="eyebrow">What this eval tests</p>
        <h3>{evalCase.hypothesis}</h3>
        <p>The same request, context, tools, and pass criteria are used for every selected model.</p>
      </section>
      <section><h3>User request</h3><blockquote>{evalCase.userMessage}</blockquote></section>
      <section><h3>Expected behavior</h3><ul>{evalCase.expectedBehavior.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section><h3>Deterministic pass checks</h3><div className="frontier-case-checks">{evalCase.deterministicAssertions.map((assertion) => <div key={assertion.id}><span>{assertion.dimension.replaceAll("_", " ")}</span><b>{assertion.label}</b></div>)}</div></section>
      <section className="frontier-case-hard-failures"><h3>Automatic hard failures</h3><ul>{evalCase.hardFailures.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section><h3>Grading rubric</h3><p>{evalCase.rubric}</p></section>
      <section><h3>Test inputs</h3><dl className="frontier-measured"><div><dt>Context blocks</dt><dd>{evalCase.context.length}</dd></div><div><dt>Tools available</dt><dd>{evalCase.tools.length}</dd></div><div><dt>Documents</dt><dd>{evalCase.documents.length}</dd></div></dl>{evalCase.documents.length ? <button type="button" className="frontier-case-pdf-link" onClick={onInspectPdf}>Inspect PDF fixture</button> : null}</section>
    </aside>
  </div>;
}

export function FrontierModelLab({ serverGatewayKey }: { serverGatewayKey?: boolean }) {
  const [modelConfigs] = useState<FrontierModelConfig[]>(initialModelConfigs);
  const [selectedCaseIds, setSelectedCaseIds] = useState(defaultDemoCaseIds);
  const [runsPerCase, setRunsPerCase] = useState(3);
  const [harnessSelection, setHarnessSelection] = useState<FrontierHarnessSelection>("improved");
  const [qualityThresholdPct, setQualityThresholdPct] = useState(90);
  const [history, setHistory] = useState<FrontierLabRun[]>(loadFrontierRuns);
  const [activeRunId, setActiveRunId] = useState<string | undefined>(() => loadFrontierRuns()[0]?.id);
  const [resultHarness, setResultHarness] = useState<FrontierHarnessId>("improved");
  const [traceSelection, setTraceSelection] = useState<{ results: FrontierScoredRun[]; index: number } | null>(null);
  const [showRunSettings, setShowRunSettings] = useState(false);
  const [showHarnessDiff, setShowHarnessDiff] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [detailCaseId, setDetailCaseId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ running: false, completed: 0, total: 0, message: "" });
  const activeRun = history.find((run) => run.id === activeRunId) ?? history[0];
  const threshold = qualityThresholdPct / 100;
  const selectedModels = modelConfigs;
  const selectedCases = frontierEvalCases.filter((item) => selectedCaseIds.includes(item.id));
  const detailCase = frontierEvalCases.find((item) => item.id === detailCaseId);
  const activeHarness = activeRun?.harnesses.includes(resultHarness) ? resultHarness : activeRun?.harnesses[0] ?? resultHarness;
  const activeResults = activeRun?.results.filter((result) => result.harnessId === activeHarness) ?? [];
  const aggregates = aggregateFrontierResults(activeResults);
  const runProblems = [
    selectedModels.length < 2 ? "Select at least two models." : "",
    selectedModels.length > 4 ? "Select no more than four models." : "",
    !selectedCases.length ? "Select at least one eval case." : "",
    selectedModels.some((model) => !model.runtimeModelId.trim()) ? "Add a current runtime model ID for every selected alias." : "",
    !serverGatewayKey ? "The server-side OpenRouter secret is not configured." : "",
  ].filter(Boolean);

  const toggleCase = (id: string) => setSelectedCaseIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);

  const toggleRunSettings = () => {
    setShowRunSettings((isOpen) => {
      if (isOpen) setShowHarnessDiff(false);
      return !isOpen;
    });
  };

  async function startEvaluation() {
    if (runProblems.length || progress.running) return;
    const harnesses: FrontierHarnessId[] = harnessSelection === "both" ? ["baseline", "improved"] : [harnessSelection];
    const run: FrontierLabRun = {
      id: `frontier_${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: "running",
      source: "live",
      modelConfigs: selectedModels,
      caseIds: selectedCases.map((item) => item.id),
      harnesses,
      runsPerCase,
      qualityThreshold: threshold,
      results: [],
    };
    const tasks = harnesses.flatMap((harnessId) => selectedCases.flatMap((evalCase) => selectedModels.flatMap((model) => Array.from({ length: runsPerCase }, (_, index) => ({ harnessId, evalCase, model, repetition: index + 1 })) )));
    setProgress({ running: true, completed: 0, total: tasks.length, message: "Starting live provider runs" });
    setHistory((items) => {
      const next = upsertFrontierRun(items, run);
      saveFrontierRuns(next);
      return next;
    });
    setActiveRunId(run.id);
    setResultHarness(harnesses.includes("improved") ? "improved" : harnesses[0]);
    const scored: FrontierScoredRun[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++];
        setProgress((value) => ({ ...value, message: `${task.model.displayName} · ${task.evalCase.shortName} · run ${task.repetition}` }));
        const raw = await runOne(task.model, task.evalCase.id, task.harnessId, task.repetition);
        scored.push(scoreFrontierRun(task.evalCase, raw, task.model, threshold));
        const checkpoint: FrontierLabRun = { ...run, results: [...scored] };
        setHistory((items) => {
          const next = upsertFrontierRun(items, checkpoint);
          saveFrontierRuns(next);
          return next;
        });
        setProgress((value) => ({ ...value, completed: value.completed + 1 }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, () => worker()));
    scored.sort((left, right) => {
      const harnessOrder = harnesses.indexOf(left.harnessId) - harnesses.indexOf(right.harnessId);
      if (harnessOrder) return harnessOrder;
      const caseOrder = run.caseIds.indexOf(left.caseId) - run.caseIds.indexOf(right.caseId);
      if (caseOrder) return caseOrder;
      const modelOrder = run.modelConfigs.findIndex((model) => model.id === left.modelAliasId)
        - run.modelConfigs.findIndex((model) => model.id === right.modelAliasId);
      return modelOrder || left.repetition - right.repetition;
    });
    const completed: FrontierLabRun = {
      ...run,
      completedAt: new Date().toISOString(),
      status: scored.some((result) => result.status === "error") ? "partial" : "completed",
      results: scored,
    };
    setHistory((items) => {
      const next = upsertFrontierRun(items, completed);
      saveFrontierRuns(next);
      return next;
    });
    setProgress({ running: false, completed: tasks.length, total: tasks.length, message: completed.status === "partial" ? "Completed with provider errors" : "Evaluation complete" });
  }

  const matrixResults = (caseId: string, modelId: string) => activeResults.filter((result) => result.caseId === caseId && result.modelAliasId === modelId);
  const routing = activeRun ? frontierRoutingRecommendations(activeRun) : [];
  const takeaways = activeRun ? frontierTakeaways(activeRun) : [];

  return <div className="frontier-lab">
    <section className="frontier-intro panel">
      <div><p className="eyebrow">Model × workflow × harness</p><h2>Comparing frontier model performance on a standard set of tasks</h2><p>Compare performance of 8 tasks cases across GPT Astra 6, GPT Sol 6.1 and Opus 5.5 (live calls) and compare quality, cost and latency across the 3 models.</p></div>
    </section>

    <section className="frontier-config panel">
      <div className="panelhead"><div><p className="eyebrow">Run configuration</p><h2>Comparable inputs, tools, and grading</h2></div><div className="frontier-config-actions"><span>{selectedModels.length} models · {selectedCases.length} cases</span>{!showRunSettings ? <small>{runsPerCase} runs · {frontierHarnesses[harnessSelection === "both" ? "improved" : harnessSelection].name}{harnessSelection === "both" ? " + Baseline" : ""} · {qualityThresholdPct}%</small> : null}<button type="button" className={`frontier-settings-toggle ${showRunSettings ? "active" : ""}`} aria-label={`${showRunSettings ? "Hide" : "Show"} run settings`} aria-expanded={showRunSettings} title={`${showRunSettings ? "Hide" : "Show"} run settings`} onClick={toggleRunSettings}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="M19.4 13.5a7.8 7.8 0 0 0 0-3l2-1.5-2-3.4-2.5 1a8.4 8.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.6A8.4 8.4 0 0 0 7 6.6l-2.5-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 3l-2 1.5 2 3.4 2.5-1a8.4 8.4 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8.4 8.4 0 0 0 2.6-1.5l2.5 1 2-3.4-2.1-1.5Z"/></svg></button></div></div>
      {showRunSettings ? <div className="frontier-config-grid settings-only"><div className="frontier-run-settings">
          <div className="frontier-section-head"><h3>Run controls</h3><small>Same settings for every provider</small></div>
          <label><span>Runs per case</span><select value={runsPerCase} onChange={(event) => setRunsPerCase(Number(event.target.value))}>{[1, 2, 3, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>Harness</span><select value={harnessSelection} onChange={(event) => setHarnessSelection(event.target.value as FrontierHarnessSelection)}><option value="baseline">Baseline</option><option value="improved">Improved</option><option value="both">Compare both</option></select></label>
          <label><span>Quality threshold</span><div className="frontier-threshold"><input type="range" min="50" max="100" step="1" value={qualityThresholdPct} onChange={(event) => setQualityThresholdPct(Number(event.target.value))} /><b>{qualityThresholdPct}%</b></div></label>
          <button type="button" className="frontier-diff-button" onClick={() => setShowHarnessDiff((value) => !value)}>Inspect Baseline ↔ Improved diff</button>
          <div className="frontier-provider-state"><span className={serverGatewayKey ? "ready" : "missing"} />Server-side OpenRouter secret {serverGatewayKey ? "ready" : "missing"}</div>
        </div></div> : null}
      {showRunSettings && showHarnessDiff ? <div className="frontier-harness-diff">
        <div><small>Baseline</small><p>{frontierHarnesses.baseline.systemPrompt}</p><span>{frontierHarnesses.baseline.summary}</span></div>
        <div><small>Improved</small><p>{frontierHarnesses.improved.systemPrompt}</p><span>{frontierHarnesses.improved.summary}</span></div>
      </div> : null}
      <div className="frontier-case-picker">
        <div className="frontier-section-head"><h3>Evaluation cases</h3><div><button type="button" onClick={() => setSelectedCaseIds(frontierEvalCases.map((item) => item.id))}>Select all</button><button type="button" onClick={() => setSelectedCaseIds([])}>Clear</button></div></div>
        <div className="frontier-case-grid">{frontierEvalCases.map((evalCase) => <article className={`frontier-case-option ${selectedCaseIds.includes(evalCase.id) ? "selected" : ""} ${evalCase.id === "disputed-enterprise-invoice" ? "centerpiece" : ""}`} key={evalCase.id}>
          <label className="frontier-case-checkbox" title={`${selectedCaseIds.includes(evalCase.id) ? "Remove" : "Add"} ${evalCase.name}`}><input type="checkbox" aria-label={`Select ${evalCase.name}`} checked={selectedCaseIds.includes(evalCase.id)} onChange={() => toggleCase(evalCase.id)} /></label>
          <button type="button" className="frontier-case-summary" onClick={() => setDetailCaseId(evalCase.id)} aria-label={`View what ${evalCase.name} tests`}><span><b>{evalCase.name}</b><small>{evalCase.category} · {evalCase.difficulty}</small></span><strong>View test</strong></button>
          {evalCase.documents.length ? <button type="button" className="frontier-case-pdf-button" onClick={() => setShowPdf(true)}>Inspect PDF</button> : null}
        </article>)}</div>
      </div>
      <div className="frontier-run-bar">
        <div>{runProblems.length ? runProblems.map((problem) => <span key={problem}>{problem}</span>) : <span className="ready">Ready for a live measured run. No seeded result data will be used.</span>}</div>
        <button type="button" className="primary" disabled={Boolean(runProblems.length) || progress.running} onClick={() => void startEvaluation()}>{progress.running ? `Running ${progress.completed}/${progress.total}` : "Start evaluation"}</button>
      </div>
      {progress.running || progress.message ? <div className="frontier-progress"><i style={{ width: `${progress.total ? progress.completed / progress.total * 100 : 0}%` }} /><span>{progress.message}</span></div> : null}
    </section>

    <section className="frontier-history panel">
      <div className="panelhead"><div><p className="eyebrow">Saved evaluation history</p><h2>Reopen earlier measured runs</h2><p className="frontier-history-note">Runs are checkpointed after every result and remain available after closing RouteLab on this browser and device.</p></div><span>{history.length} saved · up to 50 retained</span></div>
      {history.length ? <div className="frontier-history-list">{history.map((run) => <button type="button" className={run.id === activeRun?.id ? "active" : ""} onClick={() => { setActiveRunId(run.id); setResultHarness(run.harnesses.includes("improved") ? "improved" : run.harnesses[0]); }} key={run.id}><b>{run.status === "running" ? "Live run" : run.status === "partial" ? "Interrupted or partial run" : "Completed run"}</b><span>{new Date(run.completedAt ?? run.createdAt).toLocaleString()}</span><small>{run.modelConfigs.map((model) => model.displayName).join(" · ")}<br />{run.harnesses.map((item) => frontierHarnesses[item].name).join(" + ")} · {run.runsPerCase} runs/case · {run.results.length} results saved</small></button>)}</div> : <div className="frontier-empty-state"><b>No measured run yet</b><p>Live runs will be saved here as soon as they begin and remain available on this device after the session ends.</p></div>}
    </section>

    {activeRun && activeRun.results.length ? <>
      <section className="frontier-results panel">
        <div className="panelhead"><div><p className="eyebrow">Aggregate summary</p><h2>Quality, reliability, latency, and economics stay separate</h2></div>{activeRun.harnesses.length > 1 ? <div className="frontier-tabs">{activeRun.harnesses.map((item) => <button type="button" className={activeHarness === item ? "active" : ""} key={item} onClick={() => setResultHarness(item)}>{frontierHarnesses[item].name}</button>)}</div> : <span>{frontierHarnesses[activeHarness].name}</span>}</div>
        <div className="tablewrap"><table className="frontier-summary-table"><thead><tr><th>Model</th><th>Quality</th><th>Reliability</th><th>P50 latency</th><th>Avg cost/task</th><th>Cost/successful task</th></tr></thead><tbody>{aggregates.map((row) => <tr key={row.modelAliasId}><td><b>{row.modelDisplayName}</b><small>{row.successes}/{row.attempts} successful</small></td><td>{percent(row.quality)}</td><td>{percent(row.reliability)}</td><td>{latency(row.p50LatencyMs)}</td><td>{money(row.averageCostUsd)}</td><td>{row.successes ? money(row.costPerSuccessUsd) : "∞"}</td></tr>)}</tbody></table></div>
        <div className="frontier-matrix-wrap"><table className="frontier-matrix"><thead><tr><th>Enterprise eval case</th>{activeRun.modelConfigs.map((model) => <th key={model.id}>{model.displayName}</th>)}</tr></thead><tbody>{activeRun.caseIds.map((caseId) => { const evalCase = frontierEvalCases.find((item) => item.id === caseId)!; return <tr className={caseId === "disputed-enterprise-invoice" ? "centerpiece" : ""} key={caseId}><th><b>{evalCase.name}</b><span>{evalCase.category}</span>{evalCase.documents.length ? <button type="button" onClick={() => setShowPdf(true)}>Open 10-page fixture</button> : null}</th>{activeRun.modelConfigs.map((model) => { const results = matrixResults(caseId, model.id); const firstFailure = results.findIndex((result) => !result.passed); return <td key={model.id}><ResultCell results={results} onOpen={() => setTraceSelection({ results, index: firstFailure >= 0 ? firstFailure : 0 })} /></td>; })}</tr>; })}</tbody></table></div>
      </section>

      <section className="frontier-insights-grid">
        <div className="panel frontier-takeaways"><p className="eyebrow">What did we learn?</p><h2>Only claims supported by this run</h2><ol>{takeaways.map((item) => <li key={item}>{item}</li>)}</ol></div>
        <div className="panel frontier-routing"><p className="eyebrow">Workload-specific routing</p><h2>Lowest-cost measured model above the bar</h2><div>{routing.map((item) => <article key={item.caseId}><b>{item.caseName}</b><strong>{item.recommendedModel ?? "No passing route"}</strong><p>{item.reason}</p></article>)}</div></div>
      </section>

      <section className="panel frontier-harness-comparison">
        <div className="panelhead"><div><p className="eyebrow">Model vs harness</p><h2>Is capability or scaffolding the binding constraint?</h2></div><span>{activeRun.harnesses.length === 2 ? "Measured comparison" : "Run Compare both to populate"}</span></div>
        {activeRun.harnesses.length === 2 ? <div className="tablewrap"><table><thead><tr><th>Workflow</th><th>Model</th><th>Baseline</th><th>Improved</th><th>Measured interpretation</th></tr></thead><tbody>{activeRun.caseIds.flatMap((caseId) => activeRun.modelConfigs.map((model) => {
          const baseline = activeRun.results.filter((result) => result.caseId === caseId && result.modelAliasId === model.id && result.harnessId === "baseline");
          const improved = activeRun.results.filter((result) => result.caseId === caseId && result.modelAliasId === model.id && result.harnessId === "improved");
          const baseRate = baseline.length ? baseline.filter((result) => result.passed).length / baseline.length : 0;
          const improvedRate = improved.length ? improved.filter((result) => result.passed).length / improved.length : 0;
          const interpretation = baseRate < activeRun.qualityThreshold && improvedRate >= activeRun.qualityThreshold ? "Harness improvement closed the model-quality gap." : improvedRate < activeRun.qualityThreshold ? "Still below the bar; capability may be binding." : Math.abs(improvedRate - baseRate) < 0.01 ? "No material harness effect in this run." : "Harness changed measured reliability.";
          return <tr key={`${caseId}_${model.id}`}><td>{frontierEvalCases.find((item) => item.id === caseId)!.name}</td><td>{model.displayName}</td><td>{baseline.filter((result) => result.passed).length}/{baseline.length}</td><td>{improved.filter((result) => result.passed).length}/{improved.length}</td><td>{interpretation}</td></tr>;
        }))}</tbody></table></div> : <div className="frontier-empty-state"><b>No paired harness measurement</b><p>Select “Compare both” and rerun identical cases to determine whether improved scaffolding closes a model gap.</p></div>}
      </section>
    </> : null}

    {traceSelection ? <TraceViewer results={traceSelection.results} initialIndex={traceSelection.index} onClose={() => setTraceSelection(null)} /> : null}
    {detailCase ? <EvalCaseDetails evalCase={detailCase} onClose={() => setDetailCaseId(null)} onInspectPdf={() => { setDetailCaseId(null); setShowPdf(true); }} /> : null}
    {showPdf ? <div className="frontier-pdf-layer" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setShowPdf(false); }}><section role="dialog" aria-modal="true" aria-label="Disputed invoice PDF"><div className="frontier-pdf-head"><div><h2>Disputed Enterprise Invoice fixture</h2><p>10 pages · invoice, usage chart, stale schedule, signed amendment, scanned clause, and realistic distractors</p></div><a href="/frontier-lab/northstar_acme_october_invoice_dispute.pdf" target="_blank" rel="noreferrer">Open full PDF</a><button type="button" aria-label="Close PDF viewer" onClick={() => setShowPdf(false)}>×</button></div><div className="frontier-pdf-pages">{Array.from({ length: 10 }, (_, index) => <figure key={index}><img src={`/frontier-lab/invoice-pages/page-${String(index + 1).padStart(2, "0")}.png`} alt={`Invoice fixture page ${index + 1}`} /><figcaption>Page {index + 1}</figcaption></figure>)}</div></section></div> : null}
  </div>;
}
