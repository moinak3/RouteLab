export type ReviewAdjudicationDecision = "approve" | "reject" | "escalate" | "skip";
export type ReviewChoice = readonly [ReviewAdjudicationDecision, string, string];

const escalationChoices: ReviewChoice[] = [
  ["escalate", "Escalate to expert", "Needs domain review"],
  ["skip", "Skip", "Not enough context"],
];

export function reviewChoicesForVerdict(passed?: boolean): ReviewChoice[] {
  if (passed === true) {
    return [
      ["reject", "Mark response incorrect", "Response is incorrect / partially incorrect"],
      ["approve", "Confirm pass", "Judge is right"],
      ...escalationChoices,
    ];
  }

  if (passed === false) {
    return [
      ["approve", "Overrule judge", "Response is actually fine"],
      ["reject", "Confirm failure", "Judge is right"],
      ...escalationChoices,
    ];
  }

  return [
    ["approve", "Mark satisfactory", "No issue found"],
    ["reject", "Confirm issue", "Response needs correction"],
    ...escalationChoices,
  ];
}
