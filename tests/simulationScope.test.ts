import { describe, expect, it } from "vitest";
import { simulationScopeKey } from "../src/core/simulationScope";

const scope = {
  candidateId: "openai/gpt-6.1-sol",
  dateRange: "30d",
  requestCount: 2,
  taskGroupIds: ["billing", "support"],
  traceIds: ["trace-2", "trace-1"],
};

describe("simulation scope", () => {
  it("stays stable when equivalent arrays are recreated or reordered", () => {
    expect(simulationScopeKey(scope)).toBe(simulationScopeKey({
      ...scope,
      taskGroupIds: ["support", "billing"],
      traceIds: ["trace-1", "trace-2"],
    }));
  });

  it("changes when the effective simulation inputs change", () => {
    expect(simulationScopeKey(scope)).not.toBe(simulationScopeKey({ ...scope, candidateId: "openai/gpt-6.1-terra" }));
    expect(simulationScopeKey(scope)).not.toBe(simulationScopeKey({ ...scope, requestCount: 1 }));
    expect(simulationScopeKey(scope)).not.toBe(simulationScopeKey({ ...scope, traceIds: ["trace-1"] }));
  });
});
