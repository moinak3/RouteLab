import { describe, expect, it } from "vitest";
import { buildClassifierValidationReport, createDemoClassifierValidationExamples } from "../src/core/classifierValidation";
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
});
