import type { DistinctTaskBucket, TraceJudgeResult } from "../types";

export type QualityHistoryMonth = {
  key: string;
  label: string;
};

export type TaskGroupQualityPoint = QualityHistoryMonth & {
  averageScore: number;
  count: number;
};

export type TaskGroupQualitySeries = {
  id: string;
  label: string;
  resultCount: number;
  points: Array<TaskGroupQualityPoint | null>;
};

const monthLabel = (date: Date) => date.toLocaleString("en-US", { month: "short" });

export function taskGroupQualityHistory(
  results: TraceJudgeResult[],
  taskGroups: DistinctTaskBucket[],
  maxNamedGroups = 5,
) {
  const traceToGroup = new Map<string, DistinctTaskBucket>();
  taskGroups.forEach((group) => group.traces.forEach((traceId) => traceToGroup.set(traceId, group)));

  const validResults = results.flatMap((result) => {
    const date = new Date(result.created_at);
    const group = traceToGroup.get(result.trace_id);
    if (!group || Number.isNaN(date.getTime())) return [];
    return [{
      result,
      group,
      monthKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      monthLabel: monthLabel(date),
    }];
  });

  const months = Array.from(new Map(
    validResults.map((item) => [item.monthKey, { key: item.monthKey, label: item.monthLabel }]),
  ).values()).sort((left, right) => left.key.localeCompare(right.key)).slice(-6);
  const visibleMonthKeys = new Set(months.map((month) => month.key));

  const groupCounts = new Map<string, number>();
  validResults.forEach(({ group, monthKey }) => {
    if (visibleMonthKeys.has(monthKey)) groupCounts.set(group.bucket_id, (groupCounts.get(group.bucket_id) ?? 0) + 1);
  });
  const namedGroupIds = new Set(
    [...groupCounts.entries()]
      .sort(([leftId, leftCount], [rightId, rightCount]) => rightCount - leftCount || leftId.localeCompare(rightId))
      .slice(0, maxNamedGroups)
      .map(([groupId]) => groupId),
  );
  const hasOtherGroups = [...groupCounts.keys()].some((groupId) => !namedGroupIds.has(groupId));
  const seriesIds = [...namedGroupIds, ...(hasOtherGroups ? ["other"] : [])];
  const taskGroupById = new Map(taskGroups.map((group) => [group.bucket_id, group]));

  const series: TaskGroupQualitySeries[] = seriesIds.map((seriesId) => {
    const matching = validResults.filter(({ group, monthKey }) => (
      visibleMonthKeys.has(monthKey)
      && (seriesId === "other" ? !namedGroupIds.has(group.bucket_id) : group.bucket_id === seriesId)
    ));
    return {
      id: seriesId,
      label: seriesId === "other" ? "Other Task Groups" : taskGroupById.get(seriesId)?.bucket_name ?? seriesId,
      resultCount: matching.length,
      points: months.map((month) => {
        const monthResults = matching.filter((item) => item.monthKey === month.key);
        if (!monthResults.length) return null;
        return {
          ...month,
          count: monthResults.length,
          averageScore: monthResults.reduce((sum, item) => sum + item.result.score, 0) / monthResults.length,
        };
      }),
    };
  });

  return { months, series };
}
