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
      { prompt: "As an AI customer support agent, summarize this escalated support thread: customer cannot export data, billing is current, engineering says the export job timed out.", response: pass("The customer cannot export data despite an active billing status; engineering traced the issue to an export job timeout.") },
      { prompt: "As an AI customer support agent, condense this customer call transcript into three bullets for the support handoff.", response: pass("Customer needs SSO by July, is worried about migration effort, and wants a pricing follow-up.") },
    ],
  },
  {
    key: "extraction",
    label: "Extraction",
    risk: "low",
    easyRate: .98,
    currentModels: ["claude-opus-4.8", "deepseek-v4-pro", "local-qwen-14b", "deepseek-r1"],
    examples: [
      { prompt: "As an AI customer support agent, extract invoice_id, due_date, total, and currency from the customer's billing attachment: Invoice INV-2048 is due 2026-07-01 for USD 418.25.", response: JSON.stringify({ invoice_id: "INV-2048", due_date: "2026-07-01", total: 418.25, currency: "USD" }) },
      { prompt: "As an AI customer support agent, pull name, company, and renewal date from this support note: Priya Shah at Northstar renews on March 14, 2027.", response: JSON.stringify({ name: "Priya Shah", company: "Northstar", renewal_date: "2027-03-14" }) },
    ],
  },
  {
    key: "classification_tagging",
    label: "Classification / tagging",
    risk: "low",
    easyRate: .96,
    currentModels: ["deepseek-v4-pro", "deepseek-r1", "claude-opus-4.8", "local-qwen-14b"],
    examples: [
      { prompt: "As an AI customer support agent, classify this ticket intent and priority: I was charged twice after upgrading yesterday.", response: pass("intent=billing_dispute; priority=high; sentiment=frustrated") },
      { prompt: "As an AI customer support agent, tag this support conversation: enterprise admin asks for security docs before enabling SSO.", response: pass("tags=enterprise,sso,security_review; priority=medium") },
    ],
  },
  {
    key: "question_answering",
    label: "Question answering",
    risk: "medium",
    easyRate: .86,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-v4-pro", "deepseek-r1"],
    examples: [
      { prompt: "As an AI customer support agent, answer the customer's question: what is the difference between API latency and throughput?", response: pass("Latency is time per request; throughput is how many requests the system handles per unit time.") },
      { prompt: "As an AI customer support agent, answer why a lower-priced plan can still have a higher monthly bill after usage spikes.", response: pass("The plan price can be lower, but higher usage, add-ons, or overage charges can increase the total monthly bill.") },
    ],
  },
  {
    key: "rag_grounded_answers",
    label: "RAG / grounded answers",
    risk: "high",
    easyRate: .72,
    currentModels: ["claude-opus-4.8", "claude-opus-4.8", "gpt-5.5-pro", "gpt-5.4"],
    examples: [
      { prompt: "As an AI customer support agent, using retrieved policy excerpt 'refunds are allowed within 30 days for annual plans', answer whether the customer qualifies and cite the excerpt.", response: pass("Yes. The customer qualifies if the annual plan purchase was within 30 days, per the refund policy excerpt.") },
      { prompt: "As an AI customer support agent, based on the retrieved SLA article, answer whether the customer's outage qualifies for a service credit.", response: pass("The outage qualifies if it exceeded the SLA downtime threshold and was not caused by excluded maintenance.") },
    ],
  },
  {
    key: "customer_support_responses",
    label: "Customer support responses",
    risk: "medium",
    easyRate: .9,
    currentModels: ["claude-opus-4.8", "deepseek-r1", "deepseek-v4-pro", "claude-opus-4.8"],
    examples: [
      { prompt: "As an AI customer support agent, draft a reply to a customer asking how to reset their password.", response: pass("You can reset your password from Account Settings > Security. I can also send a reset link if needed.") },
      { prompt: "As an AI customer support agent, respond to a customer disputing a subscription charge and explain the refund review process.", response: pass("I can help review the charge. Please share the billing email and charge date so we can check refund eligibility.") },
    ],
  },
  {
    key: "policy_compliance_reasoning",
    label: "Policy / compliance reasoning",
    risk: "high",
    easyRate: .52,
    currentModels: ["claude-opus-4.8", "gpt-5.5-pro", "claude-opus-4.8", "gpt-5.4"],
    examples: [
      { prompt: "As an AI customer support agent, check whether this customer reply complies with the refund policy and avoids promising approval before review.", response: pass("Compliant if it says the team will review eligibility; non-compliant if it guarantees a refund before verification.") },
      { prompt: "As an AI customer support agent, assess whether sharing this customer export in a ticket violates the internal data handling policy.", response: pass("It requires approval because the export contains personal data and would leave the approved workspace.") },
    ],
  },
  {
    key: "code_generation",
    label: "Code generation",
    risk: "medium",
    easyRate: .7,
    currentModels: ["claude-opus-4.8", "deepseek-v4-pro", "gpt-5.4", "claude-opus-4.8"],
    examples: [
      { prompt: "As an AI customer support agent, write a TypeScript helper that retries a failed support-ticket lookup three times with backoff.", response: "```ts\nexport async function retry<T>(fn:()=>Promise<T>, attempts=3){let last;for(let i=0;i<attempts;i++){try{return await fn()}catch(err){last=err;await new Promise(r=>setTimeout(r,100*(i+1)))}}throw last}\n```" },
      { prompt: "As an AI customer support agent, create a Jest test for a support billing helper that formats cents as dollars in customer replies.", response: "```ts\nexpect(formatDollars(1234)).toBe('$12.34');\nexpect(formatDollars(0)).toBe('$0.00');\n```" },
    ],
  },
  {
    key: "code_review_debugging",
    label: "Code review / debugging",
    risk: "medium",
    easyRate: .42,
    currentModels: ["claude-opus-4.8", "deepseek-v4-pro", "claude-opus-4.8", "gpt-5.4"],
    examples: [
      { prompt: "As an AI customer support agent, review this support automation diff: the refund API writes the credit before checking idempotency. Find the bug.", response: pass("The handler can create duplicate credits on retries. Check idempotency before writing and make the insert conditional.") },
      { prompt: "As an AI customer support agent, explain why this support dashboard React effect loops forever: it sets ticket state and depends on that state.", response: pass("The effect updates a dependency on every run, retriggering itself. Use a narrower dependency or functional update.") },
    ],
  },
  {
    key: "sql_data_query_generation",
    label: "SQL / data query generation",
    risk: "medium",
    easyRate: .72,
    currentModels: ["claude-opus-4.8", "deepseek-v4-pro", "deepseek-r1", "gpt-5.4"],
    examples: [
      { prompt: "As an AI customer support agent, write SQL to calculate weekly support tickets by issue category from tickets(category, created_at).", response: "SELECT date_trunc('week', created_at) AS week, category, count(*) AS ticket_count FROM tickets GROUP BY 1, 2 ORDER BY 1, 2;" },
      { prompt: "As an AI customer support agent, write a query for refund approval rate by support queue from tickets and refunds tables.", response: "SELECT t.queue, count(r.id)::float / count(t.id) AS refund_approval_rate FROM tickets t LEFT JOIN refunds r ON r.ticket_id=t.id AND r.status='approved' GROUP BY 1;" },
    ],
  },
  {
    key: "data_analysis_insight_generation",
    label: "Data analysis / insight generation",
    risk: "medium",
    easyRate: .66,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-v4-pro", "mistral-large-3"],
    examples: [
      { prompt: "As an AI customer support agent, analyze this support dashboard: password-reset tickets fell 8%, refund tickets rose 3%, and SLA breaches doubled.", response: pass("Password-reset volume improved, but refund volume and SLA breaches indicate billing friction or staffing issues may have regressed.") },
      { prompt: "As an AI customer support agent, interpret a help-center A/B test with 10.2% ticket deflection in control and 11.1% in variant over 40k visits.", response: pass("The variant shows a 0.9 point lift; verify statistical significance and check whether escalations increased before rollout.") },
    ],
  },
  {
    key: "writing_editing",
    label: "Writing / editing",
    risk: "low",
    easyRate: .88,
    currentModels: ["claude-opus-4.8", "deepseek-r1", "gpt-5.4", "local-qwen-14b"],
    examples: [
      { prompt: "As an AI customer support agent, rewrite this customer update to be clearer and shorter: We are experiencing some delay on account of a dependency.", response: pass("We are delayed because a dependency is not ready yet.") },
      { prompt: "As an AI customer support agent, edit this escalation note for a calmer customer-facing tone.", response: pass("The case remains active, and one dependency is under review.") },
    ],
  },
  {
    key: "sales_marketing_content",
    label: "Sales / marketing content",
    risk: "low",
    easyRate: .82,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-r1", "mistral-large-3"],
    examples: [
      { prompt: "As an AI customer support agent, write three proactive support email subject lines for customers who may exceed plan limits.", response: pass("1. Heads up: your usage is nearing its limit 2. Avoid overages with a quick plan check 3. Review your usage before the next billing cycle") },
      { prompt: "As an AI customer support agent, create short in-app help copy promoting the new self-serve refund status page.", response: pass("Track your refund review in one place, see the latest status, and find any next steps without opening a new ticket.") },
    ],
  },
  {
    key: "translation_localization",
    label: "Translation / localization",
    risk: "low",
    easyRate: .9,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-v4-pro", "local-qwen-14b"],
    examples: [
      { prompt: "As an AI customer support agent, translate to Spanish for a friendly support email: Your refund request is under review.", response: pass("Tu solicitud de reembolso está en revisión.") },
      { prompt: "As an AI customer support agent, localize this US support message for UK English: We are organizing your case history before escalating.", response: pass("We are organising your case history before escalating.") },
    ],
  },
  {
    key: "document_review_legal_analysis",
    label: "Document review / legal analysis",
    risk: "high",
    easyRate: .3,
    currentModels: ["claude-opus-4.8", "gpt-5.5-pro", "claude-opus-4.8", "gpt-5.4"],
    examples: [
      { prompt: "As an AI customer support agent, review this enterprise support agreement clause for unusual termination obligations before escalating to legal.", response: pass("The clause allows termination for convenience but requires 60 days notice and payment of committed fees.") },
      { prompt: "As an AI customer support agent, identify risk in this customer indemnity clause before summarizing it for the account team.", response: pass("Risk: indemnity is uncapped and covers third-party claims caused by customer modifications.") },
    ],
  },
  {
    key: "planning_strategy_recommendations",
    label: "Planning / strategy / recommendations",
    risk: "medium",
    easyRate: .68,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "mistral-large-3", "deepseek-v4-pro"],
    examples: [
      { prompt: "As an AI customer support agent, create a 30-day rollout plan for new refund macros across support traffic.", response: pass("Week 1 baseline quality review, week 2 low-risk shadow use, week 3 support pilot, week 4 monitored rollout with rollback thresholds.") },
      { prompt: "As an AI customer support agent, recommend next steps after a failed help-center deflection experiment.", response: pass("Segment failed searches, interview support agents, revise article structure, and rerun with a smaller targeted cohort.") },
    ],
  },
  {
    key: "tool_use_function_calling",
    label: "Tool use / function calling",
    risk: "medium",
    easyRate: .76,
    currentModels: ["claude-opus-4.8", "deepseek-v4-pro", "gpt-5.4", "deepseek-r1"],
    examples: [
      { prompt: "As an AI customer support agent, use the order API and shipping calculator to confirm whether order SO-781 can ship today.", response: JSON.stringify({ order_id: "SO-781", inventory_available: true, shipping_window: "today" }) },
      { prompt: "As an AI customer support agent, call the CRM lookup tool for account Acme and return support owner and ARR.", response: JSON.stringify({ account: "Acme", support_owner: "Jordan Lee", arr: 84000 }) },
    ],
  },
  {
    key: "agentic_workflow_execution",
    label: "Agentic workflow execution",
    risk: "medium",
    easyRate: .58,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-v4-pro", "mistral-large-3"],
    examples: [
      { prompt: "As an AI customer support agent, research the customer's outage history, draft an escalation brief, create follow-up tasks, and report status.", response: pass("Completed: reviewed outage history, drafted escalation themes, created follow-up tasks, and flagged SLA eligibility as unresolved.") },
      { prompt: "As an AI customer support agent, plan, execute, verify, and summarize a CRM cleanup for duplicate support contacts.", response: pass("Found duplicates, merged safe matches, left ambiguous records for review, and summarized the cleanup log.") },
    ],
  },
  {
    key: "moderation_safety_review",
    label: "Moderation / safety review",
    risk: "high",
    easyRate: .8,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-v4-pro", "claude-opus-4.8"],
    examples: [
      { prompt: "As an AI customer support agent, review this customer message for harassment and self-harm risk: 'You are worthless and should disappear.'", response: pass("harassment=true; self_harm_reference=false; action=block_or_warn") },
      { prompt: "As an AI customer support agent, moderate this customer upload for sensitive personal data exposure before attaching it to a ticket.", response: pass("Contains personal data. Redact email addresses and account numbers before sharing.") },
    ],
  },
  {
    key: "multimodal_document_image_understanding",
    label: "Multimodal document / image understanding",
    risk: "medium",
    easyRate: .64,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "gemini-3-pro", "mistral-large-3"],
    examples: [
      { prompt: "As an AI customer support agent, interpret this customer screenshot of a checkout error and identify the likely failed field.", response: pass("The card ZIP field is highlighted, so the likely failure is postal code validation.") },
      { prompt: "As an AI customer support agent, read this customer PDF invoice image and summarize vendor, total, and due date.", response: pass("Vendor: Northwind Services. Total: $1,284.50. Due date: 2026-07-15.") },
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
        domain: "customer_support",
        risk_level: group.risk,
        mock_slow_candidate: group.key === "customer_support_responses",
      },
    };
  }));
}
