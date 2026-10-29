export type ScenarioMetric = {
  label: string;
  before: string;
  after: string;
  change: string;
  good: boolean;
};

export function ScenarioMetricRows({ rows, pending, requiresLiveReplay }: {
  rows: ScenarioMetric[];
  pending: boolean;
  requiresLiveReplay: boolean;
}) {
  return <>{rows.map((row) => <div className="scenario-metric-row" key={row.label}>
    <b>{row.label}</b>
    <span>{row.before}</span>
    <strong aria-busy={pending}>{pending ? null : requiresLiveReplay ? "Run live replay" : row.after}</strong>
    <em
      className={pending ? undefined : requiresLiveReplay ? "warn" : row.good ? "good" : "warn"}
      aria-busy={pending}
    >{pending ? null : requiresLiveReplay ? "not estimated" : row.change}</em>
  </div>)}</>;
}
