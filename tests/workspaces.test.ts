import { afterEach, describe, expect, it, vi } from "vitest";
import { clearWorkspaceTraces, emptyPersonalWorkspace, inferTaskGroupingMethod, loadActiveWorkspace, loadCloudWorkspaceId, loadPersonalWorkspace, replaceWorkspaceTraces, saveActiveWorkspace, savePersonalWorkspace } from "../src/core/workspaces";

function useMemoryStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
}

describe("workspace persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts a fresh browser in an empty personal workspace", () => {
    useMemoryStorage();
    expect(loadActiveWorkspace()).toBe("personal");
    expect(loadPersonalWorkspace()).toEqual(emptyPersonalWorkspace());
  });

  it("gives My Workspace a stable cloud identity separate from the demo", () => {
    useMemoryStorage();
    const first = loadCloudWorkspaceId("personal");
    expect(first).toMatch(/^personal_[a-z0-9]+$/);
    expect(loadCloudWorkspaceId("personal")).toBe(first);
    expect(loadCloudWorkspaceId("demo")).toBe("demo");
  });

  it("keeps the selected workspace and personal evidence across reloads", () => {
    useMemoryStorage();
    const workspace = { ...emptyPersonalWorkspace(), traces: [{ id: "trace_1" }] as never[] };
    saveActiveWorkspace("demo");
    savePersonalWorkspace(workspace);
    expect(loadActiveWorkspace()).toBe("demo");
    expect(loadPersonalWorkspace().traces).toEqual([{ id: "trace_1" }]);
  });

  it("restores the latest task grouping approach for existing workspaces", () => {
    expect(inferTaskGroupingMethod([{ bucket_id: "task_rules" }] as never[])).toBe("rules");
    expect(inferTaskGroupingMethod([{ bucket_id: "llm_discovered" }] as never[])).toBe("llm");
    expect(inferTaskGroupingMethod([])).toBeUndefined();
  });

  it("migrates automatic factor-list names to short unique summaries", () => {
    useMemoryStorage();
    const task = {
      task_type: "tool_use_function_calling", domain: "security", complexity: "high", temporal_context: "early_multi_turn",
      tool_use: "success", output_uncertainty: "low", output_format: "natural_language", grounding_requirement: "none",
    };
    savePersonalWorkspace({
      ...emptyPersonalWorkspace(),
      taskGroups: [
        { bucket_id: "one", bucket_name: "security tool use function calling, high complexity", name_source: "heuristic", task },
        { bucket_id: "two", bucket_name: "billing tool use function calling, early multi turn", name_source: "heuristic", task: { ...task, domain: "billing" } },
      ] as never[],
    });
    const names = loadPersonalWorkspace().taskGroups.map((group) => group.bucket_name);
    expect(names).toEqual(["Tool Requests (security)", "Tool Requests (billing)"]);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(2);
  });

  it("preserves names explicitly edited by a user", () => {
    useMemoryStorage();
    const task = {
      task_type: "question_answering", domain: "general", complexity: "low", temporal_context: "single_turn",
      tool_use: "none", output_uncertainty: "low", output_format: "natural_language", grounding_requirement: "none",
    };
    savePersonalWorkspace({ ...emptyPersonalWorkspace(), taskGroups: [{ bucket_id: "one", bucket_name: "My Carefully Chosen Support Name", name_source: "user", task }] as never[] });
    expect(loadPersonalWorkspace().taskGroups[0].bucket_name).toBe("My Carefully Chosen Support Name");
  });

  it("imports traces without creating classifications or judge results", () => {
    const workspace = {
      ...emptyPersonalWorkspace(),
      traceJudgeResults: [{ trace_id: "old" }] as never[],
      taskGroups: [{ bucket_id: "old" }] as never[],
      goldenDatasets: [{ id: "golden" }] as never[],
    };
    const imported = replaceWorkspaceTraces(workspace, [{ id: "trace_1" }] as never[]);
    expect(imported.traces).toEqual([{ id: "trace_1" }]);
    expect(imported.traceJudgeResults).toEqual([]);
    expect(imported.taskGroups).toEqual([]);
    expect(imported.taskGroupingMethod).toBeUndefined();
    expect(imported.goldenDatasets).toEqual([{ id: "golden" }]);
  });

  it("clears traces and derived state without deleting golden datasets", () => {
    const workspace = {
      ...emptyPersonalWorkspace(),
      traces: [{ id: "trace_1" }] as never[],
      traceJudgeResults: [{ trace_id: "trace_1" }] as never[],
      taskGroups: [{ bucket_id: "group_1" }] as never[],
      goldenDatasets: [{ id: "golden" }] as never[],
    };
    expect(clearWorkspaceTraces(workspace)).toEqual({
      traces: [],
      traceJudgeResults: [],
      taskGroups: [],
      taskGroupingMethod: undefined,
      goldenDatasets: [{ id: "golden" }],
    });
  });
});
