import { calculateCost, getModel } from "./catalog";
import type { Complexity, Risk, TaskType, Trace, TraceSpan, WorkflowRole } from "../types";

export const SEED_TRACES_PER_GROUP = 12;
export const SEED_TASK_GROUP_COUNT = 16;
export const SEED_TRACE_COUNT = SEED_TRACES_PER_GROUP * SEED_TASK_GROUP_COUNT;

const workflowRoles: WorkflowRole[] = ["planner", "retriever_summarizer", "judge", "final_answer"];
const json = (value: unknown) => JSON.stringify(value);

type SeedExample = { prompt: string; response: string; weak_response?: string; spans?: TraceSpan[] };
type SeedGroup = {
  key: TaskType;
  label: string;
  risk: Risk;
  complexity: Complexity;
  easyRate: number;
  currentModels: string[];
  examples: SeedExample[];
};

const sharedSupportSystemPrompt = [
  "You are the production support AI for a B2B SaaS company.",
  "Follow the support policy exactly. Do not promise refunds, credits, account access, or timeline commitments unless the provided context explicitly allows it.",
  "Use a calm, concise, customer-ready tone. Preserve required facts, cite retrieved sources when present, and escalate uncertainty.",
  "For structured tasks, return the requested schema without extra prose. For customer replies, avoid internal policy names and explain the next safe step.",
].join(" ");
const sharedSupportSystemTokens = Math.ceil(sharedSupportSystemPrompt.length / 4);

const groups: SeedGroup[] = [
  {
    key: "classification_tagging",
    label: "Intent classification and tagging",
    risk: "low",
    complexity: "low",
    easyRate: .94,
    currentModels: ["deepseek-r1", "deepseek-v4-pro", "local-qwen-14b"],
    examples: [
      { prompt: "Classify intent, priority, sentiment, and queue for a customer who says they were charged twice after upgrading yesterday.", response: "intent=billing_dispute; priority=high; sentiment=frustrated; queue=billing" },
      { prompt: "Tag an enterprise admin request for SSO documentation before rollout, including security review and priority.", response: "intent=security_review; priority=medium; tags=sso,security_docs,enterprise" },
      { prompt: "Classify a message asking where to find the refund status page after submitting a request.", response: "intent=refund_status; priority=low; sentiment=neutral; queue=billing" },
    ],
  },
  {
    key: "customer_support_responses",
    label: "Refund and billing dispute resolution",
    risk: "medium",
    complexity: "medium",
    easyRate: .82,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-v4-pro"],
    examples: [
      { prompt: "Draft a reply to a customer reporting a duplicate annual-plan charge. Policy says billing must verify the transaction before approval.", response: "Thanks for flagging this. I can see why a duplicate charge would be frustrating. Our billing team will verify the transaction first, and we will update you with the next step after that review is complete.", weak_response: "Thanks for flagging this. I have approved the refund and you should see it today." },
      { prompt: "Respond to a customer asking for an immediate refund after missing a renewal reminder. Policy allows review but not automatic approval.", response: "I can open a refund review for you. We need to confirm the renewal timeline and account history before any approval, and I will share the decision once the review is complete.", weak_response: "No problem, your refund is guaranteed because you missed the renewal reminder." },
      { prompt: "Reply to a customer disputing an overage fee where usage logs need to be checked before credit can be issued.", response: "I can help review the overage. We will compare the usage logs with your plan limits first, then confirm whether a credit or plan adjustment is available.", weak_response: "The overage fee was probably an error, so I removed it from your bill." },
    ],
  },
  {
    key: "rag_grounded_answers",
    label: "RAG-grounded policy answers",
    risk: "high",
    complexity: "high",
    easyRate: .68,
    currentModels: ["claude-opus-4.8", "gpt-5.5-pro", "gpt-5.4"],
    examples: [
      { prompt: "Using retrieved context, answer whether an annual-plan refund is allowed and cite the source. Context [1]: Annual plan refunds are allowed within 30 days when no export job has completed.", response: "Yes, the customer may qualify if the purchase was within 30 days and no export job has completed [1].", weak_response: "Yes, annual-plan refunds are always allowed within 30 days." , spans: [{ id: "retrieved_refund_policy", type: "retriever", name: "refund_policy", metadata: { chunks: 3 } }] },
      { prompt: "Using retrieved context, answer whether an outage qualifies for service credit. Context [1]: Credits require 45 continuous minutes of unplanned downtime.", response: "The outage qualifies only if it reached 45 continuous minutes of unplanned downtime [1].", weak_response: "The outage qualifies for credit because any downtime is eligible.", spans: [{ id: "retrieved_sla_policy", type: "retriever", name: "sla_policy", metadata: { chunks: 2 } }] },
      { prompt: "Using retrieved context, answer whether SSO enforcement can be delayed. Context [1]: Enterprise admins can defer enforcement once for 14 days.", response: "The admin can defer SSO enforcement once for 14 days [1].", weak_response: "The admin can delay SSO enforcement indefinitely if they contact support.", spans: [{ id: "retrieved_sso_policy", type: "retriever", name: "sso_policy", metadata: { chunks: 2 } }] },
    ],
  },
  {
    key: "customer_support_responses",
    label: "Subscription and plan change handling",
    risk: "medium",
    complexity: "medium",
    easyRate: .9,
    currentModels: ["deepseek-v4-pro", "claude-opus-4.8", "gpt-5.4"],
    examples: [
      { prompt: "Draft a reply explaining why moving to a lower base plan can still increase a bill when add-ons and usage overages remain active.", response: "A lower base plan can reduce the subscription fee, but add-ons and overage charges are billed separately. I can help review the account usage so you can decide which plan or usage limit fits best." },
      { prompt: "Explain to an admin how to schedule a downgrade at renewal instead of changing the plan immediately.", response: "You can schedule the downgrade for the renewal date so current seats and features stay active through the term. I can help confirm the renewal date and the target plan before making the change." },
      { prompt: "Respond to a customer asking whether adding temporary seats will change their annual contract.", response: "Temporary seats can affect billing for the active term. We should confirm the seat count, dates, and contract terms before applying the change." },
    ],
  },
  {
    key: "classification_tagging",
    label: "Escalation triage and routing",
    risk: "medium",
    complexity: "low",
    easyRate: .92,
    currentModels: ["deepseek-r1", "deepseek-v4-pro", "gpt-5.4"],
    examples: [
      { prompt: "Route a ticket where renewal is tomorrow, outage timeline is missing, and the account owner asks for SLA credit review.", response: "queue=enterprise_support; priority=high; escalation_reason=renewal_risk_and_sla_credit_review" },
      { prompt: "Route a ticket where a workspace admin lost access after SSO enforcement and the incident affects the executive team.", response: "queue=account_recovery; priority=critical; escalation_reason=admin_lockout_sso_enforcement" },
      { prompt: "Route a ticket where a customer reports audit-log export failures before a compliance audit.", response: "queue=technical_support; priority=high; escalation_reason=compliance_deadline_export_failure" },
    ],
  },
  {
    key: "writing_editing",
    label: "CSAT follow-up drafting",
    risk: "low",
    complexity: "low",
    easyRate: .96,
    currentModels: ["deepseek-r1", "gpt-5.4", "local-qwen-14b"],
    examples: [
      { prompt: "Write a short CSAT follow-up after a billing dispute was resolved and the customer thanked the support team.", response: "Thanks again for working with us on the billing issue. If anything else comes up, reply here and we will help." },
      { prompt: "Draft a friendly follow-up after a password reset issue was resolved through admin verification.", response: "I am glad we were able to restore access. Please let us know if any other users have trouble signing in." },
      { prompt: "Create a concise follow-up after export retries succeeded and the customer confirmed the file is available.", response: "Great to hear the export is available now. We will keep monitoring for any recurrence on our side." },
    ],
  },
  {
    key: "summarization",
    label: "Ticket summarization for handoff",
    risk: "low",
    complexity: "low",
    easyRate: .95,
    currentModels: ["deepseek-r1", "deepseek-v4-pro", "claude-opus-4.8"],
    examples: [
      { prompt: "Summarize a ticket for handoff: the customer cannot export audit logs, billing is current, and the export job timed out twice.", response: "The customer cannot export audit logs despite an active account; two export attempts timed out and need engineering review." },
      { prompt: "Summarize a chat transcript for the next agent: the admin lost access after SSO enforcement and needs recovery today.", response: "An admin lost access after SSO enforcement and needs same-day account recovery support." },
      { prompt: "Condense an escalation note: renewal is tomorrow, support needs the outage timeline, and the customer asked for SLA credit review.", response: "The renewal is tomorrow; support needs the outage timeline to assess SLA credit eligibility." },
    ],
  },
  {
    key: "tool_use_function_calling",
    label: "Order status lookup",
    risk: "medium",
    complexity: "medium",
    easyRate: .9,
    currentModels: ["deepseek-v4-pro", "gpt-5.4", "claude-opus-4.8"],
    examples: [
      { prompt: "Call the order API and shipping calculator to confirm whether order SO-781 can ship today.", response: json({ order_id: "SO-781", inventory_available: true, shipping_window: "today" }), spans: [{ id: "order_api", type: "tool", name: "order_api", metadata: { status: "success", arguments: { order_id: "SO-781" } } }, { id: "shipping_calculator", type: "tool", name: "shipping_calculator", metadata: { status: "success", arguments: { region: "EMEA" } } }] },
      { prompt: "Check order SO-882 and return inventory availability and ship date.", response: json({ order_id: "SO-882", inventory_available: false, shipping_window: "backorder review" }), spans: [{ id: "order_api", type: "tool", name: "order_api", metadata: { status: "success", arguments: { order_id: "SO-882" } } }] },
      { prompt: "Use fulfillment tools to tell support whether order SO-945 is blocked by payment or inventory.", response: json({ order_id: "SO-945", block_reason: "payment_hold", inventory_available: true }), spans: [{ id: "order_api", type: "tool", name: "order_api", metadata: { status: "success", arguments: { order_id: "SO-945" } } }] },
    ],
  },
  {
    key: "tool_use_function_calling",
    label: "Account security verification",
    risk: "high",
    complexity: "medium",
    easyRate: .8,
    currentModels: ["claude-opus-4.8", "gpt-5.4", "deepseek-v4-pro"],
    examples: [
      { prompt: "Call the entitlement and admin-directory tools to verify whether account Greenbyte can enable audit-log export.", response: json({ account: "Greenbyte", admin_verified: true, audit_log_export_enabled: true }), spans: [{ id: "entitlement_api", type: "tool", name: "entitlement_api", metadata: { status: "success", arguments: { account: "Greenbyte" } } }, { id: "admin_directory", type: "tool", name: "admin_directory", metadata: { status: "success", arguments: { account: "Greenbyte" } } }] },
      { prompt: "Verify whether the requester for Northstar is an admin before discussing SSO recovery steps.", response: json({ account: "Northstar", requester_admin: true, recovery_steps_allowed: true }), spans: [{ id: "admin_directory", type: "tool", name: "admin_directory", metadata: { status: "success", arguments: { account: "Northstar" } } }] },
      { prompt: "Check whether Acme has verified domain ownership before enabling SCIM changes.", response: json({ account: "Acme", domain_verified: true, scim_change_allowed: true }), spans: [{ id: "domain_verification", type: "tool", name: "domain_verification", metadata: { status: "success", arguments: { account: "Acme" } } }] },
    ],
  },
  {
    key: "question_answering",
    label: "Troubleshooting guided flows",
    risk: "medium",
    complexity: "medium",
    easyRate: .88,
    currentModels: ["deepseek-v4-pro", "claude-opus-4.8", "gpt-5.4"],
    examples: [
      { prompt: "Guide a customer through first checks when API requests are slow but not failing.", response: "Check recent latency by endpoint, confirm request volume, compare p95 latency against baseline, and inspect retries or rate-limit headers before escalating." },
      { prompt: "Explain what an admin should check first when invitation emails are not received.", response: "Check the email allowlist, spam filtering, and whether invitations were sent to the correct domain before resending." },
      { prompt: "Provide a troubleshooting flow for failed CSV exports that timeout after five minutes.", response: "Confirm export size, retry during lower traffic, check filters, and escalate with the export job ID if the retry also times out." },
    ],
  },
  {
    key: "policy_compliance_reasoning",
    label: "Policy compliance review",
    risk: "high",
    complexity: "high",
    easyRate: .54,
    currentModels: ["claude-opus-4.8", "gpt-5.5-pro", "gpt-5.4"],
    examples: [
      { prompt: "Check whether this draft complies with refund policy: We guarantee your refund today before verifying the charge.", response: "Non-compliant. The reply promises approval before verifying refund eligibility.", weak_response: "Compliant. The customer deserves a fast refund because the charge is disputed." },
      { prompt: "Check whether sharing a customer CSV export in a public ticket complies with data-handling policy.", response: "Non-compliant. Customer exports must stay in approved support systems and personal data must be protected.", weak_response: "Compliant as long as the link is convenient for the customer." },
      { prompt: "Check whether this password reset reply follows account access policy: Tell me the old password and I will reset it.", response: "Non-compliant. Support must not ask customers to disclose passwords.", weak_response: "Compliant. Asking for the old password confirms identity." },
    ],
  },
  {
    key: "document_review_legal_analysis",
    label: "Legal and DPA document review",
    risk: "high",
    complexity: "high",
    easyRate: .42,
    currentModels: ["claude-opus-4.8", "gpt-5.5-pro", "gpt-5.4"],
    examples: [
      { prompt: "Review an enterprise support agreement clause for unusual termination obligations before escalating to legal.", response: "The clause allows termination for convenience but requires 60 days notice and payment of committed fees.", weak_response: "The clause appears standard and does not need legal review." },
      { prompt: "Identify risk in an indemnity clause before summarizing it for the account team.", response: "Risk: indemnity is uncapped and covers third-party claims caused by customer modifications.", weak_response: "The indemnity clause only protects the vendor and has no customer risk." },
      { prompt: "Review a DPA excerpt for support escalation obligations.", response: "The excerpt requires incident notice within 48 hours and restricts support data access to approved personnel.", weak_response: "The DPA does not include any support escalation obligations." },
    ],
  },
  {
    key: "translation_localization",
    label: "Multilingual reply translation",
    risk: "low",
    complexity: "low",
    easyRate: .92,
    currentModels: ["local-qwen-14b", "deepseek-v4-pro", "gpt-5.4"],
    examples: [
      { prompt: "Translate to Spanish for a friendly support email: Your refund request is under review.", response: "Tu solicitud de reembolso está en revisión." },
      { prompt: "Localize this US support message for UK English: We are organizing your case history before escalating.", response: "We are organising your case history before escalating." },
      { prompt: "Translate to French for a support reply: Please confirm the billing email on the account.", response: "Veuillez confirmer l'adresse e-mail de facturation du compte." },
    ],
  },
  {
    key: "writing_editing",
    label: "Macro and template drafting",
    risk: "low",
    complexity: "low",
    easyRate: .9,
    currentModels: ["deepseek-r1", "gpt-5.4", "local-qwen-14b"],
    examples: [
      { prompt: "Draft a support macro for explaining that an export delay is being escalated without promising an exact fix time.", response: "We have escalated the export delay to our team and will share updates as soon as we have confirmed next steps." },
      { prompt: "Rewrite a support macro to be clearer: Your thing is not working because setup is wrong.", response: "The issue appears to be caused by a setup mismatch. I can help verify the configuration." },
      { prompt: "Draft a template for asking an admin to confirm account domain before access recovery.", response: "Please confirm the account domain and admin email so we can start the recovery review." },
    ],
  },
  {
    key: "classification_tagging",
    label: "Sentiment and churn-risk flagging",
    risk: "medium",
    complexity: "low",
    easyRate: .9,
    currentModels: ["deepseek-r1", "deepseek-v4-pro", "gpt-5.4"],
    examples: [
      { prompt: "Flag sentiment and churn risk for a customer who says this is the third outage before renewal.", response: "sentiment=frustrated; churn_risk=high; trigger=repeat_outage_before_renewal" },
      { prompt: "Classify churn risk for a customer asking whether competitors have better audit-log exports.", response: "sentiment=concerned; churn_risk=medium; trigger=competitive_evaluation" },
      { prompt: "Tag sentiment for a customer thanking support after a billing correction.", response: "sentiment=positive; churn_risk=low; trigger=resolved_billing_issue" },
    ],
  },
  {
    key: "extraction",
    label: "Knowledge-base gap extraction",
    risk: "low",
    complexity: "low",
    easyRate: .95,
    currentModels: ["local-qwen-14b", "deepseek-r1", "deepseek-v4-pro"],
    examples: [
      { prompt: "Extract missing knowledge-base topic, customer question, and suggested article title from a ticket about SSO enforcement delay.", response: json({ missing_topic: "SSO enforcement deferral", customer_question: "Can SSO enforcement be delayed?", suggested_article: "How to defer SSO enforcement" }) },
      { prompt: "Extract the documentation gap from a ticket where a customer cannot find audit-log export limits.", response: json({ missing_topic: "Audit-log export limits", customer_question: "What are the size and time limits for audit-log export?", suggested_article: "Audit-log export limits and troubleshooting" }) },
      { prompt: "Extract a help-center gap from a support thread about renewal reminders and plan changes.", response: json({ missing_topic: "Renewal reminder timing", customer_question: "When are renewal reminders sent?", suggested_article: "Renewal reminders and scheduled plan changes" }) },
    ],
  },
];

const accounts = ["Northstar", "Acme", "Greenbyte", "Atlas", "Waypoint", "Cobalt", "Helio", "Nimbus", "Redwood", "Summit", "Kite", "Harbor"];
const sampleUserFeedback: Record<string, "thumbs_up" | "thumbs_down"> = {
  trace_intent_classification_and_tagging_003: "thumbs_up",
  trace_refund_and_billing_dispute_resolution_002: "thumbs_down",
  trace_refund_and_billing_dispute_resolution_003: "thumbs_up",
  trace_refund_and_billing_dispute_resolution_008: "thumbs_down",
  trace_rag_grounded_policy_answers_001: "thumbs_up",
  trace_rag_grounded_policy_answers_005: "thumbs_down",
  trace_rag_grounded_policy_answers_011: "thumbs_down",
  trace_csat_follow_up_drafting_001: "thumbs_up",
  trace_troubleshooting_guided_flows_006: "thumbs_up",
  trace_multilingual_reply_translation_009: "thumbs_up",
};
const sampleSafetySignals: Record<string, { signal: string; reason: string }> = {
  trace_policy_compliance_review_011: {
    signal: "customer_data_exposure",
    reason: "The agent treats sharing a customer CSV in a public ticket as compliant.",
  },
  trace_policy_compliance_review_012: {
    signal: "credential_disclosure",
    reason: "The agent approves asking a customer to disclose an old password.",
  },
};
const complexityScore = (complexity: Complexity) => ({ low: .12, medium: .18, high: .82 })[complexity];
const tokenBase = (complexity: Complexity) => ({ low: 360, medium: 820, high: 1600 })[complexity];

function personalize(prompt: string, index: number) {
  return `${prompt} Account: ${accounts[index % accounts.length]}. Ticket opened by ${["admin", "billing owner", "support manager", "operations lead"][index % 4]}.`;
}

export function createSeedTraces(): Trace[] {
  return groups.flatMap((group, groupIndex) => Array.from({ length: SEED_TRACES_PER_GROUP }, (_, index) => {
    const example = group.examples[index % group.examples.length];
    const id = `trace_${group.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}_${String(index + 1).padStart(3, "0")}`;
    const prompt = personalize(example.prompt, index);
    const reference = example.response;
    const safetySignal = sampleSafetySignals[id];
    const modelId = group.currentModels[index % group.currentModels.length];
    const model = getModel(modelId)!;
    const base = tokenBase(group.complexity);
    const input = base + sharedSupportSystemTokens + groupIndex * 17 + index * 19;
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
    const failed = index === SEED_TRACES_PER_GROUP - 1 && group.label === "Order status lookup";
    return {
      id,
      timestamp,
      provider: model.provider,
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      prompt_text: prompt,
      response_text: safetySignal && example.weak_response ? example.weak_response : reference,
      input_tokens: input,
      output_tokens: output,
      total_tokens: input + output,
      latency_ms: model.default_latency_ms + groupIndex * 25 + index * 18,
      cost_usd: calculateCost(input, output, model),
      status: failed ? "error" : "success",
      workflow_id: workflowId,
      node_id: nodeId,
      parent_node_id: groupIndex && parentRole ? `${workflowId}_${String(groupIndex).padStart(2, "0")}_${parentRole}` : undefined,
      workflow_role: role,
      span_name: `${group.label} ${role}`,
      spans: example.spans,
      error_type: failed ? "timeout" : undefined,
      metadata: {
        _internal_reference: reference,
        _internal_candidate_quality: index / SEED_TRACES_PER_GROUP < group.easyRate ? "passes" : "fails",
        _internal_weak_response: example.weak_response,
        user_id: `user_${accounts[index % accounts.length].toLowerCase()}_${String(index + 1).padStart(3, "0")}`,
        ...(sampleUserFeedback[id] ? { user_feedback: sampleUserFeedback[id] } : {}),
        ...(safetySignal ? { safety_signal: safetySignal.signal, safety_reason: safetySignal.reason } : {}),
        task_type: group.key,
        distinct_task_label: group.label,
        domain: "customer_support",
        risk_level: group.risk,
        complexity_score: complexityScore(group.complexity),
        static_prompt_tokens: sharedSupportSystemTokens,
        workflow_id: workflowId,
        parent_step: parentRole ?? "root",
      },
    };
  }));
}
