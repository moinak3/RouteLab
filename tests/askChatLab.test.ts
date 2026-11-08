import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { askRouteLabFollowUps, parseAskChatLabCommand, resolveModel, resolveTaskGroup, selectSimulationTraces, validateAskRouteLabPlan, workspaceCoverageSummary, workspaceMetricDashboard, workspaceMetricSummary } from "../src/core/askChatLab";
import { AskRouteLabOpenUI, askRouteLabOpenUILibrary } from "../src/components/AskRouteLabOpenUI";
import { askRouteLabOpenUISpec, fallbackAskRouteLabOpenUI } from "../src/core/askRouteLabOpenUISpec";
import { generateAskRouteLabOpenUI, planAskRouteLab, validateAskRouteLabOpenUI } from "../src/server/askRouteLab";
import { sanitizeAskRouteLabTelemetryEvent, traceAskRouteLabOperation } from "../src/server/askRouteLabTelemetry";
import type { DistinctTaskBucket, Model, Trace, TraceJudgeResult } from "../src/types";

const traces = Array.from({ length: 10 }, (_, index): Trace => ({
  id: `trace_${index}`,
  timestamp: "2026-10-30T12:00:00.000Z",
  model: "current",
  messages: [],
  prompt_text: `Prompt ${index}`,
  response_text: `Response ${index}`,
  input_tokens: 10,
  output_tokens: 5,
  total_tokens: 15,
  latency_ms: 100,
  cost_usd: 0.01,
  status: "success",
}));

const group: DistinctTaskBucket = {
  bucket_id: "finance",
  bucket_name: "Financial Savings Analysis",
  task: { task_type: "data_analysis_insight_generation", domain: "finance", complexity: "medium", temporal_context: "single_turn", tool_use: "none", output_uncertainty: "low", output_format: "natural_language", grounding_requirement: "none" },
  traces: traces.map((trace) => trace.id),
  trace_count: traces.length,
  total_cost_usd: 0.1,
  avg_cost_usd: 0.01,
  total_tokens: 150,
  avg_input_tokens: 10,
  avg_output_tokens: 5,
  avg_latency_ms: 100,
  avg_confidence: 0.9,
  low_confidence_count: 0,
  risk_level: "medium",
  customer_facing: true,
  evidence: { task_type: [], domain: [], complexity: [], temporal_context: [], tool_use: [], output_uncertainty: [], output_format: [], grounding_requirement: [] },
  examples: [],
};

const model: Model = {
  id: "openrouter:anthropic/claude-opus-5.5",
  provider: "Anthropic",
  display_name: "Anthropic Opus 5.5",
  input_cost_per_1m: 1,
  output_cost_per_1m: 2,
  default_latency_ms: 500,
  deployment_type: "api",
  pricing_source_model_id: "anthropic/claude-opus-5.5",
  quality_tier: "strong",
  family: "Claude",
  family_tier: "top",
};

describe("AskChatLab", () => {
  it("sanitizes the final Braintrust interaction event", () => {
    const event = sanitizeAskRouteLabTelemetryEvent({
      interactionId: "interaction-1",
      parent: "parent-context",
      question: "What changed?",
      workspace: "RouteLab demo",
      status: "completed",
      planKind: "metrics",
      planner: "llm",
      output: { text: "A grounded answer", facts: ["fact one"], action: "Open Overview", openui: "root = Dashboard([])" },
    });
    expect(event).toMatchObject({
      interactionId: "interaction-1",
      question: "What changed?",
      workspace: "RouteLab demo",
      status: "completed",
      planKind: "metrics",
      output: { text: "A grounded answer", facts: ["fact one"], action: "Open Overview" },
    });
  });

  it("keeps Ask RouteLab working when Braintrust is not configured", async () => {
    const previous = process.env.BRAINTRUST_API_KEY;
    delete process.env.BRAINTRUST_API_KEY;
    try {
      const result = await traceAskRouteLabOperation({ name: "test", input: { question: "hello" } }, async (span) => {
        expect(span).toBeUndefined();
        return { answer: "world" };
      });
      expect(result).toEqual({ value: { answer: "world" }, parent: undefined, enabled: false });
    } finally {
      if (previous === undefined) delete process.env.BRAINTRUST_API_KEY;
      else process.env.BRAINTRUST_API_KEY = previous;
    }
  });

  it("parses a live simulation request", () => {
    expect(parseAskChatLabCommand("Run 10% of traces for task group Financial Savings Analysis through Claude Opus 5.5 and give me the results")).toEqual({
      kind: "simulate",
      taskGroupQuery: "Financial Savings Analysis",
      modelQuery: "Claude Opus 5.5",
      sampleMode: "percent",
      sampleValue: 10,
    });
  });

  it("recognizes metrics and unsupported-coverage questions", () => {
    expect(parseAskChatLabCommand("What's new with my metrics?")).toEqual({ kind: "metrics" });
    expect(parseAskChatLabCommand("How many requests have been classified by my classifier?")).toEqual({ kind: "classifier_metrics" });
    expect(parseAskChatLabCommand("Is my classifier live?")).toEqual({ kind: "classifier_metrics" });
    expect(parseAskChatLabCommand("Are any of the task groups performing worse than average?")).toEqual({ kind: "task_group_quality_comparison" });
    expect(parseAskChatLabCommand("What conversations didn't have support for natively?")).toEqual({ kind: "coverage" });
    expect(parseAskChatLabCommand("Graph quality and latency")).toEqual({ kind: "metrics" });
    expect(parseAskChatLabCommand("Catch me up")).toEqual({ kind: "metrics" });
    expect(parseAskChatLabCommand("Give me an overview of what's going on and what I need to pay attention to")).toEqual({ kind: "metrics" });
  });

  it("suggests grounded next steps from the completed operation", () => {
    expect(askRouteLabFollowUps("metrics")).toEqual([
      "Open the review queue",
      "Are any Task Groups performing worse than average?",
    ]);
    expect(askRouteLabFollowUps("coverage")).toEqual([
      "Catch me up",
      "Are any Task Groups performing worse than average?",
    ]);
    expect(askRouteLabFollowUps("metrics")).toHaveLength(2);
  });

  it("resolves workspace task groups and model aliases", () => {
    expect(resolveTaskGroup("financial savings", [group])?.bucket_id).toBe("finance");
    expect(resolveModel("Claude Opus 5.5", [model])?.id).toBe(model.id);
  });

  it("accepts only allowlisted LLM operations and exact catalog IDs", () => {
    const taskGroups = [{ id: group.bucket_id, name: group.bucket_name }];
    const models = [{ id: model.id, name: model.display_name }];
    expect(validateAskRouteLabPlan({
      kind: "simulate",
      taskGroupId: group.bucket_id,
      candidateId: model.id,
      sampleMode: "percent",
      sampleValue: 250,
      rationale: "The user requested a live comparison.",
    }, taskGroups, models)).toMatchObject({ sampleValue: 100 });
    expect(validateAskRouteLabPlan({
      kind: "simulate",
      taskGroupId: "invented",
      candidateId: model.id,
      sampleMode: "count",
      sampleValue: 10,
      rationale: "Invented target.",
    }, taskGroups, models)).toBeUndefined();
  });

  it("uses a structured LLM response to plan an allowlisted action", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        kind: "simulate",
        destination: null,
        taskGroupId: group.bucket_id,
        candidateId: model.id,
        sampleMode: "percent",
        sampleValue: 10,
        rationale: "Run the requested sample through the requested model.",
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    const result = await planAskRouteLab({
      message: "Run ten percent of finance through Opus",
      taskGroups: [{ id: group.bucket_id, name: group.bucket_name }],
      models: [{ id: model.id, name: model.display_name }],
      key: "test-key",
      model: "test/planner",
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.planner).toEqual({ type: "llm", model: "test/planner" });
    expect(result.plan).toMatchObject({
      kind: "simulate",
      taskGroupId: group.bucket_id,
      candidateId: model.id,
      sampleValue: 10,
    });
  });

  it("plans classifier counts as classifier metrics instead of workspace metrics", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        kind: "classifier_metrics",
        destination: null,
        taskGroupId: null,
        candidateId: null,
        sampleMode: null,
        sampleValue: null,
        rationale: "The user asked how many requests the classifier processed.",
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    const result = await planAskRouteLab({
      message: "How many requests have been classified by my classifier?",
      taskGroups: [],
      models: [],
      key: "test-key",
      model: "test/planner",
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.plan.kind).toBe("classifier_metrics");
  });

  it("plans below-average Task Group questions as a deterministic comparison", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        kind: "task_group_quality_comparison",
        destination: null,
        taskGroupId: null,
        candidateId: null,
        sampleMode: null,
        sampleValue: null,
        rationale: "The user asked which Task Groups are below the workspace average.",
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    const result = await planAskRouteLab({
      message: "Are any Task Groups performing worse than average?",
      taskGroups: [],
      models: [],
      key: "test-key",
      model: "test/planner",
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.plan.kind).toBe("task_group_quality_comparison");
  });

  it("accepts only allowlisted OpenUI metric dashboards with a chart", () => {
    const valid = 'root = Dashboard([summary, chart])\nsummary = Summary("overview")\nchart = TrendChart("requests", "line")';
    expect(validateAskRouteLabOpenUI(valid)).toBe(valid);
    expect(validateAskRouteLabOpenUI('root = Dashboard([text])\ntext = TextContent("invented")')).toBeUndefined();
    expect(validateAskRouteLabOpenUI('root = Dashboard([summary])\nsummary = Summary("overview")')).toBeUndefined();
    expect(validateAskRouteLabOpenUI('root = Dashboard([comparison])\ncomparison = QualityComparison()')).toBe('root = Dashboard([comparison])\ncomparison = QualityComparison()');
  });

  it("uses the OpenUI prompt to generate a grounded dashboard program", async () => {
    const openui = 'root = Dashboard([summary, cost, chart])\nsummary = Summary("cost")\ncost = MetricCard("cost")\nchart = TaskGroupChart("cost")';
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}"));
      expect(request.messages[0].content).toContain("openui-lang");
      return new Response(JSON.stringify({ choices: [{ message: { content: openui } }] }), { status: 200 });
    };
    const result = await generateAskRouteLabOpenUI({
      question: "Where is cost concentrated?",
      hasQuality: true,
      weeklyPoints: 8,
      taskGroupCount: 3,
      key: "test-key",
      model: "test/planner",
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result).toEqual({ openui, renderer: "openui", model: "test/planner" });
  });

  it("keeps the server prompt contract aligned with the rendered OpenUI library", () => {
    expect(askRouteLabOpenUILibrary.toSpec().components).toEqual(askRouteLabOpenUISpec.components);
  });

  it("counts only traces with recorded classifier decisions as processed", () => {
    const decision = {
      provider: "jev" as const,
      model: "classifier",
      signature_id: group.bucket_id,
      signature_label: group.bucket_name,
      confidence: 0.94,
      probabilities: { [group.bucket_id]: 0.94 },
      status: "matched" as const,
      routing_action: "signature_route" as const,
      confidence_threshold: 0.8,
      latency_ms: 45,
      reason: "Matched",
    };
    const classifierTraces = traces.map((trace, index) => index < 2 ? { ...trace, signature_decision: decision } : trace);
    const data = workspaceMetricDashboard(classifierTraces, [group], [], undefined, true);
    const response = fallbackAskRouteLabOpenUI("How many requests did my classifier process?", false);
    const html = renderToStaticMarkup(createElement(AskRouteLabOpenUI, { response, data }));
    expect(data.summary.totalTraces).toBe(10);
    expect(data.summary.classifiedRequests).toBe(2);
    expect(html).toContain("processed 2 of 10 workspace traces");
    expect(html).toContain("Classifier requests");
    expect(html).toContain("2 of 10 workspace traces");
  });

  it("renders a grounded operational overview with seven-day metrics and calibration follow-ups", () => {
    const decision = {
      provider: "jev" as const,
      model: "classifier",
      signature_id: group.bucket_id,
      signature_label: group.bucket_name,
      confidence: 0.94,
      probabilities: { [group.bucket_id]: 0.94 },
      status: "matched" as const,
      routing_action: "signature_route" as const,
      confidence_threshold: 0.8,
      latency_ms: 45,
      reason: "Matched",
    };
    const classifierTraces = traces.map((trace, index) => index < 2 ? { ...trace, signature_decision: { ...decision, latency_ms: index ? 55 : 45 } } : trace);
    const result: TraceJudgeResult = {
      id: "judge_0",
      trace_id: "trace_0",
      evaluator_type: "trace_quality_llm_judge",
      created_at: traces[0].timestamp,
      score: 0.8,
      passed: true,
      rationale: "Complete",
    };
    const data = workspaceMetricDashboard(classifierTraces, [group], [result], undefined, true, {
      conversationsToReview: 3,
      classifierCalibration: { needsAttention: false, label: "Classifier calibrated", detail: "Latest round agrees with human truth.", reviewedExamples: 20 },
      judgeCalibration: { needsAttention: true, label: "Judge follow-up needed", detail: "One human and judge verdict differs.", reviewedExamples: 20 },
    });
    const response = fallbackAskRouteLabOpenUI("Give me an overview of what's going on and what I need to pay attention to", true);
    const html = renderToStaticMarkup(createElement(AskRouteLabOpenUI, { response, data }));
    expect(response).toContain("ClassifierStatus()");
    expect(response).toContain("SevenDayMetrics()");
    expect(response).toContain("AttentionSummary()");
    expect(data.summary.classifierP50LatencyMs).toBe(45);
    expect(data.summary.recentTraces).toBe(10);
    expect(data.summary.recentCostUsd).toBeCloseTo(0.1);
    expect(data.summary.recentAverageQuality).toBe(0.8);
    expect(html).toContain("P50 added latency");
    expect(html).toContain("45ms");
    expect(html).toContain("3 conversations to review");
    expect(html).toContain("Classifier calibrated");
    expect(html).toContain("Judge follow-up needed");
  });

  it("treats Catch me up as the complete operational overview", () => {
    const response = fallbackAskRouteLabOpenUI("Catch me up", true);
    expect(response).toContain('Summary("overview")');
    expect(response).toContain("ClassifierStatus()");
    expect(response).toContain("SevenDayMetrics()");
    expect(response).toContain("AttentionSummary()");
    expect(response).toContain('TrendChart("requests", "line")');
  });

  it("computes and renders Task Groups below the scored workspace average", () => {
    const stronger = { ...group, bucket_id: "strong", bucket_name: "Strong Group", traces: traces.slice(0, 5).map((trace) => trace.id), trace_count: 5 };
    const weaker = { ...group, bucket_id: "weak", bucket_name: "Weak Group", traces: traces.slice(5).map((trace) => trace.id), trace_count: 5 };
    const results = traces.map((trace, index): TraceJudgeResult => ({
      id: `result_${index}`,
      trace_id: trace.id,
      evaluator_type: "trace_quality_llm_judge",
      score: index < 5 ? 1 : 0.6,
      passed: index < 5,
      rationale: index < 5 ? "Strong" : "Needs work",
      created_at: trace.timestamp,
    }));
    const data = workspaceMetricDashboard(traces, [stronger, weaker], results);
    const response = fallbackAskRouteLabOpenUI("Are any Task Groups performing worse than average?", true);
    const html = renderToStaticMarkup(createElement(AskRouteLabOpenUI, { response, data }));
    expect(data.qualityComparison.workspaceAverage).toBeCloseTo(0.8);
    expect(data.qualityComparison.scoredTaskGroupCount).toBe(2);
    expect(data.qualityComparison.belowAverage).toHaveLength(1);
    expect(data.qualityComparison.belowAverage[0]).toMatchObject({ label: "Weak Group", quality: 0.6, scoredTraces: 5 });
    expect(data.qualityComparison.belowAverage[0].gapFromAverage).toBeCloseTo(-0.2);
    expect(html).toContain("Weak Group");
    expect(html).toContain("60.0%");
    expect(html).toContain("-20.0 pts");
  });

  it("selects the requested percent without exceeding the group", () => {
    expect(selectSimulationTraces(traces, group, "percent", 10).selected).toHaveLength(1);
    expect(selectSimulationTraces(traces, group, "percent", 100).selected).toHaveLength(10);
    expect(selectSimulationTraces(traces, group, "count", 20).selected).toHaveLength(10);
  });

  it("keeps classifier and eval coverage gaps separate", () => {
    const partiallyGrouped = { ...group, traces: group.traces.slice(0, 5) };
    const summary = workspaceCoverageSummary(traces, [partiallyGrouped], [], { id: "eval", version: 1 });
    expect(summary.classifierGaps).toHaveLength(5);
    expect(summary.evalGaps).toHaveLength(10);
    expect(summary.topReasons[0]).toEqual(["No Task Group assignment", 5]);
  });

  it("includes legacy unversioned demo scores in the active-eval summary", () => {
    const result: TraceJudgeResult = {
      id: "judge_0",
      trace_id: "trace_0",
      evaluator_type: "trace_quality_llm_judge",
      created_at: traces[0].timestamp,
      score: 0.8,
      passed: true,
      rationale: "Complete",
    };
    const summary = workspaceMetricSummary(traces, [result], { id: "active_eval", version: 2 });
    expect(summary.scored).toBe(1);
    expect(summary.averageScore).toBe(0.8);
  });

  it("renders deterministic RouteLab data through the OpenUI renderer", () => {
    const result: TraceJudgeResult = {
      id: "judge_0",
      trace_id: "trace_0",
      evaluator_type: "trace_quality_llm_judge",
      created_at: traces[0].timestamp,
      score: 0.8,
      passed: true,
      rationale: "Complete",
    };
    const data = workspaceMetricDashboard(traces, [group], [result], { id: "eval", version: 1 });
    const response = fallbackAskRouteLabOpenUI("Show quality", true);
    const html = renderToStaticMarkup(createElement(AskRouteLabOpenUI, { response, data }));
    expect(html).toContain('data-renderer="openui"');
    expect(html).toContain("80.0%");
    expect(html).toContain("Average quality by Task Group");
    expect(data.weekly).toHaveLength(8);
  });
});
