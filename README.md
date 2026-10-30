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
- `sidecar/`: signed-policy consumer and OpenAI-compatible routing proxy for customer environments
- `support-demo/`: standalone customer-support chat and live sidecar routing inspector
- `src/App.tsx`: local React UI

## Privacy and external providers

RouteLab runs locally and uses the deterministic MockProvider by default. Live simulation and the customer-hosted sidecar only call external providers when an OpenRouter key is explicitly configured. The sidecar sends classification and completion traffic directly from the customer's environment to OpenRouter; RouteLab Cloud only serves the signed policy bundle.

## Distinct Tasks and eval plans

The **Distinct Tasks** page infers what each loaded trace is without requiring a manually assigned task type. It classifies task, domain, complexity, temporal/session context, tool need and outcome, expressed output uncertainty, output format, grounding, risk, and user visibility; groups exact matching tasks into buckets; and generates a recommended eval plan for every bucket. Complexity uses token volume as one input, but also considers semantic density, reasoning requirements, tools, grounding, constraints, repetition, historical difficulty, and optional embedding or LLM difficulty scores. Multi-turn, tool-failure, and confidence-calibration signals generate specialized eval requirements and stricter routing evidence. Simulations and routing recommendations use these same Distinct Task buckets as their workload scope.

```bash
npm run eval:distinct-tasks
```

This runs the 30-trace, 10-bucket golden evaluation and writes `artifacts/trace-task-report.json` and `artifacts/eval-plan-report.json`.

The eval plan report also includes `benchmark_prior` for each Distinct Task. These priors map tasks to public benchmark families such as SWE-bench, Terminal-Bench, tau-bench, BFCL, WebArena/WebVoyager, OSWorld, expert reasoning, and long-context tests. They only produce **suggested candidate models to simulate** in SignalEval; they are not best-model claims.

## Policy exports

The Recommendations page exports RouteLab JSON, LiteLLM-style YAML, and a TypeScript router stub.

Routing Simulations can also publish and deploy an immutable signed policy for the Docker-ready customer sidecar. The sidecar classifies each incoming conversation into a published trace bucket using its messages, tools, tool calls, and requested output; then it applies the bucket override or the general fallback and proxies the request to OpenRouter. See [`sidecar/README.md`](sidecar/README.md).

The standalone test console exercises that path end to end and shows each routing decision beside the customer conversation. After starting the sidecar, run it with:

```bash
ROUTELAB_SIDECAR_URL=http://127.0.0.1:8787 \
ROUTELAB_SIDECAR_API_KEY=replace-with-exported-key \
npm run support-demo
```

Open `http://127.0.0.1:8790`. The console server keeps the sidecar credential out of browser code. See [`support-demo/README.md`](support-demo/README.md).

The production Vercel build also serves a stateless demonstration at `/support-console/` backed by authenticated `/api/sidecar/*` routes. Real customer deployments should use the Docker sidecar so model traffic and credentials remain in the customer's environment.

Policy publishing requires `DATABASE_URL` plus an Ed25519 PKCS8 private key and SPKI public key, both base64 encoded, in `ROUTELAB_POLICY_SIGNING_PRIVATE_KEY` and `ROUTELAB_POLICY_SIGNING_PUBLIC_KEY`. Sidecars pin the exported public key and reject modified, unexpectedly signed, or expired bundles.

## Limitations

Uploaded trace data remains browser-local, model simulations default to deterministic fixtures, and the sidecar currently targets OpenRouter's Decisions and Chat Completions APIs. Enterprise identity, multi-tenant authorization, and direct non-OpenRouter runtime adapters are not included.
