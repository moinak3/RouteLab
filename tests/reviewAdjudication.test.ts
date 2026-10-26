import { describe, expect, it } from "vitest";
import { reviewChoicesForVerdict } from "../src/core/reviewAdjudication";

describe("review adjudication choices", () => {
  it("lets a reviewer correct a passing judge verdict", () => {
    const choices = reviewChoicesForVerdict(true);
    expect(choices[0]).toEqual(["reject", "Mark response incorrect", "Response is incorrect / partially incorrect"]);
    expect(choices[1]).toEqual(["approve", "Confirm pass", "Judge is right"]);
  });

  it("lets a reviewer overrule or confirm a failing judge verdict", () => {
    const choices = reviewChoicesForVerdict(false);
    expect(choices[0]).toEqual(["approve", "Overrule judge", "Response is actually fine"]);
    expect(choices[1]).toEqual(["reject", "Confirm failure", "Judge is right"]);
  });

  it("uses neutral choices when no judge verdict exists", () => {
    const choices = reviewChoicesForVerdict(undefined);
    expect(choices[0]).toEqual(["approve", "Mark satisfactory", "No issue found"]);
    expect(choices[1]).toEqual(["reject", "Confirm issue", "Response needs correction"]);
  });

  it("always preserves expert escalation and skip paths", () => {
    for (const verdict of [true, false, undefined]) {
      const choices = reviewChoicesForVerdict(verdict);
      expect(choices.slice(2)).toEqual([
        ["escalate", "Escalate to expert", "Needs domain review"],
        ["skip", "Skip", "Not enough context"],
      ]);
    }
  });
});
