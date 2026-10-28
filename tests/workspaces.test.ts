import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyPersonalWorkspace, loadActiveWorkspace, loadPersonalWorkspace, saveActiveWorkspace, savePersonalWorkspace } from "../src/core/workspaces";

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
});
