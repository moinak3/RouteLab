import type { DistinctTask, DistinctTaskBucket, Risk, TaskType } from "../types";

export type TaskGroupNamingFactors = Pick<DistinctTask, "task_type" | "domain" | "complexity" | "temporal_context" | "tool_use" | "output_format"> & {
  risk_level?: Risk;
  customer_facing?: boolean;
};

export type AutomaticTaskGroupNameInput = {
  id: string;
  name: string;
  factors: TaskGroupNamingFactors;
  preserve?: boolean;
};

const outcomeNames: Record<TaskType, string> = {
  summarization: "Ticket Summaries",
  extraction: "Data Extraction",
  classification_tagging: "Intent Tagging",
  question_answering: "Question Answering",
  rag_grounded_answers: "Knowledge Answers",
  customer_support_responses: "Support Responses",
  policy_compliance_reasoning: "Policy Review",
  code_generation: "Code Generation",
  code_review_debugging: "Code Debugging",
  sql_data_query_generation: "SQL Generation",
  data_analysis_insight_generation: "Data Analysis",
  writing_editing: "Writing Edits",
  sales_marketing_content: "Marketing Content",
  translation_localization: "Content Translation",
  document_review_legal_analysis: "Legal Review",
  planning_strategy_recommendations: "Strategic Planning",
  tool_use_function_calling: "Tool Requests",
  agentic_workflow_execution: "Workflow Execution",
  moderation_safety_review: "Safety Review",
  multimodal_document_image_understanding: "Document Understanding",
};

const normalized = (value: string) => value.trim().replace(/\s+/g, " ");
const key = (value: string) => normalized(value).toLocaleLowerCase();
const words = (value: string) => normalized(value).split(/\s+/).filter(Boolean);
const listStylePunctuation = /[,;:|/\\[\]{}]/;
const numericSuffix = /\s+\d+$/;

export function baseTaskGroupName(taskType: TaskType | string) {
  return outcomeNames[taskType as TaskType] ?? "General Requests";
}

export function isCompactTaskGroupName(name: string) {
  const compact = normalized(name);
  const count = words(compact).length;
  return count >= 2
    && count <= 6
    && compact.length <= 64
    && !numericSuffix.test(compact)
    && !listStylePunctuation.test(compact)
    && !compact.includes("_")
    && /^[-A-Za-z0-9&+.' ]+(?: \([-A-Za-z0-9&+.' ]+\))?$/.test(compact);
}

function factorLabels(factors: TaskGroupNamingFactors) {
  const domain = factors.domain === "customer_support"
    ? "support"
    : factors.domain === "unknown"
      ? "general"
      : factors.domain.replace(/_domain$/, "").replaceAll("_", "-");
  const temporal = factors.temporal_context === "single_turn"
    ? "single-turn"
    : factors.temporal_context === "early_multi_turn"
      ? "multi-turn"
      : "extended";
  const tool = factors.tool_use === "none"
    ? "no-tools"
    : factors.tool_use === "success"
      ? "tool-assisted"
      : factors.tool_use === "recovered_failure"
        ? "recovered-tool"
        : "failed-tool";
  const output = factors.output_format === "natural_language"
    ? "narrative"
    : factors.output_format.replaceAll("_", "-");
  return [...new Set([
    domain,
    temporal,
    tool,
    output,
    `${factors.complexity}-complexity`,
    factors.customer_facing === undefined ? "" : factors.customer_facing ? "customer-facing" : "internal",
    factors.risk_level ? `${factors.risk_level}-risk` : "",
  ].filter(Boolean))];
}

function qualifierCombinations(labels: string[]) {
  const combinations: string[] = [];
  for (let size = 1; size <= Math.min(3, labels.length); size += 1) {
    const visit = (start: number, selected: string[]) => {
      if (selected.length === size) {
        combinations.push(selected.join(" "));
        return;
      }
      for (let index = start; index < labels.length; index += 1) visit(index + 1, [...selected, labels[index]]);
    };
    visit(0, []);
  }
  return combinations;
}

function semanticOptions(input: { factors: TaskGroupNamingFactors }) {
  const base = baseTaskGroupName(input.factors.task_type);
  return qualifierCombinations(factorLabels(input.factors))
    .map((qualifier) => `${base} (${qualifier})`)
    .filter((candidate) => candidate.length <= 64);
}

export function resolveAutomaticTaskGroupNames(inputs: AutomaticTaskGroupNameInput[]) {
  const prepared = inputs.map((input) => ({
    ...input,
    candidate: input.preserve
      ? normalized(input.name)
      : isCompactTaskGroupName(normalized(input.name).replace(numericSuffix, ""))
        ? normalized(input.name).replace(numericSuffix, "")
        : baseTaskGroupName(input.factors.task_type),
  }));
  const candidateCounts = new Map<string, number>();
  prepared.forEach((input) => candidateCounts.set(key(input.candidate), (candidateCounts.get(key(input.candidate)) ?? 0) + 1));

  const used = new Set(prepared.filter((input) => input.preserve).map((input) => key(input.candidate)));
  return prepared.map((input) => {
    if (input.preserve) return { id: input.id, name: input.candidate };

    const collision = (candidateCounts.get(key(input.candidate)) ?? 0) > 1 || used.has(key(input.candidate));
    const semanticBase = baseTaskGroupName(input.factors.task_type);
    const cohort = prepared.filter((peer) => !peer.preserve && key(peer.candidate) === key(input.candidate));
    const distinguishingOptions = semanticOptions(input).filter((option) => cohort.filter((peer) => semanticOptions(peer).includes(option)).length === 1);
    const options = collision ? [...distinguishingOptions, ...semanticOptions(input)] : [input.candidate];
    let chosen = options.find((candidate) => candidate && !used.has(key(candidate))) ?? "";
    if (!chosen) {
      chosen = `${semanticBase} (${factorLabels(input.factors).join(" ")})`;
    }
    used.add(key(chosen));
    return { id: input.id, name: chosen };
  });
}

export function normalizeAutomaticTaskGroupNames(groups: DistinctTaskBucket[]) {
  const validGroups = groups.filter((group) => group?.task && typeof group.bucket_name === "string");
  const names = resolveAutomaticTaskGroupNames(validGroups.map((group) => ({
    id: group.bucket_id,
    name: group.bucket_name,
    factors: { ...group.task, risk_level: group.risk_level, customer_facing: group.customer_facing },
    preserve: group.name_source === "user",
  })));
  const byId = new Map(names.map((item) => [item.id, item.name]));
  return groups.map((group) => ({ ...group, bucket_name: byId.get(group.bucket_id) ?? group.bucket_name }));
}
