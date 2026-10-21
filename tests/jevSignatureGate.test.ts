import { describe, expect, it } from "vitest";
import {
  applyJevSignatureDecisions,
  interpretJevSignatureChoice,
  JEV_UNKNOWN_SIGNATURE_ID,
} from "../src/core/jevSignatureGate";
import type { KnownTaskSignature, Trace } from "../src/types";

const signatures: KnownTaskSignature[] = [
  { id: "billing_dispute", label: "Billing dispute", description: "Disputed charges and refunds", risk_level: "medium" },
  { id: "account_security", label: "Account security", description: "Authentication and account access", risk_level: "high" },
];

describe("Jev signature gate", () => {
  it("unlocks a known route only above its risk-adjusted threshold", () => {
    const decision = interpretJevSignatureChoice({
      type: "choice",
      choice: "billing_dispute",
      confidence: .9,
      probabilities: { billing_dispute: .9, account_security: .07, unknown: .03 },
    }, signatures, "typesafe/jev-1.14", 190);
    expect(decision.status).toBe("matched");
    expect(decision.routing_action).toBe("signature_route");
    expect(decision.confidence_threshold).toBe(.86);
  });

  it("uses the fallback model for a low-confidence high-risk match", () => {
    const decision = interpretJevSignatureChoice({
      type: "choice",
      choice: "account_security",
      confidence: .9,
      probabilities: { account_security: .9, billing_dispute: .06, unknown: .04 },
    }, signatures, "typesafe/jev-1.14", 210);
    expect(decision.status).toBe("low_confidence");
    expect(decision.routing_action).toBe("fallback_model");
    expect(decision.confidence_threshold).toBe(.92);
  });

  it("preserves explicit unknown decisions and runner-up evidence", () => {
    const decision = interpretJevSignatureChoice({
      type: "choice",
      choice: JEV_UNKNOWN_SIGNATURE_ID,
      confidence: .72,
      probabilities: { unknown: .72, billing_dispute: .2, account_security: .08 },
    }, signatures, "typesafe/jev-1.14", 180);
    expect(decision.status).toBe("unknown");
    expect(decision.routing_action).toBe("fallback_model");
    expect(decision.runner_up?.signature_id).toBe("billing_dispute");
  });

  it("attaches decisions to their matching traces", () => {
    const trace = { id: "trace_1" } as Trace;
    const decision = interpretJevSignatureChoice({
      type: "choice",
      choice: "billing_dispute",
      confidence: .9,
      probabilities: { billing_dispute: .9, unknown: .1 },
    }, signatures, "typesafe/jev-1.14", 190);
    expect(applyJevSignatureDecisions([trace], [{ trace_id: trace.id, decision }])[0].signature_decision).toEqual(decision);
  });
});
