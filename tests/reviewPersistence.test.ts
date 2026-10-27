import { describe, expect, it } from "vitest";
import {
  MAX_WEEKLY_REVIEW_BUDGET,
  MIN_WEEKLY_REVIEW_BUDGET,
  normalizedReviewBudget,
  reviewLaneFromSearch,
  reviewLaneHref,
  reviewsAsGoldenDataset,
  type PersistedReview,
} from "../src/core/reviewPersistence";

describe("review workflow persistence", () => {
  it("builds stable deep links for all three review lanes", () => {
    expect(reviewLaneHref("representative")).toBe("/quality/review-queue?lane=representative");
    expect(reviewLaneFromSearch("?lane=unusual")).toBe("unusual");
    expect(reviewLaneFromSearch("?lane=uncovered")).toBe("uncovered");
    expect(reviewLaneFromSearch("?lane=not-a-lane")).toBe("representative");
  });

  it("keeps weekly review budgets within the supported range", () => {
    expect(normalizedReviewBudget(0)).toBe(MIN_WEEKLY_REVIEW_BUDGET);
    expect(normalizedReviewBudget(42.4)).toBe(42);
    expect(normalizedReviewBudget(5_000)).toBe(MAX_WEEKLY_REVIEW_BUDGET);
  });

  it("materializes only human-labeled outcomes as a golden dataset", () => {
    const reviews: PersistedReview[] = [
      {
        traceId: "trace_wrong",
        lane: "unusual",
        decision: "incorrect",
        correctAnswer: "The corrected response.",
        rationale: "The original answer used the wrong policy.",
        reviewedAt: "2026-10-26T12:00:00.000Z",
        goldenRow: { trace_id: "trace_wrong", human_passed: false, human_answer: "The corrected response." },
      },
      {
        traceId: "trace_skipped",
        lane: "representative",
        decision: "skip",
        correctAnswer: null,
        rationale: null,
        reviewedAt: "2026-10-26T12:05:00.000Z",
        goldenRow: null,
      },
    ];
    const dataset = reviewsAsGoldenDataset(reviews);
    expect(dataset?.name).toBe("Human-reviewed conversations");
    expect(dataset?.row_count).toBe(1);
    expect(dataset?.rows[0]).toMatchObject({ trace_id: "trace_wrong", human_passed: false, human_answer: "The corrected response." });
  });
});
