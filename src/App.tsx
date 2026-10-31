import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type SetStateAction } from "react";
import { NewWorkspaceOverview } from "./components/NewWorkspaceOverview";
import { dashboardMetrics } from "./core/analysis";
import { pageForPath, pathForPage } from "./appRoutes";
import { OPENROUTER_AUTO_MODEL, enabledModels, registerOpenRouterModels, updateFamilyEnabled, updateModelEnabled, updateModelPricing } from "./core/catalog";
import { requiredOpenRouterModels, withRequiredOpenRouterModels } from "./core/openRouterModels";
import { createDistinctTaskBuckets } from "./core/distinctTasks";
import { createSimulatedGoldenDataset } from "./core/goldenDatasets";
import { buildWorkflowTrees, ingestText } from "./core/ingestion";
import { recommendPolicy } from "./core/recommendations";
import { mergeRuntimeTraces } from "./core/runtimeTraces";
import {
  DEFAULT_WEEKLY_REVIEW_BUDGET,
  fetchReviewWorkflow,
  HUMAN_REVIEW_DATASET_ID,
  persistReview,
  persistReviewCycle,
  persistTaskGroupReview,
  persistWeeklyReviewBudget,
  reviewLaneFromSearch,
  reviewLaneHref,
  reviewTaskFromSearch,
  reviewsAsGoldenDataset,
  type PersistedReview,
  type PersistedTaskGroupReview,
  type ReviewCycle,
  type ReviewTaskFilter,
  type ReviewWorkflowState,
  type SaveReviewInput,
  type SaveTaskGroupReviewInput,
} from "./core/reviewPersistence";
import { createSeedTraces, knownDistinctTaskSignatures } from "./core/seed";
import { createTraceJudgeResults } from "./core/traceJudge";
import { demoEvalDefinitions, ensureEvalScoreAnchors } from "./core/evalDefinitions";
import { loadActiveEvalConfig, type ActiveEvalConfig } from "./core/evalRegistry";
import {
  loadEvalAutomationPolicies,
  markEvalTracesProcessed,
  mergeEvalResults,
  runEvalOnTraces,
  saveEvalRunRecord,
  type EvalAutomationPolicy,
} from "./core/evalLifecycle";
import { clearWorkspaceBrowserState, clearWorkspaceTraces, loadActiveWorkspace, loadCloudWorkspaceId, loadPersonalWorkspace, replaceWorkspaceTraces, resetPersonalCloudWorkspaceId, saveActiveWorkspace, savePersonalWorkspace, type TaskGroupingMethod, type WorkspaceData, type WorkspaceId } from "./core/workspaces";
import { ClassifierValidation } from "./pages/ClassifierValidation";
import { Evals } from "./pages/Evals";
import { FineTuning } from "./pages/FineTuning";
import { FrontierModelLab } from "./pages/FrontierModelLab";
import { GoldenDataset } from "./pages/GoldenDataset";
import { Home } from "./pages/Home";
import { ModelCatalog } from "./pages/ModelCatalog";
import { Overview } from "./pages/Overview";
import { Recommendations } from "./pages/Recommendations";
import { ReviewQueue } from "./pages/ReviewQueue";
import { Simulations } from "./pages/Simulations";
import { Traces } from "./pages/Traces";
import { TaskSignatures } from "./pages/TaskSignatures";
import type { DistinctTaskBucket, FineTuneJob, GatewayProvider, GoldenDataset as GoldenDatasetType, Model, Trace } from "./types";
import type { Page, ReviewQueueFilter } from "./types/ui";

const initialTraces = createSeedTraces();
const initialTraceJudgeResults = createTraceJudgeResults(initialTraces);
const initialGoldenDatasets = [createSimulatedGoldenDataset(initialTraces, initialTraceJudgeResults)];
const DEEPSEEK_RECOMMENDATION_SCOPE = "deepseek_family";
const APP_PASSWORD = "Mochinder";
const PREVIEW_SESSION_KEY = "routelab-preview-unlocked";

type NavDestination = {
  label: string;
  page: Page;
  pages: Page[];
  icon: string;
  children?: Array<{ label: string; page: Page }>;
};
const workflowNav: NavDestination[] = [
  { label: "Overview", page: "Overview", pages: ["Overview"], icon: "O" },
  { label: "Workloads", page: "Traces", pages: ["Traces", "Distinct Tasks"], icon: "W", children: [{ label: "Traces", page: "Traces" }, { label: "Task Groups", page: "Distinct Tasks" }] },
  { label: "Response Quality", page: "Evals", pages: ["Evals"], icon: "Q" },
  { label: "Calibration", page: "Golden Dataset", pages: ["Golden Dataset", "Classifier Validation"], icon: "C", children: [{ label: "Response Quality Calibration", page: "Golden Dataset" }, { label: "Classifier Calibration", page: "Classifier Validation" }] },
  { label: "Routing", page: "Simulations", pages: ["Simulations"], icon: "M", children: [{ label: "Simulations & Route Selection", page: "Simulations" }] },
  { label: "Review", page: "Review Queue", pages: ["Review Queue"], icon: "R" },
];
const advancedNav: NavDestination[] = [
  { label: "Benchmarking", page: "Benchmarking", pages: ["Benchmarking"], icon: "B" },
  { label: "Settings", page: "Model Catalog", pages: ["Model Catalog"], icon: "S" },
];
const allNav = [...workflowNav, ...advancedNav];
const topLevelLabel = (page: Page) => allNav.find((item) => item.pages.includes(page))?.label ?? page;
const pageTitle = (page: Page) => page === "Simulations"
  ? "Simulations and Route selection"
  : topLevelLabel(page);

function hasPreviewAccess() {
  try {
    return window.sessionStorage.getItem(PREVIEW_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

export default function App() {
  const [page, setPage] = useState<Page>(() => pageForPath(window.location.pathname) ?? "Home");
  const [previewUnlocked, setPreviewUnlocked] = useState(hasPreviewAccess);
  const [expandedNav, setExpandedNav] = useState<Record<string, boolean>>({ Workloads: true, Calibration: false, Routing: false });
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>(loadActiveWorkspace);
  const [workspaceData, setWorkspaceData] = useState<Record<WorkspaceId, WorkspaceData>>(() => ({
    personal: loadPersonalWorkspace(),
    demo: { traces: initialTraces, traceJudgeResults: initialTraceJudgeResults, goldenDatasets: initialGoldenDatasets, taskGroups: createDistinctTaskBuckets(initialTraces), taskGroupingMethod: "rules" },
  }));
  const [personalCloudWorkspaceId, setPersonalCloudWorkspaceId] = useState(() => loadCloudWorkspaceId("personal"));
  const traces = workspaceData[activeWorkspace].traces;
  const traceJudgeResults = workspaceData[activeWorkspace].traceJudgeResults;
  const goldenDatasets = workspaceData[activeWorkspace].goldenDatasets;
  const distinctTaskBuckets = workspaceData[activeWorkspace].taskGroups;
  const taskGroupingMethod = workspaceData[activeWorkspace].taskGroupingMethod;
  const cloudWorkspaceId = activeWorkspace === "demo" ? "demo" : personalCloudWorkspaceId;
  const supportConsoleUrl = `/support-console/?workspace=${encodeURIComponent(cloudWorkspaceId)}&workspaceLabel=${encodeURIComponent(activeWorkspace === "demo" ? "RouteLab demo" : "My workspace")}`;
  const [evalAutomationPolicies, setEvalAutomationPolicies] = useState<EvalAutomationPolicy[]>(() => loadEvalAutomationPolicies(cloudWorkspaceId));
  const activeEvalRuns = useRef(new Set<string>());
  const setTraces = useCallback((next: SetStateAction<Trace[]>) => {
    setWorkspaceData((current) => {
      const workspace = current[activeWorkspace];
      const traces = typeof next === "function" ? next(workspace.traces) : next;
      return { ...current, [activeWorkspace]: { ...workspace, traces } };
    });
  }, [activeWorkspace]);
  const setGoldenDatasets = useCallback((next: SetStateAction<GoldenDatasetType[]>) => {
    setWorkspaceData((current) => {
      const workspace = current[activeWorkspace];
      const goldenDatasets = typeof next === "function" ? next(workspace.goldenDatasets) : next;
      return { ...current, [activeWorkspace]: { ...workspace, goldenDatasets } };
    });
  }, [activeWorkspace]);
  const addEvalResults = useCallback((results: typeof traceJudgeResults) => {
    if (!results.length) return;
    setWorkspaceData((current) => ({
      ...current,
      [activeWorkspace]: {
        ...current[activeWorkspace],
        traceJudgeResults: mergeEvalResults(current[activeWorkspace].traceJudgeResults, results),
      },
    }));
  }, [activeWorkspace]);
  const setTaskGroups = useCallback((taskGroups: DistinctTaskBucket[], method: TaskGroupingMethod) => {
    setWorkspaceData((current) => ({
      ...current,
      [activeWorkspace]: { ...current[activeWorkspace], taskGroups, taskGroupingMethod: method },
    }));
  }, [activeWorkspace]);
  const [candidate, setCandidate] = useState("deepseek-r1");
  const [recommendationCandidate, setRecommendationCandidate] = useState(DEEPSEEK_RECOMMENDATION_SCOPE);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [openRouterModels, setOpenRouterModels] = useState<Model[] | null>(null);
  const [familyApiKeys, setFamilyApiKeys] = useState<Partial<Record<Model["family"], string>>>({});
  const [gatewayApiKeys, setGatewayApiKeys] = useState<Partial<Record<GatewayProvider, string>>>({});
  const [serverGatewayKeys, setServerGatewayKeys] = useState<Partial<Record<GatewayProvider, boolean>>>({});
  const [reviewQueueFilter, setReviewQueueFilter] = useState<ReviewQueueFilter>(() => reviewLaneFromSearch(window.location.search));
  const [reviewTaskFilter, setReviewTaskFilter] = useState<ReviewTaskFilter>(() => reviewTaskFromSearch(window.location.search));
  const [weeklyReviewBudget, setWeeklyReviewBudget] = useState(DEFAULT_WEEKLY_REVIEW_BUDGET);
  const [persistedReviews, setPersistedReviews] = useState<PersistedReview[]>([]);
  const [persistedTaskGroupReviews, setPersistedTaskGroupReviews] = useState<PersistedTaskGroupReview[]>([]);
  const [currentReviewCycle, setCurrentReviewCycle] = useState<ReviewCycle | null>(null);
  const [reviewPersistenceState, setReviewPersistenceState] = useState<"loading" | "ready" | "saving" | "unavailable">("loading");
  const [reviewPersistenceError, setReviewPersistenceError] = useState<string | null>(null);
  const [fineTuneJobs, setFineTuneJobs] = useState<FineTuneJob[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [evalRegistryRevision, setEvalRegistryRevision] = useState(0);
  const activeModels = useMemo(() => enabledModels(), [catalogVersion]);
  const activeModelIds = useMemo(() => activeModels.map((model) => model.id), [activeModels]);
  const simulationModels = useMemo(() => [
    ...withRequiredOpenRouterModels(openRouterModels ?? activeModels).filter((model) => model.id !== OPENROUTER_AUTO_MODEL.id),
    OPENROUTER_AUTO_MODEL,
  ], [openRouterModels, activeModels]);
  const simulationModelIds = useMemo(() => simulationModels.map((model) => model.id), [simulationModels]);
  const metrics = useMemo(() => dashboardMetrics(traces), [traces]);
  const workflows = useMemo(() => buildWorkflowTrees(traces), [traces]);
  const deepSeekModelIds = useMemo(() => activeModels.filter((model) => model.family === "DeepSeek").map((model) => model.id), [activeModels]);
  const recommendationCandidateIds = useMemo(() => recommendationCandidate === DEEPSEEK_RECOMMENDATION_SCOPE ? deepSeekModelIds : [recommendationCandidate], [recommendationCandidate, deepSeekModelIds]);
  const policy = useMemo(() => recommendPolicy(traces, distinctTaskBuckets, recommendationCandidateIds.length ? recommendationCandidateIds : activeModelIds), [traces, distinctTaskBuckets, recommendationCandidateIds, activeModelIds, catalogVersion]);
  const activeSectionChildren = allNav.find((item) => item.pages.includes(page))?.children ?? [];

  useEffect(() => saveActiveWorkspace(activeWorkspace), [activeWorkspace]);
  useEffect(() => savePersonalWorkspace(workspaceData.personal), [workspaceData.personal]);
  useEffect(() => {
    setEvalAutomationPolicies(loadEvalAutomationPolicies(cloudWorkspaceId));
    const handlePolicyUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string; policies?: EvalAutomationPolicy[] }>).detail;
      if (detail?.workspaceId === cloudWorkspaceId && Array.isArray(detail.policies)) setEvalAutomationPolicies(detail.policies);
    };
    window.addEventListener("routelab-eval-policy-updated", handlePolicyUpdate);
    return () => window.removeEventListener("routelab-eval-policy-updated", handlePolicyUpdate);
  }, [cloudWorkspaceId]);
  useEffect(() => {
    const handleActiveEvalUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail;
      if (detail?.workspaceId === cloudWorkspaceId) setEvalRegistryRevision((revision) => revision + 1);
    };
    window.addEventListener("routelab-active-eval-updated", handleActiveEvalUpdate);
    return () => window.removeEventListener("routelab-active-eval-updated", handleActiveEvalUpdate);
  }, [cloudWorkspaceId]);
  const activeEvalConfig = useMemo<ActiveEvalConfig | undefined>(() => {
    const stored = loadActiveEvalConfig(cloudWorkspaceId);
    const livePolicy = stored
      ? evalAutomationPolicies.find((policy) => policy.runOnNewTraces && policy.evalId === stored.definition.id)
      : evalAutomationPolicies.find((policy) => policy.runOnNewTraces);
    if (livePolicy) return { definition: ensureEvalScoreAnchors(livePolicy.definition), version: livePolicy.evalVersion };
    if (stored) return stored;
    return activeWorkspace === "demo" ? { definition: demoEvalDefinitions[0], version: 1 } : undefined;
  }, [cloudWorkspaceId, evalAutomationPolicies, activeWorkspace, page, evalRegistryRevision]);

  useEffect(() => {
    if (!previewUnlocked || !traces.length) return;
    const controller = new AbortController();
    const enabled = evalAutomationPolicies.filter((policy) => policy.runOnNewTraces);
    const runNewTraceEvals = async () => {
      for (const policy of enabled) {
        if (activeEvalRuns.current.has(policy.evalId) || controller.signal.aborted) continue;
        const known = new Set(policy.knownTraceIds);
        const pending = traces.filter((trace) => !known.has(trace.id));
        if (!pending.length) continue;
        activeEvalRuns.current.add(policy.evalId);
        try {
          for (let offset = 0; offset < pending.length; offset += 25) {
            if (controller.signal.aborted) break;
            const batch = pending.slice(offset, offset + 25);
            const response = await runEvalOnTraces({
              workspaceId: cloudWorkspaceId,
              definition: policy.definition,
              evalVersion: policy.evalVersion,
              mode: "new_traces",
              traces: batch,
              signal: controller.signal,
            });
            addEvalResults(response.results);
            saveEvalRunRecord(cloudWorkspaceId, response.run);
          }
          if (!controller.signal.aborted) {
            markEvalTracesProcessed(cloudWorkspaceId, policy.evalId, pending.map((trace) => trace.id));
            setNotice(`${policy.definition.name} evaluated ${pending.length.toLocaleString()} new traces`);
          }
        } catch (error) {
          if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "New-trace evaluation failed");
        } finally {
          activeEvalRuns.current.delete(policy.evalId);
        }
      }
    };
    void runNewTraceEvals();
    return () => controller.abort();
  }, [previewUnlocked, traces, evalAutomationPolicies, cloudWorkspaceId, addEvalResults]);

  const refreshRuntimeTraces = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/runtime-traces?limit=500&workspace=${encodeURIComponent(cloudWorkspaceId)}`, { cache: "no-store", signal });
    const payload = await response.json().catch(() => ({})) as { traces?: Trace[] };
    if (!response.ok || !Array.isArray(payload.traces)) throw new Error("Runtime traces are unavailable.");
    if (payload.traces.length) setTraces(current => mergeRuntimeTraces(current, payload.traces!));
  }, [cloudWorkspaceId, setTraces]);

  function navigateTo(nextPage: Page, options?: { replace?: boolean }) {
    const nextPath = pathForPage(nextPage);
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentPath !== nextPath) {
      window.history[options?.replace ? "replaceState" : "pushState"]({ page: nextPage }, "", nextPath);
    }
    setPage(nextPage);
  }

  function openTaskGroupSimulation(bucketId: string) {
    const nextPath = `${pathForPage("Simulations")}?taskGroup=${encodeURIComponent(bucketId)}`;
    window.history.pushState({ page: "Simulations", taskGroup: bucketId }, "", nextPath);
    setPage("Simulations");
  }

  function switchWorkspace(workspace: WorkspaceId) {
    setActiveWorkspace(workspace);
    navigateTo("Overview");
    setNotice(workspace === "demo"
      ? "Demo workspace loaded · sample data only"
      : workspaceData.personal.traces.length
        ? "Your workspace loaded"
        : "Your workspace is ready for its first trace import");
  }

  function navigateToReviewLane(lane: ReviewQueueFilter, taskOrOptions?: ReviewTaskFilter | { replace?: boolean; task?: ReviewTaskFilter }) {
    const options = typeof taskOrOptions === "string" ? { task: taskOrOptions } : taskOrOptions;
    const task = options?.task ?? reviewTaskFilter;
    const nextPath = reviewLaneHref(lane, task);
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (currentPath !== nextPath) window.history[options?.replace ? "replaceState" : "pushState"]({ page: "Review Queue", lane, task }, "", nextPath);
    setReviewQueueFilter(lane);
    setReviewTaskFilter(task);
    setPage("Review Queue");
  }

  function handlePageLink(nextPage: Page) {
    return (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigateTo(nextPage);
    };
  }

  useEffect(() => {
    const handlePopState = () => {
      const nextPage = pageForPath(window.location.pathname) ?? "Home";
      if (nextPage === "Review Queue") {
        setReviewQueueFilter(reviewLaneFromSearch(window.location.search));
        setReviewTaskFilter(reviewTaskFromSearch(window.location.search));
      }
      setPage(nextPage);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const applyReviewWorkflow = useCallback((workflow: ReviewWorkflowState) => {
    setWeeklyReviewBudget(workflow.weeklyBudget);
    setPersistedReviews(workflow.reviews);
    setPersistedTaskGroupReviews(workflow.taskGroupReviews);
    setCurrentReviewCycle(workflow.currentCycle);
    const humanDataset = reviewsAsGoldenDataset(workflow.reviews);
    setGoldenDatasets((items) => {
      const withoutHumanReviews = items.filter((item) => item.id !== HUMAN_REVIEW_DATASET_ID);
      return humanDataset ? [humanDataset, ...withoutHumanReviews] : withoutHumanReviews;
    });
  }, [setGoldenDatasets]);

  useEffect(() => {
    if (!previewUnlocked) return;
    const controller = new AbortController();
    setReviewPersistenceState("loading");
    fetchReviewWorkflow(cloudWorkspaceId, controller.signal)
      .then((workflow) => {
        applyReviewWorkflow(workflow);
        setReviewPersistenceError(null);
        setReviewPersistenceState("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setReviewPersistenceError(error instanceof Error ? error.message : "Review persistence is unavailable.");
        setReviewPersistenceState("unavailable");
      });
    return () => controller.abort();
  }, [previewUnlocked, cloudWorkspaceId, applyReviewWorkflow]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [page]);

  useEffect(() => {
    const activeGroup = allNav.find((item) => item.children?.length && item.pages.includes(page));
    if (activeGroup) setExpandedNav((expanded) => ({ ...expanded, [activeGroup.label]: true }));
    if (advancedNav.some((item) => item.pages.includes(page))) {
      setExpandedNav((expanded) => ({ ...expanded, Advanced: true }));
    }
  }, [page]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/live/key-status")
      .then(response => response.ok ? response.json() : undefined)
      .then((payload: { gateways?: Partial<Record<GatewayProvider, boolean>> } | undefined) => {
        if (!cancelled && payload?.gateways) setServerGatewayKeys(payload.gateways);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (page !== "Overview" && page !== "Traces" && page !== "Review Queue") return;
    const controller = new AbortController();
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || controller.signal.aborted) return;
      refreshing = true;
      try { await refreshRuntimeTraces(controller.signal); }
      catch { /* Runtime trace storage is optional in local-only mode. */ }
      finally { refreshing = false; }
    };
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("routelab-runtime-traces");
    if (channel) channel.onmessage = (event) => {
      if (event.data?.type === "trace_saved" && event.data?.workspaceId === cloudWorkspaceId) void refresh();
    };
    void refresh();
    const timer = window.setInterval(refreshWhenVisible, 10_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      channel?.close();
    };
  }, [page, activeWorkspace, cloudWorkspaceId, refreshRuntimeTraces]);

  useEffect(() => {
    let cancelled = false;
    registerOpenRouterModels([OPENROUTER_AUTO_MODEL, ...requiredOpenRouterModels]);
    fetch("/api/openrouter/models")
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as { models?: Model[]; error?: unknown };
        if (!response.ok || !Array.isArray(payload.models) || !payload.models.length) throw new Error(String(payload.error ?? "OpenRouter catalog unavailable."));
        return payload.models;
      })
      .then(models => {
        if (cancelled) return;
        const availableModels = withRequiredOpenRouterModels(models);
        registerOpenRouterModels([OPENROUTER_AUTO_MODEL, ...availableModels]);
        setOpenRouterModels(availableModels);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!simulationModels.length) return;
    if (!simulationModelIds.includes(candidate)) setCandidate(simulationModels[0].id);
    if (recommendationCandidate !== DEEPSEEK_RECOMMENDATION_SCOPE && !activeModelIds.includes(recommendationCandidate)) setRecommendationCandidate(DEEPSEEK_RECOMMENDATION_SCOPE);
  }, [simulationModels, simulationModelIds, activeModelIds, candidate, recommendationCandidate]);

  async function applyUploadedText(text: string, fileName: string) {
    const result = ingestText(text, fileName);
    const errors = result.errors.slice(0, 8).map((error) => `Row ${error.row}: ${error.reason}`);
    if (result.traces.length) {
      setWorkspaceData((current) => ({
        ...current,
        personal: replaceWorkspaceTraces(current.personal, result.traces),
      }));
      setActiveWorkspace("personal");
      navigateTo("Overview");
      setNotice(`${result.traces.length.toLocaleString()} traces imported · no classification or evaluation run${result.errors.length ? ` · ${result.errors.length} rows skipped` : ""}`);
      return { imported: result.traces.length, errors };
    } else {
      setNotice(result.errors.length ? `${result.errors.length} rows could not be ingested` : "No LLM calls found in upload");
      return { imported: 0, errors: errors.length ? errors : ["No LLM calls were found in this file."] };
    }
  }

  async function upload(file?: File) {
    if (!file) return { imported: 0, errors: ["No file was selected."] };
    return applyUploadedText(await file.text(), file.name);
  }

  function clearPersonalTraces() {
    if (activeWorkspace !== "personal") return;
    const previousCloudWorkspaceId = personalCloudWorkspaceId;
    clearWorkspaceBrowserState(previousCloudWorkspaceId);
    const nextCloudWorkspaceId = resetPersonalCloudWorkspaceId();
    activeEvalRuns.current.clear();
    setWorkspaceData((current) => ({
      ...current,
      personal: clearWorkspaceTraces(current.personal),
    }));
    setPersonalCloudWorkspaceId(nextCloudWorkspaceId);
    setEvalAutomationPolicies([]);
    setWeeklyReviewBudget(DEFAULT_WEEKLY_REVIEW_BUDGET);
    setPersistedReviews([]);
    setPersistedTaskGroupReviews([]);
    setCurrentReviewCycle(null);
    setReviewPersistenceState("ready");
    setReviewPersistenceError(null);
    setReviewQueueFilter("representative");
    setReviewTaskFilter("all");
    setFineTuneJobs([]);
    navigateTo("Overview");
    setNotice("My workspace reset · traces, task groups, evals, reviews, and routing settings cleared");
  }

  function enterApp(password: string) {
    if (password === APP_PASSWORD) {
      try {
        window.sessionStorage.setItem(PREVIEW_SESSION_KEY, "true");
      } catch {
        // Session storage can be unavailable in privacy-restricted browsers.
      }
      setPreviewUnlocked(true);
      if (page === "Review Queue") navigateToReviewLane(reviewLaneFromSearch(window.location.search), { replace: true });
      else navigateTo(page === "Home" ? "Overview" : page, { replace: page !== "Home" });
      return true;
    }
    return false;
  }

  function addGoldenDataset(dataset: GoldenDatasetType) {
    setGoldenDatasets((items) => [dataset, ...items]);
    setNotice(`${dataset.name} uploaded · ${dataset.row_count.toLocaleString()} golden rows`);
  }

  function updateGoldenDataset(dataset: GoldenDatasetType) {
    setGoldenDatasets((items) => items.map((item) => item.id === dataset.id ? dataset : item));
  }

  async function saveWeeklyReviewBudget(weeklyBudget: number) {
    setReviewPersistenceState("saving");
    setReviewPersistenceError(null);
    try {
      const workflow = await persistWeeklyReviewBudget(cloudWorkspaceId, weeklyBudget);
      applyReviewWorkflow(workflow);
      setReviewPersistenceState("ready");
      setNotice(`Weekly review budget saved · ${workflow.weeklyBudget.toLocaleString()} conversations`);
    } catch (error) {
      setReviewPersistenceState("unavailable");
      setReviewPersistenceError(error instanceof Error ? error.message : "Review persistence is unavailable.");
      throw error;
    }
  }

  async function saveReviewCycle(cycle: ReviewCycle) {
    setReviewPersistenceState("saving");
    setReviewPersistenceError(null);
    try {
      const workflow = await persistReviewCycle(cloudWorkspaceId, cycle.weeklyBudget, cycle);
      applyReviewWorkflow(workflow);
      setReviewPersistenceState("ready");
    } catch (error) {
      setReviewPersistenceState("unavailable");
      setReviewPersistenceError(error instanceof Error ? error.message : "The weekly review batch could not be saved.");
      throw error;
    }
  }

  async function saveHumanReview(input: SaveReviewInput) {
    setReviewPersistenceState("saving");
    setReviewPersistenceError(null);
    try {
      const { review } = await persistReview(cloudWorkspaceId, input);
      const reviews = [review, ...persistedReviews.filter((item) => item.traceId !== review.traceId)];
      setPersistedReviews(reviews);
      const humanDataset = reviewsAsGoldenDataset(reviews);
      setGoldenDatasets((items) => {
        const withoutHumanReviews = items.filter((item) => item.id !== HUMAN_REVIEW_DATASET_ID);
        return humanDataset ? [humanDataset, ...withoutHumanReviews] : withoutHumanReviews;
      });
      setReviewPersistenceState("ready");
      setNotice(review.goldenRow ? "Human review saved · golden dataset updated" : "Human review saved");
      return review;
    } catch (error) {
      setReviewPersistenceState("unavailable");
      setReviewPersistenceError(error instanceof Error ? error.message : "Review persistence is unavailable.");
      throw error;
    }
  }

  async function saveTaskGroupHumanReview(input: SaveTaskGroupReviewInput) {
    setReviewPersistenceState("saving");
    setReviewPersistenceError(null);
    try {
      const { review } = await persistTaskGroupReview(cloudWorkspaceId, input);
      setPersistedTaskGroupReviews((items) => [review, ...items.filter((item) => item.traceId !== review.traceId)]);
      setReviewPersistenceState("ready");
      setNotice("Task Group label saved · classifier calibration updated");
      return review;
    } catch (error) {
      setReviewPersistenceState("unavailable");
      setReviewPersistenceError(error instanceof Error ? error.message : "The Task Group label could not be saved.");
      throw error;
    }
  }

  function deleteGoldenDataset(id: string) {
    setGoldenDatasets((items) => items.filter((item) => item.id !== id));
    setFineTuneJobs((items) => items.filter((job) => job.dataset_id !== id));
    setNotice("Golden dataset deleted");
  }

  async function startFineTune(dataset: GoldenDatasetType, baseModel: string, provider: string) {
    const now = new Date();
    const job: FineTuneJob = {
      id: `ft_${now.getTime()}`,
      dataset_id: dataset.id,
      dataset_name: dataset.name,
      base_model: baseModel,
      provider,
      status: "running",
      created_at: now.toISOString(),
      mode: provider === "BaseTen" ? "baseten" : "simulated",
    };
    setFineTuneJobs((items) => [job, ...items]);
    if (provider === "BaseTen") {
      setNotice(`Creating BaseTen training job for ${baseModel}`);
      try {
        const response = await fetch("/api/fine-tuning/baseten", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataset, baseModel, provider }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error ?? "BaseTen fine-tuning request failed.");
        const trainingJob = payload.training_job ?? {};
        const trainingProject = payload.training_project ?? {};
        setFineTuneJobs((items) => items.map((item) => item.id === job.id ? {
          ...item,
          status: "queued",
          external_job_id: String(trainingJob.id ?? ""),
          external_project_id: String(trainingProject.id ?? trainingJob.training_project_id ?? ""),
          external_url: trainingJob.id ? "https://app.baseten.co/" : undefined,
        } : item));
        setNotice(`BaseTen training job created${trainingJob.id ? `: ${trainingJob.id}` : ""}`);
      } catch (error) {
        setFineTuneJobs((items) => items.map((item) => item.id === job.id ? {
          ...item,
          status: "failed",
          error: error instanceof Error ? error.message : "BaseTen fine-tuning failed.",
        } : item));
        setNotice(error instanceof Error ? error.message : "BaseTen fine-tuning failed.");
      }
      return;
    }

    setNotice(`Simulated fine-tuning started: ${baseModel} on ${provider}`);
    window.setTimeout(() => {
      setFineTuneJobs((items) => items.map((item) => item.id === job.id ? { ...item, status: "completed", completed_at: new Date().toISOString() } : item));
      setNotice(`Simulated fine-tuning completed: ${baseModel}`);
    }, 900);
  }

  function deployFineTune(jobId: string, target: string) {
    setFineTuneJobs((items) => items.map((item) => item.id === jobId ? { ...item, deployment_target: target } : item));
    setNotice(`${target} selected for fine-tuned model`);
  }

  if (page === "Home" || !previewUnlocked) {
    return <Home onGetStarted={enterApp} promptForPassword={page !== "Home"} />;
  }

  return <div className="shell">
    <aside>
      <a className="brand" href="/" aria-label="RouteLab home"><span className="brandmark">R</span><div><b>RouteLab</b><small>Routing intelligence</small></div></a>
      <label className="workspace-switcher"><span>Workspace</span><select value={activeWorkspace} onChange={(event) => switchWorkspace(event.target.value as WorkspaceId)}><option value="personal">My workspace</option><option value="demo">RouteLab demo</option></select><small>{activeWorkspace === "demo" ? "Sample data · changes reset" : traces.length ? `${traces.length.toLocaleString()} imported traces` : "No data added yet"}</small></label>
      <nav aria-label="Primary navigation">
        <small className="nav-group-label">Workflow</small>
        {workflowNav.map((item) => item.children ? <div className="nav-collapsible" key={item.label}>
          <button
            type="button"
            className={`nav-parent ${item.pages.includes(page) ? "active" : ""}`}
            onClick={() => setExpandedNav((expanded) => ({ ...expanded, [item.label]: !expanded[item.label] }))}
            aria-expanded={Boolean(expandedNav[item.label])}
            aria-controls={`${item.label.toLowerCase()}-submenu`}
          >
            <span>{item.icon}</span>{item.label}<i className="nav-caret" aria-hidden="true">{expandedNav[item.label] ? "-" : "+"}</i>
          </button>
          {expandedNav[item.label] && <div className="nav-submenu" id={`${item.label.toLowerCase()}-submenu`}>
            {item.children.map((child) => <a href={pathForPage(child.page)} className={page === child.page ? "active" : ""} aria-current={page === child.page ? "page" : undefined} onClick={handlePageLink(child.page)} key={child.page}>{child.label}</a>)}
          </div>}
        </div> : <a href={pathForPage(item.page)} className={item.pages.includes(page) ? "active" : ""} aria-current={item.pages.includes(page) ? "page" : undefined} onClick={handlePageLink(item.page)} key={item.label}><span>{item.icon}</span>{item.label}</a>)}
        <div className="nav-collapsible advanced-nav">
          <button
            type="button"
            className={`nav-parent ${advancedNav.some((item) => item.pages.includes(page)) ? "active" : ""}`}
            onClick={() => setExpandedNav((expanded) => ({ ...expanded, Advanced: !expanded.Advanced }))}
            aria-expanded={Boolean(expandedNav.Advanced)}
            aria-controls="advanced-submenu"
          >
            <span>A</span>Advanced<i className="nav-caret" aria-hidden="true">{expandedNav.Advanced ? "-" : "+"}</i>
          </button>
          {expandedNav.Advanced && <div className="nav-submenu" id="advanced-submenu">
            {advancedNav.map((item) => <a href={pathForPage(item.page)} className={item.pages.includes(page) ? "active" : ""} aria-current={item.pages.includes(page) ? "page" : undefined} onClick={handlePageLink(item.page)} key={item.label}>{item.label}</a>)}
            <a href={supportConsoleUrl} target="_blank" rel="noreferrer">Test Console</a>
          </div>}
        </div>
      </nav>
    </aside>
    <main>
      {page !== "Benchmarking" ? <header><h1>{pageTitle(page)}</h1><div className="header-workspace-control"><span className={`workspace-badge ${activeWorkspace}`}>{activeWorkspace === "demo" ? "Demo data" : "My workspace"}</span><select className="mobile-workspace-select" aria-label="Select workspace" value={activeWorkspace} onChange={(event) => switchWorkspace(event.target.value as WorkspaceId)}><option value="personal">My workspace</option><option value="demo">RouteLab demo</option></select></div></header> : null}
      <div className="mobile-nav" aria-label="Mobile navigation">
        {workflowNav.map(item=><a href={pathForPage(item.page)} className={item.pages.includes(page)?"active":""} aria-current={item.pages.includes(page) ? "page" : undefined} onClick={handlePageLink(item.page)} key={item.label}>{item.label}</a>)}
        <button type="button" className={advancedNav.some((item) => item.pages.includes(page)) ? "active" : ""} aria-expanded={Boolean(expandedNav.Advanced)} aria-controls="mobile-advanced-submenu" onClick={() => setExpandedNav((expanded) => ({ ...expanded, Advanced: !expanded.Advanced }))}>Advanced</button>
      </div>
      {expandedNav.Advanced && <nav className="group-mobile-subnav mobile-advanced-submenu" id="mobile-advanced-submenu" aria-label="Advanced navigation">
          {advancedNav.map(item=><a href={pathForPage(item.page)} className={item.pages.includes(page)?"active":""} aria-current={item.pages.includes(page) ? "page" : undefined} onClick={handlePageLink(item.page)} key={item.label}>{item.label}</a>)}
          <a href={supportConsoleUrl} target="_blank" rel="noreferrer">Test Console</a>
      </nav>}
      {activeSectionChildren.length > 0 && <nav className="group-mobile-subnav" aria-label={`${topLevelLabel(page)} sections`}>{activeSectionChildren.map((child) => <a href={pathForPage(child.page)} className={page === child.page ? "active" : ""} aria-current={page === child.page ? "page" : undefined} onClick={handlePageLink(child.page)} key={child.page}>{child.label}</a>)}</nav>}
      {notice && <div className="notice"><span>✓</span>{notice}</div>}
      {page === "Overview" && activeWorkspace === "personal" && traces.length === 0 && <NewWorkspaceOverview onImport={upload} onNavigate={navigateTo} onUseDemo={() => switchWorkspace("demo")} />}
      {page === "Overview" && (activeWorkspace === "demo" || traces.length > 0) && <Overview key={`overview-${cloudWorkspaceId}`} workspaceId={cloudWorkspaceId} metrics={metrics} distinctTaskBuckets={distinctTaskBuckets} traces={traces} traceJudgeResults={traceJudgeResults} evaluationEvidenceCount={traceJudgeResults.length + goldenDatasets.reduce((sum, dataset) => sum + dataset.row_count, 0)} workflowCount={workflows.length} onNavigate={navigateTo} onReviewQueue={navigateToReviewLane} personalWorkspace={activeWorkspace === "personal"} />}
      {page === "Traces" && <Traces traces={traces} traceJudgeResults={traceJudgeResults} onImport={upload} personalWorkspace={activeWorkspace === "personal"} onClearTraces={clearPersonalTraces} />}
      {page === "Distinct Tasks" && <TaskSignatures key={`groups-${cloudWorkspaceId}`} workspaceId={cloudWorkspaceId} traces={traces} traceJudgeResults={traceJudgeResults} serverGatewayKey={serverGatewayKeys.OpenRouter} taskGroups={distinctTaskBuckets} taskGroupingMethod={taskGroupingMethod} onTaskGroupsChange={setTaskGroups} onRunSimulation={openTaskGroupSimulation} />}
      {page === "Evals" && <Evals key={`evals-${cloudWorkspaceId}`} workspaceId={cloudWorkspaceId} workspace={activeWorkspace} traces={traces} traceJudgeResults={traceJudgeResults} models={simulationModels} onReviewFilter={(lane) => navigateToReviewLane(lane, "response_quality")} onOpenCalibration={() => navigateTo("Golden Dataset")} onEvalResults={addEvalResults} onAutomationPoliciesChange={setEvalAutomationPolicies} />}
      {page === "Golden Dataset" && <GoldenDataset traces={traces} traceJudgeResults={traceJudgeResults} datasets={goldenDatasets} onUpload={addGoldenDataset} onUpdate={updateGoldenDataset} onDelete={deleteGoldenDataset} onOpenEvalLibrary={() => navigateTo("Evals")} onOpenReviewQueue={() => navigateToReviewLane("unusual", "response_quality")} />}
      {page === "Review Queue" && <ReviewQueue traces={traces} traceJudgeResults={traceJudgeResults} distinctTaskBuckets={distinctTaskBuckets} goldenDatasets={goldenDatasets} filter={reviewQueueFilter} taskFilter={reviewTaskFilter} onFilterChange={navigateToReviewLane} weeklyBudget={weeklyReviewBudget} persistedReviews={persistedReviews} persistedTaskGroupReviews={persistedTaskGroupReviews} currentCycle={currentReviewCycle} persistenceState={reviewPersistenceState} persistenceError={reviewPersistenceError} onWeeklyBudgetChange={saveWeeklyReviewBudget} onSaveCycle={saveReviewCycle} onSaveReview={saveHumanReview} onSaveTaskGroupReview={saveTaskGroupHumanReview} onOpenClassifierValidation={() => navigateTo("Classifier Validation")} />}
      {page === "Classifier Validation" && <ClassifierValidation signatures={knownDistinctTaskSignatures} workspace={activeWorkspace} workspaceId={cloudWorkspaceId} traces={traces} taskGroups={distinctTaskBuckets} onOpenResponseReview={() => navigateToReviewLane("representative", "task_group")} onOpenCalibration={() => navigateTo("Golden Dataset")} />}
      {page === "Simulations" && <Simulations key={`simulations-${cloudWorkspaceId}`} workspaceId={cloudWorkspaceId} traces={traces} traceJudgeResults={traceJudgeResults} distinctTaskBuckets={distinctTaskBuckets} candidate={candidate} setCandidate={setCandidate} catalogVersion={catalogVersion} activeModels={activeModels} candidateModels={simulationModels} familyApiKeys={familyApiKeys} gatewayApiKeys={gatewayApiKeys} serverGatewayKeys={serverGatewayKeys} activeEval={activeEvalConfig} />}
      {page === "Benchmarking" && <FrontierModelLab serverGatewayKey={serverGatewayKeys.OpenRouter} />}
      {page === "Recommendations" && <Recommendations policy={policy} activeModels={activeModels} traceCount={traces.length} />}
      {page === "Fine-Tuning" && <FineTuning traces={traces} distinctTaskBuckets={distinctTaskBuckets} traceJudgeResults={traceJudgeResults} datasets={goldenDatasets} jobs={fineTuneJobs} onStartFineTune={startFineTune} onDeployFineTune={deployFineTune} />}
      {page === "Model Catalog" && <ModelCatalog catalogVersion={catalogVersion} familyApiKeys={familyApiKeys} gatewayApiKeys={gatewayApiKeys} onFamilyApiKey={(family,key)=>setFamilyApiKeys(keys=>({...keys,[family]:key}))} onGatewayApiKey={(gateway,key)=>setGatewayApiKeys(keys=>({...keys,[gateway]:key}))} onModelEnabled={(id:string,enabled:boolean)=>{updateModelEnabled(id,enabled);setCatalogVersion(value=>value+1)}} onFamilyEnabled={(family:Model["family"],enabled:boolean)=>{updateFamilyEnabled(family,enabled);setCatalogVersion(value=>value+1)}} onPricing={(id:string,input:number,output:number)=>{updateModelPricing(id,input,output);setCatalogVersion(value=>value+1)}} />}
    </main>
  </div>;
}
