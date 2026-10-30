import { describe, expect, it } from "vitest";
import { reviewChoicesForVerdict } from "../src/core/reviewAdjudication";

describe("review adjudication choices", () => {
  it("lets a reviewer correct a passing judge verdict", () => {
    const choices = reviewChoicesForVerdict(true);
    expect(choices[0]).toEqual(["incorrect", "Mark response incorrect", "Add the corrected answer to the golden dataset"]);
    expect(choices[1]).toEqual(["correct", "Confirm pass", "The response is correct"]);
  });

  it("lets a reviewer overrule or confirm a failing judge verdict", () => {
    const choices = reviewChoicesForVerdict(false);
    expect(choices[0]).toEqual(["correct", "Overrule judge", "The response is actually correct"]);
    expect(choices[1]).toEqual(["incorrect", "Confirm failure", "Add the corrected answer to the golden dataset"]);
  });

  it("uses neutral choices when no judge verdict exists", () => {
    const choices = reviewChoicesForVerdict(undefined);
    expect(choices[0]).toEqual(["correct", "Mark satisfactory", "No issue found"]);
    expect(choices[1]).toEqual(["incorrect", "Mark incorrect", "Add the corrected answer to the golden dataset"]);
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
