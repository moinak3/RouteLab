# RouteLab

RouteLab is an offline-first routing observability and counterfactual simulation lab for historical LLM traffic. It shows where spend goes, infers Distinct Tasks, replays traces against deterministic mock models, simulates cheap-first cascades, and exports deployable routing policies.

## Run locally

```bash
npm install
npm run dev
```

The app opens with 12,500 deterministic enterprise-scale example traces spread over six months, with 50% in the latest two months. Use **Upload traces** to replace them with CSV, JSON, or JSONL data.

## Verify

```bash
npm run eval
npm run eval:golden
```

`npm run eval` runs the unit/integration suite and a production build. The golden eval loads 12,500 traces, infers Distinct Tasks, runs cost-only, replay, cascade, recommendation, and export workflows.

## Seed data

```bash
npm run seed
```

This creates `fixtures/seed_traces.jsonl` and `fixtures/seed_model_catalog.json`. The seed traffic uses a believable mixed baseline: cheap/balanced models handle routine work, while strong models are concentrated in legal/compliance and harder workflows. Hosted-model token prices are sourced from OpenRouter's public model catalog and record the exact source model plus refresh date in `src/core/catalog.ts`; uploaded traces with missing costs are priced from it.

## Two-level trace ingestion

RouteLab always normalizes each LLM call into a flat trace for cost, latency, Distinct Task inference, and model simulation. It also preserves optional workflow context using:

- `workflow_id`
- `node_id`
- `parent_node_id`
- `workflow_role`: `planner`, `retriever`, `retriever_summarizer`, `tool_caller`, `final_answer`, `judge`, or `other`
- `span_name`

These fields work in CSV, JSON, and JSONL. JSON can also contain nested `workflows[].nodes[].children[]`; RouteLab flattens the LLM calls while reconstructing the workflow tree.

## Architecture

- `src/core/ingestion.ts`: CSV/JSON/JSONL normalization, nested workflow flattening, and trace-tree reconstruction
- `src/core/analysis.ts`: dashboard metrics and risk heuristics
- `src/core/distinctTasks.ts`: deterministic Distinct Task inference and exact-task grouping
- `src/core/benchmarkPriors.ts`: Distinct Task to public-benchmark prior mapping and suggested candidate model shortlists for SignalEval simulation
- `src/core/simulations.ts`: cost-only, mock replay, and cascade simulation
- `src/core/evaluators.ts`: exact match, JSON Schema, regex, and mock judge
- `src/core/recommendations.ts`: risk-aware policy recommendations and exports
- `src/App.tsx`: local React UI

## Privacy and external providers

RouteLab runs locally, uses the deterministic MockProvider by default, and never calls an external model API. `ROUTELAB_ALLOW_EXTERNAL_MODELS=false` is the default in `.env.example`. External provider adapters are intentionally not enabled in this MVP.

## Distinct Tasks and eval plans

The **Distinct Tasks** page infers what each loaded trace is without requiring a manually assigned task type. It classifies task, domain, complexity, temporal/session context, tool need and outcome, expressed output uncertainty, output format, grounding, risk, and user visibility; groups exact matching tasks into buckets; and generates a recommended eval plan for every bucket. Complexity uses token volume as one input, but also considers semantic density, reasoning requirements, tools, grounding, constraints, repetition, historical difficulty, and optional embedding or LLM difficulty scores. Multi-turn, tool-failure, and confidence-calibration signals generate specialized eval requirements and stricter routing evidence. Simulations and routing recommendations use these same Distinct Task buckets as their workload scope.

```bash
npm run eval:distinct-tasks
```

This runs the 30-trace, 10-bucket golden evaluation and writes `artifacts/trace-task-report.json` and `artifacts/eval-plan-report.json`.

The eval plan report also includes `benchmark_prior` for each Distinct Task. These priors map tasks to public benchmark families such as SWE-bench, Terminal-Bench, tau-bench, BFCL, WebArena/WebVoyager, OSWorld, expert reasoning, and long-context tests. They only produce **suggested candidate models to simulate** in SignalEval; they are not best-model claims.

## Policy exports

The Recommendations page exports RouteLab JSON, LiteLLM-style YAML, and a TypeScript router stub.

## Limitations

The MVP keeps data in browser memory, uses deterministic Distinct Task inference for testability, and does not include authentication, live production routing, or external LLM replay.
