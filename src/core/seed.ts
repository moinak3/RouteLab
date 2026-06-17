import { calculateCost, getModel } from "./catalog";
import type { Complexity, Risk, TaskType, Trace, TraceSpan, WorkflowRole } from "../types";

export const SEED_TRACES_PER_GROUP = 12;
export const SEED_TASK_GROUP_COUNT = 16;
export const SEED_TRACE_COUNT = SEED_TRACES_PER_GROUP * SEED_TASK_GROUP_COUNT;

const workflowRoles: WorkflowRole[] = ["planner", "retriever_summarizer", "judge", "final_answer"];

type SeedExample = {
  prompt: string;
  response: string;
  spans?: TraceSpan[];
};

type SeedGroup = {
  key: TaskType;
  label: string;
  risk: Risk;
  complexity: Complexity;
  easyRate: number;
  currentModels: string[];
  examples: SeedExample[];
};

const json = (value: unknown) => JSON.stringify(value);
const supportPrefix = "As an AI customer support agent,";

const groups: SeedGroup[] = [
  {
    key: "summarization",
    label: "Support thread summarization",
    risk: "low",
    complexity: "low",
    easyRate: .92,
    currentModels: ["deepseek-r1", "deepseek-v4-pro", "claude-opus-4.8"],
    examples: [
      { prompt: `${supportPrefix} summarize this ticket for handoff: the customer cannot export audit logs, billing is current, and the export job timed out twice.`, response: "The customer cannot export audit logs despite an active account; two export attempts timed out and need engineering review." },
      { prompt: `${supportPrefix} summarize this chat transcript for the next agent: the admin lost access after SSO enforcement and needs recovery today.`, response: "An admin lost access after SSO enforcement and needs same-day account recovery support." },
      { prompt: `${supportPrefix} condense this escalation note: renewal is tomorrow, the customer needs SLA credit review, and support needs the outage timeline.`, response: "The renewal is tomorrow; support needs the outage timeline to assess SLA credit eligibility." },
    ],
  },
  {
    key: "extraction",
    label: "Billing and account field extraction",
    risk: "low",
    complexity: "low",
    easyRate: .96,
    currentModels: ["local-qwen-14b", "deepseek-r1", "deepseek-v4-pro"],
    examples: [
      { prompt: `${supportPrefix} extract invoice_id, due_date, total, and currency from this billing message: Invoice INV-2048 is due 2026-07-01 for USD 418.25.`, response: json({ invoice_id: "INV-2048", due_date: "2026-07-01", total: 418.25, currency: "USD" }) },
      { prompt: `${supportPrefix} extract customer_name, company, and renewal_date from this note: Priya Shah at Northstar renews on 2027-03-14.`, response: json({ customer_name: "Priya Shah", company: "Northstar", renewal_date: "2027-03-14" }) },
      { prompt: `${supportPrefix} extract order_id, shipping_region, and priority from this case: Order SO-781 for EMEA is blocked and marked urgent.`, response: json({ order_id: "SO-781", shipping_region: "EMEA", priority: "urgent" }) },
    ],
  },
  {
    key: "classification_tagging",
    label: "Ticket classification and priority tagging",
    risk: "low",
    complexity: "low",
    easyRate: .94,
    currentModels: ["deepseek-r1", "deepseek-v4-pro", "local-qwen-14b"],
    examples: [
      { prompt: `${supportPrefix} classify intent, priority, and sentiment for this ticket: I was charged twice after upgrading yesterday.`, response: "intent=billing_dispute; priority=high; sentiment=frustrated" },
      { prompt: `${supportPrefix} tag this ticket: enterprise admin asks for SSO security documents before rollout.`, response: "intent=security_review; priority=medium; tags=sso,security" },
      { prompt: `${supportPrefix} label this message: customer asks where to find the refund status page.`, response: "intent=refund_status; priority=low; sentiment=neutral" },
    ],
  },
  {
    key: "question_answering",
    label: "General support question answering",
    risk: "medium",
    complexity: "medium",
    easyRate: 1,
    currentModels: ["deepseek-v4-pro", "claude-opus-4.8", "gpt-5.4"],
    examples: [
      { prompt: `${supportPrefix} answer the question: what is the difference between API latency and throughput for a customer troubleshooting slow requests?`, response: "Latency is the time one request takes to complete. Throughput is the number of requests the system handles in a period." },
      { prompt: `${supportPrefix} answer why a customer can have a higher bill after moving to a lower base plan.`, response: "A lower base plan can still cost more when usage, add-ons, or overage charges increase." },
      { prompt: `${supportPrefix} answer what an admin should check first when users stop receiving invitation emails.`, response: "Check the email allowlist, spam filtering, and whether invitations were sent to the correct domain." },
    ],
  },
  {
    key: "rag_grounded_answers",
    label: "Grounded support answers with citations",
    risk: "high",
    complexity: "high",
    easyRate: .68,
    currentModels: ["claude-opus-4.8", "gpt-5.5-pro", "gpt-5.4"],
    examples: [
      { prompt: `${supportPrefix} using retrieved context, answer whether the customer qualifies for a refund and cite sources. Context [1]: Annual plan refunds are allowed within 30 days.`, response: "Yes. The customer qualifies when the annual plan purchase is within 30 days [1].", spans: [{ id: "retrieved_refund_policy", type: "retriever", name: "refund_policy", metadata: { chunks: 3 } }] },
      { prompt: `${supportPrefix} using retrieved context, answer whether the outage qualifies for service credit and cite sources. Context [1]: Credits require 45 continuous minutes of unplanned downtime.`, response: "The outage qualifies when it reached 45 continuous minutes of unplanned downtime [1].", spans: [{ id: "retrieved_sla_policy", type: "retriever", name: "sla_policy", metadata: { chunks: 2 } }] },
      { prompt: `${supportPrefix} using retrieved context, answer whether SSO enforcement can be delayed and cite sources. Context [1]: Enterprise admins can defer enforcement once for 14 days.`, response: "The admin can defer SSO enforcement once for 14 days [1].", spans: [{ id: "retrieved_sso_policy", type: "retriever", name: "sso_policy", metadata: { chunks: 2 } }] },
    ],
  },
  {
    key: "customer_support_responses",
    label: "Customer-facing support replies",
    risk: "medium",
    complexity: "medium",
    easyRate: 1,
    currentModels: ["deepseek-r1", "claude-opus-4.8", "deepseek-v4-pro"],
    examples: [
      { prompt: `${supportPrefix} according to support policy, draft a customer-facing reply explaining that a refund request is under review and no approval is promised yet.`, response: "Thanks for reaching out. Your refund request is under review, and we will update you after eligibility is checked." },
      { prompt: `${supportPrefix} according to support policy, draft a customer-facing reply for an admin locked out after SSO enforcement.`, response: "I can help restore access. Please confirm the admin email and account domain so we can start the recovery review." },
      { prompt: `${supportPrefix} according to support policy, write a reply explaining that export delays are being escalated without promising an exact fix time.`, response: "We have escalated the export delay to our team and will share updates as soon as we have confirmed next steps." },
    ],
  },
  {
    key: "policy_compliance_reasoning",
    label: "Support policy compliance checks",
    risk: "high",
    complexity: "high",
    easyRate: .54,
    currentModels: ["claude-opus-4.8", "gpt-5.5-pro", "gpt-5.4"],
    examples: [
      { prompt: `${supportPrefix} according to policy, check whether this draft complies with refund policy: We guarantee your refund today before verifying the charge.`, response: "Non-compliant. The reply promises approval before verifying refund eligibility." },
      { prompt: `${supportPrefix} according to policy, check whether sharing a customer CSV export in a public ticket complies with data handling policy.`, response: "Non-compliant. Customer exports must stay in approved support systems and personal data must be protected." },
      { prompt: `${supportPrefix} according to policy, check whether this password reset reply follows account access policy: Tell me the old password and I will reset it.`, response: "Non-compliant. Support must not ask customers to disclose passwords." },
    ],
  },
  {
    key: "code_generation",
    label: "Support automation code generation",
    risk: "medium",
    complexity: "medium",
    easyRate: 1,
    currentModels: ["deepseek-v4-pro", "claude-opus-4.8", "gpt-5.4"],
    examples: [
      { prompt: `${supportPrefix} write code for a TypeScript helper that retries a failed support ticket lookup three times with backoff.`, response: "```ts\nexport async function retryTicketLookup<T>(fn:()=>Promise<T>, attempts=3){let last:unknown;for(let i=0;i<attempts;i++){try{return await fn()}catch(error){last=error;await new Promise(resolve=>setTimeout(resolve,100*(i+1)))}}throw last}\n```" },
      { prompt: `${supportPrefix} generate code for a small JavaScript function that masks account IDs in support notes.`, response: "```js\nexport function maskAccountId(value){return value.replace(/acct_[A-Za-z0-9]+/g,'acct_****')}\n```" },
      { prompt: `${supportPrefix} write code for a Jest test that verifies cents are formatted as dollars in billing replies.`, response: "```ts\nexpect(formatDollars(1234)).toBe('$12.34');\nexpect(formatDollars(0)).toBe('$0.00');\n```" },
    ],
  },
  {
    key: "code_review_debugging",
    label: "Support automation debugging",
    risk: "medium",
    complexity: "medium",
    easyRate: 1,
    currentModels: ["claude-opus-4.8", "deepseek-v4-pro", "gpt-5.4"],
    examples: [
      { prompt: `${supportPrefix} debug this support automation diff: the refund API writes a credit before checking idempotency.`, response: "The bug can create duplicate credits on retry. Check idempotency before writing the credit." },
      { prompt: `${supportPrefix} review this ticket routing diff: urgent billing tickets are matched after the generic billing rule.`, response: "The generic billing rule captures urgent billing tickets first. Move urgent billing above the generic rule." },
      { prompt: `${supportPrefix} explain why this support dashboard effect loops forever: it sets ticket state and depends on that state.`, response: "The effect updates a dependency every run. Use a narrower dependency or a functional update." },
    ],
  },
  {
    key: "sql_data_query_generation",
    label: "Support SQL query generation",
    risk: "medium",
    complexity: "medium",
    easyRate: 1,
    currentModels: ["deepseek-v4-pro", "deepseek-r1", "claude-opus-4.8"],
    examples: [
      { prompt: `${supportPrefix} write SQL to calculate weekly support tickets by issue category from tickets(category, created_at).`, response: "SELECT date_trunc('week', created_at) AS week, category, count(*) AS ticket_count FROM tickets GROUP BY 1, 2 ORDER BY 1, 2;" },
      { prompt: `${supportPrefix} write SQL for refund approval rate by support queue from tickets and refunds tables.`, response: "SELECT t.queue, count(r.id)::float / count(t.id) AS refund_approval_rate FROM tickets t LEFT JOIN refunds r ON r.ticket_id=t.id AND r.status='approved' GROUP BY 1;" },
      { prompt: `${supportPrefix} generate SQL to find accounts with more than three reopenings in the last 30 days.`, response: "SELECT account_id, count(*) AS reopen_count FROM tickets WHERE reopened_at >= current_date - interval '30 days' GROUP BY account_id HAVING count(*) > 3;" },
    ],
  },
  {
    key: "data_analysis_insight_generation",
    label: "Support analytics insight generation",
    risk: "medium",
    complexity: "medium",
    easyRate: 1,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "mistral-large-3"],
    examples: [
      { prompt: `${supportPrefix} analyze dashboard metrics: password reset tickets fell 8%, refund tickets rose 3%, and SLA breaches doubled.`, response: "Password reset volume improved, while refund volume and SLA breaches indicate billing friction or staffing risk." },
      { prompt: `${supportPrefix} analyze an experiment where help-center deflection rose from 10.2% to 11.1% over 40k visits.`, response: "The variant shows a 0.9 point lift; confirm statistical significance and check escalation quality before rollout." },
      { prompt: `${supportPrefix} interpret a support trend: first response time improved, but reopen rate increased for billing tickets.`, response: "Faster first responses are not fully resolving billing cases. Review answer quality and refund workflow clarity." },
    ],
  },
  {
    key: "writing_editing",
    label: "Support writing and editing",
    risk: "low",
    complexity: "low",
    easyRate: .88,
    currentModels: ["deepseek-r1", "gpt-5.4", "local-qwen-14b"],
    examples: [
      { prompt: `${supportPrefix} rewrite this customer update to be clearer and shorter: We are experiencing some delay on account of a dependency.`, response: "We are delayed because a dependency is not ready yet." },
      { prompt: `${supportPrefix} edit this escalation note for a calmer customer-facing tone: Engineering has not fixed this and the customer is angry.`, response: "The case remains active, and our team is reviewing the remaining dependency." },
      { prompt: `${supportPrefix} improve clarity in this support macro: Your thing is not working because setup is wrong.`, response: "The issue appears to be caused by a setup mismatch. I can help verify the configuration." },
    ],
  },
  {
    key: "translation_localization",
    label: "Support translation and localization",
    risk: "low",
    complexity: "low",
    easyRate: .9,
    currentModels: ["local-qwen-14b", "deepseek-v4-pro", "gpt-5.4"],
    examples: [
      { prompt: `${supportPrefix} translate to Spanish for a friendly support email: Your refund request is under review.`, response: "Tu solicitud de reembolso está en revisión." },
      { prompt: `${supportPrefix} localize this US support message for UK English: We are organizing your case history before escalating.`, response: "We are organising your case history before escalating." },
      { prompt: `${supportPrefix} translate to French for a support reply: Please confirm the billing email on the account.`, response: "Veuillez confirmer l'adresse e-mail de facturation du compte." },
    ],
  },
  {
    key: "document_review_legal_analysis",
    label: "Support legal document review",
    risk: "high",
    complexity: "high",
    easyRate: .34,
    currentModels: ["claude-opus-4.8", "gpt-5.5-pro", "gpt-5.4"],
    examples: [
      { prompt: `${supportPrefix} review this enterprise support agreement clause for unusual termination obligations before escalating to legal.`, response: "The clause allows termination for convenience but requires 60 days notice and payment of committed fees." },
      { prompt: `${supportPrefix} identify risk in this indemnity clause before summarizing it for the account team.`, response: "Risk: indemnity is uncapped and covers third-party claims caused by customer modifications." },
      { prompt: `${supportPrefix} review this data processing addendum excerpt for support escalation obligations.`, response: "The excerpt requires incident notice within 48 hours and restricts support data access to approved personnel." },
    ],
  },
  {
    key: "planning_strategy_recommendations",
    label: "Support planning and recommendations",
    risk: "medium",
    complexity: "medium",
    easyRate: 1,
    currentModels: ["gpt-5.4", "mistral-large-3", "deepseek-v4-pro"],
    examples: [
      { prompt: `${supportPrefix} create a plan for rolling out new refund macros across support traffic.`, response: "Week 1 review quality, week 2 shadow test, week 3 pilot with billing agents, week 4 monitored rollout with rollback thresholds." },
      { prompt: `${supportPrefix} recommend next steps after a failed help-center deflection experiment.`, response: "Segment failed searches, interview agents, revise article structure, and rerun with a targeted cohort." },
      { prompt: `${supportPrefix} create a plan to reduce weekend SLA breaches in the enterprise support queue.`, response: "Review weekend volume, adjust staffing, add priority triage, monitor breach rate, and revisit coverage after two weeks." },
    ],
  },
  {
    key: "tool_use_function_calling",
    label: "Support tool and API calls",
    risk: "medium",
    complexity: "medium",
    easyRate: 1,
    currentModels: ["deepseek-v4-pro", "gpt-5.4", "claude-opus-4.8"],
    examples: [
      { prompt: `${supportPrefix} call the order API and shipping calculator to confirm whether order SO-781 can ship today.`, response: json({ order_id: "SO-781", inventory_available: true, shipping_window: "today" }), spans: [{ id: "order_api", type: "tool", name: "order_api", metadata: { status: "success" } }, { id: "shipping_calculator", type: "tool", name: "shipping_calculator", metadata: { status: "success" } }] },
      { prompt: `${supportPrefix} call the CRM lookup tool for account Acme and return support owner and ARR.`, response: json({ account: "Acme", support_owner: "Jordan Lee", arr: 84000 }), spans: [{ id: "crm_lookup", type: "tool", name: "crm_lookup", metadata: { status: "success" } }] },
      { prompt: `${supportPrefix} call the entitlement API to check whether account Greenbyte has audit-log export enabled.`, response: json({ account: "Greenbyte", audit_log_export_enabled: true }), spans: [{ id: "entitlement_api", type: "tool", name: "entitlement_api", metadata: { status: "success" } }] },
    ],
  },
];

const complexityScore = (complexity: Complexity) => ({ low: .12, medium: .18, high: .82 })[complexity];
const tokenBase = (complexity: Complexity) => ({ low: 360, medium: 820, high: 1600 })[complexity];

export function createSeedTraces(): Trace[] {
  return groups.flatMap((group, groupIndex) => Array.from({ length: SEED_TRACES_PER_GROUP }, (_, index) => {
    const example = group.examples[index % group.examples.length];
    const id = `trace_${group.key}_${String(index + 1).padStart(3, "0")}`;
    const prompt = `${example.prompt} Case ${index + 1}.`;
    const expected = example.response;
    const modelId = group.currentModels[index % group.currentModels.length];
    const model = getModel(modelId)!;
    const base = tokenBase(group.complexity);
    const input = base + groupIndex * 17 + index * 19;
    const output = Math.round(base * .22) + groupIndex * 5 + index * 7;
    const monthIndex = index < SEED_TRACES_PER_GROUP / 2
      ? Math.floor(index / (SEED_TRACES_PER_GROUP / 2) * 4)
      : 4 + Math.floor((index - SEED_TRACES_PER_GROUP / 2) / (SEED_TRACES_PER_GROUP / 2) * 2);
    const monthStart = Date.UTC(2026, monthIndex, 1);
    const daysInMonth = new Date(Date.UTC(2026, monthIndex + 1, 0)).getUTCDate();
    const day = (index * 3 + groupIndex) % daysInMonth;
    const timestamp = new Date(monthStart + day * 86_400_000 + (8 + groupIndex % 10) * 3_600_000).toISOString();
    const workflowId = `workflow_${String(index + 1).padStart(3, "0")}`;
    const role = workflowRoles[groupIndex % workflowRoles.length];
    const parentRole = groupIndex ? workflowRoles[(groupIndex - 1) % workflowRoles.length] : undefined;
    const nodeId = `${workflowId}_${String(groupIndex + 1).padStart(2, "0")}_${role}`;
    const failed = index === SEED_TRACES_PER_GROUP - 1 && group.key === "tool_use_function_calling";
    return {
      id, timestamp,
      provider: model.provider, model: modelId, messages: [{ role: "user", content: prompt }],
      prompt_text: prompt, response_text: expected, input_tokens: input, output_tokens: output,
      total_tokens: input + output, latency_ms: model.default_latency_ms + groupIndex * 25 + index * 18,
      cost_usd: calculateCost(input, output, model), status: failed ? "error" : "success",
      workflow_id: workflowId, node_id: nodeId,
      parent_node_id: groupIndex && parentRole ? `${workflowId}_${String(groupIndex).padStart(2, "0")}_${parentRole}` : undefined,
      workflow_role: role, span_name: `${group.label} ${role}`,
      spans: example.spans,
      error_type: failed ? "timeout" : undefined,
      metadata: {
        expected_answer: expected,
        mock_difficulty: index / SEED_TRACES_PER_GROUP < group.easyRate ? "easy" : "hard",
        task_type: group.key,
        domain: "customer_support",
        risk_level: group.risk,
        complexity_score: complexityScore(group.complexity),
        mock_slow_candidate: group.key === "customer_support_responses",
      },
    };
  }));
}
