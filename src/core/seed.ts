import { calculateCost, getModel } from "./catalog";
import type { Risk, Trace } from "../types";

export const SEED_TRACES_PER_GROUP = 2500;
export const SEED_TRACE_COUNT = SEED_TRACES_PER_GROUP * 5;
const enterpriseTokenScale = 120;
const workflowRoles = ["planner", "retriever_summarizer", "tool_caller", "judge", "final_answer"] as const;
const groups: Array<{ key: string; label: string; risk: Risk; prompts: string[]; easyRate: number; currentModels: string[] }> = [
  { key: "json_extraction", label: "JSON extraction", risk: "low", easyRate: 1, currentModels: ["claude-opus-4.8", "claude-opus-4.8", "deepseek-v4-pro", "deepseek-r1", "claude-opus-4.8", "deepseek-v4-pro", "claude-opus-4.8", "local-qwen-14b"], prompts: ["Extract invoice number and total as JSON", "Convert customer record to JSON", "Parse order id and amount into JSON", "Extract contact fields into JSON"] },
  { key: "support_faq", label: "Support FAQ", risk: "low", easyRate: .94, currentModels: ["claude-opus-4.8", "claude-opus-4.8", "deepseek-r1", "deepseek-v4-pro", "claude-opus-4.8", "deepseek-v4-pro", "claude-opus-4.8", "deepseek-r1"], prompts: ["Answer support FAQ about password reset", "Explain how to update billing details", "Answer support FAQ about account access", "Explain how to cancel a subscription"] },
  { key: "internal_summarization", label: "Internal summarization", risk: "low", easyRate: .92, currentModels: ["claude-opus-4.8", "claude-opus-4.8", "deepseek-v4-pro", "deepseek-r1", "claude-opus-4.8", "deepseek-r1", "claude-opus-4.8", "claude-opus-4.8"], prompts: ["Summarize internal project update", "Summarize meeting notes for the team", "Create a short summary of release notes", "Summarize internal research memo"] },
  { key: "legal_compliance", label: "Legal & compliance", risk: "high", easyRate: 0, currentModels: ["claude-opus-4.8", "claude-opus-4.8", "claude-opus-4.8", "gpt-5.5-pro"], prompts: ["Review legal contract compliance terms", "Analyze privacy policy for compliance risk", "Assess tax and finance disclosure language", "Review HR termination policy"] },
  { key: "code_review", label: "Code review", risk: "medium", easyRate: .38, currentModels: ["claude-opus-4.8", "claude-opus-4.8", "deepseek-v4-pro", "deepseek-r1", "claude-opus-4.8", "deepseek-v4-pro", "claude-opus-4.8", "claude-opus-4.8"], prompts: ["Review TypeScript code for correctness", "Find security bugs in API handler", "Analyze database migration code", "Review retry logic and recommend changes"] },
];

export function createSeedTraces(): Trace[] {
  return groups.flatMap((group, groupIndex) => Array.from({ length: SEED_TRACES_PER_GROUP }, (_, index) => {
    const id = `trace_${group.key}_${String(index + 1).padStart(4, "0")}`;
    const prompt = `${group.prompts[index % group.prompts.length]}: sample ${index + 1}`;
    const expected = group.key === "json_extraction"
      ? JSON.stringify({ id: `INV-${100 + index}`, total: 42 + index })
      : `[PASS] ${group.label} answer ${index + 1}`;
    const volumeIndex = index % 108;
    const input = (180 + groupIndex * 80 + volumeIndex * 11) * enterpriseTokenScale;
    const output = (45 + groupIndex * 22 + volumeIndex * 3) * enterpriseTokenScale;
    const modelId = group.currentModels[index % group.currentModels.length];
    const model = getModel(modelId)!;
    const monthIndex = index < SEED_TRACES_PER_GROUP / 2
      ? Math.floor(index / (SEED_TRACES_PER_GROUP / 2) * 4)
      : 4 + Math.floor((index - SEED_TRACES_PER_GROUP / 2) / (SEED_TRACES_PER_GROUP / 2) * 2);
    const monthStart = Date.UTC(2026, monthIndex, 1);
    const daysInMonth = new Date(Date.UTC(2026, monthIndex + 1, 0)).getUTCDate();
    const day = index % daysInMonth;
    const timestamp = new Date(monthStart + day * 86_400_000 + (9 + groupIndex) * 3_600_000).toISOString();
    const failed = index === SEED_TRACES_PER_GROUP - 1 && groupIndex === 4;
    const workflowId = `workflow_${String(index + 1).padStart(4, "0")}`;
    const nodeId = `${workflowId}_${workflowRoles[groupIndex]}`;
    return {
      id, timestamp,
      provider: model.provider, model: modelId, messages: [{ role: "user", content: prompt }],
      prompt_text: prompt, response_text: expected, input_tokens: input, output_tokens: output,
      total_tokens: input + output, latency_ms: model.default_latency_ms + volumeIndex * 35,
      cost_usd: calculateCost(input, output, model), status: failed ? "error" : "success",
      workflow_id: workflowId, node_id: nodeId,
      parent_node_id: groupIndex ? `${workflowId}_${workflowRoles[groupIndex - 1]}` : undefined,
      workflow_role: workflowRoles[groupIndex], span_name: `${group.label} ${workflowRoles[groupIndex]}`,
      error_type: failed ? "timeout" : undefined,
      metadata: { expected_answer: expected, mock_difficulty: index / SEED_TRACES_PER_GROUP < group.easyRate ? "easy" : "hard", task_type: group.key, risk_level: group.risk, mock_slow_candidate: group.key === "support_faq" },
    };
  }));
}
