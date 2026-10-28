import { afterEach, describe, expect, it, vi } from "vitest";
import { clearWorkspaceTraces, emptyPersonalWorkspace, loadActiveWorkspace, loadPersonalWorkspace, replaceWorkspaceTraces, saveActiveWorkspace, savePersonalWorkspace } from "../src/core/workspaces";

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

  it("keeps the selected workspace and personal evidence across reloads", () => {
    useMemoryStorage();
    const workspace = { ...emptyPersonalWorkspace(), traces: [{ id: "trace_1" }] as never[] };
    saveActiveWorkspace("demo");
    savePersonalWorkspace(workspace);
    expect(loadActiveWorkspace()).toBe("demo");
    expect(loadPersonalWorkspace().traces).toEqual([{ id: "trace_1" }]);
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
      goldenDatasets: [{ id: "golden" }],
    });
  });
});
