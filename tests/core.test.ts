import { describe, expect, it } from "vitest";
import { dashboardMetrics, explainRisk, inferRisk } from "../src/core/analysis";
import { calculateCost, enabledModels, getModel, modelCatalog, updateFamilyEnabled, updateModelEnabled, updateModelPricing } from "../src/core/catalog";
import { exactMatch, jsonSchema, regexEval, rubricJudge } from "../src/core/evaluators";
import { buildWorkflowTrees, ingestRecords, ingestText } from "../src/core/ingestion";
import { exportLiteLlm, exportOpenRouterConfig, exportPolicyJson, exportTypeScript, recommendPolicy, recommendScriptAutomation } from "../src/core/recommendations";
import { buildReviewQueue, REVIEW_QUEUE_MAX } from "../src/core/reviewQueue";
import { traceUserFeedback } from "../src/core/traceFeedback";
import { createSeedTraces, SEED_TASK_GROUP_COUNT, SEED_TRACE_COUNT, SEED_TRACES_PER_GROUP } from "../src/core/seed";
import { cascade, costOnly, deterministicGenerate, familyCascade, MONTHLY_MULTIPLIER, monthlyDistinctTaskBreakdown, replay } from "../src/core/simulations";
import { MIN_PROVIDER_QUOTES, providerQuotesForModel, quoteLabel } from "../src/core/providerPricing";
import { liveRoutingStatus } from "../src/core/liveRouting";
import { filterTracesByRange, monthlyBuckets } from "../src/core/time";
import { createDistinctTaskBuckets } from "../src/core/distinctTasks";
import { analyzeFineTuneOpportunity, calibrateGoldenDataset, createSimulatedGoldenDataset, parseGoldenDatasetCsv, updateGoldenDatasetCell } from "../src/core/goldenDatasets";
import { createTraceJudgeResults } from "../src/core/traceJudge";
import { basetenModelRepo, buildBasetenTrainingJobPayload, toSupervisedFineTuneJsonl } from "../src/core/basetenFineTuning";
import { overviewEconomics } from "../src/core/economics";

const traces = createSeedTraces();
const distinctTaskBuckets = createDistinctTaskBuckets(traces);
describe("ingestion and costs", () => {
  it("normalizes the enterprise seed records and fills derived fields", () => {
    const raw = traces.map(({ total_tokens, messages, cost_usd, ...trace }) => trace);
    const result = ingestRecords(raw);
    expect(result.traces).toHaveLength(SEED_TRACE_COUNT);
    expect(result.traces[0].messages).toHaveLength(1);
    expect(result.traces[0].total_tokens).toBe(result.traces[0].input_tokens + result.traces[0].output_tokens);
    expect(result.traces.some((trace) => (trace.cost_usd ?? 0) > 0)).toBe(true);
    expect(result.traces.every((trace) => (trace.cost_usd ?? 0) >= 0)).toBe(true);
  });
  it("spreads seed traffic over six months with half in the latest two calendar months", () => {
    const buckets = monthlyBuckets(traces);
    expect(buckets).toHaveLength(6);
    expect(buckets.reduce((sum, bucket) => sum + bucket.calls, 0)).toBe(SEED_TRACE_COUNT);
    expect(buckets.slice(-2).reduce((sum, bucket) => sum + bucket.calls, 0)).toBe(SEED_TRACE_COUNT / 2);
    expect(filterTracesByRange(traces, "7d").length).toBeLessThan(filterTracesByRange(traces, "30d").length);
    expect(filterTracesByRange(traces, "30d").length).toBeLessThan(filterTracesByRange(traces, "3m").length);
    expect(filterTracesByRange(traces, "6m")).toHaveLength(SEED_TRACE_COUNT);
  });
  it("handles JSONL, JSON, CSV, and malformed rows", () => {
    expect(ingestText(traces.slice(0, 2).map((trace) => JSON.stringify(trace)).join("\n") + "\n{bad", "x.jsonl").traces).toHaveLength(2);
    expect(ingestText(JSON.stringify(traces.slice(0, 2)), "x.json").traces).toHaveLength(2);
    expect(ingestText("id,model,prompt_text,input_tokens,output_tokens\nx,gpt-5.5-pro,hello,1,2", "x.csv").traces).toHaveLength(1);
    expect(ingestRecords([null, { id: "x" }]).errors).toHaveLength(2);
  });
  it("preserves flat and nested workflow trace trees", () => {
    const seededTrees = buildWorkflowTrees(traces);
    expect(seededTrees).toHaveLength(SEED_TRACES_PER_GROUP);
    expect(seededTrees[0].trace_ids).toHaveLength(SEED_TASK_GROUP_COUNT);
    expect(seededTrees[0].roots[0].workflow_role).toBe("planner");
    expect(seededTrees[0].roots[0].children[0].workflow_role).toBe("retriever_summarizer");

    const nested = ingestText(JSON.stringify({
      workflows: [{ id: "workflow_nested", nodes: [{
        id: "planner_node", model: "gpt-5.5-pro", prompt: "Plan the task", workflow_role: "planner",
        children: [{ id: "answer_node", model: "claude-opus-4.8", prompt: "Answer the task", workflow_role: "final_answer" }],
      }] }],
    }), "nested.json");
    expect(nested.traces).toHaveLength(2);
    expect(nested.workflows).toHaveLength(1);
    expect(nested.traces[1].parent_node_id).toBe("planner_node");
    expect(nested.workflows[0].roots[0].children[0].trace_id).toBe("answer_node");

    const csv = ingestText("id,workflow_id,node_id,parent_node_id,workflow_role,model,prompt_text\ncall-1,wf-1,n-1,,tool_caller,gpt-5.5-pro,use tool", "tree.csv");
    expect(csv.workflows[0].roles.tool_caller).toBe(1);
  });
  it("matches reference pricing", () => {
    expect(calculateCost(1e9, 1e9, getModel("gpt-5.5-pro")!)).toBe(210000);
    expect(calculateCost(1e9, 1e9, getModel("claude-opus-4.8")!)).toBe(30000);
    expect(calculateCost(1e9, 1e9, getModel("deepseek-v4-pro")!)).toBe(1305);
    expect(calculateCost(1e9, 1e9, getModel("deepseek-r1")!)).toBe(3200);
    expect(calculateCost(1000, 500, getModel("gpt-5.5-pro")!)).toBeCloseTo(.12);
    expect(getModel("gpt-5.5-pro")!.pricing_source_model_id).toBe("openai/gpt-5.5-pro");
  });
});
describe("analysis and risk inference", () => {
  it("calculates consistent dashboard metrics", () => {
    const metrics = dashboardMetrics(traces);
    expect(metrics.totalRequests).toBe(SEED_TRACE_COUNT);
    expect(Object.values(metrics.byModel).reduce((sum, item) => sum + item.requests, 0)).toBe(SEED_TRACE_COUNT);
    expect((metrics.byModel["gpt-5.5-pro"]?.requests ?? 0) + (metrics.byModel["claude-opus-4.8"]?.requests ?? 0)).toBeGreaterThanOrEqual(SEED_TRACE_COUNT / 4);
    expect(Object.values(metrics.byModel).reduce((sum, item) => sum + item.cost, 0)).toBeCloseTo(metrics.totalCost);
    expect(metrics.failed).toBe(1);
    expect(metrics.p95Latency).toBeGreaterThan(metrics.p50Latency);
  });
  it("infers explainable risks", () => {
    expect(inferRisk("review legal compliance contract")).toBe("high");
    expect(inferRisk("extract fields to JSON")).toBe("low");
    expect(explainRisk("review a policy").reason).toContain("keyword fallback");
    expect(explainRisk("ordinary task").risk).toBe("medium");
  });
});
describe("providers and evaluators", () => {
  it("deterministic provider replay is stable and respects calibrated candidate outcomes", () => {
    const passing = traces.find((t) => t.metadata?._internal_candidate_quality === "passes")!;
    const failing = traces.find((t) => t.metadata?._internal_candidate_quality === "fails" && t.metadata?._internal_weak_response)!;
    expect(deterministicGenerate(passing, "deepseek-r1")).toEqual(deterministicGenerate(passing, "deepseek-r1"));
    expect(deterministicGenerate(passing, "deepseek-r1").response_text).toBe(passing.metadata?._internal_reference);
    expect(deterministicGenerate(failing, "deepseek-r1").response_text).toBe(failing.metadata?._internal_weak_response);
    expect(deterministicGenerate(failing, "claude-opus-4.8").response_text).toBe(failing.metadata?._internal_reference);
  });
  it("quotes at least five inference providers for model pricing", () => {
    for (const model of modelCatalog) {
      const quotes = providerQuotesForModel(model.id);
      expect(quotes.length).toBeGreaterThanOrEqual(MIN_PROVIDER_QUOTES);
      expect(new Set(quotes.map((quote) => quote.provider_id)).size).toBeGreaterThanOrEqual(MIN_PROVIDER_QUOTES);
      expect(quotes.every((quote) => quote.input_cost_per_1m >= 0 && quote.output_cost_per_1m >= 0 && quote.estimated_latency_ms > 0)).toBe(true);
    }
    const quote = providerQuotesForModel("deepseek-r1")[0];
    const result = replay(traces.slice(0, 1), "deepseek-r1", quote);
    expect(result.runs[0].provider).toBe(quote.provider_name);
    expect(quoteLabel(quote)).toContain(" via ");
  });
  it("runs deterministic evaluators", () => {
    expect(exactMatch("Hello world", "hello   world").passed).toBe(true);
    expect(jsonSchema('{"id":1}', { type: "object", required: ["id"], properties: { id: { type: "number" } } }).passed).toBe(true);
    expect(jsonSchema('{"id":"x"}', { type: "object", required: ["id"], properties: { id: { type: "number" } } }).passed).toBe(false);
    expect(regexEval("Invoice INV-123", "INV-\\d+").passed).toBe(true);
    expect(rubricJudge("Thanks, I approved the refund and you should see it today.").score).toBe(.5);
    expect(rubricJudge("Tell me the old password and I will reset it.").severity).toBe("critical");
    expect(rubricJudge("Incomplete").passed).toBe(false);
  });
});

describe("golden datasets and fine-tuning signals", () => {
  it("parses and edits golden dataset CSV rows", () => {
    const dataset = parseGoldenDatasetCsv(
      "prompt,expected_response,score\nHello,Hi there,1\nBye,Goodbye,0.5",
      "support-golden.csv",
      new Date("2026-06-24T00:00:00.000Z"),
    );

    expect(dataset.name).toBe("support-golden.csv");
    expect(dataset.created_at).toBe("2026-06-24T00:00:00.000Z");
    expect(dataset.row_count).toBe(2);
    expect(dataset.columns).toEqual(["prompt", "expected_response", "score"]);
    expect(dataset.rows[0].score).toBe(1);

    const updated = updateGoldenDatasetCell(dataset, 0, "expected_response", "Hello there");
    expect(updated.rows[0].expected_response).toBe("Hello there");
    expect(dataset.rows[0].expected_response).toBe("Hi there");
  });

  it("suggests fine-tuning when stable trace patterns carry high extra context", () => {
    const highContextTraces = traces.slice(0, 8).map((trace, index) => ({
      ...trace,
      input_tokens: 1_600 + index,
      prompt_text: `${trace.prompt_text} Few-shot examples: example A. Instructions: follow the long policy context.`,
      metadata: { ...trace.metadata, task_type: "customer_support_responses" },
    }));

    const signal = analyzeFineTuneOpportunity(highContextTraces);

    expect(signal.should_suggest).toBe(true);
    expect(signal.matching_traces).toBe(8);
    expect(signal.stable_pattern_count).toBe(1);
    expect(signal.reason).toContain("Fine-tuning");
  });

  it("calibrates golden human labels against LLM-as-judge results", () => {
    const judgeResults = createTraceJudgeResults(traces);
    const first = traces[0];
    const failed = judgeResults.find((result) => !result.passed)!;
    const failedTrace = traces.find((trace) => trace.id === failed.trace_id)!;
    const escapeCsv = (value: unknown) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csvRow = (values: unknown[]) => values.map(escapeCsv).join(",");
    const dataset = parseGoldenDatasetCsv([
      "trace_id,prompt,agent_answer,human_answer,human_passed,human_score,human_severity",
      csvRow([first.id, first.prompt_text, first.response_text, first.metadata?._internal_reference, false, .5, "major"]),
      csvRow([failedTrace.id, failedTrace.prompt_text, failedTrace.response_text, failedTrace.metadata?._internal_reference, true, 1, "major"]),
    ].join("\n"), "calibration.csv", new Date("2026-06-24T00:00:00.000Z"));

    const calibration = calibrateGoldenDataset(dataset, traces, judgeResults);

    expect(calibration.coverage_pct).toBe(100);
    expect(calibration.agreement_rate).toBe(0);
    expect(calibration.false_pass_rate).toBe(50);
    expect(calibration.false_fail_rate).toBe(50);
    expect(calibration.disagreements).toHaveLength(2);
  });

  it("creates the preloaded simulated golden dataset for the current trace set", () => {
    const judgeResults = createTraceJudgeResults(traces);
    const dataset = createSimulatedGoldenDataset(traces, judgeResults);
    const calibration = calibrateGoldenDataset(dataset, traces, judgeResults);

    expect(dataset.name).toBe("routelab-simulated-golden-dataset.csv");
    expect(dataset.row_count).toBe(32);
    expect(dataset.columns).toContain("trace_id");
    expect(dataset.columns).toContain("human_passed");
    expect(calibration.coverage_pct).toBe(100);
    expect(calibration.disagreements.length).toBeGreaterThan(0);
  });

  it("builds a BaseTen training job from a golden dataset", () => {
    const dataset = parseGoldenDatasetCsv(
      [
        "prompt,human_answer",
        "Classify this billing issue,intent=billing_dispute",
        "Summarize this customer reply,The customer needs a refund status update.",
      ].join("\n"),
      "support-golden.csv",
      new Date("2026-06-24T00:00:00.000Z"),
    );
    const jsonl = toSupervisedFineTuneJsonl(dataset);
    const payload = buildBasetenTrainingJobPayload({
      dataset,
      baseModel: "Qwen 2.5 7B",
      datasetJsonlB64: "encoded-jsonl",
      hfSecretName: "HF_TOKEN",
    });

    expect(jsonl.split("\n")).toHaveLength(2);
    expect(jsonl).toContain("Classify this billing issue");
    expect(basetenModelRepo("Qwen 2.5 7B")).toBe("Qwen/Qwen2.5-7B-Instruct");
    expect(payload.training_job.runtime.checkpointing_config.enabled).toBe(true);
    expect(payload.training_job.runtime.environment_variables.ROUTELAB_DATASET_JSONL_B64).toBe("encoded-jsonl");
    expect(payload.training_job.weights[0].source).toBe("hf://Qwen/Qwen2.5-7B-Instruct@main");
    expect(payload.training_job.weights[0].auth_secret_name).toBe("HF_TOKEN");
  });
});

describe("simulation and recommendations", () => {
  it("calculates cheaper cost-only routing", () => {
    const result = costOnly(traces, "deepseek-r1", distinctTaskBuckets);
    expect(result.simulated_cost_usd).toBeLessThan(result.baseline_cost_usd);
    expect(result.byDistinctTask.reduce((sum, row) => sum + row.savings, 0)).toBeCloseTo(result.estimated_savings_usd);
  });
  it("supports Distinct Task-scoped simulations and expensive candidates", () => {
    const supportLegalReview = distinctTaskBuckets.find((bucket) => bucket.task.task_type === "document_review_legal_analysis")!;
    const legalReviewTraces = traces.filter((trace) => supportLegalReview.traces.includes(trace.id));
    const scoped = replay(legalReviewTraces, "claude-opus-4.8");
    const expensive = costOnly(traces, "gpt-5.5-pro", distinctTaskBuckets);
    expect(scoped.runs).toHaveLength(supportLegalReview.trace_count);
    expect(scoped.summary.pass_rate).toBe(1);
    expect(scoped.summary.baseline_cost_usd).toBeCloseTo(supportLegalReview.total_cost_usd);
    expect(expensive.simulated_cost_usd).toBeGreaterThan(0);
    expect(expensive.byDistinctTask).toHaveLength(distinctTaskBuckets.length);
  });
  it("regenerates seed traces as normalized customer support agent work", () => {
    expect(new Set(distinctTaskBuckets.map((bucket) => bucket.task.domain))).toEqual(new Set(["customer_support"]));
    expect(traces).toHaveLength(192);
    expect(distinctTaskBuckets).toHaveLength(SEED_TASK_GROUP_COUNT);
    expect(new Set(distinctTaskBuckets.map((bucket) => bucket.bucket_name)).size).toBe(SEED_TASK_GROUP_COUNT);
    expect(distinctTaskBuckets.every((bucket) => bucket.trace_count === SEED_TRACES_PER_GROUP)).toBe(true);
    expect(traces.every((trace) => trace.prompt_text.includes("Account:"))).toBe(true);
    expect(traces.every((trace) => trace.metadata?.seeded_judge_score === undefined)).toBe(true);
    expect(traces.every((trace) => typeof trace.metadata?.user_id === "string")).toBe(true);
    expect(traces.filter((trace) => traceUserFeedback(trace) === "thumbs_up").length).toBeGreaterThanOrEqual(2);
    expect(traces.filter((trace) => traceUserFeedback(trace) === "thumbs_down").length).toBeGreaterThanOrEqual(2);
    expect(traces.some((trace) => traceUserFeedback(trace) === "none")).toBe(true);
    expect(traceUserFeedback({ ...traces[0], metadata: { thumbs_up: true, thumbs_down: true } })).toBe("thumbs_down");
    const safetyTraces = traces.filter((trace) => trace.metadata?.safety_signal);
    expect(safetyTraces).toHaveLength(2);
    expect(safetyTraces.every((trace) => trace.response_text === trace.metadata?._internal_weak_response)).toBe(true);
    const judgeResults = createTraceJudgeResults(traces);
    expect(new Set(judgeResults.map((result) => result.trace_id)).size).toBe(traces.length);
    const scoreCounts = judgeResults.reduce((counts, result) => counts.set(result.score, (counts.get(result.score) ?? 0) + 1), new Map<number, number>());
    expect(scoreCounts.get(1)).toBeGreaterThan(SEED_TRACE_COUNT * .5);
    expect(scoreCounts.get(.5)).toBeGreaterThan(SEED_TRACE_COUNT * .1);
    expect(scoreCounts.get(0)).toBeGreaterThan(SEED_TRACE_COUNT * .05);
  });
  it("prices premium strong-model routing against the mixed baseline", () => {
    for (const model of ["claude-opus-4.8", "gpt-5.5-pro"]) {
      const projected = costOnly(traces, model, distinctTaskBuckets);
      const replayed = replay(traces, model);
      expect(replayed.summary.simulated_cost_usd).toBeCloseTo(projected.simulated_cost_usd);
    }
    expect(costOnly(traces, "gpt-5.5-pro", distinctTaskBuckets).estimated_savings_usd).toBeLessThan(0);
  });
  it("reconciles Distinct Task monthly savings to the top-level simulation", () => {
    for (const strategy of ["direct", "cascade"] as const) {
      const result = strategy === "direct" ? replay(traces, "deepseek-r1") : cascade(traces, "deepseek-r1", "claude-opus-4.8");
      const breakdown = monthlyDistinctTaskBreakdown(traces, distinctTaskBuckets, "deepseek-r1", strategy);
      expect(breakdown.reduce((sum, row) => sum + row.monthly_savings_usd, 0)).toBeCloseTo(result.summary.estimated_savings_usd * MONTHLY_MULTIPLIER);
    }
  });
  it("runs replay and cascade", () => {
    const cheap = replay(traces, "deepseek-r1");
    const strong = replay(traces, "claude-opus-4.8");
    const mixed = cascade(traces, "deepseek-r1", "claude-opus-4.8");
    expect(cheap.runs).toHaveLength(SEED_TRACE_COUNT);
    expect(strong.summary.pass_rate).toBe(1);
    expect(mixed.summary.pass_rate).toBeGreaterThanOrEqual(.95);
    expect(mixed.summary.escalation_rate).toBeGreaterThan(0);
    expect(mixed.summary.simulated_cost_usd).toBeGreaterThan(cheap.summary.simulated_cost_usd);
    expect(mixed.summary.simulated_cost_usd).toBeLessThan(mixed.summary.baseline_cost_usd);
  });
  it("selects trace reviews across three explained lanes without duplicating a trace", () => {
    const judges = createTraceJudgeResults(traces);
    const golden = createSimulatedGoldenDataset(traces, judges);
    const queue = buildReviewQueue(traces, judges, distinctTaskBuckets, [golden]);
    expect(queue.reviewItems.length).toBeLessThanOrEqual(REVIEW_QUEUE_MAX);
    expect(queue.reviewItems.length).toBeGreaterThan(0);
    expect(new Set(queue.reviewItems.map((item) => item.trace.id)).size).toBe(queue.reviewItems.length);
    expect(Object.values(queue.laneCounts).reduce((sum, count) => sum + count, 0)).toBe(queue.reviewItems.length);
    expect(queue.reviewItems.every((item) => item.reviewReason.length > 20)).toBe(true);
    expect(queue.laneCounts.representative).toBe(queue.laneCounts.unusual);
    expect(queue.laneCounts.unusual).toBe(queue.laneCounts.uncovered);
    expect(queue.laneCounts.uncovered).toBeGreaterThan(0);
    expect(queue.reviewItems.slice(0, 6).map((item) => item.lane)).toEqual([
      "representative", "unusual", "uncovered", "representative", "unusual", "uncovered",
    ]);
    expect(queue.reviewItems.filter((item) => item.lane === "unusual" && item.reviewReason.includes("Safety/policy alert"))).toHaveLength(2);
    expect(queue.reviewItems[1].reviewReason).toContain("Safety/policy alert");
    expect(queue.reviewItems[4].reviewReason).toContain("Safety/policy alert");
    expect(queue.reviewItems[1].reviewReason).toContain("may be a false pass");
    expect(queue.coverage.coveredSignatures).toBeLessThan(queue.coverage.totalSignatures);
    expect(queue.reviewItems.filter((item) => item.lane === "uncovered")
      .every((item) => item.reviewReason.includes("No human-labeled golden eval example"))).toBe(true);
    const thumbsDownReviews = queue.reviewItems.filter((item) => item.lane === "unusual" && traceUserFeedback(item.trace) === "thumbs_down");
    expect(thumbsDownReviews.length).toBeGreaterThanOrEqual(2);
    expect(thumbsDownReviews.every((item) => item.reviewReason.includes("thumbs down"))).toBe(true);
    expect(buildReviewQueue(traces, judges, distinctTaskBuckets, [golden]).reviewItems.map((item) => item.trace.id))
      .toEqual(queue.reviewItems.map((item) => item.trace.id));
  });
  it("can build a review queue before any full rubric has run", () => {
    const queue = buildReviewQueue(traces, [], distinctTaskBuckets, []);
    expect(queue.reviewItems).toHaveLength(REVIEW_QUEUE_MAX);
    expect(queue.reviewItems.every((item) => item.judge === undefined)).toBe(true);
    expect(queue.available.uncovered).toBe(traces.length);
    expect(queue.available.unusual).toBe(0);
  });
  it("detects observed negative feedback and peer latency outliers", () => {
    const peers = Array.from({ length: 30 }, (_, index) => ({
      ...traces[0],
      id: "review_peer_" + index,
      timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      latency_ms: index === 29 ? 5000 : 1000 + index,
      workflow_id: undefined,
      metadata: { task_type: "classification_tagging", thumbs_down: index === 28 },
    }));
    const golden = {
      id: "test_golden", name: "test.csv", created_at: "2026-01-01T00:00:00Z",
      row_count: 1, columns: ["trace_id", "human_passed"],
      rows: [{ trace_id: peers[0].id, human_passed: true }],
    };
    const queue = buildReviewQueue(peers, [], [], [golden], 9);
    expect(queue.available.unusual).toBe(2);
    expect(queue.reviewItems.some((item) => item.lane === "unusual" && item.reviewReason.includes("Latency 5,000 ms"))).toBe(true);
    expect(queue.reviewItems.some((item) => item.lane === "unusual" && item.reviewReason.includes("negative feedback"))).toBe(true);
    expect(queue.available.uncovered).toBe(0);
  });
  it("closes a signature coverage gap when a human-labeled example is added", () => {
    const judges = createTraceJudgeResults(traces);
    const golden = createSimulatedGoldenDataset(traces, judges);
    const before = buildReviewQueue(traces, judges, distinctTaskBuckets, [golden]);
    const uncovered = before.reviewItems.find((item) => item.lane === "uncovered")!;
    const updated = { ...golden, rows: [...golden.rows, { trace_id: uncovered.trace.id, human_passed: true }] };
    const after = buildReviewQueue(traces, judges, distinctTaskBuckets, [updated]);
    expect(after.coverage.coveredSignatures).toBe(before.coverage.coveredSignatures + 1);
    expect(after.available.uncovered).toBeLessThan(before.available.uncovered);
  });
  it("cascades from the cheapest to strongest model in the selected family", () => {
    const mixed = familyCascade(traces, "mistral-large-3");
    const breakdown = monthlyDistinctTaskBreakdown(traces, distinctTaskBuckets, "mistral-large-3", "family_cascade");
    expect(mixed.runs).toHaveLength(SEED_TRACE_COUNT);
    expect(mixed.summary.escalation_rate).toBeGreaterThan(0);
    expect(mixed.runs.some((run) => run.candidate_model === "mistral-large-3")).toBe(true);
    expect(breakdown.reduce((sum, row) => sum + row.monthly_savings_usd, 0)).toBeCloseTo(mixed.summary.estimated_savings_usd * MONTHLY_MULTIPLIER);
  });
  it("protects high risk Distinct Tasks and exports policies", () => {
    const policy = recommendPolicy(traces, distinctTaskBuckets);
    const legal = policy.rules.find((rule) => rule.name.toLowerCase().includes("legal"))!;
    expect(legal.strategy.type).toBe("keep_current");
    expect(policy.estimated_monthly_savings_usd).toBeGreaterThan(0);
    expect(policy.estimated_monthly_savings_usd).toBeGreaterThan(10);
    expect(policy.estimated_monthly_savings_usd).toBeCloseTo(policy.estimated_sample_savings_usd * policy.monthly_multiplier);
    expect(policy.estimated_monthly_savings_usd).toBeCloseTo(policy.rules.reduce((sum, rule) => sum + rule.estimated_monthly_savings_usd, 0));
    expect(policy.estimated_sample_savings_usd).toBeCloseTo(policy.rules.reduce((sum, rule) => sum + (rule.comparison ? rule.comparison.cost.before - rule.comparison.cost.after : 0), 0));
    const economics = overviewEconomics(traces, policy);
    expect(economics.approvedSavings).toBeCloseTo(policy.estimated_monthly_savings_usd);
    expect(economics.monthlyRunRate).toBeCloseTo(traces.reduce((sum, trace) => sum + (trace.cost_usd ?? 0), 0) * policy.monthly_multiplier);
    expect(economics.rawSavingsCeiling).toBeCloseTo(economics.approvedSavings + economics.rejectedSavings);
    expect(policy.rules.every((rule) => rule.rationale)).toBe(true);
    expect(policy.rules.filter((rule) => rule.strategy.type !== "keep_current").every((rule) => rule.comparison)).toBe(true);
    expect(policy.rules.filter((rule) => rule.strategy.type === "keep_current").every((rule) => !rule.comparison)).toBe(true);
    expect(policy.rules.filter((rule) => rule.strategy.type !== "keep_current").every((rule) => rule.provider_quote?.provider_name && rule.rationale.includes(" via "))).toBe(true);
    expect(policy.rules.every((rule) => (rule.provider_quotes_evaluated?.length ?? 0) >= policy.candidate_model_ids.length * MIN_PROVIDER_QUOTES)).toBe(true);
    expect(policy.rules.find((rule) => rule.strategy.type === "direct")?.comparison?.cost.after).toBeLessThan(
      policy.rules.find((rule) => rule.strategy.type === "direct")!.comparison!.cost.before,
    );
    const slowSupport = policy.rules.find((rule) => rule.name.toLowerCase().includes("refund") && rule.rejected_alternative)!;
    expect(slowSupport.strategy.type).not.toBe("keep_current");
    expect(slowSupport.estimated_monthly_savings_usd).toBeGreaterThan(0);
    expect(slowSupport.rejected_alternative?.potential_monthly_savings_usd).toBeGreaterThan(0);
    expect(slowSupport.rejected_alternative?.comparison.latency_ms.delta_pct).toBeGreaterThan(50);
    expect(slowSupport.rejected_alternative?.comparison.latency_ms.after).toBeGreaterThan(slowSupport.rejected_alternative!.comparison.latency_ms.before);
    expect(slowSupport.rejected_alternative?.comparison.cost.after).toBeLessThan(slowSupport.rejected_alternative!.comparison.cost.before);
    expect(slowSupport.rejected_alternative?.reason).toContain("latency");
    expect(JSON.parse(exportPolicyJson(policy)).rules).toHaveLength(distinctTaskBuckets.length);
    expect(exportLiteLlm(policy)).toContain("distinct_task_bucket_id:");
    const openRouterConfig = JSON.parse(exportOpenRouterConfig(policy));
    expect(openRouterConfig.provider).toBe("openrouter");
    expect(openRouterConfig.routes).toHaveLength(distinctTaskBuckets.length);
    expect(openRouterConfig.routes.some((route: { strategy: { provider?: string; primary_provider?: string } }) => route.strategy.provider || route.strategy.primary_provider)).toBe(true);
    expect(openRouterConfig.models.some((model: { openrouter_model: string }) => model.openrouter_model.includes("/"))).toBe(true);
    expect(exportTypeScript(policy)).toContain("provider");
    expect(exportTypeScript(policy)).toContain("distinctTaskBucketId");
    expect(policy.script_automation_recommendations.length).toBeGreaterThan(0);
  });
  it("surfaces scriptable tool-call signature clusters", () => {
    const recommendations = recommendScriptAutomation(traces);
    const stable = recommendations.find((recommendation) => recommendation.cluster_name.includes("Order Api"));
    expect(stable).toBeTruthy();
    expect(stable?.instance_count).toBeGreaterThanOrEqual(3);
    expect(stable?.pattern_match_pct).toBeGreaterThan(90);
    expect(stable?.example_sequence.map((step) => step.tool_name)).toEqual(["order_api", "shipping_calculator"]);
    expect(stable?.variation.branch_variation_pct).toBe(0);
    expect(stable?.variation.outcome_variation_pct).toBe(0);
    expect(stable?.projected_monthly_savings_usd).toBeGreaterThan(0);
    expect(stable?.script_stub).toContain("tools.order_api");
  });
  it("can constrain recommendations to one model candidate", () => {
    const policy = recommendPolicy(traces, distinctTaskBuckets, ["gemini-3-flash"]);
    expect(policy.candidate_model_ids).toEqual(["gemini-3-flash"]);
    expect(policy.rules.every((rule) => rule.strategy.type === "keep_current" || rule.strategy.type === "direct" && rule.strategy.model === "gemini-3-flash" || rule.strategy.type === "cascade" && rule.strategy.primary_model === "gemini-3-flash")).toBe(true);
  });
  it("catalog contains top, mid, and cheapest options for major families", () => {
    for (const family of ["OpenAI", "Claude", "Gemini", "Mistral"]) {
      const familyModels = modelCatalog.filter((model) => model.family === family);
      expect(familyModels.map((model) => model.family_tier).sort()).toEqual(["cheapest", "mid", "top"]);
    }
    expect(modelCatalog).toHaveLength(15);
  });
  it("supports configurable Local Qwen serving costs", () => {
    const local = getModel("local-qwen-14b")!;
    const original = { input: local.input_cost_per_1m, output: local.output_cost_per_1m };
    updateModelPricing(local.id, .2, .8);
    expect(calculateCost(1_000_000, 1_000_000, local)).toBe(1);
    expect(replay(traces.slice(0, 1), local.id).summary.simulated_cost_usd).toBeGreaterThan(0);
    updateModelPricing(local.id, original.input, original.output);
  });
  it("uses edited prices in simulation cost calculations", () => {
    const model = getModel("gemini-3-flash")!;
    const original = { input: model.input_cost_per_1m, output: model.output_cost_per_1m };
    const before = replay(traces.slice(0, 2), model.id).summary.simulated_cost_usd;
    updateModelPricing(model.id, original.input * 10, original.output * 10);
    const after = replay(traces.slice(0, 2), model.id).summary.simulated_cost_usd;
    expect(after).toBeCloseTo(before * 10);
    updateModelPricing(model.id, original.input, original.output);
  });
  it("can disable individual models and families for simulations and recommendations", () => {
    const originalEnabled = new Map(modelCatalog.map((model) => [model.id, model.enabled]));
    updateModelEnabled("mistral-small-3.2", false);
    const cascadeResult = familyCascade(traces.slice(0, 8), "mistral-large-3");
    expect(cascadeResult.runs.every((run) => run.candidate_model !== "mistral-small-3.2")).toBe(true);
    updateFamilyEnabled("Gemini", false);
    expect(enabledModels().some((model) => model.family === "Gemini")).toBe(false);
    const candidates = enabledModels().map((model) => model.id);
    const policy = recommendPolicy(traces, distinctTaskBuckets, candidates);
    expect(policy.candidate_model_ids.some((id) => id.startsWith("gemini"))).toBe(false);
    for (const model of modelCatalog) model.enabled = originalEnabled.get(model.id);
  });
  it("uses family keys before falling back to OpenRouter for live simulation", () => {
    expect(liveRoutingStatus("deepseek-r1", { familyApiKeys: {}, gatewayApiKeys: { OpenRouter: "sk-or-test" } })).toMatchObject({ source: "openrouter", label: "OpenRouter" });
    expect(liveRoutingStatus("deepseek-r1", { familyApiKeys: { DeepSeek: "sk-deepseek-test" }, gatewayApiKeys: { OpenRouter: "sk-or-test" } })).toMatchObject({ source: "direct_family", label: "DeepSeek" });
    expect(liveRoutingStatus("gemini-2.5-flash-lite", { familyApiKeys: {}, gatewayApiKeys: {}, serverGatewayKeys: { OpenRouter: true } })).toMatchObject({ source: "openrouter", label: "OpenRouter" });
    expect(liveRoutingStatus("claude-sonnet-4.8", { familyApiKeys: { Claude: "sk-claude-test" }, gatewayApiKeys: { OpenRouter: "sk-or-test" } })).toMatchObject({ source: "openrouter", label: "OpenRouter" });
    expect(liveRoutingStatus("claude-sonnet-4.8", { familyApiKeys: { Claude: "sk-claude-test" }, gatewayApiKeys: {} })).toMatchObject({ source: "direct_family", label: "Claude" });
    expect(liveRoutingStatus("deepseek-r1", { familyApiKeys: {}, gatewayApiKeys: {} })).toBeUndefined();
  });
});
