import {
  createLLMGroupingSnapshot,
  parseLLMGroupingRun,
  prepareLLMGroupingInput,
  type LLMGroupingRun,
  type LLMGroupingStage,
} from "./llmGrouping";
import type { Trace } from "../types";

export type LLMGroupingProgress = {
  stage: LLMGroupingStage;
  completed: number;
  total: number;
  message: string;
};

type StreamEvent =
  | ({ type: "progress" } & LLMGroupingProgress)
  | { type: "complete"; run: unknown }
  | { type: "error"; error?: unknown; recoverable?: boolean }
  | { type: "heartbeat"; at: string };

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown };
  return new Error(typeof payload.error === "string" ? payload.error : fallback);
}

const workspaceUrl = (path: string, workspaceId: string) => `${path}${path.includes("?") ? "&" : "?"}workspace=${encodeURIComponent(workspaceId)}`;

const sameSnapshot = (run: LLMGroupingRun, snapshot: LLMGroupingRun["snapshot"]) => (
  run.snapshot.hash === snapshot.hash
  && run.snapshot.totalTraces === snapshot.totalTraces
  && run.snapshot.traceIds.length === snapshot.traceIds.length
  && run.snapshot.traceIds.every((traceId, index) => traceId === snapshot.traceIds[index])
);

const wait = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  const onAbort = () => {
    clearTimeout(timeout);
    reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  };
  const timeout = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, milliseconds);
  signal?.addEventListener("abort", onAbort, { once: true });
});

async function recoverSavedRun(workspaceId: string, snapshot: LLMGroupingRun["snapshot"], signal?: AbortSignal) {
  for (const delay of [0, 500, 1_500]) {
    if (delay) await wait(delay, signal);
    try {
      const latest = await fetchLatestLLMGroupingRun(workspaceId, signal);
      if (latest && sameSnapshot(latest, snapshot)) return latest;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return null;
}

export async function fetchLatestLLMGroupingRun(workspaceId: string, signal?: AbortSignal) {
  const response = await fetch(workspaceUrl("/api/llm-grouping/latest", workspaceId), { cache: "no-store", signal });
  if (!response.ok) throw await responseError(response, "Could not load the latest LLM grouping run.");
  const payload = await response.json() as { run?: unknown };
  return payload.run ? parseLLMGroupingRun(payload.run) : null;
}

export async function runLLMGroupingExperiment(
  traces: Trace[],
  workspaceId: string,
  onProgress: (progress: LLMGroupingProgress) => void,
  signal?: AbortSignal,
): Promise<LLMGroupingRun> {
  const inputs = prepareLLMGroupingInput(traces);
  const snapshot = createLLMGroupingSnapshot(traces);
  const response = await fetch(workspaceUrl("/api/llm-grouping/run", workspaceId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inputs, snapshot }),
    signal,
  });
  if (!response.ok || !response.body) throw await responseError(response, "LLM grouping could not start.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completedRun: LLMGroupingRun | null = null;
  let reportedError: Error | null = null;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as StreamEvent;
    if (event.type === "progress") onProgress(event);
    if (event.type === "complete") completedRun = parseLLMGroupingRun(event.run);
    if (event.type === "error") {
      reportedError = new Error(typeof event.error === "string" ? event.error : "LLM grouping failed.");
      throw reportedError;
    }
  };

  let streamFailure: unknown = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(consumeLine);
      if (done) break;
    }
    consumeLine(buffer);
  } catch (error) {
    streamFailure = error;
  }
  if (reportedError) throw reportedError;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  if (!completedRun) {
    const recovered = await recoverSavedRun(workspaceId, snapshot, signal);
    if (recovered) return recovered;
    if (streamFailure instanceof Error) throw new Error(`The grouping connection closed before the completed result was received: ${streamFailure.message}`);
    throw new Error("The grouping connection closed before a completed result was received, and no matching saved run was found. Please retry.");
  }
  return completedRun;
}
