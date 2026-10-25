import type { KnownTaskSignature, Trace, TraceSignatureDecision } from "../types";

export const JEV_UNKNOWN_SIGNATURE_ID = "unknown";
export const JEV_BASE_CONFIDENCE_THRESHOLD = .8;
export const JEV_RISK_THRESHOLDS = { low: .8, medium: .86, high: .92 } as const;

export type JevChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

export type JevSignatureGateResponse = {
  decisions: Array<{ trace_id: string; decision: TraceSignatureDecision }>;
  summary: { total: number; matched: number; fallback: number; unknown: number; failed: number };
};

export const signatureCriteria = (signatures: KnownTaskSignature[]) => Object.fromEntries([
  ...signatures.map((signature) => [signature.id, signature.description]),
  [JEV_UNKNOWN_SIGNATURE_ID, "The request does not reliably match any known task signature, or there is not enough evidence to decide."],
]);

export function interpretJevSignatureChoice(
  answer: JevChoiceAnswer,
  signatures: KnownTaskSignature[],
  model: string,
  latencyMs: number,
  baseThreshold = JEV_BASE_CONFIDENCE_THRESHOLD,
): TraceSignatureDecision {
  const selected = signatures.find((signature) => signature.id === answer.choice);
  const isUnknown = answer.choice === JEV_UNKNOWN_SIGNATURE_ID || !selected;
  const threshold = selected ? Math.max(baseThreshold, JEV_RISK_THRESHOLDS[selected.risk_level]) : baseThreshold;
  const ranked = Object.entries(answer.probabilities ?? {}).sort((left, right) => right[1] - left[1]);
  const runnerUpEntry = ranked.find(([id]) => id !== answer.choice);
  const runnerUpSignature = runnerUpEntry ? signatures.find((signature) => signature.id === runnerUpEntry[0]) : undefined;
  const lowConfidence = !isUnknown && answer.confidence < threshold;
  const routingAction = !isUnknown && !lowConfidence ? "signature_route" : "fallback_model";
  const status = isUnknown ? "unknown" : lowConfidence ? "low_confidence" : "matched";
  const signatureLabel = selected?.label ?? "Unknown or new signature";
  const reason = isUnknown
    ? "Jev did not find a reliable match in the known signature catalog. Use the configured default strategy and review for new coverage."
    : lowConfidence
      ? `Jev's ${(answer.confidence * 100).toFixed(1)}% confidence is below the ${(threshold * 100).toFixed(0)}% ${selected.risk_level}-risk routing threshold. Use the default strategy unless the request requires the high-risk emergency route.`
      : `Jev cleared the ${(threshold * 100).toFixed(0)}% ${selected.risk_level}-risk threshold for ${selected.label}.`;
  return {
    provider: "jev", model, signature_id: selected?.id ?? JEV_UNKNOWN_SIGNATURE_ID, signature_label: signatureLabel,
    confidence: answer.confidence, probabilities: answer.probabilities ?? {}, status, routing_action: routingAction,
    confidence_threshold: threshold, latency_ms: latencyMs, reason,
    runner_up: runnerUpEntry ? {
      signature_id: runnerUpEntry[0],
      signature_label: runnerUpSignature?.label ?? (runnerUpEntry[0] === JEV_UNKNOWN_SIGNATURE_ID ? "Unknown or new signature" : runnerUpEntry[0]),
      confidence: runnerUpEntry[1],
    } : undefined,
  };
}

export const failedJevSignatureDecision = (
  status: Extract<TraceSignatureDecision["status"], "timeout" | "error" | "provider_unavailable">,
  reason: string,
  latencyMs = 0,
  model = "typesafe/jev-1.14",
): TraceSignatureDecision => ({
  provider: "jev", model, signature_id: JEV_UNKNOWN_SIGNATURE_ID,
  signature_label: "Unknown or new signature", confidence: 0, probabilities: {}, status,
  routing_action: "fallback_model", confidence_threshold: JEV_BASE_CONFIDENCE_THRESHOLD,
  latency_ms: latencyMs, reason, error: reason,
});

export const applyJevSignatureDecisions = (
  traces: Trace[],
  decisions: JevSignatureGateResponse["decisions"],
) => {
  const byTrace = new Map(decisions.map((item) => [item.trace_id, item.decision]));
  return traces.map((trace) => ({ ...trace, signature_decision: byTrace.get(trace.id) ?? trace.signature_decision }));
};

export async function classifyTraceSignaturesWithJev(
  traces: Trace[],
  signatures: KnownTaskSignature[],
  baseThreshold = JEV_BASE_CONFIDENCE_THRESHOLD,
): Promise<JevSignatureGateResponse> {
  const response = await fetch("/api/jev/signature-gate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ traces, signatures, baseThreshold }),
  });
  const payload = await response.json().catch(() => ({})) as Partial<JevSignatureGateResponse> & { error?: string };
  if (!response.ok || !payload.decisions || !payload.summary) throw new Error(payload.error ?? "Jev signature classification failed.");
  return payload as JevSignatureGateResponse;
}
