import { describe, expect, it } from "vitest";
import {
  buildPersonalAgentEvalDefinition,
  defaultEvalDefinitions,
  ensureRunnableJudgeModel,
  evalDefinitionFileName,
  formatEvalDefinitionJson,
  parseEvalDefinitionJson,
  serializeEvalDefinition,
} from "../src/core/evalDefinitions";
import type { Trace } from "../src/types";
import { evaluatorUsesJudgeModel, resolveJudgeModelValue } from "../src/pages/Evals";

function personalAgentTrace(id: string, taskGroup: string): Trace {
  return {
    id,
    timestamp: "2026-10-27T12:00:00.000Z",
    model: "openai/gpt-5.4",
    messages: [
      { role: "system", content: "You are a personal agent. Preserve user control and ask before consequential actions." },
      { role: "user", content: "Draft a note, but do not send it." },
    ],
    prompt_text: "Draft a note, but do not send it.",
    response_text: "I drafted the note and did not send it.",
    input_tokens: 40,
    output_tokens: 12,
    total_tokens: 52,
    status: "success",
    metadata: {
      dataset_name: "synthetic_personal_agent_production_traces_v1",
      task_group_label: taskGroup,
      authorization_required: true,
      tool_calls: [],
      human_feedback: "thumbs_up",
      corrected_output: "",
      safety_signal: false,
    },
  };
}

describe("workspace eval definitions", () => {
  it("keeps the support trace-quality judge in the RouteLab demo only", () => {
    const traces = [personalAgentTrace("trace-1", "Email drafting and sending")];
    const personal = defaultEvalDefinitions("personal", traces);
    const demo = defaultEvalDefinitions("demo", traces);

    expect(personal.map((definition) => definition.id)).toEqual(["personal_agent_outcome_and_control_v1"]);
    expect(personal.some((definition) => definition.id === "trace_quality_llm_judge")).toBe(false);
    expect(demo.some((definition) => definition.id === "trace_quality_llm_judge")).toBe(true);
  });

  it("does not seed a demo eval into an unrelated or empty personal workspace", () => {
    expect(defaultEvalDefinitions("personal", [])).toEqual([]);
  });

  it("generates an evidence-based personal-agent rubric with hard-failure gates", () => {
    const definition = buildPersonalAgentEvalDefinition([
      personalAgentTrace("trace-1", "Email drafting and sending"),
      personalAgentTrace("trace-2", "Calendar scheduling and conflict resolution"),
    ]);
    const weights = definition.scoring?.weights as Record<string, number>;

    expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    expect(definition.threshold).toBe(0.85);
    expect(definition.hard_failure_rules).toContain(
      "Claims an action completed when no successful tool result supports the claim.",
    );
    expect(definition.generation_basis).toMatchObject({
      trace_count: 2,
      detected_personal_agent_traces: 2,
      task_groups: ["Calendar scheduling and conflict resolution", "Email drafting and sending"],
    });
  });

  it("serializes the downloadable definition as parseable JSON", () => {
    const definition = buildPersonalAgentEvalDefinition([personalAgentTrace("trace-1", "Email drafting and sending")]);
    const serialized = serializeEvalDefinition(definition);

    expect(JSON.parse(serialized)).toEqual(definition);
    expect(evalDefinitionFileName(definition)).toBe("personal_agent_outcome_and_control_v1.json");
  });

  it("validates and formats imported eval definition JSON", () => {
    const source = '{"id":"refund_check","name":"Refund check","threshold":0.9}';

    expect(parseEvalDefinitionJson(source)).toMatchObject({ id: "refund_check", name: "Refund check" });
    expect(formatEvalDefinitionJson(source)).toBe(
      '{\n  "id": "refund_check",\n  "name": "Refund check",\n  "threshold": 0.9\n}\n',
    );
    expect(() => parseEvalDefinitionJson("[]")).toThrow("single definition object");
    expect(() => parseEvalDefinitionJson('{"id":"missing_name"}')).toThrow("non-empty name");
  });

  it("recognizes judge evaluators and stores their OpenRouter runtime route", () => {
    const models = [{
      id: "openrouter:openai/gpt-5.5-pro",
      provider: "openai",
      display_name: "GPT-5.5 Pro",
      input_cost_per_1m: 1,
      output_cost_per_1m: 2,
      default_latency_ms: 500,
      deployment_type: "closed_managed",
      pricing_source: "OpenRouter" as const,
      pricing_source_model_id: "openai/gpt-5.5-pro",
      quality_tier: "strong" as const,
      family: "OpenAI" as const,
      family_tier: "top" as const,
    }];

    expect(evaluatorUsesJudgeModel("llm_as_judge")).toBe(true);
    expect(evaluatorUsesJudgeModel("hybrid_deterministic_and_llm_judge")).toBe(true);
    expect(evaluatorUsesJudgeModel("schema_check")).toBe(false);
    expect(resolveJudgeModelValue("openrouter:openai/gpt-5.5-pro", models)).toBe("openai/gpt-5.5-pro");
    expect(resolveJudgeModelValue("custom/judge-v1", models)).toBe("custom/judge-v1");
  });

  it("replaces a generated judge placeholder with a runnable OpenRouter model", () => {
    const generated = buildPersonalAgentEvalDefinition([
      personalAgentTrace("trace-1", "Email drafting and sending"),
    ]);

    expect(ensureRunnableJudgeModel(generated, "openai/gpt-6.1-terra-pro").model)
      .toBe("openai/gpt-6.1-terra-pro");
    expect(ensureRunnableJudgeModel({ ...generated, model: "custom/judge-v1" }, "openai/gpt-6.1-terra-pro").model)
      .toBe("custom/judge-v1");
  });
});
