import { neon } from "@neondatabase/serverless";
import type { EvalAutomationPolicy } from "../../src/core/evalLifecycle.js";
import type { Trace, TraceJudgeResult } from "../../src/types.js";
import { evaluateTraceWithDefinition } from "../../src/server/evalRuns.js";
import { serverOpenRouterKey } from "../live/_shared.js";

let initializedForUrl = "";
let initialization: Promise<unknown> | null = null;

function databaseUrl() {
  const value = String(process.env.DATABASE_URL ?? "").trim();
  if (!value) throw Object.assign(new Error("Eval automation storage is not configured."), { statusCode: 503 });
  return value;
}

function store() {
  const url = databaseUrl();
  const sql = neon(url);
  if (initializedForUrl !== url || !initialization) {
    initializedForUrl = url;
    initialization = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS routelab_eval_automation_policies (
          workspace_id text NOT NULL,
          eval_id text NOT NULL,
          eval_version integer NOT NULL,
          definition jsonb NOT NULL,
          run_on_new_traces boolean NOT NULL DEFAULT false,
          known_trace_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
          enabled_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (workspace_id, eval_id)
        )
      `;
      await sql`
        ALTER TABLE routelab_eval_automation_policies
        ADD COLUMN IF NOT EXISTS known_trace_ids jsonb NOT NULL DEFAULT '[]'::jsonb
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS routelab_runtime_eval_results (
          workspace_id text NOT NULL,
          eval_id text NOT NULL,
          trace_id text NOT NULL,
          result jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (workspace_id, eval_id, trace_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS routelab_runtime_eval_results_recent
        ON routelab_runtime_eval_results (workspace_id, created_at DESC)
      `;
    })();
  }
  return { sql, ready: initialization };
}

function policyFromRow(row: any): EvalAutomationPolicy {
  return {
    evalId: String(row.eval_id),
    evalVersion: Number(row.eval_version),
    definition: row.definition,
    runOnNewTraces: Boolean(row.run_on_new_traces),
    enabledAt: row.enabled_at ? new Date(row.enabled_at).toISOString() : null,
    knownTraceIds: Array.isArray(row.known_trace_ids) ? row.known_trace_ids.map(String) : [],
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listServerEvalAutomationPolicies(workspaceId: string) {
  const database = store();
  await database.ready;
  const rows = await database.sql`
    SELECT eval_id, eval_version, definition, run_on_new_traces, known_trace_ids, enabled_at, updated_at
    FROM routelab_eval_automation_policies
    WHERE workspace_id = ${workspaceId}
    ORDER BY updated_at DESC
  `;
  return rows.map(policyFromRow);
}

export async function saveServerEvalAutomationPolicies(workspaceId: string, policies: EvalAutomationPolicy[]) {
  const database = store();
  await database.ready;
  const retainedEvalIds = new Set(policies.map((policy) => policy.evalId));
  const existing = await database.sql`
    SELECT eval_id FROM routelab_eval_automation_policies WHERE workspace_id = ${workspaceId}
  `;
  for (const row of existing) {
    const evalId = String(row.eval_id);
    if (retainedEvalIds.has(evalId)) continue;
    await database.sql`
      DELETE FROM routelab_eval_automation_policies
      WHERE workspace_id = ${workspaceId} AND eval_id = ${evalId}
    `;
  }
  for (const policy of policies) {
    const definition = JSON.stringify(policy.definition);
    const knownTraceIds = JSON.stringify(policy.knownTraceIds);
    await database.sql`
      INSERT INTO routelab_eval_automation_policies (
        workspace_id, eval_id, eval_version, definition, run_on_new_traces, known_trace_ids, enabled_at, updated_at
      ) VALUES (
        ${workspaceId}, ${policy.evalId}, ${policy.evalVersion}, ${definition}::jsonb,
        ${policy.runOnNewTraces}, ${knownTraceIds}::jsonb, ${policy.enabledAt}, ${policy.updatedAt}
      )
      ON CONFLICT (workspace_id, eval_id) DO UPDATE SET
        eval_version = EXCLUDED.eval_version,
        definition = EXCLUDED.definition,
        run_on_new_traces = EXCLUDED.run_on_new_traces,
        known_trace_ids = EXCLUDED.known_trace_ids,
        enabled_at = EXCLUDED.enabled_at,
        updated_at = EXCLUDED.updated_at
    `;
  }
  return listServerEvalAutomationPolicies(workspaceId);
}

export async function listRuntimeEvalResults(workspaceId: string, limit = 2_000) {
  const database = store();
  await database.ready;
  const boundedLimit = Math.max(1, Math.min(5_000, Math.floor(limit) || 2_000));
  const rows = await database.sql`
    SELECT result
    FROM routelab_runtime_eval_results
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${boundedLimit}
  `;
  return rows.map((row) => row.result as TraceJudgeResult);
}

export async function saveRuntimeEvalResults(workspaceId: string, results: TraceJudgeResult[]) {
  if (!results.length) return [];
  const database = store();
  await database.ready;
  for (const result of results) {
    const evalId = String(result.eval_id ?? result.evaluator_type);
    const resultJson = JSON.stringify(result);
    await database.sql`
      INSERT INTO routelab_runtime_eval_results (workspace_id, eval_id, trace_id, result, created_at)
      VALUES (${workspaceId}, ${evalId}, ${result.trace_id}, ${resultJson}::jsonb, ${result.created_at})
      ON CONFLICT (workspace_id, eval_id, trace_id) DO UPDATE SET
        result = EXCLUDED.result,
        created_at = EXCLUDED.created_at
    `;
  }
  return results;
}

export async function evaluateTraceForAutomationPolicies({
  trace,
  policies,
  hasResult,
  evaluate,
  save,
}: {
  trace: Trace;
  policies: EvalAutomationPolicy[];
  hasResult: (policy: EvalAutomationPolicy, trace: Trace) => Promise<boolean>;
  evaluate: (policy: EvalAutomationPolicy, trace: Trace) => Promise<TraceJudgeResult>;
  save: (result: TraceJudgeResult) => Promise<void>;
}) {
  if (trace.status !== "success" || !String(trace.response_text ?? "").trim()) return [];
  const results: TraceJudgeResult[] = [];
  for (const policy of policies.filter((item) => item.runOnNewTraces)) {
    if (await hasResult(policy, trace)) continue;
    const result = await evaluate(policy, trace);
    await save(result);
    results.push(result);
  }
  return results;
}

export async function evaluateRuntimeTraceWithActivePolicies(trace: Trace, workspaceId: string) {
  const policies = (await listServerEvalAutomationPolicies(workspaceId)).filter((policy) => policy.runOnNewTraces);
  if (!policies.length) return [];
  const apiKey = serverOpenRouterKey();
  if (!apiKey) throw new Error("The server-side OpenRouter key is not configured.");
  const database = store();
  await database.ready;
  return evaluateTraceForAutomationPolicies({
    trace,
    policies,
    hasResult: async (policy, candidate) => {
      const existing = await database.sql`
        SELECT 1
        FROM routelab_runtime_eval_results
        WHERE workspace_id = ${workspaceId} AND eval_id = ${policy.evalId} AND trace_id = ${candidate.id}
        LIMIT 1
      `;
      return existing.length > 0;
    },
    evaluate: (policy, candidate) => evaluateTraceWithDefinition({
      definition: policy.definition,
      trace: candidate,
      evalVersion: policy.evalVersion,
      runId: `evalrun_runtime_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      runMode: "new_traces",
      apiKey,
    }),
    save: async (result) => { await saveRuntimeEvalResults(workspaceId, [result]); },
  });
}
