import { describe, expect, it, vi } from "vitest";
import { runTaskGroupNaming } from "../src/server/taskGroupNames";
import { createDistinctTaskSeedTraces } from "../src/core/distinctTaskSeed";
import { createDistinctTaskBuckets } from "../src/core/distinctTasks";
import { applyTaskGroupNames, prepareTaskGroupNamingInput, validateTaskGroupNames } from "../src/core/taskGroupNaming";
import { resolveAutomaticTaskGroupNames } from "../src/core/taskGroupDisplayNames";

const groups = createDistinctTaskBuckets(createDistinctTaskSeedTraces()).slice(0, 2);

describe("task group naming", () => {
  it("sends only naming-safe summaries without grounding or responses", () => {
    const input = prepareTaskGroupNamingInput(groups);
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("grounding_requirement");
    expect(serialized).not.toContain("response_preview");
    expect(serialized).not.toContain(groups[0].examples[0].response_preview);
    expect(input[0].representativeRequests.length).toBeGreaterThan(0);
  });

  it("applies exact unique names without changing membership", () => {
    const names = groups.map((group, index) => ({ bucketId: group.bucket_id, name: index ? "Structured Field Extraction" : "Ticket Handoff Summaries" }));
    const named = applyTaskGroupNames(groups, names);
    expect(named.map((group) => group.bucket_name)).toEqual(names.map((item) => item.name));
    expect(named.map((group) => group.traces)).toEqual(groups.map((group) => group.traces));
    expect(named.every((group) => group.name_source === "llm")).toBe(true);
  });

  it("rejects missing or verbose names and resolves duplicate summaries", () => {
    const input = prepareTaskGroupNamingInput(groups);
    expect(() => validateTaskGroupNames(input, [{ bucketId: groups[0].bucket_id, name: "Ticket Summaries" }])).toThrow(/exactly one/i);
    const deduplicated = validateTaskGroupNames(input, groups.map((group) => ({ bucketId: group.bucket_id, name: "Duplicate Name" })));
    expect(new Set(deduplicated.map((item) => item.name.toLowerCase())).size).toBe(groups.length);
    expect(deduplicated.every((item) => item.name.split(/\s+/).length <= 4)).toBe(true);
    expect(() => validateTaskGroupNames(input, groups.map((group, index) => ({ bucketId: group.bucket_id, name: index ? "A Name With Far Too Many Words To Ever Accept Here" : "Ticket Summaries" })))).toThrow(/2 and 6 words/i);
    expect(() => validateTaskGroupNames(input, groups.map((group, index) => ({ bucketId: group.bucket_id, name: index ? "Billing, High Complexity" : "Ticket Summaries" })))).toThrow(/plain, concise/i);
  });

  it("replaces numbered collisions with semantic qualifiers", () => {
    const factors = {
      task_type: "planning_strategy_recommendations" as const,
      complexity: "medium" as const,
      temporal_context: "single_turn" as const,
      tool_use: "none" as const,
      output_format: "natural_language" as const,
    };
    const names = resolveAutomaticTaskGroupNames([
      { id: "general", name: "Strategic Planning", factors: { ...factors, domain: "general" } },
      { id: "operations", name: "Strategic Planning 2", factors: { ...factors, domain: "operations" } },
      { id: "finance", name: "Strategic Planning 3", factors: { ...factors, domain: "finance" } },
    ]);

    expect(names).toEqual([
      { id: "general", name: "Strategic Planning (general)" },
      { id: "operations", name: "Strategic Planning (operations)" },
      { id: "finance", name: "Strategic Planning (finance)" },
    ]);
    expect(names.every((item) => !/\s\d+$/.test(item.name))).toBe(true);
  });

  it("uses additional true factors when colliding groups share a domain", () => {
    const base = {
      task_type: "question_answering" as const,
      domain: "general" as const,
      complexity: "medium" as const,
      temporal_context: "single_turn" as const,
      tool_use: "none" as const,
      output_format: "natural_language" as const,
    };
    const names = resolveAutomaticTaskGroupNames([
      { id: "first", name: "Question Answering", factors: base },
      { id: "second", name: "Question Answering 2", factors: base },
      { id: "third", name: "Question Answering 3", factors: base },
    ]).map((item) => item.name);

    expect(new Set(names).size).toBe(3);
    expect(names).toEqual([
      "Question Answering (general)",
      "Question Answering (single-turn)",
      "Question Answering (no-tools)",
    ]);
    expect(names.every((name) => !/\s\d+$/.test(name))).toBe(true);
  });

  it("requests structured names through OpenRouter", async () => {
    const input = prepareTaskGroupNamingInput(groups);
    const responseNames = input.map((group, index) => ({ bucketId: group.bucketId, name: index ? "Structured Field Extraction" : "Ticket Handoff Summaries" }));
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request.temperature).toBe(0);
      expect(request.response_format.json_schema.name).toBe("task_group_names");
      expect(JSON.stringify(request.messages)).not.toContain("grounding_requirement");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ names: responseNames }) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    await expect(runTaskGroupNaming({ groups: input, apiKey: "test-key", model: "test/model", fetchImpl: fetchImpl as typeof fetch })).resolves.toEqual(responseNames);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
