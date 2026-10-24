const labels: Record<string, string> = {
  customer_support_responses_task: "Support reply",
  classification_tagging: "Classification and tagging",
  none_tool_use: "No tools",
  optional_tool_use: "Optional tools",
  required_tool_use: "Required tools",
  tool_grounded_grounding: "Tool-grounded",
  retrieved_context_grounding: "Retrieved context",
  no_external_grounding: "No external grounding",
  llm_as_judge: "LLM judge",
  deterministic_rule_check: "Rule check",
  schema_check: "Schema check",
  single_turn_session: "Single request",
  multi_turn_session: "Multi-turn session",
  low_complexity: "Low",
  medium_complexity: "Medium",
  high_complexity: "High",
  structured_output: "Structured output",
  natural_language_output: "Natural language",
  exact_match_output: "Exact match",
};

export function labelFor(value: string | undefined | null) {
  if (!value) return "Not specified";
  return labels[value] ?? value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
