import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScenarioMetricRows, type ScenarioMetric } from "../src/components/SimulationMetricRows";

const rows: ScenarioMetric[] = [{
  label: "Average eval score",
  before: "63.5%",
  after: "50.0%",
  change: "-13.5 pts",
  good: false,
}];

describe("simulation result display", () => {
  it("keeps current evidence visible but clears candidate and impact values during a fresh live replay", () => {
    const markup = renderToStaticMarkup(<ScenarioMetricRows rows={rows} pending requiresLiveReplay={false} />);

    expect(markup).toContain("63.5%");
    expect(markup).not.toContain("50.0%");
    expect(markup).not.toContain("-13.5 pts");
    expect(markup.match(/aria-busy="true"/g)).toHaveLength(2);
  });

  it("renders completed candidate evidence as soon as the replay result is available", () => {
    const markup = renderToStaticMarkup(<ScenarioMetricRows rows={rows} pending={false} requiresLiveReplay={false} />);

    expect(markup).toContain("50.0%");
    expect(markup).toContain("-13.5 pts");
    expect(markup).toContain('class="warn"');
  });
});
