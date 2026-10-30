import { JEV_RISK_THRESHOLDS } from "./jevSignatureGate";
import type { KnownTaskSignature } from "../types";

export type ClassifierValidationExample = {
  id: string;
  promptPreview: string;
  reviewedSignatureId: string;
  predictedSignatureId: string;
  confidence: number;
  accepted: boolean;
  usesOnlyPreInferenceInformation: boolean;
};

export type ClassifierValidationReport = {
  metadata: {
    datasetLabel: string;
    sampleSize: number;
    classifierModel: string;
    signatureCatalogVersion: string;
    testSplit: string;
    thresholdTuningSplit: string;
    thresholds: Record<"low" | "medium" | "high", number>;
  };
  acceptedPrecision: number;
  coverage: number;
  abstention: number;
  unknownFalseAcceptance: number;
  perSignature: Array<{
    signatureId: string;
    label: string;
    precision: number;
    recall: number;
    support: number;
    correctAcceptedCount: number;
    acceptedPredictionCount: number;
  }>;
  labels: string[];
  confusion: Record<string, Record<string, number>>;
  errors: ClassifierValidationExample[];
};

export type ClassifierValidationReadiness = {
  simulationEvidenceCount: number;
  overrideCount: number;
  signedPolicyCount: number;
  reviewedLabelCount: number;
};

export function classifierValidationReadiness(input: ClassifierValidationReadiness) {
  const prerequisites = [
    {
      id: "simulation",
      label: "Measure routing candidates",
      complete: input.simulationEvidenceCount > 0,
      detail: input.simulationEvidenceCount > 0
        ? `${input.simulationEvidenceCount} promoted simulation result${input.simulationEvidenceCount === 1 ? "" : "s"}`
        : "Run a routing simulation and promote at least one measured result.",
    },
    {
      id: "overrides",
      label: "Approve task overrides",
      complete: input.overrideCount > 0,
      detail: input.overrideCount > 0
        ? `${input.overrideCount} approved task override${input.overrideCount === 1 ? "" : "s"}`
        : "No task-specific model allocation has been approved.",
    },
    {
      id: "policy",
      label: "Sign a policy version",
      complete: input.signedPolicyCount > 0,
      detail: input.signedPolicyCount > 0
        ? `${input.signedPolicyCount} signed policy version${input.signedPolicyCount === 1 ? "" : "s"}`
        : "The draft routing policy has not been signed.",
    },
    {
      id: "labels",
      label: "Add independently reviewed labels",
      complete: input.reviewedLabelCount > 0,
      detail: input.reviewedLabelCount > 0
        ? `${input.reviewedLabelCount} reviewed classifier label${input.reviewedLabelCount === 1 ? "" : "s"}`
        : "Classifier accuracy requires a held-out set of human-reviewed task labels.",
    },
  ];
  return {
    prerequisites,
    ready: prerequisites.every((item) => item.complete),
    completedCount: prerequisites.filter((item) => item.complete).length,
  };
}

const divide = (numerator: number, denominator: number) => denominator ? numerator / denominator : 0;

export function buildClassifierValidationReport(
  examples: ClassifierValidationExample[],
  signatures: KnownTaskSignature[],
  metadata: Omit<ClassifierValidationReport["metadata"], "sampleSize" | "thresholds">,
): ClassifierValidationReport {
  const knownIds = signatures.map((signature) => signature.id);
  const labels = [...knownIds, "unknown", "abstain"];
  const confusion = Object.fromEntries(labels.map((actual) => [actual, Object.fromEntries(labels.map((predicted) => [predicted, 0]))]));
  examples.forEach((example) => {
    const actual = knownIds.includes(example.reviewedSignatureId) ? example.reviewedSignatureId : "unknown";
    const predicted = example.accepted ? (knownIds.includes(example.predictedSignatureId) ? example.predictedSignatureId : "unknown") : "abstain";
    confusion[actual][predicted] += 1;
  });
  const accepted = examples.filter((example) => example.accepted);
  const acceptedCorrect = accepted.filter((example) => example.predictedSignatureId === example.reviewedSignatureId).length;
  const unknown = examples.filter((example) => example.reviewedSignatureId === "unknown");
  const unknownFalseAccepts = unknown.filter((example) => example.accepted && example.predictedSignatureId !== "unknown").length;
  const perSignature = signatures.map((signature) => {
    const actual = examples.filter((example) => example.reviewedSignatureId === signature.id);
    const predicted = examples.filter((example) => example.accepted && example.predictedSignatureId === signature.id);
    const truePositive = predicted.filter((example) => example.reviewedSignatureId === signature.id).length;
    return {
      signatureId: signature.id,
      label: signature.label,
      precision: divide(truePositive, predicted.length),
      recall: divide(truePositive, actual.length),
      support: actual.length,
      correctAcceptedCount: truePositive,
      acceptedPredictionCount: predicted.length,
    };
  });
  return {
    metadata: { ...metadata, sampleSize: examples.length, thresholds: { ...JEV_RISK_THRESHOLDS } },
    acceptedPrecision: divide(acceptedCorrect, accepted.length),
    coverage: divide(accepted.length, examples.length),
    abstention: 1 - divide(accepted.length, examples.length),
    unknownFalseAcceptance: divide(unknownFalseAccepts, unknown.length),
    perSignature,
    labels,
    confusion,
    errors: examples.filter((example) => example.accepted
      ? example.predictedSignatureId !== example.reviewedSignatureId
      : example.reviewedSignatureId !== "unknown").slice(0, 12),
  };
}

export function createDemoClassifierValidationExamples(signatures: KnownTaskSignature[]): ClassifierValidationExample[] {
  const examples = signatures.flatMap((signature, index) => {
    const threshold = JEV_RISK_THRESHOLDS[signature.risk_level];
    const confusedWith = signatures[(index + 1) % signatures.length].id;
    const variants = [
      { confidence: Math.min(.99, threshold + .05), predicted: signature.id },
      { confidence: Math.min(.97, threshold + .02), predicted: index % 7 === 3 ? confusedWith : signature.id },
      { confidence: index % 6 === 2 ? threshold - .04 : Math.min(.96, threshold + .01), predicted: signature.id },
    ];
    return variants.map((variant, variantIndex) => ({
      id: `heldout_${index + 1}_${variantIndex + 1}`,
      promptPreview: `${signature.label} demo held-out example ${variantIndex + 1}`,
      reviewedSignatureId: signature.id,
      predictedSignatureId: variant.predicted,
      confidence: variant.confidence,
      accepted: variant.confidence >= threshold,
      usesOnlyPreInferenceInformation: true,
    }));
  });
  return [...examples, ...Array.from({ length: 8 }, (_, index) => ({
    id: `heldout_unknown_${index + 1}`,
    promptPreview: `Unfamiliar held-out workflow ${index + 1}`,
    reviewedSignatureId: "unknown",
    predictedSignatureId: index === 2 ? signatures[0]?.id ?? "unknown" : "unknown",
    confidence: index === 2 ? .91 : .72,
    accepted: index === 2,
    usesOnlyPreInferenceInformation: true,
  }))];
}
