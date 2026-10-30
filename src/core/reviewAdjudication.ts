export type ReviewAdjudicationDecision = "correct" | "incorrect" | "escalate" | "skip";
export type ReviewChoice = readonly [ReviewAdjudicationDecision, string, string];

const escalationChoices: ReviewChoice[] = [
  ["escalate", "Escalate to expert", "Needs domain review"],
  ["skip", "Skip", "Not enough context"],
];

export function reviewChoicesForVerdict(passed?: boolean): ReviewChoice[] {
  if (passed === true) {
    return [
      ["incorrect", "Mark response incorrect", "Add the corrected answer to the golden dataset"],
      ["correct", "Confirm pass", "The response is correct"],
      ...escalationChoices,
    ];
  }

  if (passed === false) {
    return [
      ["correct", "Overrule judge", "The response is actually correct"],
      ["incorrect", "Confirm failure", "Add the corrected answer to the golden dataset"],
      ...escalationChoices,
    ];
  }

  return [
    ["correct", "Mark satisfactory", "No issue found"],
    ["incorrect", "Mark incorrect", "Add the corrected answer to the golden dataset"],
    ...escalationChoices,
  ];
}
