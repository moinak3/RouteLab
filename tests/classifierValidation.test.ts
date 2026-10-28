import { describe, expect, it } from "vitest";
import { buildClassifierValidationReport, classifierValidationReadiness, createDemoClassifierValidationExamples } from "../src/core/classifierValidation";
import { knownDistinctTaskSignatures } from "../src/core/seed";

describe("classifier validation", () => {
  it("measures gated precision, coverage, abstention, unknown acceptance, and per-signature recall", () => {
    const examples = createDemoClassifierValidationExamples(knownDistinctTaskSignatures);
    const report = buildClassifierValidationReport(examples, knownDistinctTaskSignatures, {
      datasetLabel: "test",
      classifierModel: "typesafe/jev-1.14",
      signatureCatalogVersion: "v1",
      testSplit: "held-out",
      thresholdTuningSplit: "calibration",
    });
    expect(report.metadata.sampleSize).toBe(examples.length);
    expect(report.acceptedPrecision).toBeGreaterThan(0);
    expect(report.coverage).toBeGreaterThan(0);
    expect(report.abstention).toBeCloseTo(1 - report.coverage);
    expect(report.unknownFalseAcceptance).toBeGreaterThan(0);
    expect(report.perSignature).toHaveLength(knownDistinctTaskSignatures.length);
    expect(report.confusion.unknown).toBeDefined();
    expect(report.errors.length).toBeGreaterThan(0);
    expect(examples.every((example) => example.usesOnlyPreInferenceInformation)).toBe(true);
  });

  it("keeps workspace validation blank until routing evidence, overrides, a signed policy, and reviewed labels exist", () => {
    const empty = classifierValidationReadiness({
      simulationEvidenceCount: 0,
      overrideCount: 0,
      signedPolicyCount: 0,
      reviewedLabelCount: 0,
    });
    expect(empty.ready).toBe(false);
    expect(empty.completedCount).toBe(0);
    expect(empty.prerequisites.every((item) => !item.complete)).toBe(true);

    const ready = classifierValidationReadiness({
      simulationEvidenceCount: 2,
      overrideCount: 2,
      signedPolicyCount: 1,
      reviewedLabelCount: 40,
    });
    expect(ready.ready).toBe(true);
    expect(ready.completedCount).toBe(4);
  });
});
