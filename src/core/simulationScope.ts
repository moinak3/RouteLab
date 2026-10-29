export type SimulationScope = {
  candidateId: string;
  dateRange: string;
  requestCount: number;
  taskGroupIds: string[];
  traceIds: string[];
};

export function simulationScopeKey(scope: SimulationScope) {
  return JSON.stringify({
    candidateId: scope.candidateId,
    dateRange: scope.dateRange,
    requestCount: scope.requestCount,
    taskGroupIds: [...scope.taskGroupIds].sort(),
    traceIds: [...scope.traceIds].sort(),
  });
}
