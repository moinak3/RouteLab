# RouteLab design cleanup

## Codebase map

- Global CSS and tokens: `src/styles.css`; landing-specific rules: `src/styles/home.css`; page-specific rules: `src/styles/*.css`.
- Marketing landing: `src/pages/Home.tsx`, with navigation, hero, problem, why-now, positioning, steps, assessment, ICP, trust, final CTA and password dialog in one component.
- App shell and navigation: `src/App.tsx`; page identity is defined in `src/types/ui.ts`.
- Product pages: `src/pages/Overview.tsx`, `Traces.tsx`, `DistinctTasks.tsx`, `Evals.tsx`, `GoldenDataset.tsx`, `ReviewQueue.tsx`, `Simulations.tsx`, `Recommendations.tsx`, `ModelCatalog.tsx`, `FrontierModelLab.tsx` and `FineTuning.tsx`.
- Demo traces and task definitions: `src/core/seed.ts`; exported fixtures: `fixtures/seed_traces.jsonl` and `fixtures/seed_model_catalog.json`.
- Golden dataset and calibration: `src/core/goldenDatasets.ts`; judge results: `src/core/traceJudge.ts`; review selection: `src/core/reviewQueue.ts`.
- Simulation replay: `src/core/simulations.ts`; routing recommendations and exports: `src/core/recommendations.ts`; policy drafts: `src/core/routingDraft.ts` and `src/core/useRoutingPolicyDraft.ts`.
- Model catalog and pricing: `src/core/catalog.ts` and `src/core/providerPricing.ts`.
- Existing economics: `src/core/economics.ts`, plus page-local arithmetic in `Overview.tsx`, `Simulations.tsx`, `Recommendations.tsx` and `FineTuning.tsx`.
- Landing screenshots: `public/marketing/traces.jpg`, `evals.jpg`, `simulations.jpg`, `policy-builder.jpg`, and `policy-enforcement.jpg`; capture entrypoint: `scripts/capture-marketing-screenshots.mjs`.

## Judgment calls

- Keep Benchmarking's Astra, Sol and Opus models and add them to the shared catalog, because those named models are central to the existing interview demo.
- Treat the uploaded traces as a deterministic representative sample. The generator stores the monthly-call representation explicitly; all monthly economics use that factor instead of a fixed 30-day multiplier.
- Keep RouteLab's signed-policy work on this branch and reshape it into the requested Policy pages rather than discarding it.
- Keep the DeepSeek sponsored evaluation panel unchanged except for inherited global typography, tokens, formatting and shared economics.
- Use Inter Variable and DM Mono as local npm assets. No runtime font request is required.

## TODO(moinak)

- Replace `mailto:TODO@routelab.dev` in `ASSESSMENT_URL` with the assessment intake URL.
- Replace the support-team target line with a measured replay result.
- Replace `SAMPLE_REPORT_URL` with the final sample assessment report.
- Complete the trace-handling copy for Storage, Isolation, Retention and deletion, and Subprocessors.

## Workstream status

- [x] 1. Data and economics
- [ ] 2. Bugs and layout
- [ ] 3. Design system
- [ ] 4. Copy
- [ ] 5. Information architecture
- [ ] 6. Verification

## Incomplete items

- None yet.
