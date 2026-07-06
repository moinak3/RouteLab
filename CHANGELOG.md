# RouteLab Change Log

## Auditability and Evidence Pass

- Part A: Updated marketing headline, CTA, ICP positioning, guardrail-approved terminology, assessment copy, allocation explanation, fine-tuning language, proof chips, Golden Dataset calibration screenshot target, competitive contrast, scope note, and regenerated marketing screenshots.
- Part B: Rebuilt the demo trace dataset around 16 support-realistic distinct tasks, realistic prompts/responses, varied judge rationales, full trace IDs, and removed user-visible demo scaffolding strings.
- Part C: Added a shared economics module for uploaded sample cost, monthly projection, approved savings, rejected savings, and raw savings ceiling; Overview now shows the arithmetic chain.
- Part D: Fixed deterministic cascade behavior so failing cheap-model traces escalate, re-score on fallback, and include both-pass cost and latency.
- Part E: Replaced the bare trace file input with a guided upload modal, templates, drag-and-drop, example dataset loading, and row-level ingestion errors.
- Part F: Compact trace rows, moved judge rationale into tooltip/drawer surfaces, fixed nav scroll reset, added workflow filtering from the trace drawer, polished model-catalog local pricing and missing-signal messaging, and clarified simulation scope.
- Part G: Seeded multiple eval definitions, added working JSON import and create-eval flows, task scope display, and chart axis labels/tooltips.
- Part H: Added sponsored-candidate disclosure, clipboard-plus-download exports, model/provider route labels, and evidence summaries for keep-current recommendations.
- Part I: Added per-request simulation scope honesty and workflow navigation without claiming trajectory-level guarantees.

## QA

- `npm run build`
- `npm run test`
- `git diff --check`
- Production forbidden-string audit for old demo scaffolding.
