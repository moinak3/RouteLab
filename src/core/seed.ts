import { calculateCost, getModel } from "./catalog";
import type { Risk, TaskType, Trace } from "../types";

export const SEED_TRACES_PER_GROUP = 625;
export const SEED_TRACE_COUNT = SEED_TRACES_PER_GROUP * 20;
const enterpriseTokenScale = 120;
const workflowRoles = ["planner", "retriever_summarizer", "tool_caller", "judge", "final_answer"] as const;

type SeedGroup = {
  key: TaskType;
  label: string;
  risk: Risk;
  easyRate: number;
  currentModels: string[];
  examples: Array<{ prompt: string; response: string }>;
};

const pass = (text: string) => `[PASS] ${text}`;
const groups: SeedGroup[] = [
  {
    key: "summarization",
    label: "Summarization",
    risk: "low",
    easyRate: .94,
    currentModels: ["claude-opus-4.8", "claude-opus-4.8", "deepseek-v4-pro", "deepseek-r1"],
    examples: [
      { prompt: "Summarize these meeting notes: launch moved to Friday, API bug fixed, onboarding email still blocked.", response: pass("Launch moved to Friday; the API blocker is fixed; onboarding email remains the only open issue.") },
      { prompt: "Condense this customer call transcript into three bullets for the account team.", response: pass("Customer needs SSO by July, is worried about migration effort, and wants a pricing follow-up.") },
    ],
  },
  {
    key: "extraction",
    label: "Extraction",
    risk: "low",
    easyRate: .98,
    currentModels: ["claude-opus-4.8", "deepseek-v4-pro", "local-qwen-14b", "deepseek-r1"],
    examples: [
      { prompt: "Extract invoice_id, due_date, total, and currency from: Invoice INV-2048 is due 2026-07-01 for USD 418.25.", response: JSON.stringify({ invoice_id: "INV-2048", due_date: "2026-07-01", total: 418.25, currency: "USD" }) },
      { prompt: "Pull name, company, and renewal date from: Priya Shah at Northstar renews on March 14, 2027.", response: JSON.stringify({ name: "Priya Shah", company: "Northstar", renewal_date: "2027-03-14" }) },
    ],
  },
  {
    key: "classification_tagging",
    label: "Classification / tagging",
    risk: "low",
    easyRate: .96,
    currentModels: ["deepseek-v4-pro", "deepseek-r1", "claude-opus-4.8", "local-qwen-14b"],
    examples: [
      { prompt: "Classify this ticket intent and priority: I was charged twice after upgrading yesterday.", response: pass("intent=billing_dispute; priority=high; sentiment=frustrated") },
      { prompt: "Tag this lead note: VP of Sales asked for enterprise security docs and pricing.", response: pass("tags=enterprise,security_review,pricing; stage=qualified") },
    ],
  },
  {
    key: "question_answering",
    label: "Question answering",
    risk: "medium",
    easyRate: .86,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-v4-pro", "deepseek-r1"],
    examples: [
      { prompt: "What is the difference between latency and throughput in an API?", response: pass("Latency is time per request; throughput is how many requests the system handles per unit time.") },
      { prompt: "Why might a model with lower token cost still be more expensive for a workflow?", response: pass("It may require retries, longer outputs, slower cascades, or more human review, raising total workflow cost.") },
    ],
  },
  {
    key: "rag_grounded_answers",
    label: "RAG / grounded answers",
    risk: "high",
    easyRate: .72,
    currentModels: ["claude-opus-4.8", "claude-opus-4.8", "gpt-5.5-pro", "gpt-5.4"],
    examples: [
      { prompt: "Using retrieved policy excerpt 'refunds are allowed within 30 days for annual plans', answer whether the customer qualifies and cite the excerpt.", response: pass("Yes. The customer qualifies if the annual plan purchase was within 30 days, per the refund policy excerpt.") },
      { prompt: "Based on the retrieved contract clause, what is the liability cap?", response: pass("The liability cap is fees paid in the prior 12 months, according to the retrieved contract clause.") },
    ],
  },
  {
    key: "customer_support_responses",
    label: "Customer support responses",
    risk: "medium",
    easyRate: .9,
    currentModels: ["claude-opus-4.8", "deepseek-r1", "deepseek-v4-pro", "claude-opus-4.8"],
    examples: [
      { prompt: "Draft a reply to a customer asking how to reset their password.", response: pass("You can reset your password from Account Settings > Security. I can also send a reset link if needed.") },
      { prompt: "Respond to a customer disputing a subscription charge and explain the refund review process.", response: pass("I can help review the charge. Please share the billing email and charge date so we can check refund eligibility.") },
    ],
  },
  {
    key: "policy_compliance_reasoning",
    label: "Policy / compliance reasoning",
    risk: "high",
    easyRate: .52,
    currentModels: ["claude-opus-4.8", "gpt-5.5-pro", "claude-opus-4.8", "gpt-5.4"],
    examples: [
      { prompt: "Check whether this outbound email complies with the policy requiring an unsubscribe link and no misleading subject lines.", response: pass("Non-compliant: it lacks an unsubscribe link. The subject line is acceptable.") },
      { prompt: "Assess whether sharing this customer export violates the internal data handling policy.", response: pass("It requires approval because the export contains personal data and would leave the approved workspace.") },
    ],
  },
  {
    key: "code_generation",
    label: "Code generation",
    risk: "medium",
    easyRate: .7,
    currentModels: ["claude-opus-4.8", "deepseek-v4-pro", "gpt-5.4", "claude-opus-4.8"],
    examples: [
      { prompt: "Write a TypeScript retry helper that retries an async function three times with backoff.", response: "```ts\nexport async function retry<T>(fn:()=>Promise<T>, attempts=3){let last;for(let i=0;i<attempts;i++){try{return await fn()}catch(err){last=err;await new Promise(r=>setTimeout(r,100*(i+1)))}}throw last}\n```" },
      { prompt: "Create a Jest test for a function that formats cents as dollars.", response: "```ts\nexpect(formatDollars(1234)).toBe('$12.34');\nexpect(formatDollars(0)).toBe('$0.00');\n```" },
    ],
  },
  {
    key: "code_review_debugging",
    label: "Code review / debugging",
    risk: "medium",
    easyRate: .42,
    currentModels: ["claude-opus-4.8", "deepseek-v4-pro", "claude-opus-4.8", "gpt-5.4"],
    examples: [
      { prompt: "Review this diff: the API writes the order before checking idempotency. Find the bug.", response: pass("The handler can create duplicate orders on retries. Check idempotency before writing and make the insert conditional.") },
      { prompt: "Explain why this React effect loops forever: it sets state and depends on that state.", response: pass("The effect updates a dependency on every run, retriggering itself. Use a narrower dependency or functional update.") },
    ],
  },
  {
    key: "sql_data_query_generation",
    label: "SQL / data query generation",
    risk: "medium",
    easyRate: .72,
    currentModels: ["claude-opus-4.8", "deepseek-v4-pro", "deepseek-r1", "gpt-5.4"],
    examples: [
      { prompt: "Write SQL to calculate weekly active users from events(user_id, created_at).", response: "SELECT date_trunc('week', created_at) AS week, count(DISTINCT user_id) AS wau FROM events GROUP BY 1 ORDER BY 1;" },
      { prompt: "Write a query for conversion rate by campaign from sessions and signups tables.", response: "SELECT s.campaign, count(DISTINCT u.user_id)::float / count(DISTINCT s.session_id) AS conversion_rate FROM sessions s LEFT JOIN signups u ON u.session_id=s.session_id GROUP BY 1;" },
    ],
  },
  {
    key: "data_analysis_insight_generation",
    label: "Data analysis / insight generation",
    risk: "medium",
    easyRate: .66,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-v4-pro", "mistral-large-3"],
    examples: [
      { prompt: "Analyze this dashboard: activation rose 8%, retention fell 3%, support tickets doubled.", response: pass("Activation improved, but retention and support load indicate onboarding quality or product reliability may have regressed.") },
      { prompt: "Interpret an A/B test with 10.2% conversion in control and 11.1% in variant over 40k visits.", response: pass("The variant shows a 0.9 point lift; verify statistical significance and segment effects before rollout.") },
    ],
  },
  {
    key: "writing_editing",
    label: "Writing / editing",
    risk: "low",
    easyRate: .88,
    currentModels: ["claude-opus-4.8", "deepseek-r1", "gpt-5.4", "local-qwen-14b"],
    examples: [
      { prompt: "Rewrite this update to be clearer and shorter: We are experiencing some delay on account of a dependency.", response: pass("We are delayed because a dependency is not ready yet.") },
      { prompt: "Edit this paragraph for a calmer executive tone.", response: pass("The launch remains on track, with one dependency under active review.") },
    ],
  },
  {
    key: "sales_marketing_content",
    label: "Sales / marketing content",
    risk: "low",
    easyRate: .82,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-r1", "mistral-large-3"],
    examples: [
      { prompt: "Write three outbound email subject lines for a CFO audience about reducing LLM spend.", response: pass("1. Cut LLM spend without slowing teams 2. Find hidden AI routing waste 3. Lower model costs with eval-backed routing") },
      { prompt: "Create landing page copy for a routing observability product.", response: pass("See where every model dollar goes, simulate safer routing changes, and ship policies backed by evals.") },
    ],
  },
  {
    key: "translation_localization",
    label: "Translation / localization",
    risk: "low",
    easyRate: .9,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-v4-pro", "local-qwen-14b"],
    examples: [
      { prompt: "Translate to Spanish for a friendly support email: Your refund request is under review.", response: pass("Tu solicitud de reembolso está en revisión.") },
      { prompt: "Localize this US marketing headline for UK English: Organize your work in one place.", response: pass("Organise your work in one place.") },
    ],
  },
  {
    key: "document_review_legal_analysis",
    label: "Document review / legal analysis",
    risk: "high",
    easyRate: .3,
    currentModels: ["claude-opus-4.8", "gpt-5.5-pro", "claude-opus-4.8", "gpt-5.4"],
    examples: [
      { prompt: "Review this contract clause for unusual termination obligations.", response: pass("The clause allows termination for convenience but requires 60 days notice and payment of committed fees.") },
      { prompt: "Identify risk in this indemnity clause for a vendor agreement.", response: pass("Risk: indemnity is uncapped and covers third-party claims caused by customer modifications.") },
    ],
  },
  {
    key: "planning_strategy_recommendations",
    label: "Planning / strategy / recommendations",
    risk: "medium",
    easyRate: .68,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "mistral-large-3", "deepseek-v4-pro"],
    examples: [
      { prompt: "Create a 30-day rollout plan for model routing changes across support traffic.", response: pass("Week 1 baseline evals, week 2 low-risk shadow routing, week 3 support pilot, week 4 monitored rollout with rollback thresholds.") },
      { prompt: "Recommend next steps after a failed pricing experiment.", response: pass("Segment results, interview lost deals, test packaging before discounting, and rerun with a smaller targeted cohort.") },
    ],
  },
  {
    key: "tool_use_function_calling",
    label: "Tool use / function calling",
    risk: "medium",
    easyRate: .76,
    currentModels: ["claude-opus-4.8", "deepseek-v4-pro", "gpt-5.4", "deepseek-r1"],
    examples: [
      { prompt: "Use the inventory API and shipping calculator to confirm whether order SO-781 can ship today.", response: JSON.stringify({ order_id: "SO-781", inventory_available: true, shipping_window: "today" }) },
      { prompt: "Call the CRM lookup tool for account Acme and return renewal owner and ARR.", response: JSON.stringify({ account: "Acme", renewal_owner: "Jordan Lee", arr: 84000 }) },
    ],
  },
  {
    key: "agentic_workflow_execution",
    label: "Agentic workflow execution",
    risk: "medium",
    easyRate: .58,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-v4-pro", "mistral-large-3"],
    examples: [
      { prompt: "Research competitors, draft a positioning brief, create follow-up tasks, and report status.", response: pass("Completed: gathered three competitor notes, drafted positioning themes, created launch tasks, and flagged pricing as unresolved.") },
      { prompt: "Plan, execute, verify, and summarize a CRM cleanup for duplicate leads.", response: pass("Found duplicates, merged safe matches, left ambiguous records for review, and summarized the cleanup log.") },
    ],
  },
  {
    key: "moderation_safety_review",
    label: "Moderation / safety review",
    risk: "high",
    easyRate: .8,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-v4-pro", "claude-opus-4.8"],
    examples: [
      { prompt: "Review this user message for harassment and self-harm risk: 'You are worthless and should disappear.'", response: pass("harassment=true; self_harm_reference=false; action=block_or_warn") },
      { prompt: "Moderate this upload for sensitive personal data exposure.", response: pass("Contains personal data. Redact email addresses and account numbers before sharing.") },
    ],
  },
  {
    key: "multimodal_document_image_understanding",
    label: "Multimodal document / image understanding",
    risk: "medium",
    easyRate: .64,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "gemini-3-pro", "mistral-large-3"],
    examples: [
      { prompt: "Interpret this screenshot of a checkout error and identify the likely failed field.", response: pass("The card ZIP field is highlighted, so the likely failure is postal code validation.") },
      { prompt: "Read this PDF invoice image and summarize vendor, total, and due date.", response: pass("Vendor: Northwind Services. Total: $1,284.50. Due date: 2026-07-15.") },
    ],
  },
];

export function createSeedTraces(): Trace[] {
  return groups.flatMap((group, groupIndex) => Array.from({ length: SEED_TRACES_PER_GROUP }, (_, index) => {
    const example = group.examples[index % group.examples.length];
    const id = `trace_${group.key}_${String(index + 1).padStart(4, "0")}`;
    const prompt = `${example.prompt} Sample ${index + 1}`;
    const expected = example.response;
    const volumeIndex = index % 108;
    const input = (180 + groupIndex * 26 + volumeIndex * 11) * enterpriseTokenScale;
    const output = (45 + groupIndex * 7 + volumeIndex * 3) * enterpriseTokenScale;
    const modelId = group.currentModels[index % group.currentModels.length];
    const model = getModel(modelId)!;
    const earlierMonthCount = Math.floor(SEED_TRACES_PER_GROUP / 2) + (groupIndex % 2);
    const latestMonthCount = SEED_TRACES_PER_GROUP - earlierMonthCount;
    const monthIndex = index < earlierMonthCount
      ? Math.floor(index / earlierMonthCount * 4)
      : 4 + Math.floor((index - earlierMonthCount) / latestMonthCount * 2);
    const monthStart = Date.UTC(2026, monthIndex, 1);
    const daysInMonth = new Date(Date.UTC(2026, monthIndex + 1, 0)).getUTCDate();
    const day = index % daysInMonth;
    const timestamp = new Date(monthStart + day * 86_400_000 + (8 + groupIndex % 10) * 3_600_000).toISOString();
    const failed = index === SEED_TRACES_PER_GROUP - 1 && groupIndex === groups.length - 1;
    const workflowId = `workflow_${String(index + 1).padStart(4, "0")}`;
    const role = workflowRoles[groupIndex % workflowRoles.length];
    const nodeId = `${workflowId}_${String(groupIndex + 1).padStart(2, "0")}_${role}`;
    const parentRole = groupIndex ? workflowRoles[(groupIndex - 1) % workflowRoles.length] : undefined;
    return {
      id, timestamp,
      provider: model.provider, model: modelId, messages: [{ role: "user", content: prompt }],
      prompt_text: prompt, response_text: expected, input_tokens: input, output_tokens: output,
      total_tokens: input + output, latency_ms: model.default_latency_ms + volumeIndex * 35,
      cost_usd: calculateCost(input, output, model), status: failed ? "error" : "success",
      workflow_id: workflowId, node_id: nodeId,
      parent_node_id: groupIndex && parentRole ? `${workflowId}_${String(groupIndex).padStart(2, "0")}_${parentRole}` : undefined,
      workflow_role: role, span_name: `${group.label} ${role}`,
      error_type: failed ? "timeout" : undefined,
      metadata: {
        expected_answer: expected,
        mock_difficulty: index / SEED_TRACES_PER_GROUP < group.easyRate ? "easy" : "hard",
        task_type: group.key,
        risk_level: group.risk,
        mock_slow_candidate: group.key === "customer_support_responses",
      },
    };
  }));
}
