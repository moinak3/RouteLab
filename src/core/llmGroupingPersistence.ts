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
  | { type: "error"; error?: unknown; recoverable?: boolean };

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown };
  return new Error(typeof payload.error === "string" ? payload.error : fallback);
}

export async function fetchLatestLLMGroupingRun(signal?: AbortSignal) {
  const response = await fetch("/api/llm-grouping/latest", { cache: "no-store", signal });
  if (!response.ok) throw await responseError(response, "Could not load the latest LLM grouping run.");
  const payload = await response.json() as { run?: unknown };
  return payload.run ? parseLLMGroupingRun(payload.run) : null;
}

export async function runLLMGroupingExperiment(
  traces: Trace[],
  onProgress: (progress: LLMGroupingProgress) => void,
  signal?: AbortSignal,
): Promise<LLMGroupingRun> {
  const inputs = prepareLLMGroupingInput(traces);
  const snapshot = createLLMGroupingSnapshot(traces);
  const response = await fetch("/api/llm-grouping/run", {
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

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as StreamEvent;
    if (event.type === "progress") onProgress(event);
    if (event.type === "complete") completedRun = parseLLMGroupingRun(event.run);
    if (event.type === "error") throw new Error(typeof event.error === "string" ? event.error : "LLM grouping failed.");
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(consumeLine);
    if (done) break;
  }
  consumeLine(buffer);
  if (!completedRun) throw new Error("The provider stream ended without a completed grouping result.");
  return completedRun;
}
