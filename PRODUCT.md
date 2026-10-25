# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

AI platform engineers, agent engineers, and product teams responsible for model quality, latency, cost, and production behavior. They work with production traces, application-specific evaluations, task taxonomies, model gateways, and human review.

## Product Purpose

RouteLab helps teams understand the recurring work inside AI traffic, compare candidate models against application requirements, approve task-specific model choices, and publish an inspectable routing policy. Success means a team can explain which model serves each task group, why that choice cleared its requirements, and what falls back when classification or evidence is uncertain.

## Positioning

RouteLab is the task-to-policy decision layer upstream of a model gateway. Observability products investigate traces and gateways execute calls; RouteLab connects task groups, evaluation evidence, explicit approvals, policy history, and focused review into a maintained model-routing policy.

## Operating Context

Teams import or continuously collect production traces, organize them into task groups based on intended outcomes, validate classification quality, calibrate evaluations with human evidence, replay candidate models, compare quality, latency, and cost, then publish and export a versioned policy. A customer-hosted runtime can classify incoming requests and apply approved overrides while unknown or low-confidence requests use the configured default.

## Capabilities and Constraints

- Preserve RouteLab's existing routes, product copy, seeded data, password-gated preview, interactions, and responsive behavior.
- Task discovery is an offline analysis step; discovered groups do not automatically become deployed routes.
- Runtime classification assigns requests to an approved catalog and may return unknown.
- Classifier confidence is not measured classification accuracy.
- Candidate recommendations are evidence to evaluate, not proof that a model should be deployed.
- OpenRouter is the currently implemented runtime target. Other gateway adapters are future work.
- Desktop data tables must retain horizontal scrolling where needed.
- The current experiment is visual only and must remain on its separate branch unless explicitly promoted.

## Brand Commitments

Keep the RouteLab name and existing RouteLab icon. The voice is precise, evidence-led, and candid about boundaries. Avoid generic claims, fabricated customer outcomes, and language that implies unsupported integrations or guarantees.

## Evidence on Hand

- Current production-style UI and demo data in `src/`, `fixtures/`, and `public/marketing/`.
- Current RouteLab screenshots in `public/marketing/`.
- Unit and integration tests in `tests/`, `sidecar/tests/`, and `support-demo/tests/`.
- No validated customer testimonials or externally verified savings claims are available and none should be invented.

## Product Principles

1. Every model allocation decision should be inspectable and reversible.
2. Evidence and uncertainty must remain visible rather than being collapsed into an opaque score.
3. Unknown or insufficiently supported requests should fall back conservatively.
4. RouteLab should complement tracing and gateway infrastructure rather than pretending to replace it.
5. Dense operational screens should prioritize comparison, scanning, and decision-making over decoration.

## Accessibility & Inclusion

Maintain keyboard access, visible focus states, readable contrast, responsive layouts, reduced-motion support, and a 12px minimum for visible text.
