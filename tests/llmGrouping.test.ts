import { describe, expect, it, vi } from "vitest";
import { LLMGroupingConfigurationError, LLMGroupingProviderError, runLLMGrouping } from "../api/llm-grouping/_runner";
import { parseStoredLLMGroupingRun } from "../api/llm-grouping/_store";
import {
  LLM_GROUPING_PROMPT_VERSION,
  LLM_GROUPING_SCHEMA_VERSION,
  compareLLMGrouping,
  createLLMGroupingInputSnapshot,
  createLLMGroupingSnapshot,
  isLLMGroupingRunOutdated,
  prepareLLMGroupingTrace,
  stableLLMGroupId,
  validateLLMGroupingRun,
  validateLLMGroupingTraceInputs,
  type LLMGroupingRun,
  type LLMGroupingTraceInput,
  type LLMTaskGroup,
} from "../src/core/llmGrouping";
import type { DistinctTaskBucket, Trace } from "../src/types";

const trace = (id: string, prompt = `Request ${id}`): Trace => ({
  id,
  timestamp: "2026-10-25T12:00:00.000Z",
  provider: "OpenRouter",
  model: "private-model",
  messages: [
    { role: "system", content: "Use the support policy." },
    { role: "user", content: prompt },
    { role: "assistant", content: `Private response ${id}` },
  ],
  prompt_text: prompt,
  response_text: `Private response ${id}`,
  input_tokens: 100,
  output_tokens: 20,
  total_tokens: 120,
  latency_ms: 900,
  cost_usd: 0.2,
  status: "success",
  workflow_id: "support",
  metadata: {
    operation: "resolve_ticket",
    available_tools: ["lookup_order", "issue_refund"],
    task_type: "existing-secret-label",
    score: 0.99,
    response: "must never be sent",
  },
  signature_decision: {
    provider: "jev",
    model: "classifier",
    signature_id: "secret",
    signature_label: "secret label",
    confidence: 1,
    probabilities: { secret: 1 },
    status: "matched",
    routing_action: "signature_route",
    confidence_threshold: 0.8,
    latency_ms: 10,
    reason: "existing classification",
  },
});

const group = (key: string, name: string): LLMTaskGroup => {
  const seed = {
    name,
    description: `${name} requests`,
    inclusionCriteria: [`Needs ${name}`],
    exclusionCriteria: [`Does not need ${name}`],
  };
  return {
    id: stableLLMGroupId(seed),
    ...seed,
    representativeTraceIds: [],
    confusingCounterexamples: [],
    nearestNeighbors: [],
    attributes: { modality: ["text"], grounding: ["policy"], expectedOutput: ["answer"], reasoningRequirements: ["lookup"] },
    suggestedEvaluationDimensions: ["policy compliance"],
    routingRationale: `${key} has a distinct routing profile.`,
  };
};

function fixtureRun(ids = ["t1", "t2"]): LLMGroupingRun {
  const inputs = ids.map((traceId) => ({ traceId, latestRequest: traceId, requestContext: [{ role: "user" as const, content: traceId }], workflowContext: {} }));
  const alpha = group("alpha", "Order lookup");
  const beta = group("beta", "Refund decision");
  const assignments = ids.map((traceId, index) => ({
    traceId,
    status: "assigned" as const,
    groupId: index % 2 ? beta.id : alpha.id,
    confidence: 0.9,
    alternateGroupIds: [],
    rationale: "The immediate job matches this definition.",
  }));
  return {
    schemaVersion: LLM_GROUPING_SCHEMA_VERSION,
    runId: "llm_grouping_fixture",
    provider: "OpenRouter",
    model: "test/model",
    promptVersion: LLM_GROUPING_PROMPT_VERSION,
    startedAt: "2026-10-25T12:00:00.000Z",
    completedAt: "2026-10-25T12:01:00.000Z",
    snapshot: createLLMGroupingInputSnapshot(inputs),
    method: { discoverySampling: "none", discoveryTraceCount: ids.length, assignmentTraceCount: ids.length, batchSize: 24, metadataFieldsUsed: [], excludedFields: [] },
    groups: [alpha, beta],
    assignments,
    coverage: { assigned: ids.length, ambiguous: 0, unassigned: 0, processed: ids.length, total: ids.length },
  };
}

describe("LLM grouping input boundary", () => {
  it("only serializes pre-inference request context and whitelisted metadata", () => {
    const prepared = prepareLLMGroupingTrace(trace("t1", "Where is order 42?"));
    const serialized = JSON.stringify(prepared);
    expect(prepared.latestRequest).toBe("Where is order 42?");
    expect(prepared.requestContext.at(-1)?.role).toBe("user");
    expect(prepared.workflowContext).toEqual({ workflow_id: "support", operation: "resolve_ticket", available_tools: ["lookup_order", "issue_refund"] });
    for (const secret of ["Private response", "private-model", "existing-secret-label", "signature_decision", "cost_usd", "latency_ms", "score"]) expect(serialized).not.toContain(secret);
  });

  it("rejects extra top-level, message, and workflow fields", () => {
    const unsafe = {
      traceId: "t1",
      latestRequest: "hello",
      requestContext: [{ role: "user", content: "hello", score: 1 }],
      workflowContext: { response: "leak" },
      model: "leak",
    };
    expect(validateLLMGroupingTraceInputs([unsafe])).toEqual(expect.arrayContaining([
      expect.stringContaining("unsupported field model"),
      expect.stringContaining("unsupported field score"),
      expect.stringContaining("unsupported workflow field response"),
    ]));
  });
});

describe("LLM grouping validation and persistence", () => {
  it("round-trips a complete valid run", () => {
    const run = fixtureRun();
    expect(validateLLMGroupingRun(run, run.snapshot.traceIds)).toEqual([]);
    expect(parseStoredLLMGroupingRun(JSON.parse(JSON.stringify(run)))).toEqual(run);
  });

  it("rejects missing, duplicate, ambiguous, and nonexistent references", () => {
    const missing = fixtureRun();
    missing.assignments.pop();
    expect(validateLLMGroupingRun(missing, missing.snapshot.traceIds).join(" ")).toContain("Missing assignment");

    const duplicate = fixtureRun();
    duplicate.assignments.push({ ...duplicate.assignments[0] });
    expect(validateLLMGroupingRun(duplicate, duplicate.snapshot.traceIds).join(" ")).toContain("Duplicate assignment");

    const ambiguous = fixtureRun();
    ambiguous.assignments[0].status = "ambiguous";
    expect(validateLLMGroupingRun(ambiguous, ambiguous.snapshot.traceIds).join(" ")).toContain("must not force a primary group");

    const badReference = fixtureRun();
    badReference.groups[0].representativeTraceIds = ["does-not-exist"];
    expect(validateLLMGroupingRun(badReference, badReference.snapshot.traceIds).join(" ")).toContain("nonexistent trace");
  });

  it("marks a saved run stale when the sanitized trace population changes", () => {
    const traces = [trace("t1"), trace("t2")];
    const run = fixtureRun(["t1", "t2"]);
    run.snapshot = createLLMGroupingSnapshot(traces);
    expect(isLLMGroupingRunOutdated(run, traces)).toBe(false);
    expect(isLLMGroupingRunOutdated(run, [trace("t1", "changed"), trace("t2")])).toBe(true);
  });
});

describe("LLM grouping comparison", () => {
  it("computes overlap cells, splits, merges, and trace rows", () => {
    const run = fixtureRun(["t1", "t2", "t3", "t4"]);
    const bucket = (id: string, ids: string[]): DistinctTaskBucket => ({
      bucket_id: id, bucket_name: id, traces: ids, trace_count: ids.length,
      task: { task_type: "question_answering", domain: "general", complexity: "low", temporal_context: "single_turn", tool_use: "none", output_uncertainty: "low", output_format: "natural_language", grounding_requirement: "none" },
      total_cost_usd: 0, avg_cost_usd: 0, total_tokens: 0, avg_input_tokens: 0, avg_output_tokens: 0,
      avg_confidence: 1, low_confidence_count: 0, risk_level: "low", customer_facing: false,
      evidence: { task_type: [], domain: [], complexity: [], temporal_context: [], tool_use: [], output_uncertainty: [], output_format: [], grounding_requirement: [] }, examples: [],
    });
    const comparison = compareLLMGrouping([bucket("existing-a", ["t1", "t2"]), bucket("existing-b", ["t3", "t4"])], run);
    expect(comparison.cells).toHaveLength(4);
    expect(comparison.splits).toHaveLength(2);
    expect(comparison.merges).toHaveLength(2);
    expect(comparison.rows).toHaveLength(4);
  });
});

describe("LLM grouping provider pipeline", () => {
  const inputs: LLMGroupingTraceInput[] = [
    { traceId: "t1", latestRequest: "Find my order", requestContext: [{ role: "user", content: "Find my order" }], workflowContext: { available_tools: ["lookup_order"] } },
    { traceId: "t2", latestRequest: "Can I get a refund?", requestContext: [{ role: "user", content: "Can I get a refund?" }], workflowContext: { available_tools: ["issue_refund"] } },
  ];

  it("runs all stages with deterministic mocked structured responses", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { response_format: { json_schema: { name: string } } };
      const name = request.response_format.json_schema.name;
      calls.push(name);
      const payload = name === "task_descriptions" ? { descriptions: [
        { traceId: "t1", immediateJob: "Look up an order", modality: ["text"], grounding: ["tool"], expectedOutput: ["status"], reasoningRequirements: ["lookup"], clarity: "clear", ambiguityReason: "" },
        { traceId: "t2", immediateJob: "Decide refund eligibility", modality: ["text"], grounding: ["policy"], expectedOutput: ["decision"], reasoningRequirements: ["policy reasoning"], clarity: "clear", ambiguityReason: "" },
      ] } : name === "task_catalog" ? { groups: [
        { groupKey: "order", name: "Order lookup", description: "Retrieve order status", inclusionCriteria: ["asks for order status"], exclusionCriteria: ["refund decision"], candidateTraceIds: ["t1"], attributes: { modality: ["text"], grounding: ["tool"], expectedOutput: ["status"], reasoningRequirements: ["lookup"] }, suggestedEvaluationDimensions: ["tool correctness"], routingRationale: "Can use a fast tool-capable model" },
        { groupKey: "refund", name: "Refund decision", description: "Apply refund policy", inclusionCriteria: ["asks for refund"], exclusionCriteria: ["status only"], candidateTraceIds: ["t2"], attributes: { modality: ["text"], grounding: ["policy"], expectedOutput: ["decision"], reasoningRequirements: ["policy reasoning"] }, suggestedEvaluationDimensions: ["policy compliance"], routingRationale: "Needs reliable policy reasoning" },
      ] } : name === "task_assignments" ? { assignments: [
        { traceId: "t1", status: "assigned", groupKey: "order", confidence: 0.95, alternateGroupKeys: [], rationale: "Order lookup request" },
        { traceId: "t2", status: "assigned", groupKey: "refund", confidence: 0.93, alternateGroupKeys: [], rationale: "Refund policy request" },
      ] } : { groups: [
        { groupKey: "order", representativeTraceIds: ["t1"], confusingCounterexamples: [{ traceId: "t2", explanation: "Requires a policy decision instead of a status lookup" }], nearestNeighbors: [{ groupKey: "refund", distinction: "Retrieval versus policy decision" }] },
        { groupKey: "refund", representativeTraceIds: ["t2"], confusingCounterexamples: [{ traceId: "t1", explanation: "Only retrieves current status" }], nearestNeighbors: [{ groupKey: "order", distinction: "Policy decision versus retrieval" }] },
      ] };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const progress = vi.fn();
    const run = await runLLMGrouping({ inputs, snapshot: createLLMGroupingInputSnapshot(inputs), apiKey: "test-key", model: "test/model", fetchImpl, onProgress: progress, now: () => new Date("2026-10-25T12:00:00.000Z") });
    expect(calls).toEqual(["task_descriptions", "task_catalog", "task_catalog", "task_assignments", "task_boundary_evidence"]);
    expect(run.coverage).toEqual({ assigned: 2, ambiguous: 0, unassigned: 0, processed: 2, total: 2 });
    expect(run.groups.map((item) => item.name)).toEqual(["Order lookup", "Refund decision"]);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: "assignment", completed: 2, total: 2 }));
  });

  it("fails clearly for missing credentials and provider errors", async () => {
    await expect(runLLMGrouping({ inputs, snapshot: createLLMGroupingInputSnapshot(inputs), apiKey: "", model: "test/model" })).rejects.toBeInstanceOf(LLMGroupingConfigurationError);
    const failedFetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: "provider unavailable" } }), { status: 503 })) as typeof fetch;
    await expect(runLLMGrouping({ inputs, snapshot: createLLMGroupingInputSnapshot(inputs), apiKey: "key", model: "test/model", fetchImpl: failedFetch })).rejects.toBeInstanceOf(LLMGroupingProviderError);
  });

  it("aborts an in-flight provider request when the run is cancelled", async () => {
    const controller = new AbortController();
    const waitingFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")), { once: true });
    })) as typeof fetch;
    const pending = runLLMGrouping({ inputs, snapshot: createLLMGroupingInputSnapshot(inputs), apiKey: "key", model: "test/model", fetchImpl: waitingFetch, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
