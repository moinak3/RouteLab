import { describe, expect, it } from "vitest";
import { isOverviewInsight, overviewInsightTitle } from "../src/core/overviewInsights";

describe("Overview insights", () => {
  it("turns the source question into a concise title", () => {
    expect(overviewInsightTitle("what are my lowest performing task groups?")).toBe("What are my lowest performing task groups");
  });

  it("validates persisted insight envelopes", () => {
    expect(isOverviewInsight({
      id: "insight_1",
      question: "Which Task Groups are below average?",
      title: "Task Groups below average",
      description: "Three Task Groups need attention.",
      openui: "root = Dashboard([chart])\nchart = QualityComparison()",
      createdAt: "2026-11-09T00:00:00.000Z",
      updatedAt: "2026-11-09T00:00:00.000Z",
    })).toBe(true);
    expect(isOverviewInsight({ id: "missing-fields" })).toBe(false);
  });
});
