import type { Trace } from "../types";

export function isUnknownClassifierTrace(trace: Trace) {
  return trace.signature_decision?.status === "unknown"
    || trace.signature_decision?.signature_id === "unknown"
    || trace.metadata?.classifier_status === "unknown"
    || trace.metadata?.unknown_classifier === true;
}

export function runtimeTraceSourceLabel(trace: Trace) {
  if (trace.source === "routelab_support" || trace.metadata?.runtime_source === "routelab_support") return "Support Console";
  if (trace.source === "routelab_sidecar" || trace.metadata?.runtime_source === "routelab_sidecar") return "RouteLab Sidecar";
  return null;
}

export function mergeRuntimeTraces(current: Trace[], incoming: Trace[]) {
  const validIncoming = incoming.filter((trace) => trace
    && typeof trace.id === "string"
    && typeof trace.timestamp === "string"
    && typeof trace.model === "string"
    && typeof trace.prompt_text === "string"
    && Array.isArray(trace.messages));
  const incomingIds = new Set(validIncoming.map((trace) => trace.id));
  return [...validIncoming, ...current.filter((trace) => !incomingIds.has(trace.id))];
}
