import type { DistinctTask, DistinctTaskBucket, TaskType } from "../types";

type NamingFactors = Pick<DistinctTask, "task_type" | "domain" | "complexity" | "temporal_context" | "tool_use" | "output_format">;

export type AutomaticTaskGroupNameInput = {
  id: string;
  name: string;
  factors: NamingFactors;
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
  planning_strategy_recommendations: "Strategy Planning",
  tool_use_function_calling: "Tool Requests",
  agentic_workflow_execution: "Workflow Execution",
  moderation_safety_review: "Safety Review",
  multimodal_document_image_understanding: "Document Understanding",
};

const normalized = (value: string) => value.trim().replace(/\s+/g, " ");
const key = (value: string) => normalized(value).toLocaleLowerCase();
const words = (value: string) => normalized(value).split(/\s+/).filter(Boolean);
const listStylePunctuation = /[,;:|/\\()[\]{}]/;

const titleCase = (value: string) => value
  .split(/[\s_-]+/)
  .filter(Boolean)
  .map((part) => part.length <= 4 && part === part.toUpperCase()
    ? part
    : `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
  .join(" ");

export function baseTaskGroupName(taskType: TaskType | string) {
  return outcomeNames[taskType as TaskType] ?? "General Requests";
}

export function isCompactTaskGroupName(name: string) {
  const compact = normalized(name);
  const count = words(compact).length;
  return count >= 2 && count <= 4 && compact.length <= 48 && !listStylePunctuation.test(compact) && !compact.includes("_");
}

function qualifierCandidates(factors: NamingFactors) {
  const candidates: string[] = [];
  if (!["general", "customer_support", "unknown"].includes(factors.domain)) {
    candidates.push(titleCase(factors.domain.replace(/_domain$/, "")));
  }
  if (factors.temporal_context === "early_multi_turn") candidates.push("Multi-Turn");
  if (factors.temporal_context === "late_multi_turn") candidates.push("Extended");
  if (factors.tool_use === "recovered_failure") candidates.push("Recovered");
  if (factors.tool_use === "failed") candidates.push("Failed");
  if (["json", "sql", "xml"].includes(factors.output_format)) candidates.push(factors.output_format.toUpperCase());
  if (factors.complexity === "high") candidates.push("Complex");
  if (factors.complexity === "low") candidates.push("Simple");
  return [...new Set(candidates.filter(Boolean))];
}

function withQualifier(qualifier: string, base: string) {
  const candidate = normalized(`${qualifier} ${base}`);
  return words(candidate).length <= 4 ? candidate : "";
}

function semanticOptions(input: { factors: NamingFactors }) {
  const base = baseTaskGroupName(input.factors.task_type);
  return qualifierCandidates(input.factors).map((qualifier) => withQualifier(qualifier, base)).filter(Boolean);
}

export function resolveAutomaticTaskGroupNames(inputs: AutomaticTaskGroupNameInput[]) {
  const prepared = inputs.map((input) => ({
    ...input,
    candidate: input.preserve
      ? normalized(input.name)
      : isCompactTaskGroupName(input.name)
        ? normalized(input.name)
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
    const options = collision ? [...distinguishingOptions, semanticBase] : [input.candidate];
    let chosen = options.find((candidate) => candidate && !used.has(key(candidate))) ?? "";
    if (!chosen) {
      let suffix = 2;
      do chosen = `${semanticBase} ${suffix++}`; while (used.has(key(chosen)));
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
    factors: group.task,
    preserve: group.name_source === "user",
  })));
  const byId = new Map(names.map((item) => [item.id, item.name]));
  return groups.map((group) => ({ ...group, bucket_name: byId.get(group.bucket_id) ?? group.bucket_name }));
}
